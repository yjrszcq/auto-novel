import { describe, expect, it } from 'vitest';

import type {
  LocalVolumeChapter,
  LocalVolumeMetadata,
} from '../src/model/LocalVolume';
import {
  createLocalVolumeReaderAdapter,
  type LocalVolumeReaderRepository,
} from '../src/pages/reader/adapters/LocalVolumeReaderAdapter';

const volume: LocalVolumeMetadata = {
  id: 'sample.epub',
  bookMetadata: {
    title: '编辑后的书名',
    authors: ['作者一', '作者二'],
    description: '简介',
    coverUrl: 'https://example.com/cover.jpg',
    languages: ['en', 'ja'],
  },
  createAt: 10,
  readAt: 20,
  toc: [
    { chapterId: 'first', title: '第一章：开端' },
    { chapterId: 'second', title: '第二章：结尾' },
  ],
  navigation: [
    { id: 'part', title: '第一部', level: 0 },
    {
      id: 'native-first',
      title: '第一章：开端',
      level: 1,
      parentId: 'part',
      chapterId: 'first',
    },
    {
      id: 'native-second',
      title: '第二章：结尾',
      level: 1,
      parentId: 'part',
      chapterId: 'second',
    },
  ],
  glossaryId: 'glossary',
  glossary: {},
  favoredId: 'default',
};

const chapters: Record<string, LocalVolumeChapter> = {
  first: {
    id: 'sample.epub/first',
    volumeId: 'sample.epub',
    paragraphs: ['原文一', '原文二'],
    segmentIds: ['segment-one', 'segment-two'],
    gpt: {
      glossaryId: 'gpt',
      glossary: {},
      paragraphs: ['GPT 一', 'GPT 二'],
    },
    sakura: {
      glossaryId: 'sakura',
      glossary: {},
      paragraphs: ['Sakura 一', 'Sakura 二'],
    },
  },
  second: {
    id: 'sample.epub/second',
    volumeId: 'sample.epub',
    paragraphs: ['原文三'],
    segmentIds: ['segment-three'],
  },
};

const repository: LocalVolumeReaderRepository = {
  getVolume: async (bookId) => (bookId === volume.id ? volume : undefined),
  getChapter: async (bookId, chapterId) =>
    bookId === volume.id ? chapters[chapterId] : undefined,
};

describe('LocalVolumeReaderAdapter', () => {
  it('maps LocalVolume content through stable IDs and configured translator priority', async () => {
    const adapter = createLocalVolumeReaderAdapter(repository, [
      'gpt',
      'sakura',
      'youdao',
      'baidu',
    ]);

    await expect(adapter.getBook(volume.id)).resolves.toMatchObject({
      id: volume.id,
      title: '编辑后的书名',
      author: '作者一、作者二',
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      coverUrl: 'https://example.com/cover.jpg',
      languages: ['en', 'ja'],
      chapterCount: 2,
    });
    await expect(adapter.getChapters(volume.id)).resolves.toMatchObject([
      {
        id: 'first',
        translationStatus: 'complete',
        translationSources: ['sakura', 'gpt'],
      },
      {
        id: 'second',
        translationStatus: 'none',
      },
    ]);
    await expect(adapter.getNavigation?.(volume.id)).resolves.toEqual(
      volume.navigation,
    );
    await expect(
      adapter.getChapter({ bookId: volume.id, chapterId: 'first' }),
    ).resolves.toEqual({
      bookId: volume.id,
      chapterId: 'first',
      chapterIndex: 0,
      title: '第一章：开端',
      translationSource: 'gpt',
      segments: [
        {
          id: 'segment-one',
          index: 0,
          original: '原文一',
          translated: 'GPT 一',
        },
        {
          id: 'segment-two',
          index: 1,
          original: '原文二',
          translated: 'GPT 二',
        },
      ],
    });
    await expect(adapter.getCapabilities(volume.id)).resolves.toMatchObject({
      hasOriginal: true,
      hasAnyTranslation: true,
      hasCompleteTranslation: false,
      translatedChapterCount: 1,
      totalChapterCount: 2,
    });
  });

  it('does not return empty translated content when the selected source has no text', async () => {
    const adapter = createLocalVolumeReaderAdapter(repository, [
      'youdao',
      'baidu',
      'sakura',
      'gpt',
    ]);

    await expect(
      adapter.getChapter({ bookId: volume.id, chapterId: 'second' }),
    ).resolves.toMatchObject({
      segments: [
        {
          id: 'segment-three',
          original: '原文三',
        },
      ],
    });
  });
});
