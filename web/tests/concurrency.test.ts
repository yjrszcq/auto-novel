import { describe, expect, it } from 'vitest';

import {
  createConcurrencyLimiter,
  runWithConcurrency,
} from '../src/domain/translate/Concurrency';
import { ProviderBackoff } from '../src/domain/translate/ProviderBackoff';

const deferred = () => {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
};

describe('translation concurrency scheduler', () => {
  it('falls back to one worker for invalid concurrency without dropping work', async () => {
    const visited: number[] = [];
    await runWithConcurrency([0, 1, 2], Number.NaN, async (item) => {
      visited.push(item);
    });
    expect(visited).toEqual([0, 1, 2]);
  });

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

  it('removes cancelled queued work immediately and preserves capacity', async () => {
    const limiter = createConcurrencyLimiter(1);
    const active = deferred();
    const release = deferred();
    const first = limiter.run(async () => {
      active.resolve();
      await release.promise;
    });
    await active.promise;

    const controllers = Array.from(
      { length: 100 },
      () => new AbortController(),
    );
    const queued = controllers.map((controller) =>
      limiter.run(async () => {}, controller.signal),
    );
    expect(limiter.queuedCount).toBe(100);
    controllers.forEach((controller) => controller.abort());
    expect(limiter.queuedCount).toBe(0);

    release.resolve();
    await first;
    expect(
      (await Promise.allSettled(queued)).every(
        (it) => it.status === 'rejected',
      ),
    ).toBe(true);
    await expect(limiter.run(async () => 'available')).resolves.toBe(
      'available',
    );
    expect(limiter.activeCount).toBe(0);
  });

  it('releases limiter capacity after a synchronous worker failure', async () => {
    const limiter = createConcurrencyLimiter(1);
    await expect(
      limiter.run(() => {
        throw new Error('synchronous failure');
      }),
    ).rejects.toThrow('synchronous failure');
    await expect(limiter.run(async () => 'next')).resolves.toBe('next');
  });

  it('reserves deterministic staggered retry slots under shared cooldown', () => {
    let now = 1_000;
    const backoff = new ProviderBackoff({
      now: () => now,
      random: () => 0,
      baseDelayMs: 100,
      maximumDelayMs: 1_000,
      retrySpacingMs: 25,
    });

    expect(backoff.reserveRetry(0)).toBe(100);
    expect(backoff.reserveRetry(0)).toBe(125);
    expect(backoff.reserveRetry(1)).toBe(200);
    expect(backoff.remainingCooldown()).toBe(200);
    now += 200;
    expect(backoff.remainingCooldown()).toBe(0);
    expect(backoff.reserveRetry(0, 500)).toBe(500);
  });
});
