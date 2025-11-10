export const runWithConcurrency = async <T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
  signal?: AbortSignal,
) => {
  if (items.length === 0) return;

  const concurrency = Math.max(1, Math.min(limit, items.length));
  let nextIndex = 0;
  let stopped = false;

  const runner = async () => {
    while (true) {
      if (stopped) return;
      if (signal?.aborted) {
        stopped = true;
        throw new DOMException('Aborted', 'AbortError');
      }
      const currentIndex = nextIndex++;
      if (currentIndex >= items.length) {
        return;
      }
      try {
        await worker(items[currentIndex], currentIndex);
      } catch (error) {
        stopped = true;
        throw error;
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => runner()));
};
