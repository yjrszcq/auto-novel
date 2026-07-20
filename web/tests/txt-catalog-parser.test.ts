import { describe, expect, it } from 'vitest';

import { decodeTxtText } from '../src/util/file/TxtDecode';
import {
  createTxtImportPlan,
  parseTxtCatalog,
  reconstructTxtImportPlan,
} from '../src/util/file/TxtCatalogParser';

const parse = (
  lines: readonly string[],
  mode: 'strict' | 'balanced' | 'loose' = 'balanced',
) => parseTxtCatalog(decodeTxtText(lines.join('\n')), { mode });

describe('scored TXT catalog parsing', () => {
  it('builds a multilingual, multi-volume hierarchy', () => {
    const plan = parse([
      '作品信息',
      '',
      '第一卷 星之塔',
      '第一章 出发',
      '正文',
      'Section 1 Details',
      'detail',
      '第二章 帰還',
      '本文',
      'Volume II: Sands',
      'Chapter 3 The Door',
      'body',
    ]);

    expect(plan.headings.map(({ title, level }) => [title, level])).toEqual([
      ['第一卷 星之塔', 1],
      ['第一章 出发', 2],
      ['Section 1 Details', 3],
      ['第二章 帰還', 2],
      ['Volume II: Sands', 1],
      ['Chapter 3 The Door', 2],
    ]);
    expect(plan.chapters[0]).toMatchObject({
      title: '正文前言',
      sourceStartLine: 0,
      sourceEndLine: 1,
      isPreamble: true,
    });
    expect(plan.chapters[2]?.parentChapterIndex).toBe(1);
    expect(plan.chapters[3]?.parentChapterIndex).toBe(2);
    expect(plan.navigation).toHaveLength(3);
  });

  it('rejects prose that only contains a local chapter-like phrase', () => {
    const plan = parse([
      '故事开始。',
      '我读到第五章了吗？答案当然是否定的。',
      '第一章的内容在这里继续说明。',
      '她说：“Chapter is just a word.”',
      '故事结束。',
    ]);
    expect(plan.headings).toEqual([]);
    expect(plan.summary.usedFallback).toBe(true);
  });

  it('learns three repeated pure English title lines in balanced mode', () => {
    const lines = [
      'The Silent Shore',
      '',
      'body one.',
      '',
      'A Broken Promise',
      '',
      'body two.',
      '',
      'Homeward Bound',
      '',
      'body three.',
    ];
    const strict = parse(lines, 'strict');
    const balanced = parse(lines, 'balanced');
    expect(strict.headings).toEqual([]);
    expect(balanced.headings.map(({ title }) => title)).toEqual([
      'The Silent Shore',
      'A Broken Promise',
      'Homeward Bound',
    ]);
    expect(balanced.summary.learnedFormatCount).toBe(1);
  });

  it('only admits an isolated weak decorated title in loose mode', () => {
    const lines = ['正文', '', '=== Secret Garden ===', '', 'more body'];
    expect(parse(lines, 'balanced').headings).toEqual([]);
    expect(parse(lines, 'loose').headings).toMatchObject([
      { title: 'Secret Garden', rule: 'loose-title-shape' },
    ]);
  });

  it('uses numbering continuity as evidence without discarding a forward jump', () => {
    const plan = parse([
      'Chapter 1 Start',
      'body',
      'Chapter 2 Middle',
      'body',
      'Chapter 9 Later',
      'body',
    ]);
    expect(plan.headings).toHaveLength(3);
    expect(plan.headings[1]?.reasons).toContain('编号连续');
    expect(plan.headings[2]?.reasons).toContain('编号向前跳跃');
  });

  it('falls back to lossless 1000-line chunks when no heading survives', () => {
    const text = Array.from(
      { length: 2_001 },
      (_, index) => `line ${index}`,
    ).join('\n');
    const plan = parseTxtCatalog(decodeTxtText(text));
    expect(plan.summary.usedFallback).toBe(true);
    expect(
      plan.chapters.map(({ sourceStartLine, sourceEndLine }) => [
        sourceStartLine,
        sourceEndLine,
      ]),
    ).toEqual([
      [0, 999],
      [1_000, 1_999],
      [2_000, 2_000],
    ]);
    expect(reconstructTxtImportPlan(plan)).toBe(text);
  });

  it('keeps every accepted heading line in chapter content', () => {
    const text = [
      'metadata',
      '',
      '# Volume',
      'line',
      '## Chapter',
      'last',
      '',
    ].join('\n');
    const plan = parseTxtCatalog(decodeTxtText(text));
    expect(plan.chapters.map(({ content }) => content)).toEqual([
      'metadata\n',
      '# Volume\nline',
      '## Chapter\nlast\n',
    ]);
    expect(reconstructTxtImportPlan(plan)).toBe(text);
  });

  it('supports reviewed manual headings with clamped levels and stable order', () => {
    const document = decodeTxtText('intro\ncustom title\nbody');
    const plan = createTxtImportPlan(
      document,
      [
        {
          lineIndex: 1,
          title: '  Edited title  ',
          level: 9,
          rule: 'manual',
          confidence: 1,
          isManual: true,
        },
      ],
      {
        mode: 'balanced',
        candidateCount: 1,
        rejectedCount: 0,
        learnedFormatCount: 0,
      },
    );
    expect(plan.headings).toMatchObject([
      { lineIndex: 1, title: 'Edited title', level: 6, isManual: true },
    ]);
    expect(reconstructTxtImportPlan(plan)).toBe(document.text);
  });

  it('parses large explicit catalogs in linear practical time', () => {
    const lines = Array.from({ length: 20_000 }, (_, index) =>
      index % 20 === 0 ? `第${index / 20 + 1}章 标题` : `正文 ${index}`,
    );
    const startedAt = performance.now();
    const plan = parse(lines);
    expect(plan.headings).toHaveLength(1_000);
    expect(performance.now() - startedAt).toBeLessThan(1_500);
  });
});
