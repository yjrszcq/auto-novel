import 'fake-indexeddb/auto';

import { deleteDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createReviewedTxtVolume,
  createVolume,
} from '../src/stores/local/CreateVolume';
import { createLocalVolumeDao } from '../src/stores/local/LocalVolumeDao';
import { createLocalVolumeReaderAdapter } from '../src/pages/reader/adapters/LocalVolumeReaderAdapter';
import { parseTxtCatalog } from '../src/util/file/TxtCatalogParser';
import { decodeTxtText } from '../src/util/file/TxtDecode';

const databaseName = 'create-volume-txt-reviewed-test';

afterEach(async () => {
  await deleteDB(databaseName);
});

describe('reviewed TXT volume creation', () => {
  it('persists UUID chapters, line anchors and hierarchical navigation atomically', async () => {
    const dao = await createLocalVolumeDao(databaseName);
    const text = [
      '第一卷 星海',
      '第一章 出发',
      '正文一',
      '第二章 归来',
      '正文二',
    ].join('\n');
    const file = new File([text], 'book.txt', { type: 'text/plain' });
    const plan = parseTxtCatalog(decodeTxtText(text));

    await createReviewedTxtVolume(dao, file, 'favorite', plan);

    const metadata = await dao.getMetadata('book.txt');
    expect(metadata).toMatchObject({
      id: 'book.txt',
      sourceFormat: 'txt',
      favoredId: 'favorite',
      sourceBookMetadata: { title: 'book', languages: ['zh'] },
    });
    expect(metadata?.toc).toHaveLength(3);
    expect(
      metadata?.toc.map(({ sourceStartLine, sourceEndLine }) => [
        sourceStartLine,
        sourceEndLine,
      ]),
    ).toEqual([
      [0, 0],
      [1, 2],
      [3, 4],
    ]);
    expect(metadata?.toc[1]?.parentChapterId).toBe(metadata?.toc[0]?.chapterId);
    expect(metadata?.navigation?.[1]?.parentId).toBe(
      `txt:${metadata?.toc[0]?.chapterId}`,
    );
    for (const entry of metadata?.toc ?? []) {
      expect(entry.chapterId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }

    const storedChapters = new Map(
      (await dao.listChapterByVolumeId('book.txt')).map((chapter) => [
        chapter.id,
        chapter,
      ]),
    );
    const reconstructed = metadata!.toc
      .map((entry) => {
        const chapter = storedChapters.get(`book.txt/${entry.chapterId}`)!;
        expect(chapter.sourceStartLine).toBe(entry.sourceStartLine);
        expect(chapter.sourceEndLine).toBe(entry.sourceEndLine);
        expect(chapter.sourceLines).toEqual(
          Array.from(
            {
              length: entry.sourceEndLine! - entry.sourceStartLine! + 1,
            },
            (_, offset) => entry.sourceStartLine! + offset,
          ),
        );
        expect(chapter.segmentIds).toHaveLength(chapter.paragraphs.length);
        expect(new Set(chapter.segmentIds).size).toBe(
          chapter.segmentIds.length,
        );
        return chapter.paragraphs.join('\n');
      })
      .join('\n');
    expect(reconstructed).toBe(text);
    expect(await dao.getFile('book.txt')).toMatchObject({ id: 'book.txt' });
    const adapter = createLocalVolumeReaderAdapter({
      getVolume: dao.getMetadata,
      listChapter: dao.listChapterByVolumeId,
    });
    expect(await adapter.getNavigation('book.txt')).toMatchObject([
      { title: '第一卷 星海', level: 1, parentId: undefined },
      {
        title: '第一章 出发',
        level: 2,
        parentId: `txt:${metadata?.toc[0]?.chapterId}`,
      },
      {
        title: '第二章 归来',
        level: 2,
        parentId: `txt:${metadata?.toc[0]?.chapterId}`,
      },
    ]);
    const firstChapterId = metadata!.toc[0]!.chapterId;
    expect(
      (
        await adapter.getChapter({
          bookId: 'book.txt',
          chapterId: firstChapterId,
        })
      ).segments[0],
    ).toMatchObject({ sourceLine: 0 });
    dao.close();
  });

  it('rejects direct TXT creation before writing anything', async () => {
    const dao = await createLocalVolumeDao(databaseName);
    const file = new File(['text'], 'book.txt', { type: 'text/plain' });
    await expect(createVolume(dao, file, 'default')).rejects.toThrow(
      '必须先预览并确认目录',
    );
    expect(await dao.listMetadata()).toEqual([]);
    expect(await dao.listChapterByVolumeId('book.txt')).toEqual([]);
    expect(await dao.getFile('book.txt')).toBeUndefined();
    dao.close();
  });

  it('rejects a discontinuous reviewed plan without a partial write', async () => {
    const dao = await createLocalVolumeDao(databaseName);
    const file = new File(['line one\nline two'], 'book.txt');
    const plan = parseTxtCatalog(decodeTxtText('line one\nline two'));
    plan.chapters[0]!.sourceStartLine = 1;

    await expect(
      createReviewedTxtVolume(dao, file, 'default', plan),
    ).rejects.toThrow('原文行范围不连续');
    expect(await dao.listMetadata()).toEqual([]);
    dao.close();
  });
});
