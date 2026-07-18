export const normalizeConcurrencyLimit = (
  value: number | undefined,
  fallback = 1,
) => (Number.isFinite(value) ? Math.max(1, Math.floor(value!)) : fallback);

export const runWithConcurrency = async <T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number, signal: AbortSignal) => Promise<void>,
  signal?: AbortSignal,
) => {
  if (items.length === 0) return;

  const requestedConcurrency = normalizeConcurrencyLimit(limit);
  const concurrency = Math.min(requestedConcurrency, items.length);
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
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

export const createConcurrencyLimiter = (limit: number) => {
  const maximum = normalizeConcurrencyLimit(limit);
  const queue = new Set<QueuedWork<unknown>>();
  let active = 0;

  const drain = () => {
    while (active < maximum && queue.size > 0) {
      const work = queue.values().next().value!;
      queue.delete(work);
      if (work.onAbort) {
        work.signal?.removeEventListener('abort', work.onAbort);
      }
      if (work.signal?.aborted) {
        work.reject(
          work.signal?.reason ?? new DOMException('Aborted', 'AbortError'),
        );
        continue;
      }

      active += 1;
      void Promise.resolve()
        .then(work.run)
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
        run: work,
        resolve,
        reject,
        signal,
      };
      queuedWork.onAbort = () => {
        if (!queue.delete(queuedWork as QueuedWork<unknown>)) return;
        reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
        drain();
      };
      signal?.addEventListener('abort', queuedWork.onAbort, { once: true });
      queue.add(queuedWork as QueuedWork<unknown>);
      drain();
    });

  return {
    run,
    get activeCount() {
      return active;
    },
    get queuedCount() {
      return queue.size;
    },
  };
};

export type ConcurrencyLimiter = ReturnType<typeof createConcurrencyLimiter>;
