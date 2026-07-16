import type { ReaderReadingStats } from '@/model/Reader';

export const addReadingTime = (
  previous: ReaderReadingStats | undefined,
  bookId: string,
  elapsedMs: number,
  now = Date.now(),
): ReaderReadingStats => ({
  bookId,
  totalReadingMs: (previous?.totalReadingMs ?? 0) + Math.max(0, elapsedMs),
  lastReadAt: now,
});

export const formatReadingDuration = (totalReadingMs: number) => {
  const minutes = Math.floor(Math.max(0, totalReadingMs) / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours > 0
    ? String(hours) + ' 小时 ' + String(minutes % 60) + ' 分钟'
    : String(minutes) + ' 分钟';
};
