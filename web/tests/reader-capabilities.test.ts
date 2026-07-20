import { describe, expect, it } from 'vitest';

import type { LocalVolumeChapter } from '../src/model/LocalVolume';
import {
  getReadingCapabilities,
  getTranslationStatus,
  selectTranslation,
} from '../src/pages/reader/core/capabilities';

const chapter = (
  overrides: Partial<LocalVolumeChapter> = {},
): LocalVolumeChapter => ({
  id: 'book/0',
  volumeId: 'book',
  paragraphs: ['one', 'two'],
  segmentIds: ['segment-1', 'segment-2'],
  ...overrides,
});

describe('reader capabilities', () => {
  it('uses the first available translation in the configured priority', () => {
    const selected = selectTranslation(
      chapter({
        gpt: { glossaryId: 'gpt', glossary: {}, paragraphs: ['G1', 'G2'] },
        sakura: {
          glossaryId: 'sakura',
          glossary: {},
          paragraphs: ['S1', 'S2'],
        },
      }),
    );

    expect(selected?.translatorId).toBe('gpt');
    expect(selected?.paragraphs).toEqual(['G1', 'G2']);
  });

  it('prefers a complete lower-priority translation over a partial higher-priority one', () => {
    const selected = selectTranslation(
      chapter({
        gpt: { glossaryId: 'gpt', glossary: {}, paragraphs: ['G1', ''] },
        sakura: {
          glossaryId: 'sakura',
          glossary: {},
          paragraphs: ['S1', 'S2'],
        },
      }),
    );

    expect(selected?.translatorId).toBe('sakura');
  });

  it('reports missing, partial, and complete translation status', () => {
    expect(getTranslationStatus(['one', 'two'], undefined)).toEqual({
      status: 'none',
      translatedSegmentCount: 0,
    });
    expect(getTranslationStatus(['one', 'two'], ['译文', ''])).toEqual({
      status: 'partial',
      translatedSegmentCount: 1,
    });
    expect(getTranslationStatus(['one', 'two'], ['一', '二'])).toEqual({
      status: 'complete',
      translatedSegmentCount: 2,
    });
    expect(getTranslationStatus(['one', '', 'two'], ['一', '', '二'])).toEqual({
      status: 'complete',
      translatedSegmentCount: 2,
    });
  });

  it('calculates book capabilities without confusing partial translation for complete translation', () => {
    expect(
      getReadingCapabilities([
        {
          id: '0',
          bookId: 'book',
          index: 0,
          title: '0',
          hasOriginal: true,
          translationStatus: 'complete',
          translatedSegmentCount: 2,
          totalSegmentCount: 2,
          translationSources: ['gpt'],
        },
        {
          id: '1',
          bookId: 'book',
          index: 1,
          title: '1',
          hasOriginal: true,
          translationStatus: 'partial',
          translatedSegmentCount: 1,
          totalSegmentCount: 2,
          translationSources: ['sakura', 'gpt'],
        },
      ]),
    ).toEqual({
      hasOriginal: true,
      hasAnyTranslation: true,
      hasCompleteTranslation: false,
      translatedChapterCount: 2,
      totalChapterCount: 2,
      availableTranslationSources: ['gpt', 'sakura'],
    });
  });
});
