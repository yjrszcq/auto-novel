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

import { createBudgetSegmentor } from '../src/domain/translate/Common';
import { SakuraWorkerPipeline } from '../src/domain/translate/SakuraWorkerPipeline';
import { Translator } from '../src/domain/translate/Translator';
import { SakuraTranslator } from '../src/domain/translate/TranslatorSakura';
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
  await TranslationCacheRepo.clear('sakura-seg-cache');
});

const deferred = () => {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
};

const seedVolume = async (volumeId: string, chapterParagraphs: string[][]) => {
  const dao = await createLocalVolumeDao();
  const toc = chapterParagraphs.map((_, index) => ({
    chapterId: `chapter-${index + 1}`,
    title: `chapter-${index + 1}`,
  }));
  const metadata: LocalVolumeMetadata = {
    id: volumeId,
    createAt: 1,
    toc,
    sourceFormat: 'epub',
    glossaryId: 'glossary',
    glossary: {},
    favoredId: 'default',
    sourceBookMetadata: { title: volumeId, languages: ['ja'] },
  };
  await dao.createMetadata(metadata);
  for (const [index, paragraphs] of chapterParagraphs.entries()) {
    const chapterId = toc[index].chapterId;
    const chapter: LocalVolumeChapter = {
      id: `${volumeId}/${chapterId}`,
      volumeId,
      paragraphs,
      segmentIds: paragraphs.map(
        (_, paragraphIndex) => `segment-${index}-${paragraphIndex}`,
      ),
    };
    await dao.createChapter(chapter);
  }
  dao.close();
  return toc.map(({ chapterId }) => chapterId);
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

const createResumeCallback = () => {
  const remainingChapterIds = new Set<string>();
  const callback: TranslateTaskCallback = {
    onStart: (_total, chapterIds) => {
      chapterIds.forEach((chapterId) => remainingChapterIds.add(chapterId));
    },
    onChapterSuccess: ({ chapterId }) => {
      remainingChapterIds.delete(chapterId);
    },
    onChapterFailure: () => {},
    log: () => {},
  };
  return { callback, remainingChapterIds };
};

const createTranslator = async (
  endpoint: string,
  options: { segLength?: number; prevSegLength?: number } = {},
) => {
  const translator = await Translator.create({
    id: 'sakura',
    endpoint,
    segLength: options.segLength ?? 100,
    prevSegLength: options.prevSegLength ?? 100,
  });
  translator.segTranslator.segmentor = createBudgetSegmentor(100, 1);
  return translator;
};

const sourceText = (messages: Array<{ role: string; content: string }>) => {
  const prompt =
    messages.findLast(({ role }) => role === 'user')?.content ?? '';
  return prompt.split('：').at(-1) ?? prompt;
};

describe('Sakura shared worker pipeline', () => {
  it('combines deployments across chapters while preserving chapter context', async () => {
    const volumeId = 'sakura-context-pool.epub';
    const chapterIds = await seedVolume(volumeId, [
      ['甲一', '甲二'],
      ['乙一', '乙二'],
    ]);
    const releaseFirstPair = deferred();
    const firstPairStarted = deferred();
    let started = 0;
    const requests: Array<{
      source: string;
      previous?: string;
    }> = [];
    const createServer = () =>
      startOpenAiTestServer({
        model: 'sakura-1.0.gguf',
        onChat: async (request) => {
          const messages = request.body.messages;
          const source = sourceText(messages);
          requests.push({
            source,
            previous: messages.find(({ role }) => role === 'assistant')
              ?.content,
          });
          started += 1;
          if (started === 2) firstPairStarted.resolve();
          if (started <= 2) await releaseFirstPair.promise;
          return { content: `译-${source}` };
        },
      });
    const firstServer = await createServer();
    const secondServer = await createServer();
    cleanupCallbacks.push(firstServer.close, secondServer.close);
    const first = await createTranslator(firstServer.endpoint);
    const second = await createTranslator(secondServer.endpoint);
    const pipeline = new SakuraWorkerPipeline({ highWaterMark: 4 });
    pipeline.register({ id: 'first', translator: first, concurrency: 1 });
    pipeline.register({ id: 'second', translator: second, concurrency: 1 });
    const { callback, state } = createCallback();

    const translation = pipeline.translateLocal(
      { type: 'local', volumeId },
      taskParams(),
      callback,
    );
    await firstPairStarted.promise;
    expect(pipeline.snapshot()).toMatchObject({
      aggregateActive: 2,
      aggregateMaximum: 2,
    });
    releaseFirstPair.resolve();
    await translation;

    expect(state).toEqual({ total: 2, successes: 2, failures: 0 });
    expect(requests).toEqual(
      expect.arrayContaining([
        { source: '甲一', previous: undefined },
        { source: '乙一', previous: undefined },
        { source: '甲二', previous: '译-甲一' },
        { source: '乙二', previous: '译-乙一' },
      ]),
    );
    const dao = await createLocalVolumeDao();
    await expect(
      Promise.all(
        chapterIds.map((chapterId) => dao.getChapter(volumeId, chapterId)),
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        sakura: expect.objectContaining({ paragraphs: ['译-甲一', '译-甲二'] }),
      }),
      expect.objectContaining({
        sakura: expect.objectContaining({ paragraphs: ['译-乙一', '译-乙二'] }),
      }),
    ]);
    dao.close();
    pipeline.close();
  });

  it('rejects workers with a different Sakura profile', async () => {
    const server = await startOpenAiTestServer({ model: 'sakura-1.0.gguf' });
    cleanupCallbacks.push(server.close);
    const first = await createTranslator(server.endpoint, { segLength: 100 });
    const incompatible = await createTranslator(server.endpoint, {
      segLength: 200,
    });
    const pipeline = new SakuraWorkerPipeline();
    pipeline.register({ id: 'first', translator: first, concurrency: 1 });

    expect(() =>
      pipeline.register({
        id: 'incompatible',
        translator: incompatible,
        concurrency: 1,
      }),
    ).toThrow('配置不兼容');
    expect(pipeline.snapshot().workers.map(({ id }) => id)).toEqual(['first']);
    pipeline.close();
  });

  it('keeps the task profile locked between chapters', async () => {
    const volumeId = 'sakura-profile-lock.epub';
    await seedVolume(volumeId, [['第一章'], ['第二章']]);
    const createFakeTranslator = (
      endpoint: string,
      segLength: number,
      label: string,
    ) => {
      const segmentTranslator = new SakuraTranslator(() => {}, {
        endpoint,
        segLength,
        prevSegLength: 100,
      });
      segmentTranslator.model = { id: 'sakura-1.0' };
      segmentTranslator.version = '1.0';
      segmentTranslator.segmentor = createBudgetSegmentor(100, 1);
      segmentTranslator.translate = async (segment) =>
        segment.map((line) => `${label}-${line}`);
      return new Translator(segmentTranslator);
    };
    const first = createFakeTranslator('http://127.0.0.1:4', 100, '甲');
    const replacement = createFakeTranslator('http://127.0.0.1:5', 100, '乙');
    const incompatible = createFakeTranslator('http://127.0.0.1:6', 200, '异');
    const pipeline = new SakuraWorkerPipeline({ highWaterMark: 1 });
    pipeline.register({ id: 'first', translator: first, concurrency: 1 });
    let completed = 0;
    const callback: TranslateTaskCallback = {
      onStart: () => {},
      onChapterSuccess: () => {
        completed += 1;
        if (completed !== 1) return;
        pipeline.unregister('first');
        expect(pipeline.profile()).toEqual(first.sakuraProfile());
        expect(() =>
          pipeline.register({
            id: 'incompatible',
            translator: incompatible,
            concurrency: 1,
          }),
        ).toThrow('配置不兼容');
        pipeline.register({
          id: 'replacement',
          translator: replacement,
          concurrency: 1,
        });
      },
      onChapterFailure: () => {},
      log: () => {},
    };

    await pipeline.translateLocal(
      { type: 'local', volumeId },
      taskParams(),
      callback,
    );

    expect(completed).toBe(2);
    expect(pipeline.snapshot().workers.map(({ id }) => id)).toEqual([
      'replacement',
    ]);
    pipeline.close();
  });

  it('requeues an interrupted segment on another compatible deployment', async () => {
    const volumeId = 'sakura-worker-stop.epub';
    const [chapterId] = await seedVolume(volumeId, [['待转交原文']]);
    const firstStarted = deferred();
    const firstSegmentTranslator = new SakuraTranslator(() => {}, {
      endpoint: 'http://127.0.0.1:1',
      segLength: 100,
      prevSegLength: 100,
    });
    firstSegmentTranslator.model = { id: 'sakura-1.0' };
    firstSegmentTranslator.version = '1.0';
    firstSegmentTranslator.segmentor = createBudgetSegmentor(100, 1);
    firstSegmentTranslator.translate = async (_segment, context) => {
      firstStarted.resolve();
      await new Promise<void>((_resolve, reject) => {
        context.signal?.addEventListener(
          'abort',
          () => reject(context.signal?.reason),
          { once: true },
        );
      });
      return [];
    };
    const secondSegmentTranslator = new SakuraTranslator(() => {}, {
      endpoint: 'http://127.0.0.1:2',
      segLength: 100,
      prevSegLength: 100,
    });
    secondSegmentTranslator.model = { id: 'sakura-1.0' };
    secondSegmentTranslator.version = '1.0';
    secondSegmentTranslator.segmentor = createBudgetSegmentor(100, 1);
    secondSegmentTranslator.translate = async (segment) =>
      segment.map((line) => `接管-${line}`);
    const pipeline = new SakuraWorkerPipeline();
    pipeline.register({
      id: 'first',
      translator: new Translator(firstSegmentTranslator),
      concurrency: 1,
    });
    pipeline.register({
      id: 'second',
      translator: new Translator(secondSegmentTranslator),
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

    const dao = await createLocalVolumeDao();
    const stored = await dao.getChapter(volumeId, chapterId);
    dao.close();
    expect(stored?.sakura?.paragraphs).toEqual(['接管-待转交原文']);
    expect(pipeline.snapshot().workers).toEqual([
      expect.objectContaining({ id: 'second', errors: 0 }),
    ]);
    pipeline.close();
  });

  it('persists completed chapters and reports only unfinished work on abort', async () => {
    const volumeId = 'sakura-resume.epub';
    const chapterIds = await seedVolume(volumeId, [['先完成'], ['后中止']]);
    const secondStarted = deferred();
    const segmentTranslator = new SakuraTranslator(() => {}, {
      endpoint: 'http://127.0.0.1:3',
      segLength: 100,
      prevSegLength: 100,
    });
    segmentTranslator.model = { id: 'sakura-1.0' };
    segmentTranslator.version = '1.0';
    segmentTranslator.segmentor = createBudgetSegmentor(100, 1);
    segmentTranslator.translate = async (segment, context) => {
      if (segment[0] === '先完成') return ['已完成'];
      secondStarted.resolve();
      await new Promise<void>((_resolve, reject) => {
        context.signal?.addEventListener(
          'abort',
          () => reject(context.signal?.reason),
          { once: true },
        );
      });
      return [];
    };
    const pipeline = new SakuraWorkerPipeline({ highWaterMark: 1 });
    pipeline.register({
      id: 'worker',
      translator: new Translator(segmentTranslator),
      concurrency: 1,
    });
    const controller = new AbortController();
    const { callback, remainingChapterIds } = createResumeCallback();

    const translation = pipeline.translateLocal(
      { type: 'local', volumeId },
      taskParams(),
      callback,
      controller.signal,
    );
    await secondStarted.promise;
    controller.abort();

    await expect(translation).resolves.toBe('abort');
    expect([...remainingChapterIds]).toEqual([chapterIds[1]]);
    const dao = await createLocalVolumeDao();
    const [completed, unfinished] = await Promise.all(
      chapterIds.map((chapterId) => dao.getChapter(volumeId, chapterId)),
    );
    dao.close();
    expect(completed?.sakura?.paragraphs).toEqual(['已完成']);
    expect(unfinished?.sakura).toBeUndefined();
    pipeline.close();
  });

  it('deduplicates equivalent requests across deployment endpoints', async () => {
    const volumeId = 'sakura-shared-cache.epub';
    await seedVolume(volumeId, [['相同原文'], ['相同原文']]);
    const firstServer = await startOpenAiTestServer({
      model: 'sakura-1.0.gguf',
      onChat: () => ({ content: '共享译文' }),
    });
    const secondServer = await startOpenAiTestServer({
      model: 'sakura-1.0.gguf',
      onChat: () => ({ content: '共享译文' }),
    });
    cleanupCallbacks.push(firstServer.close, secondServer.close);
    const first = await Translator.create(
      {
        id: 'sakura',
        endpoint: firstServer.endpoint,
        segLength: 100,
        prevSegLength: 100,
      },
      true,
    );
    const second = await Translator.create(
      {
        id: 'sakura',
        endpoint: secondServer.endpoint,
        segLength: 100,
        prevSegLength: 100,
      },
      true,
    );
    const pipeline = new SakuraWorkerPipeline({ highWaterMark: 2 });
    pipeline.register({ id: 'first', translator: first, concurrency: 1 });
    pipeline.register({ id: 'second', translator: second, concurrency: 1 });

    await pipeline.translateLocal(
      { type: 'local', volumeId },
      taskParams('normal'),
      createCallback().callback,
    );

    expect(firstServer.requests.length + secondServer.requests.length).toBe(1);
    const metrics = await TranslationCacheRepo.metrics('sakura-seg-cache');
    expect(metrics.deduplicated).toBe(1);
    pipeline.close();
  });
});
