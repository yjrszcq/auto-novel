import 'fake-indexeddb/auto';

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
import { createLengthSegmentor } from '../src/domain/translate/Common';
import { createConcurrencyLimiter } from '../src/domain/translate/Concurrency';
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
      id: 'gpt',
      endpoint: server.endpoint,
      key: 'barrier-key',
      model: 'barrier-model',
    });
    translator.segTranslator.segmentor = createLengthSegmentor(1);

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

  it('preserves segment order when concurrent responses finish out of order', async () => {
    let releaseFirstRequest: () => void = () => {};
    const firstRequestBarrier = new Promise<void>((resolve) => {
      releaseFirstRequest = resolve;
    });
    let announceTwoRequests: () => void = () => {};
    const twoRequestsArrived = new Promise<void>((resolve) => {
      announceTwoRequests = resolve;
    });
    const server = await startOpenAiTestServer({
      onChat: async (request) => {
        if (request.index === 0) await firstRequestBarrier;
        if (request.index === 1) announceTwoRequests();
        return { content: `并发译文${request.index + 1}` };
      },
    });
    cleanupCallbacks.push(server.close);
    const translator = await Translator.create({
      id: 'gpt',
      endpoint: server.endpoint,
      key: 'ordering-key',
      model: 'ordering-model',
    });
    translator.segTranslator.segmentor = createLengthSegmentor(1);

    const translation = translator.translate(
      ['原文甲', '原文乙', '原文丙'],
      undefined,
      { concurrency: 2 },
    );
    await twoRequestsArrived;
    releaseFirstRequest();

    await expect(translation).resolves.toEqual([
      '并发译文1',
      '并发译文2',
      '并发译文3',
    ]);
  });

  it('shares one request limit across concurrent translation groups', async () => {
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
        return { content: `受限译文${request.index + 1}` };
      },
    });
    cleanupCallbacks.push(server.close);
    const translator = await Translator.create({
      id: 'gpt',
      endpoint: server.endpoint,
      key: 'limit-key',
      model: 'limit-model',
    });
    translator.segTranslator.segmentor = createLengthSegmentor(1);
    const requestLimiter = createConcurrencyLimiter(2);

    const translations = Promise.all([
      translator.translate(['甲一', '甲二'], undefined, {
        concurrency: 2,
        requestLimiter,
      }),
      translator.translate(['乙一', '乙二'], undefined, {
        concurrency: 2,
        requestLimiter,
      }),
    ]);
    await twoRequestsArrived;
    try {
      expect(server.activeRequests).toBe(2);
      expect(server.requests).toHaveLength(2);
    } finally {
      releaseRequests();
    }

    await expect(translations).resolves.toHaveLength(2);
    expect(server.requests).toHaveLength(4);
    expect(server.maximumActiveRequests).toBe(2);
  });

  it('retries OpenAI-compatible HTTP errors through the translator policy', async () => {
    const server = await startOpenAiTestServer({
      onChat: () => ({
        content: 'invalid request',
        errorCode: 'invalid_request',
        status: 400,
      }),
    });
    cleanupCallbacks.push(server.close);
    const translator = await Translator.create({
      id: 'gpt',
      endpoint: server.endpoint,
      key: 'error-key',
      model: 'error-model',
    });

    await expect(translator.translate(['失败原文'])).rejects.toThrow(
      '重试次数太多',
    );
    expect(server.requests).toHaveLength(3);
  });

  it('aborts an in-flight HTTP translation', async () => {
    let announceRequest: () => void = () => {};
    const requestArrived = new Promise<void>((resolve) => {
      announceRequest = resolve;
    });
    let releaseRequest: () => void = () => {};
    const requestBarrier = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    const server = await startOpenAiTestServer({
      onChat: async () => {
        announceRequest();
        await requestBarrier;
        return { content: '不应保存的译文' };
      },
    });
    cleanupCallbacks.push(server.close);
    const translator = await Translator.create({
      id: 'gpt',
      endpoint: server.endpoint,
      key: 'abort-key',
      model: 'abort-model',
    });
    const controller = new AbortController();

    const translation = translator.translate(['取消原文'], {
      signal: controller.signal,
    });
    await requestArrived;
    controller.abort();
    releaseRequest();

    await expect(translation).rejects.toMatchObject({ name: 'AbortError' });
    expect(server.requests).toHaveLength(1);
  });

  it('bypasses cached output when translation is forced', async () => {
    const server = await startOpenAiTestServer({
      onChat: (request) => ({
        content: request.index === 0 ? '首次译文' : '强制译文',
      }),
    });
    cleanupCallbacks.push(server.close);
    const translator = await Translator.create(
      {
        id: 'gpt',
        endpoint: server.endpoint,
        key: 'cache-key',
        model: 'cache-model',
      },
      true,
    );

    await expect(translator.translate(['缓存原文'])).resolves.toEqual([
      '首次译文',
    ]);
    await expect(translator.translate(['缓存原文'])).resolves.toEqual([
      '首次译文',
    ]);
    expect(server.requests).toHaveLength(1);
    await expect(
      translator.translate(['缓存原文'], { force: true }),
    ).resolves.toEqual(['强制译文']);
    expect(server.requests).toHaveLength(2);
  });

  it('isolates GPT cache entries by endpoint and model identity', async () => {
    const server = await startOpenAiTestServer({
      onChat: (request) => ({
        content: request.body.model === 'model-a' ? '模型甲译文' : '模型乙译文',
      }),
    });
    cleanupCallbacks.push(server.close);
    const otherServer = await startOpenAiTestServer({
      onChat: () => ({ content: '端点乙译文' }),
    });
    cleanupCallbacks.push(otherServer.close);
    const createTranslator = (model: string, endpoint = server.endpoint) =>
      Translator.create(
        {
          id: 'gpt',
          endpoint,
          key: 'model-key',
          model,
        },
        true,
      );

    const translatorA = await createTranslator('model-a');
    const translatorB = await createTranslator('model-b');
    const translatorAtOtherEndpoint = await createTranslator(
      'model-a',
      otherServer.endpoint,
    );
    await expect(translatorA.translate(['相同原文'])).resolves.toEqual([
      '模型甲译文',
    ]);
    await expect(translatorB.translate(['相同原文'])).resolves.toEqual([
      '模型乙译文',
    ]);
    await expect(
      translatorAtOtherEndpoint.translate(['相同原文']),
    ).resolves.toEqual(['端点乙译文']);
    expect(server.requests).toHaveLength(2);
    expect(otherServer.requests).toHaveLength(1);
  });

  it('isolates Sakura cache entries by translated preceding context', async () => {
    const server = await startOpenAiTestServer({
      onChat: (request) => {
        const prompt = request.body.messages.at(-1)?.content ?? '';
        const previous = request.body.messages.find(
          (message) => message.role === 'assistant',
        )?.content;
        if (prompt.includes('前文甲')) return { content: '甲前文' };
        if (prompt.includes('前文乙')) return { content: '乙前文' };
        return {
          content: previous === '甲前文' ? '甲上下文译文' : '乙上下文译文',
        };
      },
    });
    cleanupCallbacks.push(server.close);
    const translator = await Translator.create(
      {
        id: 'sakura',
        endpoint: server.endpoint,
        segLength: 1,
        prevSegLength: 1,
      },
      true,
    );

    await expect(translator.translate(['前文甲', '共同句'])).resolves.toEqual([
      '甲前文',
      '甲上下文译文',
    ]);
    await expect(translator.translate(['前文乙', '共同句'])).resolves.toEqual([
      '乙前文',
      '乙上下文译文',
    ]);
    expect(server.requests).toHaveLength(4);
  });

  it('keeps Sakura segments sequential so each request receives its context', async () => {
    const server = await startOpenAiTestServer({
      onChat: (request) => ({ content: `连续译文${request.index + 1}` }),
    });
    cleanupCallbacks.push(server.close);
    const translator = await Translator.create({
      id: 'sakura',
      endpoint: server.endpoint,
      segLength: 1,
      prevSegLength: 1,
    });

    await expect(
      translator.translate(['原文甲', '原文乙', '原文丙'], undefined, {
        concurrency: 3,
      }),
    ).resolves.toEqual(['连续译文1', '连续译文2', '连续译文3']);
    expect(server.maximumActiveRequests).toBe(1);
    expect(
      server.requests[1].body.messages.find(
        (message) => message.role === 'assistant',
      )?.content,
    ).toBe('连续译文1');
    expect(
      server.requests[2].body.messages.find(
        (message) => message.role === 'assistant',
      )?.content,
    ).toBe('连续译文2');
  });
});
