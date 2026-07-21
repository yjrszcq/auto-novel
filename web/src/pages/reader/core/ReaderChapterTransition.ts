import type {
  ReaderChapterSummary,
  ReaderNavigationEntry,
} from '@/model/Reader';

export interface ReaderChapterTransition {
  checkpointIndex: number;
  targetIndex: number;
}

const getDirectParentChapterPairs = (navigation: ReaderNavigationEntry[]) => {
  const entriesById = new Map(navigation.map((entry) => [entry.id, entry]));
  const pairs = new Set<string>();
  navigation.forEach((entry) => {
    if (entry.chapterId === undefined || entry.parentId === undefined) return;
    const parentChapterId = entriesById.get(entry.parentId)?.chapterId;
    if (parentChapterId !== undefined && parentChapterId !== entry.chapterId) {
      pairs.add(`${parentChapterId}\u0000${entry.chapterId}`);
    }
  });
  return pairs;
};

export const planReaderChapterTransition = ({
  chapters,
  navigation,
  currentIndex,
  direction,
}: {
  chapters: ReaderChapterSummary[];
  navigation: ReaderNavigationEntry[];
  currentIndex: number;
  direction: 'previous' | 'next';
}): ReaderChapterTransition | undefined => {
  if (currentIndex < 0 || currentIndex >= chapters.length) return;
  const parentPairs = getDirectParentChapterPairs(navigation);
  const joinsParent = (childIndex: number) => {
    const parent = chapters[childIndex - 1];
    const child = chapters[childIndex];
    return (
      parent !== undefined &&
      child !== undefined &&
      parentPairs.has(`${parent.id}\u0000${child.id}`)
    );
  };

  let groupStart = currentIndex;
  while (groupStart > 0 && joinsParent(groupStart)) groupStart -= 1;
  let groupEnd = currentIndex;
  while (groupEnd + 1 < chapters.length && joinsParent(groupEnd + 1)) {
    groupEnd += 1;
  }

  if (direction === 'previous') {
    if (groupStart === 0) return;
    return { checkpointIndex: groupStart, targetIndex: groupStart - 1 };
  }

  const checkpointIndex = groupEnd + 1;
  if (checkpointIndex >= chapters.length) return;
  let targetIndex = checkpointIndex;
  while (targetIndex + 1 < chapters.length && joinsParent(targetIndex + 1)) {
    targetIndex += 1;
  }
  return { checkpointIndex, targetIndex };
};
