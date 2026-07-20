import { describe, expect, it } from 'vitest';

import { buildTxtSourceLines } from '../src/util/file/TxtDecode';
import {
  collectExplicitTxtHeadingMatches,
  matchTxtHeadingRule,
  parseTxtHeadingNumber,
} from '../src/util/file/TxtHeadingRules';

const matchLine = (text: string) =>
  matchTxtHeadingRule(buildTxtSourceLines(text)[0]!);

describe('TXT multilingual heading rules', () => {
  it.each([
    ['第十二卷 星之塔', 'volume', 1, 12, 'zh-numbered-heading'],
    ['【第１２３章　新的开始】', 'chapter', 2, 123, 'zh-numbered-heading'],
    ['卷三 沙之歌', 'volume', 1, 3, 'zh-reversed-numbered-heading'],
    ['第七節 静かな夜', 'section', 3, 7, 'ja-numbered-heading'],
    ['Chapter XXIV: The Door', 'chapter', 2, 24, 'en-numbered-heading'],
    ['Volume Twenty-One — Winter', 'volume', 1, 21, 'en-numbered-heading'],
  ] as const)('matches %s', (text, kind, level, numberValue, rule) => {
    expect(matchLine(text)).toMatchObject({
      title: expect.any(String),
      kind,
      level,
      numberValue,
      rule,
    });
  });

  it.each([
    ['楔子', 'zh-special-heading'],
    ['番外：雨の日', 'zh-special-heading'],
    ['プロローグ はじまり', 'ja-special-heading'],
    ['幕間 — 少女の夢', 'ja-special-heading'],
    ['Side Story: A Quiet Day', 'en-special-heading'],
    ['Epilogue', 'en-special-heading'],
  ] as const)('matches the special heading %s', (text, rule) => {
    expect(matchLine(text)).toMatchObject({ kind: 'special', level: 2, rule });
  });

  it('uses exported markdown levels and strips the marker from the title', () => {
    expect(matchLine('### 第三节 细节')).toMatchObject({
      title: '第三节 细节',
      kind: 'markdown',
      level: 3,
      rule: 'markdown-heading',
    });
  });

  it.each([
    ['二〇二四', 2024],
    ['一百零二', 102],
    ['XLII', 42],
    ['thirty-six', 36],
    ['one hundred twenty three', 123],
  ] as const)('parses heading number %s', (token, expected) => {
    expect(parseTxtHeadingNumber(token)).toBe(expected);
  });

  it.each([
    '我读到第五章了吗？',
    'Chapter is a useful English word.',
    '这是序章里的一句话。',
    '',
  ])('does not locally match ordinary prose: %s', (text) => {
    expect(matchLine(text)).toBeUndefined();
  });

  it('collects explicit multilingual candidates with stable line indexes', () => {
    const lines = buildTxtSourceLines(
      ['前言正文', '', '第一章 开始', '正文', '', 'Chapter 2 End'].join('\n'),
    );
    expect(
      collectExplicitTxtHeadingMatches(lines).map(({ lineIndex, locale }) => ({
        lineIndex,
        locale,
      })),
    ).toEqual([
      { lineIndex: 2, locale: 'zh' },
      { lineIndex: 5, locale: 'en' },
    ]);
  });
});
