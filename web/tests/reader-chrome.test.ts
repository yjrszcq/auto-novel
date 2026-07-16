import { describe, expect, it } from 'vitest';

import {
  getReaderEscapeAction,
  shouldToggleReaderChrome,
} from '../src/pages/reader/core/ReaderChrome';

describe('Candle reader chrome interactions', () => {
  it('toggles only from the middle reading zone', () => {
    const base = {
      hasOpenPanel: false,
      hasSelection: false,
      interactiveTarget: false,
      width: 1000,
    };
    expect(shouldToggleReaderChrome({ ...base, relativeX: 500 })).toBe(true);
    expect(shouldToggleReaderChrome({ ...base, relativeX: 100 })).toBe(false);
    expect(shouldToggleReaderChrome({ ...base, relativeX: 900 })).toBe(false);
  });

  it('does not hide controls during selection, button use, or an open panel', () => {
    const base = {
      hasOpenPanel: false,
      hasSelection: false,
      interactiveTarget: false,
      relativeX: 500,
      width: 1000,
    };
    expect(shouldToggleReaderChrome({ ...base, hasSelection: true })).toBe(
      false,
    );
    expect(shouldToggleReaderChrome({ ...base, interactiveTarget: true })).toBe(
      false,
    );
    expect(shouldToggleReaderChrome({ ...base, hasOpenPanel: true })).toBe(
      false,
    );
  });

  it('uses Escape to close panels before hiding the reader chrome', () => {
    expect(getReaderEscapeAction(true)).toBe('close-panel');
    expect(getReaderEscapeAction(false)).toBe('hide-controls');
  });
});
