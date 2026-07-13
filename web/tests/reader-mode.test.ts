import { describe, expect, it } from 'vitest';

import type {
  BookReadingCapabilities,
  ReaderSettingsRecord,
} from '../src/model/Reader';
import {
  getAvailableReaderModes,
  resolveReaderMode,
} from '../src/pages/reader/core/ReaderMode';

const settings: ReaderSettingsRecord = {
  id: 'default',
  defaultMode: 'ask',
  translationPriority: ['gpt', 'sakura', 'youdao', 'baidu'],
  updatedAt: 1,
};

const translated: BookReadingCapabilities = {
  hasOriginal: true,
  hasAnyTranslation: true,
  hasCompleteTranslation: false,
  translatedChapterCount: 1,
  totalChapterCount: 2,
  availableTranslationSources: ['gpt'],
};

describe('reader open mode', () => {
  it('uses temporary, then per-book, then global preferences', () => {
    expect(
      resolveReaderMode({
        temporaryMode: 'original',
        preference: {
          bookId: 'book',
          preferredMode: 'translated',
          updatedAt: 1,
        },
        settings,
        capabilities: translated,
      }),
    ).toBe('original');
    expect(
      resolveReaderMode({
        preference: {
          bookId: 'book',
          preferredMode: 'translated',
          updatedAt: 1,
        },
        settings,
        capabilities: translated,
      }),
    ).toBe('translated');
    expect(resolveReaderMode({ settings, capabilities: translated })).toBe(
      'ask',
    );
  });

  it('forces original mode and hides translated choices without translations', () => {
    const capabilities = { ...translated, hasAnyTranslation: false };

    expect(resolveReaderMode({ settings, capabilities })).toBe('original');
    expect(getAvailableReaderModes(capabilities)).toEqual(['original']);
    expect(getAvailableReaderModes(translated)).toEqual([
      'ask',
      'translated',
      'translated-original',
      'original-translated',
      'original',
    ]);
  });
});
