import { describe, expect, it } from 'vitest';

import {
  expandSegmentRange,
  getInitialSegmentRange,
  readerSegmentBatchSize,
  readerSegmentWindowSize,
} from '../src/pages/reader/core/ReaderSegmentWindow';

describe('reader segment window', () => {
  it('renders normal chapters without a window', () => {
    expect(getInitialSegmentRange(10)).toEqual({ start: 0, end: 10 });
  });

  it('centers long chapters around the recovered segment', () => {
    const range = getInitialSegmentRange(10_000, 5_000);
    expect(range.start).toBeLessThanOrEqual(5_000);
    expect(range.end).toBeGreaterThan(5_000);
    expect(range.end - range.start).toBe(readerSegmentBatchSize);
  });

  it('expands a range in either direction without exceeding chapter bounds', () => {
    expect(
      expandSegmentRange({ start: 240, end: 480 }, 1_000, 'before'),
    ).toEqual({ start: 0, end: 480 });
    expect(
      expandSegmentRange({ start: 760, end: 1_000 }, 1_000, 'after'),
    ).toEqual({ start: 760, end: 1_000 });
  });

  it('keeps repeated long-chapter navigation within a bounded sliding window', () => {
    let range = getInitialSegmentRange(10_000);
    for (let index = 0; index < 20; index++) {
      range = expandSegmentRange(range, 10_000, 'after');
      expect(range.end - range.start).toBeLessThanOrEqual(
        readerSegmentWindowSize,
      );
    }
    expect(range.start).toBeGreaterThan(0);
    for (let index = 0; index < 20; index++) {
      range = expandSegmentRange(range, 10_000, 'before');
      expect(range.end - range.start).toBeLessThanOrEqual(
        readerSegmentWindowSize,
      );
    }
    expect(range.start).toBe(0);
  });
});
