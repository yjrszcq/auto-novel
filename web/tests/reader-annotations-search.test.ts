import { describe, expect, it } from 'vitest';

import {
  createReaderAnnotation,
  getAnnotationFragments,
  resolveAnnotationRange,
} from '../src/pages/reader/core/ReaderAnnotations';
import { searchReaderChapters } from '../src/pages/reader/core/ReaderSearch';

const annotation = createReaderAnnotation({
  id: 'annotation',
  now: 1,
  bookId: 'book',
  chapterId: 'chapter',
  segmentId: 'segment',
  languageSide: 'original',
  startOffset: 6,
  endOffset: 11,
  quote: 'world',
  style: 'highlight',
});

describe('local reader annotations and search', () => {
  it('recovers an annotation range from its quote and emits plain text fragments', () => {
    expect(resolveAnnotationRange(annotation, 'hello world')).toEqual({
      startOffset: 6,
      endOffset: 11,
    });
    expect(resolveAnnotationRange(annotation, 'world hello')).toEqual({
      startOffset: 0,
      endOffset: 5,
    });
    expect(getAnnotationFragments('hello world', [annotation])).toEqual([
      { text: 'hello ' },
      { text: 'world', style: 'highlight' },
    ]);
  });

  it('searches local original and translated segments with stable jump targets', () => {
    expect(
      searchReaderChapters(
        [
          {
            bookId: 'book',
            chapterId: 'chapter',
            chapterIndex: 0,
            title: '第一章',
            segments: [
              {
                id: 'segment',
                index: 0,
                original: 'hello world',
                translated: '你好世界',
              },
            ],
          },
        ],
        '世界',
      ),
    ).toEqual([
      {
        chapterId: 'chapter',
        chapterTitle: '第一章',
        segmentId: 'segment',
        languageSide: 'translated',
        excerpt: '你好世界',
      },
    ]);
  });
});
