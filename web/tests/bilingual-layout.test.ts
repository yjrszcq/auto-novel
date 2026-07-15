import { describe, expect, it } from 'vitest';

import {
  hasTranslation,
  resolveRenderedReaderMode,
} from '../src/pages/reader/core/BilingualLayout';

const segments = [
  { id: 'one', index: 0, original: '原文', translated: '译文' },
  { id: 'two', index: 1, original: '原文二' },
];

describe('bilingual reader layout', () => {
  it('keeps a requested bilingual mode when a chapter has some translation', () => {
    expect(resolveRenderedReaderMode('translated-original', segments)).toBe(
      'translated-original',
    );
    expect(hasTranslation(segments[0])).toBe(true);
    expect(hasTranslation(segments[1])).toBe(false);
  });

  it('falls back to original for an entirely untranslated chapter', () => {
    expect(
      resolveRenderedReaderMode('translated', [
        { id: 'one', index: 0, original: '原文' },
      ]),
    ).toBe('original');
    expect(resolveRenderedReaderMode('ask', segments)).toBe('original');
  });
});
