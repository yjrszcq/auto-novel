import { describe, expect, it } from 'vitest';

import type { ReaderChapterContent } from '@/model/Reader';
import {
  getReaderAutomaticTranslationContentRevision,
  getReaderAutomaticTranslationSelectionCacheKey,
  planReaderAutomaticTranslationWindow,
  ReaderAutomaticTranslationSession,
  resolveNextReaderRetranslationChapter,
  resolveReaderAutomaticTranslationWorker,
  type ReaderAutomaticTranslationSelection,
} from '@/pages/reader/core/ReaderAutoTranslation';

const chapter = (
  chapterId: string,
  originals: string[],
): ReaderChapterContent => ({
  bookId: 'book',
  chapterId,
  chapterIndex: Number(chapterId),
  title: chapterId,
  segments: originals.map((original, index) => ({
    id: `${chapterId}-${index}`,
    index,
    original,
  })),
});
const selection = (
  source: 'gpt' | 'sakura',
  workerId = 'worker',
): ReaderAutomaticTranslationSelection => ({
  source,
  workerId,
  workerFingerprint: `${workerId}-profile`,
  glossaryId: 'glossary',
});

describe('reader automatic translator selection', () => {
  it('uses an explicit worker and safely falls back to the first configured worker', () => {
    const workers = [{ id: 'first' }, { id: 'second' }];

    expect(resolveReaderAutomaticTranslationWorker(workers, 'second')?.id).toBe(
      'second',
    );
    expect(
      resolveReaderAutomaticTranslationWorker(workers, 'removed')?.id,
    ).toBe('first');
    expect(
      resolveReaderAutomaticTranslationWorker([], 'removed'),
    ).toBeUndefined();
  });
});

describe('reader automatic translation window', () => {
  it('prioritizes visible text and plans an exact count across chapters', () => {
    const planned = planReaderAutomaticTranslationWindow({
      chapters: [
        chapter('0', ['甲甲', '乙乙']),
        chapter('1', ['丙丙', '丁丁']),
      ],
      visible: [{ chapterId: '0', segmentId: '0-1' }],
      preloadParagraphs: 2,
    });

    expect(planned.current.map(({ segmentId }) => segmentId)).toEqual(['0-1']);
    expect(planned.prefetch.map(({ segmentId }) => segmentId)).toEqual([
      '1-0',
      '1-1',
    ]);
    expect(planned.prefetchParagraphLimit).toBe(2);
  });

  it('ignores blank source lines and clamps invalid pretranslation counts', () => {
    const planned = planReaderAutomaticTranslationWindow({
      chapters: [chapter('0', ['甲', '', '乙', '丙'])],
      visible: [{ chapterId: '0', segmentId: '0-0' }],
      preloadParagraphs: 100,
    });

    expect(planned.all.map(({ segmentId }) => segmentId)).toEqual([
      '0-0',
      '0-2',
      '0-3',
    ]);
    expect(planned.prefetchParagraphLimit).toBe(100);
  });

  it('allows visible-only planning with zero pretranslation paragraphs', () => {
    const planned = planReaderAutomaticTranslationWindow({
      chapters: [chapter('0', ['甲', '乙', '丙'])],
      visible: [{ chapterId: '0', segmentId: '0-1' }],
      preloadParagraphs: 0,
    });

    expect(planned.current.map(({ segmentId }) => segmentId)).toEqual(['0-1']);
    expect(planned.prefetch).toEqual([]);
    expect(planned.all.map(({ segmentId }) => segmentId)).toEqual(['0-1']);
  });
});

describe('reader continuous retranslation', () => {
  const chapters = [
    { id: '0', translationStatus: 'complete' as const },
    { id: '1', translationStatus: 'partial' as const },
    { id: '2', translationStatus: 'none' as const },
  ];

  it('stays in the current chapter for chapter-only mode', () => {
    expect(
      resolveNextReaderRetranslationChapter(chapters, '0', {
        scope: 'chapter',
        untranslatedPolicy: 'continue',
      }),
    ).toBeUndefined();
  });

  it('continues through translated chapters and applies the untranslated boundary policy', () => {
    expect(
      resolveNextReaderRetranslationChapter(chapters, '0', {
        scope: 'continuous',
        untranslatedPolicy: 'stop',
      }),
    ).toBe('1');
    expect(
      resolveNextReaderRetranslationChapter(chapters, '1', {
        scope: 'continuous',
        untranslatedPolicy: 'stop',
      }),
    ).toBeUndefined();
    expect(
      resolveNextReaderRetranslationChapter(chapters, '1', {
        scope: 'continuous',
        untranslatedPolicy: 'continue',
      }),
    ).toBe('2');
  });
});

describe('reader automatic translation session', () => {
  it('deduplicates pending and cached targets within one selection', () => {
    const session = new ReaderAutomaticTranslationSession();
    const active = selection('gpt');
    const generation = session.start(active);
    const target = {
      chapterId: '0',
      segmentId: '0-0',
      segmentIndex: 0,
      original: '原文',
    };

    expect(session.claim(generation, [target])).toEqual([target]);
    expect(session.claim(generation, [target])).toEqual([]);
    expect(session.store(generation, [{ ...target, translated: '译文' }])).toBe(
      true,
    );
    expect(session.claim(generation, [target])).toEqual([]);
    expect(session.get(active, '0', '0-0')).toBe('译文');
  });

  it('hydrates persisted drafts without making them pending', () => {
    const session = new ReaderAutomaticTranslationSession();
    const active = selection('gpt', 'gpt-worker');
    session.hydrate(active, [
      { chapterId: 'chapter-1', segmentId: 'segment-1', translated: '译文' },
    ]);
    const generation = session.start(active);

    expect(session.get(active, 'chapter-1', 'segment-1')).toBe('译文');
    expect(
      session.claim(generation, [
        {
          chapterId: 'chapter-1',
          segmentId: 'segment-1',
          segmentIndex: 0,
          original: '原文',
        },
      ]),
    ).toEqual([]);
    session.clearChapter(active, 'chapter-1');
    expect(session.get(active, 'chapter-1', 'segment-1')).toBeUndefined();
  });

  it('creates stable storage identities without exposing worker credentials', () => {
    const first = selection('gpt', 'secret-worker-key');
    const second = selection('gpt', 'another-secret-key');
    const firstKey = getReaderAutomaticTranslationSelectionCacheKey(first);

    expect(firstKey).toHaveLength(14);
    expect(firstKey).not.toContain('secret-worker-key');
    expect(firstKey).not.toBe(
      getReaderAutomaticTranslationSelectionCacheKey(second),
    );
    expect(
      getReaderAutomaticTranslationContentRevision({
        segmentIds: ['segment-1'],
        paragraphs: ['原文'],
      }),
    ).not.toBe(
      getReaderAutomaticTranslationContentRevision({
        segmentIds: ['segment-1'],
        paragraphs: ['修改后的原文'],
      }),
    );
  });

  it('rejects late results after stop or worker switch and isolates drafts', () => {
    const session = new ReaderAutomaticTranslationSession();
    const first = selection('gpt', 'first');
    const firstGeneration = session.start(first);
    const target = {
      chapterId: '0',
      segmentId: '0-0',
      segmentIndex: 0,
      original: '原文',
    };
    session.claim(firstGeneration, [target]);

    const second = selection('gpt', 'second');
    const secondGeneration = session.start(second);
    expect(
      session.store(firstGeneration, [{ ...target, translated: '迟到译文' }]),
    ).toBe(false);
    expect(session.get(first, '0', '0-0')).toBeUndefined();
    expect(session.claim(secondGeneration, [target])).toEqual([target]);
    expect(
      session.store(secondGeneration, [{ ...target, translated: '新译文' }]),
    ).toBe(true);
    expect(session.get(second, '0', '0-0')).toBe('新译文');

    session.stop();
    expect(
      session.store(secondGeneration, [
        { ...target, translated: '停止后译文' },
      ]),
    ).toBe(false);
  });

  it('keeps GPT and Sakura drafts separate', () => {
    const session = new ReaderAutomaticTranslationSession();
    const gpt = selection('gpt');
    const sakura = selection('sakura');
    const target = {
      chapterId: '2',
      segmentId: '2-1',
      segmentIndex: 1,
      original: '原文',
    };
    const gptGeneration = session.start(gpt);
    session.claim(gptGeneration, [target]);
    session.store(gptGeneration, [{ ...target, translated: 'GPT 译文' }]);
    const sakuraGeneration = session.start(sakura);
    session.claim(sakuraGeneration, [target]);
    session.store(sakuraGeneration, [{ ...target, translated: 'Sakura 译文' }]);

    expect(session.get(gpt, '2', '2-1')).toBe('GPT 译文');
    expect(session.get(sakura, '2', '2-1')).toBe('Sakura 译文');
  });

  it('keeps ordinary and retranslation drafts separate', () => {
    const session = new ReaderAutomaticTranslationSession();
    const ordinary = selection('gpt');
    const retranslation = { ...ordinary, purpose: 'retranslate' as const };
    session.hydrate(ordinary, [
      { chapterId: '2', segmentId: '2-1', translated: '普通草稿' },
    ]);
    session.hydrate(retranslation, [
      { chapterId: '2', segmentId: '2-1', translated: '重翻草稿' },
    ]);

    expect(session.get(ordinary, '2', '2-1')).toBe('普通草稿');
    expect(session.get(retranslation, '2', '2-1')).toBe('重翻草稿');
  });
});
