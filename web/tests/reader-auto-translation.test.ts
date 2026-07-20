import { describe, expect, it } from 'vitest';

import type { ReaderChapterContent } from '@/model/Reader';
import {
  planReaderAutomaticTranslationWindow,
  ReaderAutomaticTranslationSession,
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
  it('prioritizes visible text and plans forward across chapters by page capacity', () => {
    const planned = planReaderAutomaticTranslationWindow({
      chapters: [
        chapter('0', ['甲甲', '乙乙']),
        chapter('1', ['丙丙', '丁丁']),
      ],
      visible: [{ chapterId: '0', segmentId: '0-1' }],
      preloadPages: 2,
    });

    expect(planned.current.map(({ segmentId }) => segmentId)).toEqual(['0-1']);
    expect(planned.prefetch.map(({ segmentId }) => segmentId)).toEqual([
      '1-0',
      '1-1',
    ]);
    expect(planned.prefetchCharacterBudget).toBe(4);
  });

  it('ignores blank source lines and clamps invalid pretranslation counts', () => {
    const planned = planReaderAutomaticTranslationWindow({
      chapters: [chapter('0', ['甲', '', '乙', '丙'])],
      visible: [{ chapterId: '0', segmentId: '0-0' }],
      preloadPages: 100,
    });

    expect(planned.all.map(({ segmentId }) => segmentId)).toEqual([
      '0-0',
      '0-2',
      '0-3',
    ]);
    expect(planned.prefetchCharacterBudget).toBe(20);
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
});
