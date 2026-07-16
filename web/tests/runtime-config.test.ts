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
          defaultBookCoverImage: ' images/default cover.webp ',
        }),
      }),
    );

    const store = useRuntimeConfigStore();
    await store.loadRuntimeConfig();

    expect(store.logoImage).toBe('/config/images/logo.png');
    expect(store.homeBackgroundImage).toBe(
      '/config/images/home%20background.webp',
    );
    expect(store.defaultBookCoverImage).toBe(
      '/config/images/default%20cover.webp',
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
    expect(store.defaultBookCoverImage).toBe('');
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
          defaultBookCoverImage: ' https://example.com/default-cover.webp ',
        }),
      }),
    );

    const store = useRuntimeConfigStore();
    await store.loadRuntimeConfig();

    expect(store.homeBackgroundImage).toBe(
      'https://example.com/home-background.webp',
    );
    expect(store.logoImage).toBe('https://example.com/logo.png');
    expect(store.defaultBookCoverImage).toBe(
      'https://example.com/default-cover.webp',
    );
  });
});
