import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useRuntimeConfigStore } from '../src/stores/useRuntimeConfigStore';

describe('runtime config', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prefers local image files and trims the configured URLs', async () => {
    setActivePinia(createPinia());
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          logoImageUrl: ' https://example.com/logo.png ',
          logoImageFile: ' images/logo.png ',
          homeBackgroundImageUrl: ' https://example.com/home-background.webp ',
          homeBackgroundImageFile: ' images/home background.webp ',
        }),
      }),
    );

    const store = useRuntimeConfigStore();
    await store.loadRuntimeConfig();

    expect(store.logoImage).toBe('/panel-content/images/logo.png');
    expect(store.logoImageUrl).toBe('https://example.com/logo.png');
    expect(store.homeBackgroundImageUrl).toBe(
      'https://example.com/home-background.webp',
    );
    expect(store.homeBackgroundImage).toBe(
      '/panel-content/images/home%20background.webp',
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

  it('uses the configured URL when no local background file exists', async () => {
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

    expect(store.homeBackgroundImage).toBe(
      'https://example.com/home-background.webp',
    );
    expect(store.logoImage).toBe('https://example.com/logo.png');
  });
});
