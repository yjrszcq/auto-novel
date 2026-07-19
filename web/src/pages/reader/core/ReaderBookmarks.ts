import type { ReaderBookmark } from '@/model/Reader';
import { createUuid } from '@/util/uuid';

export interface CreateReaderBookmarkInput {
  bookId: string;
  chapterId: string;
  segmentId?: string;
  languageSide?: ReaderBookmark['languageSide'];
  offsetRatio?: number;
  viewportTopOffset?: number;
  label?: string;
  id?: string;
  now?: number;
}

export const createReaderBookmark = ({
  bookId,
  chapterId,
  segmentId,
  languageSide,
  offsetRatio,
  viewportTopOffset,
  label,
  id = createUuid(),
  now = Date.now(),
}: CreateReaderBookmarkInput): ReaderBookmark => ({
  id,
  bookId,
  chapterId,
  segmentId,
  languageSide,
  offsetRatio,
  viewportTopOffset,
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
  languageSide: bookmark.languageSide,
  offsetRatio: bookmark.offsetRatio,
  viewportTopOffset: bookmark.viewportTopOffset,
});
