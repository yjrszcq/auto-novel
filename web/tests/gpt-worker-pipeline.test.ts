import 'fake-indexeddb/auto';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal(
    'Audio',
    class {
      play = vi.fn();
      pause = vi.fn();
    },
  );
});

import {
  createBudgetSegmentor,
  type SegmentTranslator,
} from '../src/domain/translate/Common';
import { GptWorkerPipeline } from '../src/domain/translate/GptWorkerPipeline';
import { Translator } from '../src/domain/translate/Translator';
import type {
  LocalVolumeChapter,
  LocalVolumeMetadata,
} from '../src/model/LocalVolume';
import type { TranslateTaskCallback } from '../src/model/Translator';
import { TranslationCacheRepo } from '../src/repos/useTranslationCache';
import { createLocalVolumeDao } from '../src/stores/local/LocalVolumeDao';
import { startOpenAiTestServer } from './helpers/openai-test-server';

const cleanupCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanupCallbacks.splice(0).map((cleanup) => cleanup()));
  await TranslationCacheRepo.clear('gpt-seg-cache');
});

const deferred = () => {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
};

const sourceLine = (prompt: string) =>
  /^#\d+:(.+)$/mu.exec(prompt)?.[1] ?? '未知原文';

const seedVolume = async (volumeId: string, paragraphs: string[]) => {
  const dao = await createLocalVolumeDao();
  const chapterId = 'chapter-1';
  const metadata: LocalVolumeMetadata = {
    id: volumeId,
    createAt: 1,
    toc: [{ chapterId, title: chapterId }],
    sourceFormat: 'epub',
    glossaryId: 'glossary',
    glossary: {},
    favoredId: 'default',
    sourceBookMetadata: { title: volumeId, languages: ['ja'] },
  };
  const chapter: LocalVolumeChapter = {
    id: `${volumeId}/${chapterId}`,
    volumeId,
    paragraphs,
    segmentIds: paragraphs.map((_, index) => `segment-${index}`),
  };
  await dao.createMetadata(metadata);
  await dao.createChapter(chapter);
  dao.close();
  return chapterId;
};

const taskParams = (level: 'normal' | 'all' = 'all') => ({
  level,
  forceMetadata: false,
  startIndex: 0,
  endIndex: 65_535,
});

const createCallback = () => {
  const state = { total: 0, successes: 0, failures: 0 };
  const callback: TranslateTaskCallback = {
    onStart: (total) => {
      state.total = total;
    },
    onChapterSuccess: () => {
      state.successes += 1;
    },
    onChapterFailure: () => {
      state.failures += 1;
    },
    log: () => {},
  };
  return { callback, state };
};

const createTranslator = (endpoint: string, model: string, cache = false) =>
  Translator.create({ id: 'gpt', endpoint, model, key: `${model}-key` }, cache);

describe('GPT shared worker pipeline', () => {
  it('uses aggregate capacity above the legacy per-worker ceiling', async () => {
    const volumeId = 'aggregate-capacity-volume.epub';
    await seedVolume(
      volumeId,
      Array.from({ length: 17 }, (_, index) => `并发原文${index}`),
    );
    const release = deferred();
    const allStarted = deferred();
    let active = 0;
    let maximumActive = 0;
    const createFakeTranslator = (label: string) =>
      new Translator({
        id: 'gpt',
        cacheIdentity: { label },
        segmentor: createBudgetSegmentor(100, 1),
        log: () => {},
        translate: async (segment) => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          if (active === 17) allStarted.resolve();
          await release.promise;
          active -= 1;
          return segment.map((line) => `${label}译-${line}`);
        },
      } satisfies SegmentTranslator);
    const pipeline = new GptWorkerPipeline({ highWaterMark: 20 });
    pipeline.register({
      id: 'wide',
      translator: createFakeTranslator('甲'),
      concurrency: 16,
    });
    pipeline.register({
      id: 'extra',
      translator: createFakeTranslator('乙'),
      concurrency: 1,
    });

    const translation = pipeline.translateLocal(
      { type: 'local', volumeId },
      taskParams(),
      createCallback().callback,
    );
    await allStarted.promise;
    expect(pipeline.snapshot()).toMatchObject({
      aggregateActive: 17,
      aggregateMaximum: 17,
    });
    expect(maximumActive).toBe(17);
    release.resolve();
    await translation;
    pipeline.close();
  });

  it('combines worker capacity on one chapter and preserves source order', async () => {
    const volumeId = 'pooled-volume.epub';
    const paragraphs = Array.from({ length: 6 }, (_, index) => `原文${index}`);
    const chapterId = await seedVolume(volumeId, paragraphs);
    const release = deferred();
    const allStarted = deferred();
    let active = 0;
    let maximumActive = 0;
    let started = 0;
    const createServer = (workerLabel: string) =>
      startOpenAiTestServer({
        onChat: async (request) => {
          active += 1;
          started += 1;
          maximumActive = Math.max(maximumActive, active);
          if (started === 3) allStarted.resolve();
          if (started <= 3) await release.promise;
          active -= 1;
          const prompt = request.body.messages.at(-1)?.content ?? '';
          return { content: `#1:${workerLabel}译-${sourceLine(prompt)}` };
        },
      });
    const firstServer = await createServer('甲');
    const secondServer = await createServer('乙');
    cleanupCallbacks.push(firstServer.close, secondServer.close);
    const first = await createTranslator(firstServer.endpoint, 'first-model');
    const second = await createTranslator(
      secondServer.endpoint,
      'second-model',
    );
    first.segTranslator.segmentor = createBudgetSegmentor(100, 1);
    second.segTranslator.segmentor = createBudgetSegmentor(100, 1);
    const snapshots: ReturnType<GptWorkerPipeline['snapshot']>[] = [];
    const pipeline = new GptWorkerPipeline({
      highWaterMark: 6,
      onSnapshot: (snapshot) => snapshots.push(snapshot),
    });
    pipeline.register({ id: 'first', translator: first, concurrency: 1 });
    pipeline.register({ id: 'second', translator: second, concurrency: 2 });
    const { callback, state } = createCallback();
    const workerIds: string[] = [];

    const translation = pipeline.translateLocal(
      { type: 'local', volumeId },
      taskParams(),
      callback,
      undefined,
      {
        onSegmentProgress: (info) => {
          if (info.status === 'success' && info.workerId) {
            workerIds.push(info.workerId);
          }
        },
      },
    );
    await allStarted.promise;
    expect(pipeline.snapshot()).toMatchObject({
      aggregateActive: 3,
      aggregateMaximum: 3,
    });
    release.resolve();
    await translation;

    expect(state).toEqual({ total: 1, successes: 1, failures: 0 });
    expect(maximumActive).toBe(3);
    expect(firstServer.maximumActiveRequests).toBe(1);
    expect(secondServer.maximumActiveRequests).toBe(2);
    expect(new Set(workerIds)).toEqual(new Set(['first', 'second']));
    expect(
      snapshots.some((snapshot) =>
        snapshot.workers.some((worker) => worker.assignments.length > 0),
      ),
    ).toBe(true);
    const dao = await createLocalVolumeDao();
    const stored = await dao.getChapter(volumeId, chapterId);
    dao.close();
    expect(stored?.gpt?.paragraphs).toHaveLength(paragraphs.length);
    stored?.gpt?.paragraphs.forEach((translated, index) => {
      expect(translated).toMatch(new RegExp(`^[甲乙]译-原文${index}$`));
    });
    pipeline.close();
  });

  it('keeps cache identities isolated and reuses each worker cache', async () => {
    const firstServer = await startOpenAiTestServer({
      onChat: (request) => ({
        content: `#1:甲译-${sourceLine(request.body.messages.at(-1)?.content ?? '')}`,
      }),
    });
    const secondServer = await startOpenAiTestServer({
      onChat: (request) => ({
        content: `#1:乙译-${sourceLine(request.body.messages.at(-1)?.content ?? '')}`,
      }),
    });
    cleanupCallbacks.push(firstServer.close, secondServer.close);
    const first = await createTranslator(
      firstServer.endpoint,
      'cache-first',
      true,
    );
    const second = await createTranslator(
      secondServer.endpoint,
      'cache-second',
      true,
    );
    first.segTranslator.segmentor = createBudgetSegmentor(100, 1);
    second.segTranslator.segmentor = createBudgetSegmentor(100, 1);
    const pipeline = new GptWorkerPipeline({ highWaterMark: 2 });
    pipeline.register({ id: 'first', translator: first, concurrency: 1 });
    pipeline.register({ id: 'second', translator: second, concurrency: 1 });

    for (const volumeId of ['cache-volume-a.epub', 'cache-volume-b.epub']) {
      await seedVolume(volumeId, ['相同原文', '相同原文']);
      await pipeline.translateLocal(
        { type: 'local', volumeId },
        taskParams('normal'),
        createCallback().callback,
      );
    }

    expect(firstServer.requests).toHaveLength(1);
    expect(secondServer.requests).toHaveLength(1);
    expect(await TranslationCacheRepo.metrics('gpt-seg-cache')).toMatchObject({
      entryCount: 2,
      hit: 2,
      provider: 2,
    });
    pipeline.close();
  });

  it('reassigns a live HTTP segment when its worker stops', async () => {
    const volumeId = 'reassign-volume.epub';
    const chapterId = await seedVolume(volumeId, ['需要重排的原文']);
    const firstStarted = deferred();
    const releaseFirst = deferred();
    const firstServer = await startOpenAiTestServer({
      onChat: async () => {
        firstStarted.resolve();
        await releaseFirst.promise;
        return { content: '#1:不应写入的旧工作者译文' };
      },
    });
    const secondServer = await startOpenAiTestServer({
      onChat: () => ({ content: '#1:新工作者译文' }),
    });
    cleanupCallbacks.push(firstServer.close, secondServer.close);
    const pipeline = new GptWorkerPipeline();
    pipeline.register({
      id: 'first',
      translator: await createTranslator(
        firstServer.endpoint,
        'reassign-first',
      ),
      concurrency: 1,
    });
    pipeline.register({
      id: 'second',
      translator: await createTranslator(
        secondServer.endpoint,
        'reassign-second',
      ),
      concurrency: 1,
    });

    const translation = pipeline.translateLocal(
      { type: 'local', volumeId },
      taskParams(),
      createCallback().callback,
    );
    await firstStarted.promise;
    pipeline.unregister('first');
    await translation;
    releaseFirst.resolve();

    expect(secondServer.requests).toHaveLength(1);
    const dao = await createLocalVolumeDao();
    const stored = await dao.getChapter(volumeId, chapterId);
    dao.close();
    expect(stored?.gpt?.paragraphs).toEqual(['新工作者译文']);
    pipeline.close();
  });

  it('cancels every worker without persisting late chapter results', async () => {
    const volumeId = 'pooled-abort-volume.epub';
    const chapterId = await seedVolume(volumeId, ['取消甲', '取消乙']);
    const release = deferred();
    const bothStarted = deferred();
    let started = 0;
    const createServer = () =>
      startOpenAiTestServer({
        onChat: async () => {
          started += 1;
          if (started === 2) bothStarted.resolve();
          await release.promise;
          return { content: '#1:取消后的译文' };
        },
      });
    const firstServer = await createServer();
    const secondServer = await createServer();
    cleanupCallbacks.push(firstServer.close, secondServer.close);
    const first = await createTranslator(firstServer.endpoint, 'abort-first');
    const second = await createTranslator(
      secondServer.endpoint,
      'abort-second',
    );
    first.segTranslator.segmentor = createBudgetSegmentor(100, 1);
    const pipeline = new GptWorkerPipeline();
    pipeline.register({ id: 'first', translator: first, concurrency: 1 });
    pipeline.register({ id: 'second', translator: second, concurrency: 1 });
    const controller = new AbortController();

    const translation = pipeline.translateLocal(
      { type: 'local', volumeId },
      taskParams(),
      createCallback().callback,
      controller.signal,
    );
    await bothStarted.promise;
    controller.abort();
    release.resolve();

    await expect(translation).resolves.toBe('abort');
    const dao = await createLocalVolumeDao();
    const stored = await dao.getChapter(volumeId, chapterId);
    dao.close();
    expect(stored?.gpt).toBeUndefined();
    expect(pipeline.snapshot()).toMatchObject({
      outstanding: 0,
      aggregateActive: 0,
    });
    pipeline.close();
  });
});
