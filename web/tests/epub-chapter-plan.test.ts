import { describe, expect, it } from 'vitest';

import { buildEpubChapterPlan } from '../src/stores/local/EpubChapterPlan';

describe('native EPUB chapter plan', () => {
  it('splits one XHTML document at native navigation anchors', () => {
    expect(
      buildEpubChapterPlan(
        [
          { text: '第一章', href: 'OEBPS/Text/book.xhtml#one', children: [] },
          { text: '第二章', href: 'OEBPS/Text/book.xhtml#two', children: [] },
        ],
        [
          {
            href: 'OEBPS/Text/book.xhtml',
            paragraphs: ['一', '二', '三', '四'],
            anchors: { one: 0, two: 2 },
          },
        ],
      ),
    ).toEqual([
      {
        chapterId: 'OEBPS/Text/book.xhtml#one',
        title: '第一章',
        paragraphs: ['一', '二'],
        sourceRanges: [{ href: 'OEBPS/Text/book.xhtml', start: 0, end: 2 }],
      },
      {
        chapterId: 'OEBPS/Text/book.xhtml#two',
        title: '第二章',
        paragraphs: ['三', '四'],
        sourceRanges: [{ href: 'OEBPS/Text/book.xhtml', start: 2, end: 4 }],
      },
    ]);
  });

  it('joins spine documents until the next native navigation target', () => {
    const chapters = buildEpubChapterPlan(
      [
        { text: '开始', href: 'OEBPS/Text/one.xhtml', children: [] },
        {
          text: '结尾',
          href: 'OEBPS/Text/three.xhtml#end',
          children: [],
        },
      ],
      [
        { href: 'OEBPS/Text/one.xhtml', paragraphs: ['一'] },
        { href: 'OEBPS/Text/two.xhtml', paragraphs: ['二', '三'] },
        {
          href: 'OEBPS/Text/three.xhtml',
          paragraphs: ['四', '五'],
          anchors: { end: 1 },
        },
      ],
    );

    expect(chapters[0].paragraphs).toEqual(['一', '二', '三', '四']);
    expect(chapters[0].sourceRanges).toEqual([
      { href: 'OEBPS/Text/one.xhtml', start: 0, end: 1 },
      { href: 'OEBPS/Text/two.xhtml', start: 0, end: 2 },
      { href: 'OEBPS/Text/three.xhtml', start: 0, end: 1 },
    ]);
    expect(chapters[1].paragraphs).toEqual(['五']);
  });

  it('keeps independent parent targets but ignores duplicate targets', () => {
    const chapters = buildEpubChapterPlan(
      [
        {
          text: '第一卷',
          href: 'OEBPS/Text/book.xhtml',
          children: [
            {
              text: '第一章',
              href: 'OEBPS/Text/book.xhtml#one',
              children: [],
            },
            {
              text: '第一章（重复）',
              href: 'OEBPS/Text/book.xhtml#one',
              children: [],
            },
          ],
        },
      ],
      [
        {
          href: 'OEBPS/Text/book.xhtml',
          paragraphs: ['卷首', '正文'],
          anchors: { one: 1 },
        },
      ],
    );

    expect(chapters.map((chapter) => chapter.title)).toEqual([
      '第一卷',
      '第一章',
    ]);
    expect(chapters.map((chapter) => chapter.paragraphs)).toEqual([
      ['卷首'],
      ['正文'],
    ]);
  });

  it('falls back to spine order when native targets are unusable', () => {
    expect(
      buildEpubChapterPlan(
        [{ text: '目录页', href: 'OEBPS/nav.xhtml', children: [] }],
        [
          { href: 'OEBPS/Text/one.xhtml', title: '第一章', paragraphs: ['一'] },
          { href: 'OEBPS/Text/two.xhtml', paragraphs: ['二'] },
        ],
      ),
    ).toMatchObject([
      { chapterId: 'OEBPS/Text/one.xhtml', title: '第一章' },
      { chapterId: 'OEBPS/Text/two.xhtml', title: '第 2 章' },
    ]);
  });
});
