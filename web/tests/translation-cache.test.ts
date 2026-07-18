import 'fake-indexeddb/auto';

import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('Audio', class {});
});

import { TranslationCacheRepo } from '../src/repos/useTranslationCache';
import { createSegIndexedDbCache } from '../src/domain/translate/Common';

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

  it('touches entries and evicts the least recently used entry deterministically', async () => {
    const limits = { maximumEntries: 2, maximumSize: 10_000 };
    await TranslationCacheRepo.clear('gpt-seg-cache');
    await TranslationCacheRepo.create('gpt-seg-cache', 'a', ['甲'], {
      now: 1,
      limits,
    });
    await TranslationCacheRepo.create('gpt-seg-cache', 'b', ['乙'], {
      now: 2,
      limits,
    });
    await TranslationCacheRepo.get('gpt-seg-cache', 'a', 3);
    await TranslationCacheRepo.create('gpt-seg-cache', 'c', ['丙'], {
      now: 4,
      limits,
    });

    expect(await TranslationCacheRepo.get('gpt-seg-cache', 'a', 5)).toEqual([
      '甲',
    ]);
    expect(
      await TranslationCacheRepo.get('gpt-seg-cache', 'b', 5),
    ).toBeUndefined();
    expect(await TranslationCacheRepo.get('gpt-seg-cache', 'c', 5)).toEqual([
      '丙',
    ]);
    expect(await TranslationCacheRepo.metrics('gpt-seg-cache')).toMatchObject({
      entryCount: 2,
      totalSize: expect.any(Number),
    });
  });

  it('accounts for replacement size and evicts entries larger than the limit', async () => {
    await TranslationCacheRepo.clear('sakura-seg-cache');
    await TranslationCacheRepo.create('sakura-seg-cache', 'same', ['短'], {
      now: 1,
      limits: { maximumEntries: 10, maximumSize: 10_000 },
    });
    await TranslationCacheRepo.create(
      'sakura-seg-cache',
      'same',
      ['更长的替换文本'],
      {
        now: 2,
        limits: { maximumEntries: 10, maximumSize: 10_000 },
      },
    );
    expect(
      await TranslationCacheRepo.metrics('sakura-seg-cache'),
    ).toMatchObject({ entryCount: 1 });

    await TranslationCacheRepo.create('sakura-seg-cache', 'oversized', ['大'], {
      now: 3,
      limits: { maximumEntries: 10, maximumSize: 1 },
    });
    expect(
      await TranslationCacheRepo.metrics('sakura-seg-cache'),
    ).toMatchObject({ entryCount: 0, totalSize: 0 });
  });

  it('does not reuse or persist an in-flight result from before cache clear', async () => {
    await TranslationCacheRepo.clear('gpt-seg-cache');
    const cache = await createSegIndexedDbCache('gpt-seg-cache');
    let releaseOld = () => {};
    const oldBarrier = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    const oldResult = cache.getOrCreate!('same', async () => {
      await oldBarrier;
      return ['旧结果'];
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    await TranslationCacheRepo.clear('gpt-seg-cache');
    await expect(
      cache.getOrCreate!('same', async () => ['新结果']),
    ).resolves.toMatchObject({ output: ['新结果'], source: 'provider' });
    releaseOld();
    await expect(oldResult).resolves.toMatchObject({ output: ['旧结果'] });
    expect(await TranslationCacheRepo.get('gpt-seg-cache', 'same')).toEqual([
      '新结果',
    ]);
  });
});
