import { BlobReader, TextWriter, ZipReader } from '@zip.js/zip.js';
import { describe, expect, it } from 'vitest';

import type {
  LocalVolumeChapter,
  LocalVolumeMetadata,
} from '../src/model/LocalVolume';
import { getTranslationFile } from '../src/stores/local/GetTranslationFile';
import type { LocalVolumeDao } from '../src/stores/local/LocalVolumeDao';
import { createTxtEpub } from '../src/stores/local/TxtEpubExport';

const readArchive = async (blob: Blob) => {
  const reader = new ZipReader(new BlobReader(blob));
  try {
    const entries = await reader.getEntries();
    const text = new Map<string, string>();
    for (const entry of entries) {
      if (!entry.directory && entry.getData) {
        text.set(entry.filename, await entry.getData(new TextWriter()));
      }
    }
    return { names: entries.map(({ filename }) => filename), text };
  } finally {
    await reader.close();
  }
};

describe('TXT EPUB export', () => {
  it('creates an EPUB 3 archive with metadata, cover and nested navigation', async () => {
    const blob = await createTxtEpub({
      filename: '测试书.epub',
      metadata: {
        title: '测试书 & 特别篇',
        authors: ['作者甲'],
        description: '简介 <内容>',
        languages: ['zh-CN', 'ja'],
      },
      chapters: [
        {
          id: 'parent',
          title: '第一卷',
          paragraphs: ['卷首'],
        },
        {
          id: 'child',
          title: '第一章',
          parentChapterId: 'parent',
          paragraphs: ['第一段', '第二段'],
        },
      ],
      cover: new Blob(['cover'], { type: 'image/png' }),
    });
    const archive = await readArchive(blob);

    expect(archive.names[0]).toBe('mimetype');
    expect(archive.text.get('mimetype')).toBe('application/epub+zip');
    expect(archive.text.get('OEBPS/content.opf')).toContain(
      '<dc:title>测试书 &amp; 特别篇</dc:title>',
    );
    expect(archive.text.get('OEBPS/content.opf')).toContain(
      '<dc:creator>作者甲</dc:creator>',
    );
    expect(archive.text.get('OEBPS/nav.xhtml')).toContain(
      '第一卷</a><ol><li><a href="text/chapter-2.xhtml">第一章',
    );
    expect(archive.text.get('OEBPS/text/chapter-2.xhtml')).toContain(
      '<p>第二段</p>',
    );
    expect(archive.names).toContain('OEBPS/images/cover.png');
  });

  it('exports configured translated and original TXT content as EPUB', async () => {
    const metadata: LocalVolumeMetadata = {
      id: 'book.txt',
      createAt: 1,
      sourceFormat: 'txt',
      toc: [
        { chapterId: 'volume', title: '第一卷' },
        {
          chapterId: 'chapter',
          title: '第一章',
          parentChapterId: 'volume',
        },
      ],
      glossaryId: 'glossary',
      glossary: {},
      favoredId: 'default',
      sourceBookMetadata: { title: '原书名', authors: [], languages: ['ja'] },
      bookMetadata: { title: '展示书名' },
      txtDownloadAsEpub: true,
    };
    const chapters = new Map<string, LocalVolumeChapter>([
      [
        'volume',
        {
          id: 'book.txt/volume',
          volumeId: 'book.txt',
          paragraphs: ['卷首原文'],
          segmentIds: ['v1'],
          gpt: {
            glossaryId: 'glossary',
            glossary: {},
            paragraphs: ['卷首译文'],
          },
        },
      ],
      [
        'chapter',
        {
          id: 'book.txt/chapter',
          volumeId: 'book.txt',
          paragraphs: ['第一章', '章节原文'],
          segmentIds: ['c1', 'c2'],
          gpt: {
            glossaryId: 'glossary',
            glossary: {},
            paragraphs: ['第一章译文', '章节译文'],
          },
        },
      ],
    ]);
    const dao = {
      getMetadata: async () => metadata,
      getChapter: async (_id: string, chapterId: string) =>
        chapters.get(chapterId),
      getFile: async () => ({
        id: metadata.id,
        file: new File(['原始文件'], metadata.id, { type: 'text/plain' }),
      }),
      getReaderCover: async () => undefined,
    } as unknown as LocalVolumeDao;

    const mixed = await getTranslationFile(dao, {
      id: metadata.id,
      mode: 'zh-jp',
      translationsMode: 'priority',
      translations: ['gpt'],
    });
    const mixedArchive = await readArchive(mixed.blob);
    const chapter = mixedArchive.text.get('OEBPS/text/chapter-2.xhtml') ?? '';
    expect(mixed.filename).toBe('zh-jp.Yg.book.epub');
    expect(chapter.indexOf('章节译文')).toBeLessThan(
      chapter.indexOf('章节原文'),
    );
    expect(chapter).not.toContain('<p>第一章</p>');

    const original = await getTranslationFile(dao, {
      id: metadata.id,
      mode: 'jp',
      translationsMode: 'priority',
      translations: [],
    });
    const originalArchive = await readArchive(original.blob);
    expect(original.filename).toBe('jp.book.epub');
    expect(originalArchive.text.get('OEBPS/text/chapter-2.xhtml')).toContain(
      '章节原文',
    );
    expect(
      originalArchive.text.get('OEBPS/text/chapter-2.xhtml'),
    ).not.toContain('章节译文');
  });
});
