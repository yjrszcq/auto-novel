import { describe, expect, it } from 'vitest';

import {
  hasTranslation,
  resolveRenderedReaderMode,
} from '../src/pages/reader/core/BilingualLayout';

const segments = [
  { id: 'one', index: 0, original: '原文', translated: '译文' },
  { id: 'two', index: 1, original: '原文二' },
];
const translatedModes = [
  'translated',
  'translated-original',
  'original-translated',
] as const;

describe('bilingual reader layout', () => {
  it('keeps every requested translated mode when a chapter has some translation', () => {
    for (const mode of translatedModes) {
      expect(resolveRenderedReaderMode(mode, segments)).toBe(mode);
    }
    expect(hasTranslation(segments[0])).toBe(true);
    expect(hasTranslation(segments[1])).toBe(false);
  });

  it('falls back to original for every translated mode in an untranslated chapter', () => {
    const untranslated = [{ id: 'one', index: 0, original: '原文' }];
    for (const mode of translatedModes) {
      expect(resolveRenderedReaderMode(mode, untranslated)).toBe('original');
    }
  });
});
