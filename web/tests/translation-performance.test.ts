import 'fake-indexeddb/auto';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('Audio', class {});
});

import {
  createBudgetSegmentor,
  estimateTranslationSize,
} from '../src/domain/translate/Common';
import {
  createConcurrencyLimiter,
  runWithConcurrency,
} from '../src/domain/translate/Concurrency';
import { Translator } from '../src/domain/translate/Translator';
import { TranslationCacheRepo } from '../src/repos/useTranslationCache';
import { startOpenAiTestServer } from './helpers/openai-test-server';

const cleanupCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanupCallbacks.splice(0).map((cleanup) => cleanup()));
  await Promise.all([
    TranslationCacheRepo.clear('gpt-seg-cache'),
    TranslationCacheRepo.clear('sakura-seg-cache'),
  ]);
});

const numberedAnswer = (lineCount: number, prefix = '译文') =>
  Array.from(
    { length: lineCount },
    (_, index) => `#${index + 1}:${prefix}${index + 1}`,
  ).join('\n');

const promptLineCount = (prompt: string) =>
  prompt.split('\n').filter((line) => /^#\d+:/.test(line)).length;

describe('translation performance contracts', () => {
  it('records current length segmentation balance and oversized-line work', () => {
    const lines = [
      '甲'.repeat(6),
      '乙'.repeat(4),
      '丙',
      '丁'.repeat(15),
      '戊戊',
    ];
    const segments = createBudgetSegmentor(10, 3)(lines);

    expect(
      segments.map(([input]) => input.map(estimateTranslationSize)),
    ).toEqual([[6, 4], [1], [10], [5, 2]]);
    const reconstructed = Array.from({ length: lines.length }, () => '');
    segments.forEach(([input, , sourceLineIndexes]) => {
      input.forEach((part, index) => {
        reconstructed[sourceLineIndexes[index]] += part;
      });
    });
    expect(reconstructed).toEqual(lines);
    expect(
      Math.max(
        ...segments.map(([input]) =>
          input.reduce((size, line) => size + estimateTranslationSize(line), 0),
        ),
      ),
    ).toBeLessThanOrEqual(10);
  });

  it('normalizes invalid limits without dropping empty-line identities', () => {
    const lines = ['', '甲乙'];
    const segments = createBudgetSegmentor(1, 0, 10)(lines);
    const reconstructed = Array.from({ length: lines.length }, () => '');

    expect(segments.every(([input]) => input.length === 1)).toBe(true);
    expect(
      segments.every(
        ([input]) =>
          input.reduce(
            (size, line) => size + estimateTranslationSize(line),
            0,
          ) <= 1,
      ),
    ).toBe(true);
    segments.forEach(([input, , sourceLineIndexes]) => {
      input.forEach((part, index) => {
        reconstructed[sourceLineIndexes[index]] += part;
      });
    });
    expect(reconstructed).toEqual(lines);
  });

  it('retries the complete segment before binary recovery', async () => {
    const server = await startOpenAiTestServer({
      onChat: (request) => {
        if (request.index === 0) {
          return { content: '#1:行数错误' };
        }
        const prompt = request.body.messages.at(-1)?.content ?? '';
        return { content: numberedAnswer(promptLineCount(prompt)) };
      },
    });
    cleanupCallbacks.push(server.close);
    const translator = await Translator.create({
      id: 'gpt',
      endpoint: server.endpoint,
      key: 'retry-performance-key',
      model: 'retry-performance-model',
    });

    await expect(
      translator.translate(['甲', '乙', '丙', '丁']),
    ).resolves.toEqual(['译文1', '译文2', '译文3', '译文4']);
    expect(server.requests).toHaveLength(2);
    expect(server.requests[1].body.messages.at(-1)?.content).toContain(
      '上一次输出未通过格式校验',
    );
  });

  it('uses the configured progressive retries before bounded binary recovery', async () => {
    const server = await startOpenAiTestServer({
      onChat: (request) => {
        const prompt = request.body.messages.at(-1)?.content ?? '';
        if (request.index < 3) return { content: '#1:行数错误' };
        return { content: numberedAnswer(promptLineCount(prompt)) };
      },
    });
    cleanupCallbacks.push(server.close);
    const translator = await Translator.create({
      id: 'gpt',
      endpoint: server.endpoint,
      key: 'bounded-recovery-key',
      model: 'bounded-recovery-model',
    });

    await expect(
      translator.translate(['甲', '乙', '丙', '丁'], { formatRetryCount: 2 }),
    ).resolves.toEqual(['译文1', '译文2', '译文1', '译文2']);
    expect(server.requests).toHaveLength(5);
    expect(
      server.requests.map((request) =>
        promptLineCount(request.body.messages.at(-1)?.content ?? ''),
      ),
    ).toEqual([4, 4, 4, 2, 2]);
    expect(server.requests[2].body.messages.at(-1)?.content).toContain(
      '这是第2次纠错重试',
    );
  });

  it('retries ambiguous duplicate numbering instead of accepting line positions', async () => {
    const server = await startOpenAiTestServer({
      onChat: (request) =>
        request.index === 0
          ? { content: '#1:第一行译文\n#1:第二行译文' }
          : { content: '#2:第二行译文\n#1:第一行译文' },
    });
    cleanupCallbacks.push(server.close);
    const translator = await Translator.create({
      id: 'gpt',
      endpoint: server.endpoint,
      key: 'duplicate-number-key',
      model: 'duplicate-number-model',
    });

    await expect(translator.translate(['第一行', '第二行'])).resolves.toEqual([
      '第一行译文',
      '第二行译文',
    ]);
    expect(server.requests).toHaveLength(2);
    expect(server.requests[1].body.messages.at(-1)?.content).toContain(
      '编号不完整、重复或混有额外文本',
    );
  });

  it('restores numbered output order from fenced model responses', async () => {
    const server = await startOpenAiTestServer({
      onChat: () => ({
        content: '```text\n#2：第二行译文\n#1: 第一行译文\n```',
      }),
    });
    cleanupCallbacks.push(server.close);
    const translator = await Translator.create({
      id: 'gpt',
      endpoint: server.endpoint,
      key: 'ordered-output-key',
      model: 'ordered-output-model',
    });

    await expect(translator.translate(['第一行', '第二行'])).resolves.toEqual([
      '第一行译文',
      '第二行译文',
    ]);
    expect(server.requests).toHaveLength(1);
  });

  it('reconstructs unchanged translations after oversized source lines split', async () => {
    const server = await startOpenAiTestServer();
    cleanupCallbacks.push(server.close);
    const translator = await Translator.create({
      id: 'gpt',
      endpoint: server.endpoint,
      key: 'split-reuse-key',
      model: 'split-reuse-model',
    });
    translator.segTranslator.segmentor = createBudgetSegmentor(3);

    await expect(
      translator.translate(['这是需要拆分的超长原文'], {
        oldTextZh: ['这是应当完整复用的旧译文'],
      }),
    ).resolves.toEqual(['这是应当完整复用的旧译文']);
    expect(server.requests).toHaveLength(0);
  });

  it('deduplicates simultaneous identical cache misses', async () => {
    let releaseRequests = () => {};
    const requestBarrier = new Promise<void>((resolve) => {
      releaseRequests = resolve;
    });
    let reportFirstRequest = () => {};
    const firstRequestArrived = new Promise<void>((resolve) => {
      reportFirstRequest = resolve;
    });
    const server = await startOpenAiTestServer({
      onChat: async (request) => {
        if (request.index === 0) reportFirstRequest();
        await requestBarrier;
        return { content: '#1:共享译文' };
      },
    });
    cleanupCallbacks.push(server.close);
    const translator = await Translator.create(
      {
        id: 'gpt',
        endpoint: server.endpoint,
        key: 'cache-performance-key',
        model: 'cache-performance-model',
      },
      true,
    );

    const first = translator.translate(['相同原文']);
    const second = translator.translate(['相同原文']);
    await firstRequestArrived;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(server.requests).toHaveLength(1);
    releaseRequests();

    await expect(Promise.all([first, second])).resolves.toEqual([
      ['共享译文'],
      ['共享译文'],
    ]);
    expect(server.requests).toHaveLength(1);
    expect(await TranslationCacheRepo.metrics('gpt-seg-cache')).toMatchObject({
      miss: 2,
      deduplicated: 1,
      provider: 1,
      fault: 0,
    });
  });

  it('keeps FIFO admission and the configured global request ceiling', async () => {
    const limiter = createConcurrencyLimiter(2);
    const admitted: number[] = [];
    const completed: number[] = [];
    let releaseFirstPair = () => {};
    const firstPairBarrier = new Promise<void>((resolve) => {
      releaseFirstPair = resolve;
    });
    let reportFirstPair = () => {};
    const firstPairStarted = new Promise<void>((resolve) => {
      reportFirstPair = resolve;
    });
    let active = 0;
    let maximumActive = 0;

    const work = Array.from({ length: 6 }, (_, index) =>
      limiter.run(async () => {
        admitted.push(index);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        if (admitted.length === 2) reportFirstPair();
        if (index < 2) await firstPairBarrier;
        active -= 1;
        completed.push(index);
      }),
    );
    await firstPairStarted;
    expect(admitted).toEqual([0, 1]);
    releaseFirstPair();
    await Promise.all(work);

    expect(admitted).toEqual([0, 1, 2, 3, 4, 5]);
    expect(completed).toHaveLength(6);
    expect(maximumActive).toBe(2);
  });

  it('segments a large chapter in linear ordered work units', async () => {
    const lines = Array.from({ length: 20_000 }, (_, index) =>
      `${index}`.padStart(8, '0'),
    );
    const segments = createBudgetSegmentor(1_500, 30)(lines);
    const visited: number[] = [];

    await runWithConcurrency(segments, 4, async ([input]) => {
      visited.push(input.length);
    });

    expect(segments).toHaveLength(Math.ceil(lines.length / 30));
    expect(segments.flatMap(([input]) => input)).toEqual(lines);
    expect(visited.reduce((sum, count) => sum + count, 0)).toBe(lines.length);
    expect(Math.max(...visited)).toBe(30);
  });
});
