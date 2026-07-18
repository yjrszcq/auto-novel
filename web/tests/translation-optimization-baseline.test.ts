import 'fake-indexeddb/auto';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('Audio', class {});
});

import { createLengthSegmentor } from '../src/domain/translate/Common';
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

describe('translation optimization baselines', () => {
  it('records current length segmentation balance and oversized-line work', () => {
    const lines = [
      '甲'.repeat(6),
      '乙'.repeat(4),
      '丙',
      '丁'.repeat(15),
      '戊戊',
    ];
    const segments = createLengthSegmentor(10, 3)(lines);

    expect(segments.map(([input]) => input.join('').length)).toEqual([
      10, 1, 15, 2,
    ]);
    expect(segments.flatMap(([input]) => input)).toEqual(lines);
    expect(
      Math.max(...segments.map(([input]) => input.join('').length)),
    ).toBeGreaterThan(10);
  });

  it('records whole-segment retry amplification before binary recovery', async () => {
    const server = await startOpenAiTestServer({
      onChat: (request) => {
        if (request.index < 3) {
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
      key: 'retry-baseline-key',
      model: 'retry-baseline-model',
    });

    await expect(
      translator.translate(['甲', '乙', '丙', '丁']),
    ).resolves.toEqual(['译文1', '译文2', '译文1', '译文2']);
    expect(server.requests).toHaveLength(5);
  });

  it('records duplicate provider work for simultaneous identical cache misses', async () => {
    let releaseRequests = () => {};
    const requestBarrier = new Promise<void>((resolve) => {
      releaseRequests = resolve;
    });
    let reportTwoRequests = () => {};
    const twoRequestsArrived = new Promise<void>((resolve) => {
      reportTwoRequests = resolve;
    });
    const server = await startOpenAiTestServer({
      onChat: async (request) => {
        if (request.index === 1) reportTwoRequests();
        await requestBarrier;
        return { content: '#1:共享译文' };
      },
    });
    cleanupCallbacks.push(server.close);
    const translator = await Translator.create(
      {
        id: 'gpt',
        endpoint: server.endpoint,
        key: 'cache-baseline-key',
        model: 'cache-baseline-model',
      },
      true,
    );

    const first = translator.translate(['相同原文']);
    const second = translator.translate(['相同原文']);
    await twoRequestsArrived;
    releaseRequests();

    await expect(Promise.all([first, second])).resolves.toEqual([
      ['共享译文'],
      ['共享译文'],
    ]);
    expect(server.requests).toHaveLength(2);
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
    const segments = createLengthSegmentor(1_500, 30)(lines);
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
