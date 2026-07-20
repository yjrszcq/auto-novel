import 'fake-indexeddb/auto';

import { deleteDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createCatalogTitleTranslationPlan,
  formatCatalogTitleForDownload,
  getCatalogTitleTranslation,
  isCatalogTitleTranslationCurrent,
  selectCatalogTitleTranslation,
} from '../src/domain/translate/CatalogTitleTranslation';
import { createLocalVolumeDao } from '../src/stores/local/LocalVolumeDao';

const databaseName = 'catalog-title-translation-test';

afterEach(async () => {
  await deleteDB(databaseName);
});

describe('catalog title translations', () => {
  it('formats translated, bilingual, and original download titles', () => {
    const entry = {
      title: '第一章',
      titleTranslations: {
        gpt: {
          text: '第一章译题',
          glossaryId: 'glossary',
          sourceTitle: '第一章',
        },
      },
    };

    expect(formatCatalogTitleForDownload(entry, 'zh', ['gpt'])).toBe(
      '第一章译题',
    );
    expect(formatCatalogTitleForDownload(entry, 'zh-jp', ['gpt'])).toBe(
      '第一章译题 / 第一章',
    );
    expect(formatCatalogTitleForDownload(entry, 'jp-zh', ['gpt'])).toBe(
      '第一章 / 第一章译题',
    );
    expect(formatCatalogTitleForDownload(entry, 'jp', ['gpt'])).toBe('第一章');
    expect(formatCatalogTitleForDownload(entry, 'zh', ['sakura'])).toBe(
      '第一章',
    );
  });

  it('plans missing, expired, and forced titles without duplicate requests', () => {
    const metadata = {
      id: 'book',
      createAt: 1,
      toc: [
        { chapterId: 'missing', title: '共同标题' },
        {
          chapterId: 'current',
          title: '当前标题',
          titleTranslations: {
            gpt: {
              text: '当前译文',
              glossaryId: 'current-glossary',
              sourceTitle: '当前标题',
            },
          },
        },
        {
          chapterId: 'expired',
          title: '过期标题',
          titleTranslations: {
            gpt: {
              text: '过期译文',
              glossaryId: 'old-glossary',
              sourceTitle: '过期标题',
            },
          },
        },
      ],
      navigation: [
        { id: 'volume', title: '共同标题', level: 0 },
        { id: 'empty', title: '   ', level: 0 },
      ],
      glossaryId: 'current-glossary',
      glossary: {},
      favoredId: 'default',
      sourceFormat: 'epub' as const,
      sourceBookMetadata: {},
    };

    expect(
      createCatalogTitleTranslationPlan(metadata, 'gpt', 'normal', false),
    ).toMatchObject({
      sourceTitles: ['共同标题'],
      toc: [{ id: 'missing' }],
      navigation: [{ id: 'volume' }],
    });
    expect(
      createCatalogTitleTranslationPlan(metadata, 'gpt', 'expire', false)
        .sourceTitles,
    ).toEqual(['共同标题', '过期标题']);
    expect(
      createCatalogTitleTranslationPlan(metadata, 'gpt', 'normal', true)
        .sourceTitles,
    ).toEqual(['共同标题', '当前标题', '过期标题']);
  });

  it('selects a source-matched translation by priority and detects expiry', () => {
    const entry = {
      title: ' 第一章 ',
      titleTranslations: {
        sakura: {
          text: '第一章：樱花',
          glossaryId: 'old-glossary',
          sourceTitle: '第一章',
        },
        gpt: {
          text: '第一章：开始',
          glossaryId: 'current-glossary',
          sourceTitle: '第一章',
        },
      },
    };

    expect(selectCatalogTitleTranslation(entry, ['gpt', 'sakura'])).toBe(
      '第一章：开始',
    );
    expect(
      isCatalogTitleTranslationCurrent(entry, 'gpt', 'current-glossary'),
    ).toBe(true);
    expect(
      isCatalogTitleTranslationCurrent(entry, 'sakura', 'current-glossary'),
    ).toBe(false);

    entry.title = '第二章';
    expect(getCatalogTitleTranslation(entry, 'gpt')).toBeUndefined();
    expect(
      selectCatalogTitleTranslation(entry, ['gpt', 'sakura']),
    ).toBeUndefined();
  });

  it('stores matching TOC and structural navigation titles without overwriting other translators', async () => {
    const dao = await createLocalVolumeDao(databaseName);
    await dao.createMetadata({
      id: 'book',
      createAt: 1,
      toc: [{ chapterId: 'chapter-1', title: '第一章' }],
      navigation: [
        { id: 'volume-1', title: '第一卷', level: 0 },
        {
          id: 'nav-chapter-1',
          title: '第一章',
          level: 1,
          chapterId: 'chapter-1',
          parentId: 'volume-1',
        },
      ],
      glossaryId: 'glossary-1',
      glossary: {},
      favoredId: 'default',
      sourceFormat: 'epub',
      sourceBookMetadata: {},
    });

    await dao.putCatalogTitleTranslations({
      bookId: 'book',
      translatorId: 'sakura',
      glossaryId: 'glossary-1',
      toc: [
        {
          id: 'chapter-1',
          sourceTitle: '第一章',
          translatedTitle: '樱花译文',
        },
      ],
      navigation: [],
    });
    const result = await dao.putCatalogTitleTranslations({
      bookId: 'book',
      translatorId: 'gpt',
      glossaryId: 'glossary-2',
      toc: [
        {
          id: 'chapter-1',
          sourceTitle: '第一章',
          translatedTitle: '第一章：开始',
        },
      ],
      navigation: [
        {
          id: 'volume-1',
          sourceTitle: '第一卷',
          translatedTitle: '第一卷：启程',
        },
        {
          id: 'nav-chapter-1',
          sourceTitle: '已经被修改',
          translatedTitle: '不应写入',
        },
      ],
    });

    expect(result).toMatchObject({ updated: 2, skipped: 1 });
    const metadata = await dao.getMetadata('book');
    expect(metadata?.toc[0]?.titleTranslations).toMatchObject({
      sakura: { text: '樱花译文' },
      gpt: {
        text: '第一章：开始',
        glossaryId: 'glossary-2',
        sourceTitle: '第一章',
      },
    });
    expect(metadata?.navigation?.[0]?.titleTranslations?.gpt?.text).toBe(
      '第一卷：启程',
    );
    expect(metadata?.navigation?.[1]?.titleTranslations).toBeUndefined();
    dao.close();
  });

  it('invalidates saved translations when a TXT title is edited', async () => {
    const dao = await createLocalVolumeDao(databaseName);
    await dao.createMetadata({
      id: 'book.txt',
      createAt: 1,
      toc: [
        {
          chapterId: 'chapter-1',
          title: '第一章',
          titleTranslations: {
            gpt: {
              text: 'Chapter One',
              glossaryId: 'glossary',
              sourceTitle: '第一章',
            },
          },
        },
      ],
      navigation: [
        {
          id: 'txt:chapter-1',
          title: '第一章',
          level: 1,
          chapterId: 'chapter-1',
          titleTranslations: {
            gpt: {
              text: 'Chapter One',
              glossaryId: 'glossary',
              sourceTitle: '第一章',
            },
          },
        },
      ],
      glossaryId: 'glossary',
      glossary: {},
      favoredId: 'default',
      sourceFormat: 'txt',
      sourceBookMetadata: {},
    });

    const metadata = await dao.updateTxtCatalogTitles({
      bookId: 'book.txt',
      expectedChapterIds: ['chapter-1'],
      titles: [{ chapterId: 'chapter-1', title: '新标题' }],
    });

    expect(metadata.toc[0]?.titleTranslations).toBeUndefined();
    expect(metadata.navigation?.[0]?.titleTranslations).toBeUndefined();
    dao.close();
  });
});
