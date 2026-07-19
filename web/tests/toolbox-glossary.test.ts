import { describe, expect, it, vi } from 'vitest';

import {
  countKatakanaTerms,
  filterGlossaryCandidates,
  mergeAutomaticTranslations,
  mergeGlossaryCounts,
  translateGlossaryWords,
} from '../src/pages/workspace/components/ToolboxGlossary';

describe('toolbox glossary workflow', () => {
  it('normalizes half-width terms and merges duplicate counts', () => {
    const first = countKatakanaTerms('カタカナ ｶﾀｶﾅ テスト');
    const second = countKatakanaTerms('カタカナ テスト テスト');

    expect(mergeGlossaryCounts([first, second])).toEqual(
      new Map([
        ['カタカナ', 3],
        ['テスト', 3],
      ]),
    );
  });

  it('uses an inclusive threshold and deterministic search/sort', () => {
    const counts = new Map([
      ['ベータ', 2],
      ['アルファ', 2],
      ['ガンマ', 1],
    ]);

    expect(filterGlossaryCandidates(counts, { minimumCount: 2 })).toEqual([
      { word: 'アルファ', count: 2 },
      { word: 'ベータ', count: 2 },
    ]);
    expect(
      filterGlossaryCandidates(counts, {
        minimumCount: 1,
        query: 'ガン',
        sort: 'word-desc',
      }),
    ).toEqual([{ word: 'ガンマ', count: 1 }]);
  });

  it('falls back per word after a batch failure and keeps partial success', async () => {
    const translate = vi.fn(async (words: string[]) => {
      if (words.length > 1) throw new Error('batch failed');
      if (words[0] === 'ベータ') throw new Error('word failed');
      return [`译-${words[0]}`];
    });
    const onProgress = vi.fn();

    const result = await translateGlossaryWords(
      ['アルファ', 'ベータ', 'ガンマ'],
      translate,
      { batchSize: 3, onProgress },
    );

    expect(result.translations).toEqual(
      new Map([
        ['アルファ', '译-アルファ'],
        ['ガンマ', '译-ガンマ'],
      ]),
    );
    expect([...result.failures.keys()]).toEqual(['ベータ']);
    expect(onProgress).toHaveBeenLastCalledWith({
      total: 3,
      completed: 3,
      succeeded: 2,
      failed: 1,
      currentWord: 'ガンマ',
    });
  });

  it('rejects malformed batch output before accepting it', async () => {
    const translate = vi.fn(async (words: string[]) =>
      words.length > 1 ? ['missing'] : [`译-${words[0]}`],
    );

    const result = await translateGlossaryWords(
      ['アルファ', 'ベータ'],
      translate,
    );

    expect(result.failures.size).toBe(0);
    expect(result.translations.size).toBe(2);
    expect(translate).toHaveBeenCalledTimes(3);
  });

  it('treats empty translations as malformed output', async () => {
    const result = await translateGlossaryWords(['アルファ'], async () => ['']);

    expect(result.translations.size).toBe(0);
    expect([...result.failures.keys()]).toEqual(['アルファ']);
  });

  it('never overwrites manually edited translations', () => {
    expect(
      mergeAutomaticTranslations(
        { アルファ: '手工译文', ベータ: '旧译文' },
        new Map([
          ['アルファ', '自动译文'],
          ['ベータ', '新译文'],
        ]),
        new Set(['アルファ']),
      ),
    ).toEqual({ アルファ: '手工译文', ベータ: '新译文' });
  });
});
