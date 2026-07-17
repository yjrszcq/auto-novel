import { describe, expect, it } from 'vitest';

import {
  getLocalBookMetadata,
  getLocalVolumeLanguages,
  getLocalVolumeTitle,
  isChineseLanguageTag,
  requiresWholeChapterTranslation,
  shouldEmbedDownloadMetadata,
  type LocalVolumeMetadata,
} from '../src/model/LocalVolume';

const volume = (override?: LocalVolumeMetadata['bookMetadata']) =>
  ({
    id: 'fallback.epub',
    createAt: 1,
    toc: [],
    glossaryId: 'glossary',
    glossary: {},
    favoredId: 'default',
    sourceBookMetadata: {
      title: '原始标题',
      authors: ['原始作者'],
      description: '原始简介',
      languages: ['ja'],
    },
    bookMetadata: override,
  }) satisfies LocalVolumeMetadata;

describe('local book metadata', () => {
  it('uses source metadata for fields that have never been edited', () => {
    expect(getLocalBookMetadata(volume({ title: '展示标题' }))).toEqual({
      title: '展示标题',
      authors: ['原始作者'],
      description: '原始简介',
      coverUrl: undefined,
      languages: ['ja'],
    });
  });

  it('preserves explicitly cleared display fields', () => {
    const book = volume({
      title: '',
      authors: [],
      description: '',
      languages: [],
    });
    expect(getLocalBookMetadata(book)).toMatchObject({
      title: '',
      authors: [],
      description: '',
      languages: [],
    });
    expect(getLocalVolumeTitle(book)).toBe('fallback');
    expect(getLocalVolumeLanguages(book)).toEqual(['ja']);
  });

  it('resolves per-book download metadata preferences before global defaults', () => {
    const book = volume();
    book.sourceFormat = 'epub';
    expect(shouldEmbedDownloadMetadata(book, 'original', true)).toBe(true);
    book.downloadMetadataPreference = {
      original: 'source',
      translated: 'embed',
    };
    expect(shouldEmbedDownloadMetadata(book, 'original', true)).toBe(false);
    expect(shouldEmbedDownloadMetadata(book, 'translated', false)).toBe(true);
    book.sourceFormat = 'txt';
    book.id = 'book.txt';
    expect(shouldEmbedDownloadMetadata(book, 'translated', true)).toBe(false);
  });

  it('recognizes common Chinese language tags as not needing chapter translation', () => {
    expect(isChineseLanguageTag('zh-CN')).toBe(true);
    expect(isChineseLanguageTag('cmn-Hans')).toBe(true);
    expect(isChineseLanguageTag('yue-Hant-HK')).toBe(true);
    expect(isChineseLanguageTag('ja')).toBe(false);
    expect(requiresWholeChapterTranslation(['ja', 'zh-Hant'])).toBe(false);
    expect(requiresWholeChapterTranslation(['ja', 'en'])).toBe(true);
  });
});
