import { describe, expect, it, vi } from 'vitest';

import type { LocalVolumeChapter } from '@/model/LocalVolume';
import {
  ReaderAutomaticTranslationSession,
  type ReaderAutomaticTranslationSelection,
  type ReaderAutomaticTranslationTarget,
} from '@/pages/reader/core/ReaderAutoTranslation';
import { ReaderAutomaticTranslationCoordinator } from '@/pages/reader/core/ReaderAutomaticTranslationCoordinator';

const selection: ReaderAutomaticTranslationSelection = {
  source: 'gpt',
  workerId: 'worker',
  workerFingerprint: 'profile',
  glossaryId: 'current-glossary',
};

const createChapter = (
  paragraphs = ['原文一', '原文二'],
): LocalVolumeChapter => ({
  id: 'book/chapter',
  volumeId: 'book',
  paragraphs,
  segmentIds: paragraphs.map((_, index) => `segment-${index}`),
});

const target = (index: number): ReaderAutomaticTranslationTarget => ({
  chapterId: 'chapter',
  segmentId: `segment-${index}`,
  segmentIndex: index,
  original: ['原文一', '原文二'][index]!,
});

describe('reader automatic translation coordinator', () => {
  it('keeps partial chapter results in memory and commits only after completion', async () => {
    const session = new ReaderAutomaticTranslationSession();
    const generation = session.start(selection);
    const commits = vi.fn();
    const drafts = vi.fn();
    const coordinator = new ReaderAutomaticTranslationCoordinator(session, {
      loadChapter: async () => createChapter(),
      translate: async (_selection, originals) =>
        originals.map((original) => `译-${original}`),
      commit: commits,
      onDraft: drafts,
    });

    await coordinator.translateTargets({
      generation,
      selection,
      targets: [target(0)],
      glossary: { 人名: '译名' },
      concurrency: 1,
      signal: new AbortController().signal,
    });
    expect(drafts).toHaveBeenCalledOnce();
    expect(commits).not.toHaveBeenCalled();

    await coordinator.translateTargets({
      generation,
      selection,
      targets: [target(1)],
      glossary: { 人名: '译名' },
      concurrency: 1,
      signal: new AbortController().signal,
    });
    expect(commits).toHaveBeenCalledWith(selection, 'chapter', {
      glossaryId: 'current-glossary',
      glossary: { 人名: '译名' },
      paragraphs: ['译-原文一', '译-原文二'],
    });
  });

  it('reuses only current-glossary persisted paragraphs', async () => {
    const session = new ReaderAutomaticTranslationSession();
    const generation = session.start(selection);
    const commits = vi.fn();
    const chapter = createChapter();
    chapter.gpt = {
      glossaryId: 'current-glossary',
      glossary: {},
      paragraphs: ['已有译文', ''],
    };
    const translate = vi.fn(async () => ['补充译文']);
    const coordinator = new ReaderAutomaticTranslationCoordinator(session, {
      loadChapter: async () => chapter,
      translate,
      commit: commits,
    });

    await coordinator.translateTargets({
      generation,
      selection,
      targets: [target(0), target(1)],
      glossary: {},
      concurrency: 1,
      signal: new AbortController().signal,
    });

    expect(translate).toHaveBeenCalledWith(
      selection,
      ['原文二'],
      {},
      expect.any(AbortSignal),
    );
    expect(commits.mock.calls[0]?.[2].paragraphs).toEqual([
      '已有译文',
      '补充译文',
    ]);
  });

  it('releases failed targets for retry and rejects results after stop', async () => {
    const session = new ReaderAutomaticTranslationSession();
    const generation = session.start(selection);
    let resolveTranslation!: (value: string[]) => void;
    const translation = new Promise<string[]>((resolve) => {
      resolveTranslation = resolve;
    });
    const commits = vi.fn();
    const coordinator = new ReaderAutomaticTranslationCoordinator(session, {
      loadChapter: async () => createChapter(['原文一']),
      translate: async () => translation,
      commit: commits,
    });
    const pending = coordinator.translateTargets({
      generation,
      selection,
      targets: [target(0)],
      glossary: {},
      concurrency: 1,
      signal: new AbortController().signal,
    });
    session.stop();
    resolveTranslation(['迟到译文']);
    await pending;

    expect(commits).not.toHaveBeenCalled();
    expect(session.get(selection, 'chapter', 'segment-0')).toBeUndefined();

    const retryGeneration = session.start(selection);
    const retryTranslate = vi
      .fn<() => Promise<string[]>>()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce(['重试译文']);
    const retryCoordinator = new ReaderAutomaticTranslationCoordinator(
      session,
      {
        loadChapter: async () => createChapter(['原文一']),
        translate: retryTranslate,
        commit: commits,
      },
    );
    const request = {
      generation: retryGeneration,
      selection,
      targets: [target(0)],
      glossary: {},
      concurrency: 1,
      signal: new AbortController().signal,
    };
    await expect(retryCoordinator.translateTargets(request)).rejects.toThrow(
      'temporary',
    );
    await retryCoordinator.translateTargets(request);
    expect(retryTranslate).toHaveBeenCalledTimes(2);
    expect(commits).toHaveBeenCalledOnce();
  });

  it('rejects stale targets and blank translations without poisoning retries', async () => {
    const session = new ReaderAutomaticTranslationSession();
    const generation = session.start(selection);
    const translate = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValueOnce([''])
      .mockResolvedValueOnce(['有效译文']);
    const commits = vi.fn();
    const coordinator = new ReaderAutomaticTranslationCoordinator(session, {
      loadChapter: async () => createChapter(['原文一']),
      translate,
      commit: commits,
    });
    const request = {
      generation,
      selection,
      targets: [target(0)],
      glossary: {},
      concurrency: 1,
      signal: new AbortController().signal,
    };

    await expect(coordinator.translateTargets(request)).rejects.toThrow(
      '翻译结果包含空白内容',
    );
    await coordinator.translateTargets(request);
    expect(commits).toHaveBeenCalledOnce();

    await expect(
      coordinator.translateTargets({
        ...request,
        targets: [{ ...target(0), original: '已经变化的原文' }],
      }),
    ).rejects.toThrow('阅读内容已更新');
  });
});
