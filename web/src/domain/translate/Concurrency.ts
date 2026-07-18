export const runWithConcurrency = async <T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number, signal: AbortSignal) => Promise<void>,
  signal?: AbortSignal,
) => {
  if (items.length === 0) return;

  const concurrency = Math.max(1, Math.min(limit, items.length));
  const controller = new AbortController();
  const workerSignal = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;
  let nextIndex = 0;
  let stopped = false;

  const runner = async () => {
    while (true) {
      if (stopped) return;
      if (workerSignal.aborted) {
        stopped = true;
        throw workerSignal.reason;
      }
      const currentIndex = nextIndex++;
      if (currentIndex >= items.length) {
        return;
      }
      try {
        await worker(items[currentIndex], currentIndex, workerSignal);
      } catch (error) {
        stopped = true;
        controller.abort(error);
        throw error;
      }
    }
  };

  const results = await Promise.allSettled(
    Array.from({ length: concurrency }, () => runner()),
  );
  const rejected = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (rejected) throw rejected.reason;
};

type QueuedWork<T> = {
  cancelled: boolean;
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

export const createConcurrencyLimiter = (limit: number) => {
  const maximum = Math.max(1, limit);
  const queue: QueuedWork<unknown>[] = [];
  let active = 0;

  const drain = () => {
    while (active < maximum && queue.length > 0) {
      const work = queue.shift()!;
      if (work.onAbort) {
        work.signal?.removeEventListener('abort', work.onAbort);
      }
      if (work.cancelled || work.signal?.aborted) {
        work.reject(
          work.signal?.reason ?? new DOMException('Aborted', 'AbortError'),
        );
        continue;
      }

      active += 1;
      void work
        .run()
        .then(work.resolve, work.reject)
        .finally(() => {
          active -= 1;
          drain();
        });
    }
  };

  const run = <T>(work: () => Promise<T>, signal?: AbortSignal) =>
    new Promise<T>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const queuedWork: QueuedWork<T> = {
        cancelled: false,
        run: work,
        resolve,
        reject,
        signal,
      };
      queuedWork.onAbort = () => {
        queuedWork.cancelled = true;
        reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
        drain();
      };
      signal?.addEventListener('abort', queuedWork.onAbort, { once: true });
      queue.push(queuedWork as QueuedWork<unknown>);
      drain();
    });

  return { run };
};

export type ConcurrencyLimiter = ReturnType<typeof createConcurrencyLimiter>;
