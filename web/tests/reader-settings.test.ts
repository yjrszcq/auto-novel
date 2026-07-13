import { describe, expect, it } from 'vitest';

import {
  defaultReaderSettings,
  normalizeReaderSettings,
} from '../src/pages/reader/core/ReaderSettings';

describe('reader settings', () => {
  it('uses durable local defaults for original reading', () => {
    expect(normalizeReaderSettings(undefined)).toEqual(defaultReaderSettings);
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
});
