import { describe, expect, it, vi } from 'vitest';

import { createBrowserSpeechController } from '../src/pages/reader/core/ReaderSpeech';
import {
  consumeReaderInteractiveSelection,
  storeReaderInteractiveSelection,
} from '../src/pages/reader/core/ReaderInteractiveHandoff';
import {
  addReadingTime,
  formatReadingDuration,
} from '../src/pages/reader/core/ReaderStats';

describe('local reader tools', () => {
  it('keeps reading statistics local and clamps negative elapsed time', () => {
    expect(addReadingTime(undefined, 'book', -1, 10)).toEqual({
      bookId: 'book',
      totalReadingMs: 0,
      lastReadAt: 10,
    });
    expect(
      addReadingTime(
        { bookId: 'book', totalReadingMs: 60_000, lastReadAt: 1 },
        'book',
        120_000,
        2,
      ),
    ).toMatchObject({ totalReadingMs: 180_000, lastReadAt: 2 });
    expect(formatReadingDuration(3_660_000)).toBe('1 小时 1 分钟');
  });

  it('handles unavailable browser speech and cancels before speaking', () => {
    const unavailable = createBrowserSpeechController(undefined, undefined);
    expect(unavailable.isAvailable).toBe(false);
    expect(unavailable.speak('text', 'ja-JP')).toBe(false);

    const cancel = vi.fn();
    const speak = vi.fn();
    const utterance = { lang: '' } as SpeechSynthesisUtterance;
    const available = createBrowserSpeechController(
      { cancel, speak },
      () => utterance,
    );
    expect(available.speak('text', 'ja-JP')).toBe(true);
    expect(utterance.lang).toBe('ja-JP');
    expect(cancel).toHaveBeenCalledOnce();
    expect(speak).toHaveBeenCalledWith(utterance);
    available.stop();
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it('keeps reader selections in one browser session until they are consumed', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(storeReaderInteractiveSelection(storage, '   ')).toBe(false);
    expect(storeReaderInteractiveSelection(storage, '  検索語  ')).toBe(true);
    expect(consumeReaderInteractiveSelection(storage)).toBe('検索語');
    expect(consumeReaderInteractiveSelection(storage)).toBeUndefined();

    const unavailableStorage = {
      getItem: () => {
        throw new Error('unavailable');
      },
      removeItem: () => {
        throw new Error('unavailable');
      },
      setItem: () => {
        throw new Error('unavailable');
      },
    };
    expect(storeReaderInteractiveSelection(unavailableStorage, '検索語')).toBe(
      false,
    );
    expect(
      consumeReaderInteractiveSelection(unavailableStorage),
    ).toBeUndefined();
  });
});
