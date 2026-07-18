import { describe, expect, it } from 'vitest';

import { runWithConcurrency } from '../src/domain/translate/Concurrency';

const deferred = () => {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
};

describe('translation concurrency scheduler', () => {
  it('aborts siblings and waits for active work before rejecting', async () => {
    const bothStarted = deferred();
    const failFirst = deferred();
    let started = 0;
    let siblingAborted = false;
    let settled = false;

    const execution = runWithConcurrency(
      [0, 1, 2],
      2,
      async (item, _index, signal) => {
        started += 1;
        if (started === 2) bothStarted.resolve();
        if (item === 0) {
          await failFirst.promise;
          throw new Error('primary failure');
        }
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              siblingAborted = true;
              reject(signal.reason);
            },
            { once: true },
          );
        });
      },
    );
    void execution.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await bothStarted.promise;
    failFirst.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(siblingAborted).toBe(true);
    await expect(execution).rejects.toThrow('primary failure');
    expect(settled).toBe(true);
    expect(started).toBe(2);
  });

  it('does not start queued work after external cancellation', async () => {
    const firstStarted = deferred();
    const controller = new AbortController();
    const started: number[] = [];

    const execution = runWithConcurrency(
      [0, 1, 2],
      1,
      async (item, _index, signal) => {
        started.push(item);
        firstStarted.resolve();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        });
      },
      controller.signal,
    );

    await firstStarted.promise;
    controller.abort();

    await expect(execution).rejects.toMatchObject({ name: 'AbortError' });
    expect(started).toEqual([0]);
  });
});
