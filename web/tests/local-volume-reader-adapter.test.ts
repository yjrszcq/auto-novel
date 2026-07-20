import { describe, expect, it, vi } from 'vitest';

import type {
  LocalVolumeChapter,
  LocalVolumeMetadata,
} from '../src/model/LocalVolume';
import {
  createLocalVolumeReaderAdapter,
  type LocalVolumeReaderRepository,
} from '../src/pages/reader/adapters/LocalVolumeReaderAdapter';
import { createReaderPageController } from '../src/pages/reader/core/ReaderPageState';

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
    {
      chapterId: 'first',
      title: '第一章：开端',
      titleTranslations: {
        gpt: {
          text: '译题：GPT 开端',
          glossaryId: 'glossary',
          sourceTitle: '第一章：开端',
        },
        sakura: {
          text: '译题：Sakura 开端',
          glossaryId: 'glossary',
          sourceTitle: '第一章：开端',
        },
      },
    },
    { chapterId: 'second', title: '第二章：结尾' },
  ],
  navigation: [
    {
      id: 'part',
      title: '第一部',
      level: 0,
      titleTranslations: {
        gpt: {
          text: '译题：第一部',
          glossaryId: 'glossary',
          sourceTitle: '第一部',
        },
      },
    },
    {
      id: 'native-first',
      title: '第一章：开端',
      level: 1,
      parentId: 'part',
      chapterId: 'first',
      titleTranslations: {
        gpt: {
          text: '译题：GPT 开端',
          glossaryId: 'glossary',
          sourceTitle: '第一章：开端',
        },
      },
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
  listChapter: async (bookId) =>
    bookId === volume.id ? Object.values(chapters) : [],
};

describe('LocalVolumeReaderAdapter', () => {
  it('opens a 1,000-chapter book with one metadata and one indexed chapter read', async () => {
    const largeVolume: LocalVolumeMetadata = {
      ...volume,
      id: 'large.epub',
      toc: Array.from({ length: 1_000 }, (_, index) => ({
        chapterId: `${index}`,
        title: `章节${index}`,
      })),
      navigation: undefined,
    };
    let largeChapters: LocalVolumeChapter[] = largeVolume.toc.map(
      ({ chapterId }) => ({
        id: `${largeVolume.id}/${chapterId}`,
        volumeId: largeVolume.id,
        paragraphs: [`原文${chapterId}`],
        segmentIds: [`segment-${chapterId}`],
      }),
    );
    const getVolume = vi.fn(async () => largeVolume);
    const listChapter = vi.fn(async () => largeChapters);
    const adapter = createLocalVolumeReaderAdapter({
      getVolume,
      listChapter,
    });

    await expect(
      createReaderPageController(adapter).load(largeVolume.id, '500'),
    ).resolves.toMatchObject({
      kind: 'ready',
      chapters: { length: 1_000 },
      chapter: { chapterId: '500', segments: [{ original: '原文500' }] },
    });
    await expect(
      adapter.getCapabilities(largeVolume.id),
    ).resolves.toMatchObject({
      totalChapterCount: 1_000,
      translatedChapterCount: 0,
    });
    expect(getVolume).toHaveBeenCalledTimes(1);
    expect(listChapter).toHaveBeenCalledTimes(1);

    largeChapters = largeChapters.map((chapter) =>
      chapter.id.endsWith('/500')
        ? {
            ...chapter,
            gpt: {
              glossaryId: 'new',
              glossary: {},
              paragraphs: ['新译文500'],
            },
          }
        : chapter,
    );
    adapter.invalidateChapter?.({ bookId: largeVolume.id, chapterId: '500' });
    await expect(
      adapter.getChapter({ bookId: largeVolume.id, chapterId: '500' }),
    ).resolves.toMatchObject({
      segments: [{ translated: '新译文500' }],
    });
    expect(getVolume).toHaveBeenCalledTimes(2);
    expect(listChapter).toHaveBeenCalledTimes(2);
  });

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
      requiresWholeChapterTranslation: true,
      targetLanguage: 'zh-CN',
      coverUrl: 'https://example.com/cover.jpg',
      languages: ['en', 'ja'],
      chapterCount: 2,
    });
    await expect(adapter.getChapters(volume.id)).resolves.toMatchObject([
      {
        id: 'first',
        translatedTitle: '译题：GPT 开端',
        translationStatus: 'complete',
        translationSources: ['sakura', 'gpt'],
      },
      {
        id: 'second',
        translationStatus: 'none',
      },
    ]);
    await expect(adapter.getNavigation?.(volume.id)).resolves.toMatchObject([
      { id: 'part', title: '第一部', translatedTitle: '译题：第一部' },
      {
        id: 'native-first',
        title: '第一章：开端',
        translatedTitle: '译题：GPT 开端',
      },
      { id: 'native-second', title: '第二章：结尾' },
    ]);
    await expect(
      adapter.getChapter({ bookId: volume.id, chapterId: 'first' }),
    ).resolves.toEqual({
      bookId: volume.id,
      chapterId: 'first',
      chapterIndex: 0,
      title: '第一章：开端',
      translatedTitle: '译题：GPT 开端',
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

  it('marks any book containing Chinese as not needing whole-chapter translation', async () => {
    const chineseVolume: LocalVolumeMetadata = {
      ...volume,
      id: 'chinese.epub',
      bookMetadata: {
        ...volume.bookMetadata,
        languages: ['ja', 'zh-Hant'],
      },
    };
    const adapter = createLocalVolumeReaderAdapter({
      getVolume: async (bookId) =>
        bookId === chineseVolume.id ? chineseVolume : undefined,
      listChapter: async () => [],
    });

    await expect(adapter.getBook(chineseVolume.id)).resolves.toMatchObject({
      languages: ['ja', 'zh-Hant'],
      requiresWholeChapterTranslation: false,
    });
  });
});
