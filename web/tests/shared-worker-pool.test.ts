import { describe, expect, it } from 'vitest';

import { SharedWorkerPool } from '../src/domain/translate/SharedWorkerPool';

const deferred = <T = void>() => {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
};

const flushMicrotasks = () =>
  new Promise<void>((resolve) => queueMicrotask(resolve));

describe('shared translation worker pool', () => {
  it('strictly bounds queued work and backpressures producers', async () => {
    const pool = new SharedWorkerPool<string, number>({ highWaterMark: 2 });
    const firstStarted = deferred();
    const releaseFirst = deferred();
    pool.register({ id: 'worker', worker: 'worker', concurrency: 1 });
    const first = await pool.enqueue(0, async () => {
      firstStarted.resolve();
      await releaseFirst.promise;
      return 'zero';
    });
    await firstStarted.promise;
    const second = await pool.enqueue(1, async () => 'one');
    let thirdAdmitted = false;
    const thirdAdmission = pool
      .enqueue(2, async () => 'two')
      .then((handle) => {
        thirdAdmitted = true;
        return handle;
      });

    await flushMicrotasks();
    expect(pool.snapshot()).toMatchObject({
      outstanding: 2,
      queued: 1,
      waitingProducers: 1,
      aggregateActive: 1,
    });
    expect(thirdAdmitted).toBe(false);

    releaseFirst.resolve();
    const third = await thirdAdmission;
    await expect(
      Promise.all([first.result, second.result, third.result]),
    ).resolves.toEqual(['zero', 'one', 'two']);
    expect(pool.snapshot()).toMatchObject({
      outstanding: 0,
      queued: 0,
      waitingProducers: 0,
    });
  });

  it('uses multiple workers without exceeding individual or aggregate ceilings', async () => {
    const pool = new SharedWorkerPool<string, number>({ highWaterMark: 6 });
    pool.register({ id: 'single', worker: 'single', concurrency: 1 });
    pool.register({ id: 'double', worker: 'double', concurrency: 2 });
    const release = deferred();
    const allStarted = deferred();
    const activeByWorker = new Map<string, number>();
    const maximumByWorker = new Map<string, number>();
    const assignments: Array<[number, string]> = [];

    const handles = [];
    for (let assignment = 0; assignment < 6; assignment += 1) {
      handles.push(
        await pool.enqueue(assignment, async (worker) => {
          assignments.push([assignment, worker]);
          const active = (activeByWorker.get(worker) ?? 0) + 1;
          activeByWorker.set(worker, active);
          maximumByWorker.set(
            worker,
            Math.max(maximumByWorker.get(worker) ?? 0, active),
          );
          if (assignments.length === 3) allStarted.resolve();
          await release.promise;
          activeByWorker.set(worker, active - 1);
          return assignment;
        }),
      );
    }

    await allStarted.promise;
    expect(pool.snapshot()).toMatchObject({
      queued: 3,
      aggregateActive: 3,
      aggregateMaximum: 3,
    });
    expect(maximumByWorker).toEqual(
      new Map([
        ['single', 1],
        ['double', 2],
      ]),
    );
    release.resolve();

    await expect(
      Promise.all(handles.map(({ result }) => result)),
    ).resolves.toEqual([0, 1, 2, 3, 4, 5]);
    expect(new Set(assignments.map(([, worker]) => worker)).size).toBe(2);
  });

  it('requeues an interrupted assignment when a worker is removed', async () => {
    const pool = new SharedWorkerPool<string, string>();
    const firstStarted = deferred();
    const attempts: string[] = [];
    pool.register({ id: 'first', worker: 'first', concurrency: 1 });
    const handle = await pool.enqueue('segment-1', async (worker, signal) => {
      attempts.push(worker);
      if (worker === 'first') {
        firstStarted.resolve();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        });
      }
      return `${worker}-result`;
    });

    await firstStarted.promise;
    pool.unregister('first');
    expect(pool.snapshot()).toMatchObject({ queued: 1, aggregateActive: 0 });
    pool.register({ id: 'second', worker: 'second', concurrency: 1 });

    await expect(handle.result).resolves.toBe('second-result');
    expect(attempts).toEqual(['first', 'second']);
  });

  it('removes cancelled queued work and ignores late active completion', async () => {
    const pool = new SharedWorkerPool<string, string>({ highWaterMark: 2 });
    const activeStarted = deferred();
    const releaseActive = deferred();
    pool.register({ id: 'worker', worker: 'worker', concurrency: 1 });

    const activeController = new AbortController();
    const active = await pool.enqueue(
      'active',
      async () => {
        activeStarted.resolve();
        await releaseActive.promise;
        return 'late-result';
      },
      activeController.signal,
    );
    await activeStarted.promise;
    const queuedController = new AbortController();
    const queued = await pool.enqueue(
      'queued',
      async () => 'must-not-run',
      queuedController.signal,
    );
    const activeResult = active.result.catch((error: unknown) => error);
    const queuedResult = queued.result.catch((error: unknown) => error);

    queuedController.abort();
    activeController.abort();
    expect(pool.snapshot()).toMatchObject({ queued: 0, aggregateActive: 0 });
    expect(await queuedResult).toMatchObject({ name: 'AbortError' });
    expect(await activeResult).toMatchObject({ name: 'AbortError' });

    releaseActive.resolve();
    await flushMicrotasks();
    expect(pool.snapshot()).toMatchObject({ queued: 0, aggregateActive: 0 });
  });

  it('isolates worker errors and reports active assignment telemetry', async () => {
    const snapshots: Array<
      ReturnType<SharedWorkerPool<string, string>['snapshot']>
    > = [];
    const pool = new SharedWorkerPool<string, string>({
      onSnapshot: (snapshot) => snapshots.push(snapshot),
    });
    const release = deferred();
    const started = deferred();
    pool.register({ id: 'worker', worker: 'worker', concurrency: 1 });
    const failed = await pool.enqueue('failed', async () => {
      throw new Error('provider failed');
    });
    await expect(failed.result).rejects.toThrow('provider failed');

    const healthy = await pool.enqueue('healthy', async () => {
      started.resolve();
      await release.promise;
      return 'ok';
    });
    await started.promise;
    expect(pool.snapshot().workers[0]).toMatchObject({
      active: 1,
      maximum: 1,
      errors: 1,
      assignments: ['healthy'],
    });
    release.resolve();
    await expect(healthy.result).resolves.toBe('ok');
    expect(snapshots.some((snapshot) => snapshot.aggregateActive === 1)).toBe(
      true,
    );
  });
});
