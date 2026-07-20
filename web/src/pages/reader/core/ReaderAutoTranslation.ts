import type { ReaderChapterContent } from '@/model/Reader';

export type ReaderAutomaticTranslationSource = 'gpt' | 'sakura';

export interface ReaderAutomaticTranslationSelection {
  source: ReaderAutomaticTranslationSource;
  workerId: string;
  workerFingerprint: string;
  glossaryId: string;
}
export interface ReaderAutomaticTranslationTarget {
  chapterId: string;
  segmentId: string;
  segmentIndex: number;
  original: string;
}

export interface ReaderAutomaticTranslationWindow {
  current: ReaderAutomaticTranslationTarget[];
  prefetch: ReaderAutomaticTranslationTarget[];
  all: ReaderAutomaticTranslationTarget[];
  visibleCharacterCount: number;
  prefetchCharacterBudget: number;
}

const targetKey = ({
  chapterId,
  segmentId,
}: Pick<ReaderAutomaticTranslationTarget, 'chapterId' | 'segmentId'>) =>
  `${chapterId}\u0000${segmentId}`;

const selectionKey = ({
  source,
  workerId,
  workerFingerprint,
  glossaryId,
}: ReaderAutomaticTranslationSelection) =>
  [source, workerId, workerFingerprint, glossaryId].join('\u0000');

const sameSelection = (
  left: ReaderAutomaticTranslationSelection | undefined,
  right: ReaderAutomaticTranslationSelection,
) => left !== undefined && selectionKey(left) === selectionKey(right);

const sourceLength = (text: string) => text.trim().length;

/**
 * Plans visible work first, then enough following source text to approximate
 * the configured number of viewport-sized pages. The caller controls which
 * chapters are available, so the same planner works for paginated and
 * continuously-scrolled chapter windows.
 */
export const planReaderAutomaticTranslationWindow = ({
  chapters,
  visible,
  preloadPages,
}: {
  chapters: ReaderChapterContent[];
  visible: Array<{ chapterId: string; segmentId: string }>;
  preloadPages: number;
}): ReaderAutomaticTranslationWindow => {
  const ordered = chapters.flatMap((chapter) =>
    chapter.segments.flatMap((segment) =>
      sourceLength(segment.original) === 0
        ? []
        : [
            {
              chapterId: chapter.chapterId,
              segmentId: segment.id,
              segmentIndex: segment.index,
              original: segment.original,
            } satisfies ReaderAutomaticTranslationTarget,
          ],
    ),
  );
  const visibleKeys = new Set(visible.map(targetKey));
  const visibleIndexes = ordered.flatMap((target, index) =>
    visibleKeys.has(targetKey(target)) ? [index] : [],
  );
  const current = visibleIndexes.map((index) => ordered[index]!);
  const visibleCharacterCount = Math.max(
    1,
    current.reduce((total, target) => total + sourceLength(target.original), 0),
  );
  const normalizedPreloadPages = Math.max(
    0,
    Math.min(Number.isFinite(preloadPages) ? Math.floor(preloadPages) : 0, 20),
  );
  const prefetchCharacterBudget =
    visibleCharacterCount * normalizedPreloadPages;
  const prefetch: ReaderAutomaticTranslationTarget[] = [];
  let prefetchedCharacters = 0;
  const firstPrefetchIndex =
    visibleIndexes.length === 0
      ? ordered.length
      : Math.max(...visibleIndexes) + 1;
  for (
    let index = firstPrefetchIndex;
    index < ordered.length && prefetchedCharacters < prefetchCharacterBudget;
    index += 1
  ) {
    const target = ordered[index]!;
    prefetch.push(target);
    prefetchedCharacters += sourceLength(target.original);
  }
  return {
    current,
    prefetch,
    all: [...current, ...prefetch],
    visibleCharacterCount,
    prefetchCharacterBudget,
  };
};

export interface ReaderAutomaticTranslationResult {
  chapterId: string;
  segmentId: string;
  translated: string;
}

/**
 * Keeps partial translations inside one reader session. Every start gets a
 * generation token, so late results from stopped or switched workers cannot
 * enter the active draft.
 */
export class ReaderAutomaticTranslationSession {
  private generation = 0;
  private activeSelection?: ReaderAutomaticTranslationSelection;
  private readonly drafts = new Map<string, Map<string, string>>();
  private readonly pending = new Set<string>();

  get active() {
    return this.activeSelection;
  }

  isActive(selection: ReaderAutomaticTranslationSelection) {
    return sameSelection(this.activeSelection, selection);
  }

  start(selection: ReaderAutomaticTranslationSelection) {
    this.generation += 1;
    this.activeSelection = { ...selection };
    this.pending.clear();
    return this.generation;
  }

  stop() {
    this.generation += 1;
    this.activeSelection = undefined;
    this.pending.clear();
  }

  currentGeneration() {
    return this.generation;
  }

  accepts(generation: number) {
    return generation === this.generation && this.activeSelection !== undefined;
  }

  claim(
    generation: number,
    targets: ReaderAutomaticTranslationTarget[],
  ): ReaderAutomaticTranslationTarget[] {
    if (!this.accepts(generation) || this.activeSelection === undefined) {
      return [];
    }
    const draft = this.draft(this.activeSelection);
    return targets.filter((target) => {
      const key = targetKey(target);
      if (this.pending.has(key) || draft.has(key)) return false;
      this.pending.add(key);
      return true;
    });
  }

  release(
    generation: number,
    targets: Array<
      Pick<ReaderAutomaticTranslationTarget, 'chapterId' | 'segmentId'>
    >,
  ) {
    if (generation !== this.generation) return;
    targets.forEach((target) => this.pending.delete(targetKey(target)));
  }

  store(generation: number, values: ReaderAutomaticTranslationResult[]) {
    if (!this.accepts(generation) || this.activeSelection === undefined) {
      return false;
    }
    const draft = this.draft(this.activeSelection);
    values.forEach((value) => {
      const key = targetKey(value);
      draft.set(key, value.translated);
      this.pending.delete(key);
    });
    return true;
  }

  get(
    selection: ReaderAutomaticTranslationSelection,
    chapterId: string,
    segmentId: string,
  ) {
    return this.drafts
      .get(selectionKey(selection))
      ?.get(targetKey({ chapterId, segmentId }));
  }

  entries(selection: ReaderAutomaticTranslationSelection, chapterId: string) {
    const prefix = `${chapterId}\u0000`;
    return [...(this.drafts.get(selectionKey(selection))?.entries() ?? [])]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, translated]) => ({
        segmentId: key.slice(prefix.length),
        translated,
      }));
  }

  clearDrafts() {
    this.generation += 1;
    this.activeSelection = undefined;
    this.pending.clear();
    this.drafts.clear();
  }

  private draft(selection: ReaderAutomaticTranslationSelection) {
    const key = selectionKey(selection);
    let draft = this.drafts.get(key);
    if (draft === undefined) {
      draft = new Map();
      this.drafts.set(key, draft);
    }
    return draft;
  }
}
