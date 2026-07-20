import { describe, expect, it } from 'vitest';

import type {
  TxtCatalogWorkerRequest,
  TxtCatalogWorkerResponse,
} from '../src/util/file/TxtCatalogWorkerProtocol';
import { createTxtCatalogSession } from '../src/util/file/TxtCatalogWorkerSession';

class FakeWorker {
  readonly requests: TxtCatalogWorkerRequest[] = [];
  terminated = false;
  private readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener) {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener) {
    this.listeners.get(type)?.delete(listener);
  }

  postMessage(request: TxtCatalogWorkerRequest) {
    this.requests.push(request);
  }

  terminate() {
    this.terminated = true;
  }

  respond(response: TxtCatalogWorkerResponse) {
    const event = new MessageEvent('message', { data: response });
    for (const listener of this.listeners.get('message') ?? []) listener(event);
  }

  fail(message: string) {
    const event = { message } as ErrorEvent;
    for (const listener of this.listeners.get('error') ?? []) listener(event);
  }
}

describe('TXT catalog Worker session', () => {
  it('matches responses and forwards progress events', async () => {
    const worker = new FakeWorker();
    const session = createTxtCatalogSession(() => worker as unknown as Worker);
    const progress: number[] = [];
    session.onProgress((event) => progress.push(event.progress));

    const result = session.reparse('balanced');
    const request = worker.requests[0]!;
    worker.respond({
      type: 'progress',
      requestId: request.requestId,
      progress: 0.5,
      stage: 'analyze',
      message: '分析中',
    });
    worker.respond({
      type: 'result',
      requestId: request.requestId,
      result: {
        fileName: 'book.txt',
        mode: 'balanced',
        encoding: 'utf-8',
        lineCount: 1,
        headings: [],
        summary: {
          encoding: 'utf-8',
          mode: 'balanced',
          lineCount: 1,
          candidateCount: 0,
          headingCount: 0,
          rejectedCount: 0,
          learnedFormatCount: 0,
          usedFallback: true,
          averageConfidence: 0,
        },
        decodeCandidates: [],
      },
    });

    await expect(result).resolves.toMatchObject({ fileName: 'book.txt' });
    expect(progress).toEqual([0.5]);
  });

  it('terminates the Worker and rejects every pending request on cancel', async () => {
    const worker = new FakeWorker();
    const session = createTxtCatalogSession(() => worker as unknown as Worker);
    const pendingLines = session.getLines(0, 20);
    const pendingSearch = session.search('chapter', 0);

    session.cancel('用户取消');

    await expect(pendingLines).rejects.toMatchObject({ name: 'AbortError' });
    await expect(pendingSearch).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminated).toBe(true);
  });

  it('makes a crashed Worker terminal instead of leaving later requests pending', async () => {
    const worker = new FakeWorker();
    const session = createTxtCatalogSession(() => worker as unknown as Worker);
    const pending = session.getLines(0, 20);

    worker.fail('worker crashed');

    await expect(pending).rejects.toThrow('worker crashed');
    await expect(session.reparse('balanced')).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(worker.terminated).toBe(true);
  });

  it('falls back to the direct service when Worker is unavailable', async () => {
    const session = createTxtCatalogSession();
    expect(session.kind).toBe('direct');
    const preview = await session.initializeBuffer(
      'book.txt',
      new TextEncoder().encode('第一章\n正文').buffer,
      'balanced',
    );
    expect(preview).toMatchObject({ fileName: 'book.txt', lineCount: 2 });
    session.dispose();
  });
});
