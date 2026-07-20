import { describe, expect, it } from 'vitest';

import type { LocalVolumeMetadata } from '../src/model/LocalVolume';
import {
  createBookMetadataForm,
  isValidLanguageTag,
  restoreSourceMetadata,
  toBookMetadata,
} from '../src/pages/bookshelf/BookMetadataEditor';

const volume: LocalVolumeMetadata = {
  id: 'book.epub',
  createAt: 1,
  toc: [],
  glossaryId: 'glossary',
  glossary: {},
  favoredId: 'default',
  sourceFormat: 'epub',
  sourceBookMetadata: {
    title: '原始标题',
    authors: ['原始作者'],
    description: '原始简介',
    languages: ['ja'],
  },
  bookMetadata: { title: '', authors: [], languages: [] },
  downloadMetadataPreference: {
    original: 'embed',
    translated: 'source',
  },
};

describe('book metadata editor', () => {
  it('prefills saved fields and falls back field-by-field to source metadata', () => {
    expect(createBookMetadataForm(volume)).toMatchObject({
      title: '',
      authors: [],
      description: '原始简介',
      languages: [],
      downloadAsEpub: false,
      originalDownload: 'embed',
      translatedDownload: 'source',
    });
  });

  it('restores source fields without changing download preferences', () => {
    const restored = restoreSourceMetadata(
      createBookMetadataForm(volume),
      volume,
    );
    expect(restored).toMatchObject({
      title: '原始标题',
      authors: ['原始作者'],
      description: '原始简介',
      coverUrl: '',
      languages: ['ja'],
      downloadAsEpub: false,
      originalDownload: 'embed',
      translatedDownload: 'source',
    });
  });

  it('prefills and preserves the TXT EPUB download preference', () => {
    const txtVolume: LocalVolumeMetadata = {
      ...volume,
      id: 'book.txt',
      sourceFormat: 'txt',
      txtDownloadAsEpub: true,
    };
    const form = createBookMetadataForm(txtVolume);

    expect(form.downloadAsEpub).toBe(true);
    expect(restoreSourceMetadata(form, txtVolume).downloadAsEpub).toBe(true);
  });

  it('persists explicit empty values and validates BCP 47 tags', () => {
    expect(toBookMetadata(createBookMetadataForm(volume))).toMatchObject({
      title: '',
      authors: [],
      languages: [],
    });
    expect(isValidLanguageTag('zh-CN')).toBe(true);
    expect(isValidLanguageTag('not_a_language')).toBe(false);
  });
});
