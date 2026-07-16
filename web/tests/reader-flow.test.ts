import { describe, expect, it } from 'vitest';

import {
  getReaderPageDelta,
  getReaderPageMetrics,
  resolveReaderPageTurn,
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
    expect(
      getReaderPageMetrics({
        clientWidth: 800,
        scrollLeft: 1_000,
        scrollWidth: 1_800,
      }),
    ).toMatchObject({ pageCount: 3, pageIndex: 2, ratio: 1 });
  });

  it('maps keyboard pagination without consuming unrelated keys', () => {
    expect(getReaderPageDelta('ArrowLeft')).toBe(-1);
    expect(getReaderPageDelta('PageDown')).toBe(1);
    expect(getReaderPageDelta('Escape')).toBe(0);
  });

  it('turns across chapter boundaries without skipping deferred segments', () => {
    const base = {
      pageIndex: 2,
      pageCount: 3,
      delta: 1,
      hasPreviousSegments: false,
      hasPreviousChapter: true,
      hasNextChapter: true,
    };
    expect(resolveReaderPageTurn({ ...base, hasMoreSegments: true })).toEqual({
      kind: 'segments',
      direction: 'next',
    });
    expect(resolveReaderPageTurn({ ...base, hasMoreSegments: false })).toEqual({
      kind: 'chapter',
      direction: 'next',
    });
    expect(
      resolveReaderPageTurn({
        ...base,
        pageIndex: 0,
        delta: -1,
        hasMoreSegments: false,
      }),
    ).toEqual({ kind: 'chapter', direction: 'previous' });
  });

  it('keeps normal page turns inside the current chapter', () => {
    expect(
      resolveReaderPageTurn({
        pageIndex: 1,
        pageCount: 3,
        delta: 1,
        hasPreviousSegments: false,
        hasMoreSegments: false,
        hasPreviousChapter: true,
        hasNextChapter: true,
      }),
    ).toEqual({ kind: 'page', pageIndex: 2 });
  });
});
