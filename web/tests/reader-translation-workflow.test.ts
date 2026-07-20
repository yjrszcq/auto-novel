import { describe, expect, it } from 'vitest';

import {
  getChapterTranslationParams,
  getTranslationStatusLabel,
} from '../src/pages/reader/core/ReaderTranslationWorkflow';

const chapter = {
  id: 'chapter',
  bookId: 'book',
  index: 3,
  title: 'chapter',
  hasOriginal: true,
  translationStatus: 'partial' as const,
  translatedSegmentCount: 2,
  totalSegmentCount: 3,
  translationSources: ['gpt'],
};

describe('reader translation workflow', () => {
  it('targets only the current chapter in a local translation task', () => {
    expect(getChapterTranslationParams(chapter)).toEqual({
      level: 'normal',
      translateMetadata: false,
      forceMetadata: false,
      startIndex: 3,
      endIndex: 4,
    });
  });

  it('formats reader-facing translation status', () => {
    expect(getTranslationStatusLabel('none')).toBe('未翻译');
    expect(getTranslationStatusLabel('partial')).toBe('部分翻译');
    expect(getTranslationStatusLabel('complete')).toBe('已翻译');
  });
});
