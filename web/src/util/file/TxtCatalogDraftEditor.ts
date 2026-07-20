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

export class TxtCatalogDraftEditor {
  private drafts: TxtHeadingDraft[] = [];

  constructor(drafts: readonly TxtHeadingDraft[] = []) {
    this.reset(drafts);
  }

  get snapshot() {
    return this.drafts.map(copyDraft);
  }

  reset(drafts: readonly TxtHeadingDraft[]) {
    const byLine = new Map<number, TxtHeadingDraft>();
    for (const draft of drafts) byLine.set(draft.lineIndex, copyDraft(draft));
    this.drafts = [...byLine.values()].sort(
      (left, right) => left.lineIndex - right.lineIndex,
    );
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
    return copyDraft(draft);
  }

  remove(lineIndex: number) {
    const previousLength = this.drafts.length;
    this.drafts = this.drafts.filter((draft) => draft.lineIndex !== lineIndex);
    return this.drafts.length !== previousLength;
  }

  update(
    lineIndex: number,
    patch: Partial<Pick<TxtHeadingDraft, 'title' | 'level'>>,
  ) {
    const draft = this.drafts.find((item) => item.lineIndex === lineIndex);
    if (draft === undefined) return undefined;
    if (patch.title !== undefined) draft.title = patch.title;
    if (patch.level !== undefined) draft.level = normalizeLevel(patch.level);
    draft.isManual = true;
    draft.reasons = ['人工修改'];
    return copyDraft(draft);
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
