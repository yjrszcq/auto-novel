import { describe, expect, it } from 'vitest';

import {
  getReaderPageDelta,
  getReaderPageMetrics,
  resolveReaderFlow,
} from '../src/pages/reader/core/ReaderFlow';

describe('reader flow', () => {
  it('resolves auto to desktop pages and mobile scrolling', () => {
    expect(resolveReaderFlow('auto', true)).toBe('paginated');
    expect(resolveReaderFlow('auto', false)).toBe('scrolled');
    expect(resolveReaderFlow('scrolled', true)).toBe('scrolled');
    expect(resolveReaderFlow('paginated', false)).toBe('paginated');
  });

  it('normalizes horizontal page metrics', () => {
    expect(
      getReaderPageMetrics({
        clientWidth: 800,
        scrollLeft: 800,
        scrollWidth: 2400,
      }),
    ).toEqual({ pageCount: 3, pageIndex: 1, pageWidth: 800, ratio: 0.5 });
    expect(
      getReaderPageMetrics({ clientWidth: 0, scrollLeft: -20, scrollWidth: 0 }),
    ).toMatchObject({ pageCount: 1, pageIndex: 0, ratio: 0 });
  });

  it('maps keyboard pagination without consuming unrelated keys', () => {
    expect(getReaderPageDelta('ArrowLeft')).toBe(-1);
    expect(getReaderPageDelta('PageDown')).toBe(1);
    expect(getReaderPageDelta('Escape')).toBe(0);
  });
});
