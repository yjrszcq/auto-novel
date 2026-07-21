import { describe, expect, it } from 'vitest';

import type {
  ReaderChapterSummary,
  ReaderNavigationEntry,
} from '../src/model/Reader';
import { planReaderChapterTransition } from '../src/pages/reader/core/ReaderChapterTransition';

const chapters = ['before', 'volume', 'part', 'chapter', 'after'].map(
  (id, index) => ({ id, index }) as ReaderChapterSummary,
);
const navigation: ReaderNavigationEntry[] = [
  { id: 'before-nav', title: 'Before', level: 0, chapterId: 'before' },
  { id: 'volume-nav', title: 'Volume', level: 0, chapterId: 'volume' },
  {
    id: 'part-nav',
    title: 'Part',
    level: 1,
    chapterId: 'part',
    parentId: 'volume-nav',
  },
  {
    id: 'chapter-nav',
    title: 'Chapter',
    level: 2,
    chapterId: 'chapter',
    parentId: 'part-nav',
  },
  {
    id: 'after-nav',
    title: 'After',
    level: 0,
    chapterId: 'after',
  },
];

describe('reader hierarchical chapter transitions', () => {
  it('uses the highest parent as the checkpoint and deepest child as target', () => {
    expect(
      planReaderChapterTransition({
        chapters,
        navigation,
        currentIndex: 0,
        direction: 'next',
      }),
    ).toEqual({ checkpointIndex: 1, targetIndex: 3 });
  });

  it('returns from a child through the same highest-parent checkpoint', () => {
    expect(
      planReaderChapterTransition({
        chapters,
        navigation,
        currentIndex: 3,
        direction: 'previous',
      }),
    ).toEqual({ checkpointIndex: 1, targetIndex: 0 });
  });

  it('moves past the whole current title group', () => {
    expect(
      planReaderChapterTransition({
        chapters,
        navigation,
        currentIndex: 1,
        direction: 'next',
      }),
    ).toEqual({ checkpointIndex: 4, targetIndex: 4 });
  });

  it('keeps ordinary adjacent chapters independent', () => {
    expect(
      planReaderChapterTransition({
        chapters,
        navigation: navigation.filter(({ id }) => id !== 'part-nav'),
        currentIndex: 0,
        direction: 'next',
      }),
    ).toEqual({ checkpointIndex: 1, targetIndex: 1 });
  });

  it('does not group a parent and child separated by another chapter', () => {
    const separated = [chapters[1]!, chapters[0]!, chapters[2]!];
    expect(
      planReaderChapterTransition({
        chapters: separated,
        navigation,
        currentIndex: 0,
        direction: 'next',
      }),
    ).toEqual({ checkpointIndex: 1, targetIndex: 1 });
  });

  it('ignores navigation parentage within the same content chapter', () => {
    expect(
      planReaderChapterTransition({
        chapters: chapters.slice(0, 2),
        navigation: [
          { id: 'anchor-a', title: 'A', level: 0, chapterId: 'volume' },
          {
            id: 'anchor-b',
            title: 'B',
            level: 1,
            chapterId: 'volume',
            parentId: 'anchor-a',
          },
        ],
        currentIndex: 0,
        direction: 'next',
      }),
    ).toEqual({ checkpointIndex: 1, targetIndex: 1 });
  });

  it('stops at the real book boundaries', () => {
    expect(
      planReaderChapterTransition({
        chapters,
        navigation,
        currentIndex: 0,
        direction: 'previous',
      }),
    ).toBeUndefined();
    expect(
      planReaderChapterTransition({
        chapters,
        navigation,
        currentIndex: chapters.length - 1,
        direction: 'next',
      }),
    ).toBeUndefined();
  });
});
