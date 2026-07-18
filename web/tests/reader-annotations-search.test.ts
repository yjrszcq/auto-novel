import { describe, expect, it } from 'vitest';

import {
  createReaderAnnotation,
  getAnnotationFragments,
  indexReaderAnnotations,
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

  it('bounds search output and indexes large annotation sets by stable segment', () => {
    const chapters = Array.from({ length: 1_000 }, (_, index) => ({
      bookId: 'book',
      chapterId: `${index}`,
      chapterIndex: index,
      title: `章节${index}`,
      segments: [
        {
          id: `segment-${index}`,
          index: 0,
          original: `命中${index}`,
        },
      ],
    }));
    expect(searchReaderChapters(chapters, '命中', 25)).toHaveLength(25);

    const annotations = Array.from({ length: 20_000 }, (_, index) =>
      createReaderAnnotation({
        id: `${index}`,
        now: index,
        bookId: 'book',
        chapterId: `${index}`,
        segmentId: `segment-${index}`,
        languageSide: index % 2 === 0 ? 'original' : 'translated',
        startOffset: 0,
        endOffset: 1,
        quote: '命',
        style: 'highlight',
      }),
    );
    const index = indexReaderAnnotations(annotations);
    expect(index.get('segment-10', 'original')).toEqual([annotations[10]]);
    expect(index.get('segment-10', 'translated')).toEqual([]);
  });
});
