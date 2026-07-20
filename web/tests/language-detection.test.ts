import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('Audio', class {});
});

import { RegexUtil } from '../src/util';
import {
  appendMissingDetectedLanguages,
  detectBookLanguages,
} from '../src/domain/BookLanguageDetection';

describe('language character detection', () => {
  it('distinguishes English letters from Han characters', () => {
    expect(RegexUtil.hasEnglishChars('hello')).toBe(true);
    expect(RegexUtil.hasEnglishChars('中文')).toBe(false);
    expect(RegexUtil.countLanguageCharacters('A中あ한')).toMatchObject({
      en: 1,
      zh: 1,
      jp: 1,
      ko: 1,
    });
  });

  it('detects common scripts and distinguishes Latin languages', () => {
    expect(detectBookLanguages([['这是一本中文小说。']])).toEqual(['zh']);
    expect(detectBookLanguages([['これは日本語の小説です。']])).toEqual(['ja']);
    expect(
      detectBookLanguages([
        ['This is an English novel with enough text. '.repeat(20)],
      ]),
    ).toEqual(['en']);
    expect(detectBookLanguages([['이것은 한국어 소설입니다.']])).toEqual([
      'ko',
    ]);
    expect(detectBookLanguages([['Ceci est un roman français.']])).toEqual([
      'fr',
    ]);
  });

  it('keeps substantial bilingual sections and ignores sparse noise', () => {
    const bilingual = Array.from({ length: 1_000 }, (_, index) =>
      index % 5 < 3
        ? '这是连续的中文正文。'
        : 'これは連続した日本語の本文です。',
    );
    expect(new Set(detectBookLanguages([bilingual]))).toEqual(
      new Set(['zh', 'ja']),
    );
    expect(
      detectBookLanguages([
        [
          ...Array.from({ length: 96 }, () => '这是中文正文。'),
          ...Array.from({ length: 2 }, () => 'これは日本語です。'),
        ],
      ]),
    ).toEqual(['zh']);
  });

  it('applies a strict configurable confidence threshold', () => {
    const text = 'This is an English novel with enough text. '.repeat(20);
    expect(detectBookLanguages([[text]], 0)).toEqual(['en']);
    expect(detectBookLanguages([[text]], 100)).toEqual([]);
  });

  it('appends only language families absent from EPUB metadata', () => {
    expect(
      appendMissingDetectedLanguages(['ja-JP', 'eng'], ['ja', 'en', 'zh']),
    ).toEqual(['ja-JP', 'eng', 'zh']);
  });
});
