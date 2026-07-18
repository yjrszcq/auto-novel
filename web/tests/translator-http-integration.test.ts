import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal(
    'Audio',
    class {
      play = vi.fn();
      pause = vi.fn();
    },
  );
});

import { Translator } from '../src/domain/translate/Translator';
import { startOpenAiTestServer } from './helpers/openai-test-server';

const cleanupCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanupCallbacks.splice(0).map((cleanup) => cleanup()));
});

describe('translator HTTP integration', () => {
  it('translates through an OpenAI-compatible streaming endpoint', async () => {
    const server = await startOpenAiTestServer();
    cleanupCallbacks.push(server.close);
    const translator = await Translator.create({
      id: 'gpt',
      endpoint: server.endpoint,
      key: 'integration-key',
      model: 'integration-model',
    });

    await expect(translator.translate(['原文一', '原文二'])).resolves.toEqual([
      '译文第1行',
      '译文第2行',
    ]);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({
      authorization: 'Bearer integration-key',
      body: { model: 'integration-model', stream: true },
    });
  });

  it('detects and translates through a Sakura-compatible endpoint', async () => {
    const server = await startOpenAiTestServer({ model: 'sakura-1.0.gguf' });
    cleanupCallbacks.push(server.close);
    const translator = await Translator.create({
      id: 'sakura',
      endpoint: server.endpoint,
      segLength: 500,
      prevSegLength: 500,
    });

    expect(translator.sakuraModel()).toBe('sakura-1.0');
    await expect(translator.translate(['原文一', '原文二'])).resolves.toEqual([
      '译文第1行',
      '译文第2行',
    ]);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({
      authorization: 'Bearer no-key',
      body: { model: '' },
    });
    expect(server.requests[0].body.stream).toBeUndefined();
  });

  it('measures requests held behind an explicit concurrency barrier', async () => {
    let releaseRequests: () => void = () => {};
    const requestBarrier = new Promise<void>((resolve) => {
      releaseRequests = resolve;
    });
    let announceTwoRequests: () => void = () => {};
    const twoRequestsArrived = new Promise<void>((resolve) => {
      announceTwoRequests = resolve;
    });
    const server = await startOpenAiTestServer({
      onChat: async (request) => {
        if (request.index === 1) announceTwoRequests();
        await requestBarrier;
        return { content: `译文请求${request.index + 1}` };
      },
    });
    cleanupCallbacks.push(server.close);
    const translator = await Translator.create({
      id: 'sakura',
      endpoint: server.endpoint,
      segLength: 1,
      prevSegLength: 1,
    });

    const translation = translator.translate(
      ['原文甲', '原文乙', '原文丙'],
      undefined,
      { concurrency: 2 },
    );
    await twoRequestsArrived;
    try {
      expect(server.activeRequests).toBe(2);
      expect(server.maximumActiveRequests).toBe(2);
    } finally {
      releaseRequests();
    }
    await expect(translation).resolves.toEqual([
      '译文请求1',
      '译文请求2',
      '译文请求3',
    ]);
    expect(server.maximumActiveRequests).toBe(2);
  });
});
