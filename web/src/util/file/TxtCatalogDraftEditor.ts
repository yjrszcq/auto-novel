import type { TxtHeadingDraft } from '../../model/TxtCatalog';

const normalizeLevel = (level: number) =>
  Math.min(Math.max(Math.round(level), 1), 6);

const copyDraft = (draft: TxtHeadingDraft): TxtHeadingDraft => ({
  ...draft,
  reasons: draft.reasons === undefined ? undefined : [...draft.reasons],
});

export interface TxtCatalogDraftValidation {
  valid: boolean;
  errors: string[];
}

type TxtCatalogDraftHistoryEntry =
  | { type: 'add'; lineIndex: number }
  | { type: 'remove'; draft: TxtHeadingDraft }
  | { type: 'update'; draft: TxtHeadingDraft; key: string }
  | { type: 'restore'; drafts: TxtHeadingDraft[] };

const sameDraft = (left: TxtHeadingDraft, right: TxtHeadingDraft) =>
  left.lineIndex === right.lineIndex &&
  left.title === right.title &&
  left.level === right.level &&
  left.rule === right.rule &&
  left.confidence === right.confidence &&
  left.isManual === right.isManual &&
  JSON.stringify(left.reasons) === JSON.stringify(right.reasons);

const sameDrafts = (
  left: readonly TxtHeadingDraft[],
  right: readonly TxtHeadingDraft[],
) =>
  left.length === right.length &&
  left.every((draft, index) => {
    const other = right[index];
    return other !== undefined && sameDraft(draft, other);
  });

export class TxtCatalogDraftEditor {
  private drafts: TxtHeadingDraft[] = [];
  private automaticDrafts: TxtHeadingDraft[] = [];
  private history: TxtCatalogDraftHistoryEntry[] = [];

  constructor(drafts: readonly TxtHeadingDraft[] = []) {
    this.reset(drafts);
  }

  get snapshot() {
    return this.drafts.map(copyDraft);
  }

  get canUndo() {
    return this.history.length > 0;
  }

  get hasManualChanges() {
    return !sameDrafts(this.drafts, this.automaticDrafts);
  }

  snapshotWithMinimumConfidence(minimumConfidence: number) {
    const threshold = Math.min(Math.max(minimumConfidence, 0), 1);
    return this.drafts
      .filter((draft) => draft.isManual || draft.confidence >= threshold)
      .map(copyDraft);
  }

  reset(drafts: readonly TxtHeadingDraft[]) {
    const byLine = new Map<number, TxtHeadingDraft>();
    for (const draft of drafts) byLine.set(draft.lineIndex, copyDraft(draft));
    this.drafts = [...byLine.values()].sort(
      (left, right) => left.lineIndex - right.lineIndex,
    );
    this.automaticDrafts = this.drafts.map(copyDraft);
    this.history = [];
  }

  has(lineIndex: number) {
    return this.drafts.some((draft) => draft.lineIndex === lineIndex);
  }

  add(lineIndex: number, title: string, level = 1) {
    const existing = this.drafts.find((draft) => draft.lineIndex === lineIndex);
    if (existing !== undefined) return copyDraft(existing);
    const draft: TxtHeadingDraft = {
      lineIndex,
      title: title.trim() || `第 ${lineIndex + 1} 行`,
      level: normalizeLevel(level),
      rule: 'manual',
      confidence: 1,
      isManual: true,
      reasons: ['人工添加'],
    };
    this.drafts.push(draft);
    this.drafts.sort((left, right) => left.lineIndex - right.lineIndex);
    this.history.push({ type: 'add', lineIndex });
    return copyDraft(draft);
  }

  remove(lineIndex: number) {
    const removed = this.drafts.find((draft) => draft.lineIndex === lineIndex);
    if (removed === undefined) return false;
    this.drafts = this.drafts.filter((draft) => draft.lineIndex !== lineIndex);
    this.history.push({ type: 'remove', draft: copyDraft(removed) });
    return true;
  }

  include(lineIndex: number) {
    const draft = this.drafts.find((item) => item.lineIndex === lineIndex);
    if (draft === undefined || draft.isManual) return undefined;
    this.history.push({
      type: 'update',
      draft: copyDraft(draft),
      key: `include:${lineIndex}`,
    });
    draft.isManual = true;
    draft.reasons = ['人工保留'];
    return copyDraft(draft);
  }

  update(
    lineIndex: number,
    patch: Partial<Pick<TxtHeadingDraft, 'title' | 'level'>>,
  ) {
    const draft = this.drafts.find((item) => item.lineIndex === lineIndex);
    if (draft === undefined) return undefined;
    const fields = [
      patch.title !== undefined ? 'title' : undefined,
      patch.level !== undefined ? 'level' : undefined,
    ].filter((field): field is string => field !== undefined);
    const key = `update:${lineIndex}:${fields.join(',')}`;
    const lastHistory = this.history.at(-1);
    if (lastHistory?.type !== 'update' || lastHistory.key !== key) {
      this.history.push({ type: 'update', draft: copyDraft(draft), key });
    }
    if (patch.title !== undefined) draft.title = patch.title;
    if (patch.level !== undefined) draft.level = normalizeLevel(patch.level);
    draft.isManual = true;
    draft.reasons = ['人工修改'];
    return copyDraft(draft);
  }

  undo() {
    const entry = this.history.pop();
    if (entry === undefined) return false;
    if (entry.type === 'add') {
      this.drafts = this.drafts.filter(
        (draft) => draft.lineIndex !== entry.lineIndex,
      );
    } else if (entry.type === 'remove') {
      this.drafts.push(copyDraft(entry.draft));
      this.drafts.sort((left, right) => left.lineIndex - right.lineIndex);
    } else if (entry.type === 'update') {
      const index = this.drafts.findIndex(
        (draft) => draft.lineIndex === entry.draft.lineIndex,
      );
      if (index >= 0) this.drafts[index] = copyDraft(entry.draft);
    } else {
      this.drafts = entry.drafts.map(copyDraft);
    }
    return true;
  }

  restoreAutomatic() {
    if (!this.hasManualChanges) return false;
    this.history.push({
      type: 'restore',
      drafts: this.drafts.map(copyDraft),
    });
    this.drafts = this.automaticDrafts.map(copyDraft);
    return true;
  }

  validate(lineCount: number): TxtCatalogDraftValidation {
    const errors: string[] = [];
    const seenLines = new Set<number>();
    for (const draft of this.drafts) {
      if (
        !Number.isInteger(draft.lineIndex) ||
        draft.lineIndex < 0 ||
        draft.lineIndex >= lineCount
      ) {
        errors.push(`第 ${draft.lineIndex + 1} 行超出正文范围`);
      }
      if (seenLines.has(draft.lineIndex))
        errors.push(`第 ${draft.lineIndex + 1} 行存在重复目录`);
      seenLines.add(draft.lineIndex);
      if (draft.title.trim().length === 0)
        errors.push(`第 ${draft.lineIndex + 1} 行的目录标题不能为空`);
      if (!Number.isInteger(draft.level) || draft.level < 1 || draft.level > 6)
        errors.push(`第 ${draft.lineIndex + 1} 行的目录层级必须为 1 至 6`);
    }
    return { valid: errors.length === 0, errors };
  }
}
