import { reactive } from 'vue';
import { describe, expect, it } from 'vitest';

import {
  applyReaderStyleOverride,
  defaultReaderSettings,
  normalizeReaderAutoTranslationPreloadPages,
  normalizeReaderChineseScript,
  normalizeReaderRetranslationPolicy,
  normalizeReaderSettings,
  serializeReaderSettings,
} from '../src/pages/reader/core/ReaderSettings';

describe('reader settings', () => {
  it('uses durable local reading defaults', () => {
    expect(normalizeReaderSettings(undefined)).toEqual(defaultReaderSettings);
    expect(defaultReaderSettings.defaultMode).toBe('translated');
    expect(defaultReaderSettings.flow).toBe('auto');
    expect(defaultReaderSettings.autoTranslationPreloadPages).toBe(3);
    expect(defaultReaderSettings.retranslationPolicy).toBe('ask');
    expect(defaultReaderSettings.chineseScript).toBe('none');
  });

  it('normalizes the optional Chinese script preference', () => {
    expect(normalizeReaderChineseScript(undefined)).toBe('none');
    expect(normalizeReaderChineseScript('simplified')).toBe('simplified');
    expect(normalizeReaderChineseScript('traditional')).toBe('traditional');
    expect(
      normalizeReaderSettings({ chineseScript: 'invalid' as never })
        .chineseScript,
    ).toBe('none');
  });

  it('normalizes the retranslation completion policy', () => {
    expect(normalizeReaderRetranslationPolicy(undefined)).toBe('ask');
    expect(normalizeReaderRetranslationPolicy('replace')).toBe('replace');
    expect(normalizeReaderRetranslationPolicy('keep')).toBe('keep');
    expect(
      normalizeReaderSettings({
        retranslationPolicy: 'invalid' as never,
      }).retranslationPolicy,
    ).toBe('ask');
  });

  it('normalizes automatic translation preloading to whole pages', () => {
    expect(normalizeReaderAutoTranslationPreloadPages(null)).toBe(3);
    expect(normalizeReaderAutoTranslationPreloadPages(7.8)).toBe(7);
    expect(
      normalizeReaderSettings({ autoTranslationPreloadPages: 4.9 })
        .autoTranslationPreloadPages,
    ).toBe(4);
    expect(
      normalizeReaderSettings({ autoTranslationPreloadPages: -1 })
        .autoTranslationPreloadPages,
    ).toBe(0);
    expect(
      normalizeReaderSettings({ autoTranslationPreloadPages: 99 })
        .autoTranslationPreloadPages,
    ).toBe(20);
  });

  it('normalizes partial records and clamps unsafe values', () => {
    expect(
      normalizeReaderSettings({
        id: 'default',
        defaultMode: 'original',
        translationPriority: ['gpt'],
        fontSize: 99,
        lineHeight: 0,
        contentWidth: 20,
        horizontalPadding: 100,
        theme: 'sepia',
        flow: 'paginated',
        updatedAt: 1,
      }),
    ).toMatchObject({
      defaultMode: 'original',
      fontSize: 32,
      lineHeight: 1.2,
      contentWidth: 480,
      horizontalPadding: 64,
      theme: 'sepia',
      flow: 'paginated',
    });
    expect(normalizeReaderSettings({ flow: 'invalid' as 'auto' }).flow).toBe(
      'auto',
    );
  });

  it('copies reactive translation priority before IndexedDB persistence', () => {
    const settings = reactive({
      ...defaultReaderSettings,
      translationPriority: [...defaultReaderSettings.translationPriority],
    });
    const serialized = serializeReaderSettings(settings);

    expect(serialized.translationPriority).not.toBe(
      settings.translationPriority,
    );
    expect(structuredClone(serialized)).toMatchObject({
      translationPriority: defaultReaderSettings.translationPriority,
      retranslationPolicy: 'ask',
    });
  });

  it('does not let undefined book overrides erase global settings', () => {
    const settings = normalizeReaderSettings({ theme: 'system' });

    expect(
      applyReaderStyleOverride(settings, {
        theme: undefined,
        fontSize: undefined,
      }),
    ).toMatchObject({
      theme: 'system',
      fontSize: settings.fontSize,
    });
    expect(applyReaderStyleOverride(settings, { theme: 'dark' }).theme).toBe(
      'dark',
    );
    expect(
      applyReaderStyleOverride(settings, { theme: 'ultra-dark' }).theme,
    ).toBe('ultra-dark');
  });
});
