import type {
  ReaderAutomaticTranslationCache,
  ReaderChapterContent,
} from '@/model/Reader';

export type ReaderAutomaticTranslationSource = 'gpt' | 'sakura';
export type ReaderAutomaticTranslationPurpose = 'automatic' | 'retranslate';

export interface ReaderAutomaticTranslationSelection {
  source: ReaderAutomaticTranslationSource;
  workerId: string;
  workerFingerprint: string;
  cacheFingerprint?: string;
  glossaryId: string;
  purpose?: ReaderAutomaticTranslationPurpose;
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

export const resolveReaderAutomaticTranslationWorker = <
  Worker extends { id: string },
>(
  workers: Worker[],
  preferredWorkerId?: string,
) => workers.find(({ id }) => id === preferredWorkerId) ?? workers[0];

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
  purpose = 'automatic',
}: ReaderAutomaticTranslationSelection) =>
  [purpose, source, workerId, workerFingerprint, glossaryId].join('\u0000');

const hashIdentity = (value: string) => {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return [first, second]
    .map((part) => (part >>> 0).toString(36).padStart(7, '0'))
    .join('');
};

/**
 * Returns a storage-safe selection identifier. The fingerprint may contain an
 * API key, so only its one-way digest is allowed to leave the reader session.
 */
export const getReaderAutomaticTranslationSelectionCacheKey = (
  selection: ReaderAutomaticTranslationSelection,
) =>
  hashIdentity(
    selectionKey({
      ...selection,
      workerFingerprint: selection.cacheFingerprint ?? selection.workerId,
    }),
  );

export const getReaderAutomaticTranslationContentRevision = ({
  segmentIds,
  paragraphs,
}: {
  segmentIds: string[];
  paragraphs: string[];
}) =>
  hashIdentity(
    segmentIds
      .map((segmentId, index) => `${segmentId}\u0001${paragraphs[index] ?? ''}`)
      .join('\u0002'),
  );

export const createReaderAutomaticTranslationCache = ({
  bookId,
  chapterId,
  selection,
  contentRevision,
  values,
  cachedAt = Date.now(),
}: {
  bookId: string;
  chapterId: string;
  selection: ReaderAutomaticTranslationSelection;
  contentRevision: string;
  values: ReaderAutomaticTranslationResult[];
  cachedAt?: number;
}): ReaderAutomaticTranslationCache => {
  const selectionCacheKey =
    getReaderAutomaticTranslationSelectionCacheKey(selection);
  const purpose = selection.purpose ?? 'automatic';
  return {
    kind: 'automatic-translation',
    key: [
      'reader-auto',
      bookId,
      chapterId,
      purpose,
      selection.source,
      selectionCacheKey,
      selection.glossaryId,
      contentRevision,
    ].join('\u0000'),
    bookId,
    chapterId,
    source: selection.source,
    purpose,
    selectionKey: selectionCacheKey,
    glossaryId: selection.glossaryId,
    contentRevision,
    entries: values.map(({ segmentId, translated }) => ({
      segmentId,
      translated,
    })),
    cachedAt,
  };
};

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

  hydrate(
    selection: ReaderAutomaticTranslationSelection,
    values: ReaderAutomaticTranslationResult[],
  ) {
    const draft = this.draft(selection);
    values.forEach((value) => draft.set(targetKey(value), value.translated));
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

  clearChapter(
    selection: ReaderAutomaticTranslationSelection,
    chapterId: string,
  ) {
    const draft = this.drafts.get(selectionKey(selection));
    if (draft === undefined) return;
    const prefix = `${chapterId}\u0000`;
    [...draft.keys()]
      .filter((key) => key.startsWith(prefix))
      .forEach((key) => draft.delete(key));
    [...this.pending]
      .filter((key) => key.startsWith(prefix))
      .forEach((key) => this.pending.delete(key));
    if (draft.size === 0) this.drafts.delete(selectionKey(selection));
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
