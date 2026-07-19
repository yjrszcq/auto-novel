import { describe, expect, it } from 'vitest';

import type {
  BookReadingCapabilities,
  ReaderSettingsRecord,
} from '../src/model/Reader';
import {
  getAvailableReaderModes,
  getReaderModeShortcut,
  getReaderModeLabel,
  readerModeLabels,
  readerModes,
  resolveReaderMode,
} from '../src/pages/reader/core/ReaderMode';

const settings: ReaderSettingsRecord = {
  id: 'default',
  defaultMode: 'translated',
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
  it('maps number shortcuts to the four display modes', () => {
    expect(getReaderModeShortcut('1')).toBe('translated');
    expect(getReaderModeShortcut('2')).toBe('translated-original');
    expect(getReaderModeShortcut('3')).toBe('original-translated');
    expect(getReaderModeShortcut('4')).toBe('original');
    expect(getReaderModeShortcut('5')).toBeUndefined();
  });
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
      'translated',
    );
  });

  it('uses every global translated preference when translation is available', () => {
    for (const defaultMode of readerModes) {
      expect(
        resolveReaderMode({
          settings: { ...settings, defaultMode },
          capabilities: translated,
        }),
      ).toBe(defaultMode);
    }
  });

  it('forces original mode and hides translated choices without translations', () => {
    const capabilities = { ...translated, hasAnyTranslation: false };

    expect(resolveReaderMode({ settings, capabilities })).toBe('original');
    expect(getAvailableReaderModes(capabilities)).toEqual(['original']);
    expect(getAvailableReaderModes(translated)).toEqual([
      'translated',
      'translated-original',
      'original-translated',
      'original',
    ]);
  });

  it('uses Japanese-to-Chinese labels', () => {
    expect(readerModeLabels).toMatchObject({
      translated: '中文',
      'translated-original': '中日对照',
      'original-translated': '日中对照',
      original: '原文（日文）',
    });
    expect(getReaderModeLabel('original', 'zh-Hans')).toBe('原文（中文）');
    expect(getReaderModeLabel('original', 'en')).toBe('原文（英文）');
  });
});
