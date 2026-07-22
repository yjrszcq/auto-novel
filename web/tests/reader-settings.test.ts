import { reactive } from 'vue';
import { describe, expect, it } from 'vitest';

import {
  applyReaderStyleOverride,
  defaultReaderSettings,
  normalizeReaderAutoTranslationChunkParagraphs,
  normalizeReaderAutoTranslationPreloadParagraphs,
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
    expect(defaultReaderSettings.autoTranslationPreloadParagraphs).toBe(60);
    expect(defaultReaderSettings.autoTranslationChunkParagraphs).toBe(5);
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

  it('normalizes automatic translation preloading to whole paragraphs', () => {
    expect(normalizeReaderAutoTranslationPreloadParagraphs(null)).toBe(60);
    expect(normalizeReaderAutoTranslationPreloadParagraphs(77.8)).toBe(77);
    expect(
      normalizeReaderSettings({ autoTranslationPreloadParagraphs: 84.9 })
        .autoTranslationPreloadParagraphs,
    ).toBe(84);
    expect(
      normalizeReaderSettings({ autoTranslationPreloadParagraphs: -1 })
        .autoTranslationPreloadParagraphs,
    ).toBe(0);
    expect(
      normalizeReaderSettings({ autoTranslationPreloadParagraphs: 9_999 })
        .autoTranslationPreloadParagraphs,
    ).toBe(1_000);
  });

  it('normalizes chunk size and migrates the old page setting', () => {
    expect(normalizeReaderAutoTranslationChunkParagraphs(null)).toBe(5);
    expect(normalizeReaderAutoTranslationChunkParagraphs(8.9)).toBe(8);
    expect(normalizeReaderAutoTranslationChunkParagraphs(0)).toBe(1);
    expect(normalizeReaderAutoTranslationChunkParagraphs(99)).toBe(50);
    expect(
      normalizeReaderSettings({ autoTranslationPreloadPages: 4 })
        .autoTranslationPreloadParagraphs,
    ).toBe(80);
    expect(
      normalizeReaderSettings({
        autoTranslationPreloadPages: 4,
        autoTranslationPreloadParagraphs: 75,
      }).autoTranslationPreloadParagraphs,
    ).toBe(75);

    const legacy = {
      ...defaultReaderSettings,
      autoTranslationPreloadPages: 3,
    };
    expect(serializeReaderSettings(legacy)).not.toHaveProperty(
      'autoTranslationPreloadPages',
    );
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
