import 'fake-indexeddb/auto';

import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('Audio', class {});
});

import { TranslationCacheRepo } from '../src/repos/useTranslationCache';

describe('translation cache', () => {
  it('stores translator caches independently and clears one store at a time', async () => {
    await TranslationCacheRepo.create('gpt-seg-cache', 'shared', ['GPT']);

    expect(await TranslationCacheRepo.get('gpt-seg-cache', 'shared')).toEqual([
      'GPT',
    ]);
    expect(
      await TranslationCacheRepo.get('sakura-seg-cache', 'shared'),
    ).toBeUndefined();

    await TranslationCacheRepo.create('sakura-seg-cache', 'shared', ['Sakura']);
    await TranslationCacheRepo.clear('gpt-seg-cache');

    expect(
      await TranslationCacheRepo.get('gpt-seg-cache', 'shared'),
    ).toBeUndefined();
    expect(
      await TranslationCacheRepo.get('sakura-seg-cache', 'shared'),
    ).toEqual(['Sakura']);
  });
});
