import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('Audio', class {});
});

import { RegexUtil } from '../src/util';

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
});
