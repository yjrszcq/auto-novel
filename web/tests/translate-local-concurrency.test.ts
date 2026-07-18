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

import { createLengthSegmentor } from '../src/domain/translate/Common';
import { translateLocal } from '../src/domain/translate/TranslateLocal';
import { Translator } from '../src/domain/translate/Translator';
import type {
  LocalVolumeChapter,
  LocalVolumeMetadata,
} from '../src/model/LocalVolume';
import type { TranslateTaskCallback } from '../src/model/Translator';
import { createLocalVolumeDao } from '../src/stores/local/LocalVolumeDao';
import { startOpenAiTestServer } from './helpers/openai-test-server';

const cleanupCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanupCallbacks.splice(0).map((cleanup) => cleanup()));
});

const seedVolume = async (
  volumeId: string,
  chapters: Array<{ id: string; paragraphs: string[] }>,
) => {
  const dao = await createLocalVolumeDao();
  const metadata: LocalVolumeMetadata = {
    id: volumeId,
    createAt: 1,
    toc: chapters.map((chapter) => ({
      chapterId: chapter.id,
      title: chapter.id,
    })),
    sourceFormat: 'epub',
    glossaryId: 'glossary',
    glossary: {},
    favoredId: 'default',
    sourceBookMetadata: { title: volumeId, languages: ['ja'] },
  };
  await dao.createMetadata(metadata);
  await Promise.all(
    chapters.map((chapter) => {
      const storedChapter: LocalVolumeChapter = {
        id: `${volumeId}/${chapter.id}`,
        volumeId,
        paragraphs: chapter.paragraphs,
        segmentIds: chapter.paragraphs.map(
          (_, index) => `${chapter.id}-segment-${index}`,
        ),
      };
      return dao.createChapter(storedChapter);
    }),
  );
  dao.close();
};

const createCallback = () => {
  const state = { total: 0, successes: 0, failures: 0, logs: [] as string[] };
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
    log: (message) => state.logs.push(message),
  };
  return { callback, state };
};

const translateVolume = (
  volumeId: string,
  callback: TranslateTaskCallback,
  translator: Translator,
  signal?: AbortSignal,
  level: 'normal' | 'all' = 'all',
) =>
  translateLocal(
    { type: 'local', volumeId },
    {
      level,
      forceMetadata: false,
      startIndex: 0,
      endIndex: 65535,
    },
    callback,
    translator,
    signal,
    { concurrency: 2 },
  );

describe('local volume concurrent translation', () => {
  it('caps total HTTP requests across concurrent chapters and segments', async () => {
    const volumeId = 'concurrency-volume.epub';
    await seedVolume(volumeId, [
      { id: 'chapter-a', paragraphs: ['甲一', '甲二'] },
      { id: 'chapter-b', paragraphs: ['乙一', '乙二'] },
    ]);
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
        if (request.index < 2) await requestBarrier;
        return { content: `#1:章节译文${request.index + 1}` };
      },
    });
    cleanupCallbacks.push(server.close);
    const translator = await Translator.create({
      id: 'gpt',
      endpoint: server.endpoint,
      key: 'chapter-key',
      model: 'chapter-model',
    });
    translator.segTranslator.segmentor = createLengthSegmentor(1);
    const { callback, state } = createCallback();

    const translation = translateVolume(volumeId, callback, translator);
    await twoRequestsArrived;
    try {
      expect(server.activeRequests).toBe(2);
      expect(server.requests).toHaveLength(2);
    } finally {
      releaseRequests();
    }
    await translation;

    expect(server.requests).toHaveLength(4);
    expect(server.maximumActiveRequests).toBe(2);
    expect(state).toMatchObject({ total: 2, successes: 2, failures: 0 });
    const dao = await createLocalVolumeDao();
    const [chapterA, chapterB] = await Promise.all([
      dao.getChapter(volumeId, 'chapter-a'),
      dao.getChapter(volumeId, 'chapter-b'),
    ]);
    dao.close();
    expect(chapterA?.gpt?.paragraphs).toHaveLength(2);
    expect(chapterB?.gpt?.paragraphs).toHaveLength(2);
  });

  it('does not persist late results after cancellation', async () => {
    const volumeId = 'abort-volume.epub';
    await seedVolume(volumeId, [
      { id: 'chapter-a', paragraphs: ['取消甲'] },
      { id: 'chapter-b', paragraphs: ['取消乙'] },
      { id: 'chapter-c', paragraphs: ['取消丙'] },
    ]);
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
        return { content: '#1:取消后的译文' };
      },
    });
    cleanupCallbacks.push(server.close);
    const translator = await Translator.create({
      id: 'gpt',
      endpoint: server.endpoint,
      key: 'abort-key',
      model: 'abort-model',
    });
    const { callback, state } = createCallback();
    const controller = new AbortController();

    const translation = translateVolume(
      volumeId,
      callback,
      translator,
      controller.signal,
    );
    await twoRequestsArrived;
    controller.abort();
    releaseRequests();

    await expect(translation).resolves.toBe('abort');
    expect(server.requests).toHaveLength(2);
    expect(state).toMatchObject({ total: 3, successes: 0, failures: 0 });
    const dao = await createLocalVolumeDao();
    const chapters = await Promise.all(
      ['chapter-a', 'chapter-b', 'chapter-c'].map((chapterId) =>
        dao.getChapter(volumeId, chapterId),
      ),
    );
    dao.close();
    expect(chapters.every((chapter) => chapter?.gpt === undefined)).toBe(true);
  });

  it('persists successes and resumes only the failed chapter', async () => {
    const volumeId = 'partial-failure-volume.epub';
    await seedVolume(volumeId, [
      { id: 'chapter-failure', paragraphs: ['失败原文'] },
      { id: 'chapter-success', paragraphs: ['成功原文'] },
    ]);
    const server = await startOpenAiTestServer({
      onChat: (request) => {
        const prompt = request.body.messages.at(-1)?.content ?? '';
        return prompt.includes('失败原文')
          ? {
              content: 'provider failure',
              errorCode: 'invalid_request',
              status: 400,
            }
          : { content: '#1:成功译文' };
      },
    });
    cleanupCallbacks.push(server.close);
    const translator = await Translator.create({
      id: 'gpt',
      endpoint: server.endpoint,
      key: 'partial-key',
      model: 'partial-model',
    });
    const { callback, state } = createCallback();

    await translateVolume(volumeId, callback, translator);

    expect(state).toMatchObject({ total: 2, successes: 1, failures: 1 });
    const dao = await createLocalVolumeDao();
    const [failedChapter, successfulChapter] = await Promise.all([
      dao.getChapter(volumeId, 'chapter-failure'),
      dao.getChapter(volumeId, 'chapter-success'),
    ]);
    dao.close();
    expect(failedChapter?.gpt).toBeUndefined();
    expect(successfulChapter?.gpt?.paragraphs).toEqual(['成功译文']);

    const recoveryServer = await startOpenAiTestServer({
      onChat: () => ({ content: '#1:恢复译文' }),
    });
    cleanupCallbacks.push(recoveryServer.close);
    const recoveryTranslator = await Translator.create({
      id: 'gpt',
      endpoint: recoveryServer.endpoint,
      key: 'recovery-key',
      model: 'recovery-model',
    });
    const recovery = createCallback();
    await translateVolume(
      volumeId,
      recovery.callback,
      recoveryTranslator,
      undefined,
      'normal',
    );

    expect(recovery.state).toMatchObject({
      total: 1,
      successes: 1,
      failures: 0,
    });
    expect(recoveryServer.requests).toHaveLength(1);
    const recoveredDao = await createLocalVolumeDao();
    const [recoveredChapter, unchangedChapter] = await Promise.all([
      recoveredDao.getChapter(volumeId, 'chapter-failure'),
      recoveredDao.getChapter(volumeId, 'chapter-success'),
    ]);
    recoveredDao.close();
    expect(recoveredChapter?.gpt?.paragraphs).toEqual(['恢复译文']);
    expect(unchangedChapter?.gpt?.paragraphs).toEqual(['成功译文']);
  });
});
