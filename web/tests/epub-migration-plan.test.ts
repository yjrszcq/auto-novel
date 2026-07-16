import { describe, expect, it } from 'vitest';

import type {
  LocalVolumeChapter,
  LocalVolumeMetadata,
} from '../src/model/LocalVolume';
import { buildNativeEpubMigrationCommit } from '../src/stores/local/EpubMigration';

const volume: LocalVolumeMetadata = {
  id: 'book.epub',
  createAt: 1,
  toc: [{ chapterId: 'Text/book.xhtml' }],
  glossaryId: 'glossary',
  glossary: {},
  favoredId: 'default',
};

const oldChapter: LocalVolumeChapter = {
  id: 'book.epub/Text/book.xhtml',
  volumeId: 'book.epub',
  paragraphs: ['一', '二', '三', '四'],
  segmentIds: ['segment-1', 'segment-2', 'segment-3', 'segment-4'],
  gpt: {
    glossaryId: 'translated',
    glossary: {},
    paragraphs: ['译一', '译二', '译三', '译四'],
  },
};

const importPlan = {
  sources: [
    {
      href: 'Text/book.xhtml',
      paragraphs: ['一', '二', '三', '四'],
    },
  ],
  chapters: [
    {
      chapterId: 'Text/book.xhtml#one',
      title: '第一章',
      paragraphs: ['一', '二'],
      sourceRanges: [{ href: 'Text/book.xhtml', start: 0, end: 2 }],
    },
    {
      chapterId: 'Text/book.xhtml#two',
      title: '第二章',
      paragraphs: ['三', '四'],
      sourceRanges: [{ href: 'Text/book.xhtml', start: 2, end: 4 }],
    },
  ],
  navigation: [
    {
      id: 'nav-0',
      title: '第一章',
      level: 0,
      href: 'Text/book.xhtml#one',
      chapterId: 'Text/book.xhtml#one',
    },
    {
      id: 'nav-1',
      title: '第二章',
      level: 0,
      href: 'Text/book.xhtml#two',
      chapterId: 'Text/book.xhtml#two',
    },
  ],
};

describe('native EPUB migration planning', () => {
  it('preserves segment IDs and translations while splitting legacy chapters', () => {
    const commit = buildNativeEpubMigrationCommit({
      volume,
      oldChapters: [oldChapter],
      epub: { getCanonicalHref: (href: string) => href } as never,
      importPlan,
    });

    expect(commit.chapters).toMatchObject([
      {
        id: 'book.epub/Text/book.xhtml#one',
        segmentIds: ['segment-1', 'segment-2'],
        gpt: { paragraphs: ['译一', '译二'] },
      },
      {
        id: 'book.epub/Text/book.xhtml#two',
        segmentIds: ['segment-3', 'segment-4'],
        gpt: { paragraphs: ['译三', '译四'] },
      },
    ]);
    expect(commit.segmentChapterMap).toEqual({
      'segment-1': 'Text/book.xhtml#one',
      'segment-2': 'Text/book.xhtml#one',
      'segment-3': 'Text/book.xhtml#two',
      'segment-4': 'Text/book.xhtml#two',
    });
    expect(commit.chapterMap).toEqual({});
  });

  it('rejects a migration when the saved paragraphs differ from the file', () => {
    expect(() =>
      buildNativeEpubMigrationCommit({
        volume,
        oldChapters: [
          { ...oldChapter, paragraphs: ['一', '已修改', '三', '四'] },
        ],
        epub: { getCanonicalHref: (href: string) => href } as never,
        importPlan,
      }),
    ).toThrow('旧正文与原文件不一致');
  });
});
