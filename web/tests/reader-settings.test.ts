import { reactive } from 'vue';
import { describe, expect, it } from 'vitest';

import {
  defaultReaderSettings,
  normalizeReaderSettings,
  serializeReaderSettings,
} from '../src/pages/reader/core/ReaderSettings';

describe('reader settings', () => {
  it('uses durable local reading defaults', () => {
    expect(normalizeReaderSettings(undefined)).toEqual(defaultReaderSettings);
    expect(defaultReaderSettings.defaultMode).toBe('translated');
  });

  it('migrates the legacy ask preference to translated', () => {
    expect(normalizeReaderSettings({ defaultMode: 'ask' })).toMatchObject({
      defaultMode: 'translated',
    });
  });

  it('keeps compatible partial records and clamps unsafe values', () => {
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
        updatedAt: 1,
      }),
    ).toMatchObject({
      defaultMode: 'original',
      fontSize: 32,
      lineHeight: 1.2,
      contentWidth: 480,
      horizontalPadding: 64,
      theme: 'sepia',
    });
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
});
