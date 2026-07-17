import { reactive } from 'vue';
import { describe, expect, it } from 'vitest';

import {
  applyReaderStyleOverride,
  defaultReaderSettings,
  normalizeReaderSettings,
  serializeReaderSettings,
} from '../src/pages/reader/core/ReaderSettings';

describe('reader settings', () => {
  it('uses durable local reading defaults', () => {
    expect(normalizeReaderSettings(undefined)).toEqual(defaultReaderSettings);
    expect(defaultReaderSettings.defaultMode).toBe('translated');
    expect(defaultReaderSettings.flow).toBe('auto');
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
  });
});
