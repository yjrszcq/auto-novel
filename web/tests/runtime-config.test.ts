import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useRuntimeConfigStore } from '../src/stores/useRuntimeConfigStore';

describe('runtime config', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads and trims the configurable homepage background URL', async () => {
    setActivePinia(createPinia());
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          logoImageUrl: ' https://example.com/logo.png ',
          homeBackgroundImageUrl: ' https://example.com/home-background.webp ',
        }),
      }),
    );

    const store = useRuntimeConfigStore();
    await store.loadRuntimeConfig();

    expect(store.logoImageUrl).toBe('https://example.com/logo.png');
    expect(store.homeBackgroundImageUrl).toBe(
      'https://example.com/home-background.webp',
    );
  });

  it('uses an empty URL when the homepage background is not configured', async () => {
    setActivePinia(createPinia());
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      }),
    );

    const store = useRuntimeConfigStore();
    await store.loadRuntimeConfig();

    expect(store.homeBackgroundImageUrl).toBe('');
  });
});
