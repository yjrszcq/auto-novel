import { describe, expect, it } from 'vitest';

import { TxtCatalogDraftEditor } from '../src/util/file/TxtCatalogDraftEditor';

describe('TXT catalog draft editor', () => {
  it('keeps source order while adding, editing and removing headings', () => {
    const editor = new TxtCatalogDraftEditor();
    editor.add(8, 'later', 2);
    editor.add(2, 'earlier', 1);
    editor.update(8, { title: 'edited', level: 6 });

    expect(editor.snapshot).toMatchObject([
      { lineIndex: 2, title: 'earlier', level: 1, isManual: true },
      { lineIndex: 8, title: 'edited', level: 6, isManual: true },
    ]);
    expect(editor.remove(2)).toBe(true);
    expect(editor.remove(2)).toBe(false);
    expect(editor.snapshot.map(({ lineIndex }) => lineIndex)).toEqual([8]);
  });

  it('does not create duplicate directory positions', () => {
    const editor = new TxtCatalogDraftEditor();
    const first = editor.add(4, 'first');
    const duplicate = editor.add(4, 'second');
    expect(duplicate).toEqual(first);
    expect(editor.snapshot).toHaveLength(1);
  });

  it('validates titles, line ranges and levels without leaking mutable state', () => {
    const editor = new TxtCatalogDraftEditor([
      {
        lineIndex: 1,
        title: 'chapter',
        level: 1,
        rule: 'zh-numbered',
        confidence: 0.9,
        isManual: false,
        reasons: ['规则命中'],
      },
    ]);
    const snapshot = editor.snapshot;
    snapshot[0]!.title = '';
    snapshot[0]!.reasons!.push('mutated');
    expect(editor.validate(2)).toEqual({ valid: true, errors: [] });

    editor.update(1, { title: '' });
    expect(editor.validate(1)).toMatchObject({ valid: false });
    expect(editor.validate(1).errors).toHaveLength(2);
  });

  it('resets all manual changes when automatic results are replaced', () => {
    const editor = new TxtCatalogDraftEditor();
    editor.add(4, 'manual');
    editor.reset([
      {
        lineIndex: 2,
        title: 'automatic',
        level: 1,
        rule: 'english-numbered',
        confidence: 0.8,
        isManual: false,
      },
    ]);
    expect(editor.snapshot).toEqual([
      {
        lineIndex: 2,
        title: 'automatic',
        level: 1,
        rule: 'english-numbered',
        confidence: 0.8,
        isManual: false,
        reasons: undefined,
      },
    ]);
  });

  it('undoes additions, removals and coalesced field edits', () => {
    const editor = new TxtCatalogDraftEditor([
      {
        lineIndex: 2,
        title: 'automatic',
        level: 1,
        rule: 'english-numbered',
        confidence: 0.8,
        isManual: false,
      },
    ]);

    editor.update(2, { title: 'a' });
    editor.update(2, { title: 'ab' });
    editor.update(2, { title: 'edited' });
    expect(editor.undo()).toBe(true);
    expect(editor.snapshot[0]).toMatchObject({
      title: 'automatic',
      isManual: false,
    });

    editor.remove(2);
    editor.add(8, 'manual', 3);
    expect(editor.undo()).toBe(true);
    expect(editor.snapshot).toHaveLength(0);
    expect(editor.undo()).toBe(true);
    expect(editor.snapshot[0]).toMatchObject({
      lineIndex: 2,
      title: 'automatic',
    });
    expect(editor.undo()).toBe(false);
  });

  it('restores the automatic baseline and allows restoring that change', () => {
    const automatic = {
      lineIndex: 2,
      title: 'automatic',
      level: 1,
      rule: 'english-numbered',
      confidence: 0.8,
      isManual: false,
    };
    const editor = new TxtCatalogDraftEditor([automatic]);
    editor.update(2, { title: 'reviewed' });
    editor.add(8, 'manual');

    expect(editor.hasManualChanges).toBe(true);
    expect(editor.restoreAutomatic()).toBe(true);
    expect(editor.snapshot).toEqual([{ ...automatic, reasons: undefined }]);
    expect(editor.hasManualChanges).toBe(false);

    expect(editor.undo()).toBe(true);
    expect(editor.snapshot).toMatchObject([
      { lineIndex: 2, title: 'reviewed', isManual: true },
      { lineIndex: 8, title: 'manual', isManual: true },
    ]);
    expect(editor.hasManualChanges).toBe(true);
  });

  it('filters automatic confidence while preserving reviewed headings', () => {
    const editor = new TxtCatalogDraftEditor([
      {
        lineIndex: 2,
        title: 'low',
        level: 1,
        rule: 'learned',
        confidence: 0.6,
        isManual: false,
      },
      {
        lineIndex: 8,
        title: 'boundary',
        level: 1,
        rule: 'numbered',
        confidence: 0.9,
        isManual: false,
      },
    ]);

    expect(
      editor
        .snapshotWithMinimumConfidence(0.9)
        .map(({ lineIndex }) => lineIndex),
    ).toEqual([8]);
    editor.include(2);
    expect(
      editor
        .snapshotWithMinimumConfidence(0.9)
        .map(({ lineIndex }) => lineIndex),
    ).toEqual([2, 8]);
    expect(editor.undo()).toBe(true);
    expect(
      editor
        .snapshotWithMinimumConfidence(0.9)
        .map(({ lineIndex }) => lineIndex),
    ).toEqual([8]);
  });
});
