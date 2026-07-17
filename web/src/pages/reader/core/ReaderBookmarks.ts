import type { ReaderBookmark } from '@/model/Reader';
import { createId } from '@/util/id';

export interface CreateReaderBookmarkInput {
  bookId: string;
  chapterId: string;
  segmentId?: string;
  label?: string;
  id?: string;
  now?: number;
}

export const createReaderBookmark = ({
  bookId,
  chapterId,
  segmentId,
  label,
  id = createId(),
  now = Date.now(),
}: CreateReaderBookmarkInput): ReaderBookmark => ({
  id,
  bookId,
  chapterId,
  segmentId,
  label,
  createdAt: now,
});

export const sortReaderBookmarks = (bookmarks: ReaderBookmark[]) =>
  [...bookmarks].sort((left, right) => right.createdAt - left.createdAt);

export const findBookmarkAtSegment = (
  bookmarks: ReaderBookmark[],
  chapterId: string,
  segmentId: string | undefined,
) =>
  bookmarks.find(
    (bookmark) =>
      bookmark.chapterId === chapterId && bookmark.segmentId === segmentId,
  );

export const getBookmarkTarget = (bookmark: ReaderBookmark) => ({
  chapterId: bookmark.chapterId,
  segmentId: bookmark.segmentId,
});
