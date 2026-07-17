import { describe, expect, it } from 'vitest';

import { defaultConverter, useOpenCC } from '../src/util/useOpenCC';

describe('OpenCC locale conversion', () => {
  it('keeps simplified Chinese as the identity fast path', async () => {
    expect(await useOpenCC('zh-cn')).toBe(defaultConverter);
    expect(defaultConverter.toView('头发发展')).toBe('头发发展');
  });

  it('preserves phrase-aware CN and TW conversion', async () => {
    const converter = await useOpenCC('zh-tw');

    expect(converter.toView('头发发展，皇后走到后面')).toBe(
      '頭髮發展，皇后走到後面',
    );
    expect(converter.toData('頭髮發展，皇后走到後面')).toBe(
      '头发发展，皇后走到后面',
    );
    expect(converter.toView('託孃')).toBe('托娘');
  });
});
