import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useRuntimeConfigStore } from '../src/stores/useRuntimeConfigStore';

describe('runtime config', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves local image paths and HTTPS URLs from one configuration field', async () => {
    setActivePinia(createPinia());
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          logoImage: ' images/logo.png ',
          homeBackgroundImage: ' images/home background.webp ',
        }),
      }),
    );

    const store = useRuntimeConfigStore();
    await store.loadRuntimeConfig();

    expect(store.logoImage).toBe('/panel-content/images/logo.png');
    expect(store.homeBackgroundImage).toBe(
      '/panel-content/images/home%20background.webp',
    );
  });

  it('uses empty image sources when they are not configured', async () => {
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

    expect(store.logoImage).toBe('');
    expect(store.homeBackgroundImage).toBe('');
  });

  it('uses HTTPS URLs as image sources', async () => {
    setActivePinia(createPinia());
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          logoImage: ' https://example.com/logo.png ',
          homeBackgroundImage: ' https://example.com/home-background.webp ',
        }),
      }),
    );

    const store = useRuntimeConfigStore();
    await store.loadRuntimeConfig();

    expect(store.homeBackgroundImage).toBe(
      'https://example.com/home-background.webp',
    );
    expect(store.logoImage).toBe('https://example.com/logo.png');
  });
});
