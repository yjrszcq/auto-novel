import 'fake-indexeddb/auto';

import { deleteDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  ChapterTranslation,
  LocalVolumeChapter,
  LocalVolumeMetadata,
} from '../src/model/LocalVolume';
import type { ReaderBookmark, ReaderProgress } from '../src/model/Reader';
import { createLocalVolumeDao } from '../src/stores/local/LocalVolumeDao';
import {
  prepareTxtCatalogRebuild,
  rebuildTxtVolume,
  reconstructTxtVolumeText,
} from '../src/stores/local/RebuildTxtVolume';
import { parseTxtCatalog } from '../src/util/file/TxtCatalogParser';
import { decodeTxtText } from '../src/util/file/TxtDecode';

const databaseName = 'rebuild-txt-volume-test';
const bookId = 'rebuild.txt';
const text = ['前言', '第一章 开始', '甲', '乙', '第二章 继续', '丙'].join(
  '\n',
);
const segmentIds = [
  '0dff1642-a362-4ca1-886a-6d66c7fff001',
  '0dff1642-a362-4ca1-886a-6d66c7fff002',
  '0dff1642-a362-4ca1-886a-6d66c7fff003',
  '0dff1642-a362-4ca1-886a-6d66c7fff004',
  '0dff1642-a362-4ca1-886a-6d66c7fff005',
  '0dff1642-a362-4ca1-886a-6d66c7fff006',
];

const translation = (
  prefix: string,
  start: number,
  end: number,
  length = end - start,
): ChapterTranslation => ({
  glossaryId: 'current-glossary',
  glossary: { 人名: '译名' },
  paragraphs: Array.from({ length }, (_, index) => `${prefix}${start + index}`),
});

const createFixture = () => {
  const metadata: LocalVolumeMetadata = {
    id: bookId,
    createAt: 1,
    toc: [
      {
        chapterId: 'old-a',
        title: '旧分段一',
        gpt: 'current-glossary',
        sakura: 'current-glossary',
        baidu: 'current-glossary',
        youdao: 'current-glossary',
      },
      {
        chapterId: 'old-b',
        title: '旧分段二',
        gpt: 'current-glossary',
        baidu: 'current-glossary',
        youdao: 'current-glossary',
      },
    ],
    sourceFormat: 'txt',
    glossaryId: 'current-glossary',
    glossary: { 人名: '译名' },
    favoredId: 'default',
    sourceBookMetadata: { title: '重建测试', languages: ['ja'] },
  };
  const chapters: LocalVolumeChapter[] = [
    {
      id: `${bookId}/old-a`,
      volumeId: bookId,
      paragraphs: text.split('\n').slice(0, 3),
      segmentIds: segmentIds.slice(0, 3),
      gpt: translation('g', 0, 3),
      sakura: translation('s', 0, 3),
      baidu: translation('b', 0, 3),
      youdao: translation('y', 0, 3),
    },
    {
      id: `${bookId}/old-b`,
      volumeId: bookId,
      paragraphs: text.split('\n').slice(3),
      segmentIds: segmentIds.slice(3),
      gpt: translation('g', 3, 6),
      baidu: translation('b', 3, 6),
      youdao: translation('y', 3, 6, 2),
    },
  ];
  const progress: ReaderProgress = {
    bookId,
    chapterId: 'old-a',
    segmentId: segmentIds[2],
    segmentOffset: 4,
    scrollRatio: 0.5,
    mode: 'translated-original',
    updatedAt: 20,
  };
  const bookmarks: ReaderBookmark[] = [
    {
      id: 'bookmark-1',
      bookId,
      chapterId: 'old-b',
      segmentId: segmentIds[1],
      sourceLine: 4,
      languageSide: 'translated',
      offsetRatio: 0.4,
      viewportTopOffset: 12,
      createdAt: 10,
    },
  ];
  return { metadata, chapters, progress, bookmarks };
};

afterEach(async () => {
  await deleteDB(databaseName);
});

describe('safe TXT catalog rebuild', () => {
  it('resegments losslessly, preserves complete sources and remaps anchors', () => {
    const fixture = createFixture();
    const plan = parseTxtCatalog(decodeTxtText(text));
    const result = prepareTxtCatalogRebuild({ ...fixture, plan });

    expect(result.preservedTranslations).toEqual(['gpt', 'baidu']);
    expect(result.clearedTranslations).toEqual(['sakura', 'youdao']);
    expect(result.metadata.toc.map((entry) => entry.title)).toEqual([
      '前言',
      '第一章 开始',
      '第二章 继续',
    ]);
    expect(result.metadata.toc.every((entry) => entry.gpt)).toBe(true);
    expect(result.metadata.toc.every((entry) => entry.baidu)).toBe(true);
    expect(result.metadata.toc.some((entry) => entry.sakura)).toBe(false);
    expect(result.chapters.flatMap((chapter) => chapter.paragraphs)).toEqual(
      text.split('\n'),
    );
    expect(result.chapters.flatMap((chapter) => chapter.segmentIds)).toEqual(
      segmentIds,
    );
    expect(
      result.chapters.flatMap((chapter) => chapter.sourceLines ?? []),
    ).toEqual([0, 1, 2, 3, 4, 5]);
    expect(
      result.chapters.flatMap((chapter) => chapter.gpt!.paragraphs),
    ).toEqual(['g0', 'g1', 'g2', 'g3', 'g4', 'g5']);
    expect(result.progress).toMatchObject({
      sourceLine: 2,
      segmentId: segmentIds[2],
      segmentOffset: 4,
      mode: 'translated-original',
    });
    expect(result.progress?.chapterId).toBe(result.metadata.toc[1]?.chapterId);
    expect(result.bookmarks[0]).toMatchObject({
      id: 'bookmark-1',
      sourceLine: 4,
      segmentId: segmentIds[4],
      languageSide: 'translated',
      offsetRatio: 0.4,
    });
    expect(result.bookmarks[0]?.chapterId).toBe(
      result.metadata.toc[2]?.chapterId,
    );
    expect(reconstructTxtVolumeText(fixture.metadata, fixture.chapters)).toBe(
      text,
    );
  });

  it('atomically replaces chapters and clears related reader caches', async () => {
    const dao = await createLocalVolumeDao(databaseName);
    const fixture = createFixture();
    await dao.createVolume({
      metadata: fixture.metadata,
      file: new File([text], bookId),
      chapters: fixture.chapters,
    });
    await dao.putReaderProgress(fixture.progress);
    await dao.putReaderBookmark(fixture.bookmarks[0]!);
    await dao.putReaderChapterCache({
      key: `${bookId}/old-a`,
      bookId,
      chapterId: 'old-a',
      contentRevision: 'old',
      cachedAt: 1,
    });

    const result = await rebuildTxtVolume(
      dao,
      bookId,
      parseTxtCatalog(decodeTxtText(text)),
    );

    expect(await dao.getChapter(bookId, 'old-a')).toBeUndefined();
    expect(await dao.listChapterByVolumeId(bookId)).toHaveLength(3);
    expect(await dao.getMetadata(bookId)).toEqual(result.metadata);
    expect(await dao.getReaderProgress(bookId)).toEqual(result.progress);
    expect(await dao.listReaderBookmarks(bookId)).toEqual(result.bookmarks);
    expect(await dao.listReaderChapterCaches(bookId)).toEqual([]);
    dao.close();
  });

  it('rolls back every store when a replacement write fails', async () => {
    const dao = await createLocalVolumeDao(databaseName);
    const fixture = createFixture();
    await dao.createVolume({
      metadata: fixture.metadata,
      file: new File([text], bookId),
      chapters: fixture.chapters,
    });
    await dao.putReaderProgress(fixture.progress);
    await dao.putReaderBookmark(fixture.bookmarks[0]!);
    await dao.putReaderChapterCache({
      key: `${bookId}/old-a`,
      bookId,
      chapterId: 'old-a',
      contentRevision: 'old',
      cachedAt: 1,
    });
    const invalidChapter = {
      ...fixture.chapters[0],
      id: `${bookId}/replacement`,
      paragraphs: [() => undefined],
    } as unknown as LocalVolumeChapter;

    await expect(
      dao.replaceTxtCatalog({
        bookId,
        expectedChapterIds: fixture.metadata.toc.map(
          ({ chapterId }) => chapterId,
        ),
        metadata: { ...fixture.metadata, toc: [] },
        chapters: [invalidChapter],
        progress: undefined,
        bookmarks: [],
      }),
    ).rejects.toBeDefined();
    expect(await dao.getMetadata(bookId)).toEqual(fixture.metadata);
    expect(await dao.listChapterByVolumeId(bookId)).toEqual(fixture.chapters);
    expect(await dao.getReaderProgress(bookId)).toEqual(fixture.progress);
    expect(await dao.listReaderBookmarks(bookId)).toEqual(fixture.bookmarks);
    expect(await dao.listReaderChapterCaches(bookId)).toHaveLength(1);
    dao.close();
  });

  it('rejects a stale preview or reading state from another book', async () => {
    const dao = await createLocalVolumeDao(databaseName);
    const fixture = createFixture();
    await dao.createVolume({
      metadata: fixture.metadata,
      file: new File([text], bookId),
      chapters: fixture.chapters,
    });

    await expect(
      dao.replaceTxtCatalog({
        bookId,
        expectedChapterIds: ['stale-chapter'],
        metadata: fixture.metadata,
        chapters: fixture.chapters,
        progress: fixture.progress,
        bookmarks: fixture.bookmarks,
      }),
    ).rejects.toThrow('目录已在其他位置更新');
    await expect(
      dao.replaceTxtCatalog({
        bookId,
        expectedChapterIds: fixture.metadata.toc.map(
          ({ chapterId }) => chapterId,
        ),
        metadata: fixture.metadata,
        chapters: fixture.chapters,
        progress: { ...fixture.progress, bookId: 'another-book' },
        bookmarks: fixture.bookmarks,
      }),
    ).rejects.toThrow('包含其他书籍的数据');
    expect(await dao.getMetadata(bookId)).toEqual(fixture.metadata);
    expect(await dao.listChapterByVolumeId(bookId)).toEqual(fixture.chapters);
    dao.close();
  });
});
