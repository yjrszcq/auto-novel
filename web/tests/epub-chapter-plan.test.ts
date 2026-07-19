import { describe, expect, it } from 'vitest';

import {
  buildEpubChapterPlan,
  buildEpubNavigationPlan,
} from '../src/stores/local/EpubChapterPlan';

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
        sourceRanges: [
          {
            href: 'OEBPS/Text/book.xhtml',
            start: 0,
            end: 2,
            startFragment: 'one',
            endFragment: 'two',
          },
        ],
      },
      {
        chapterId: 'OEBPS/Text/book.xhtml#two',
        title: '第二章',
        paragraphs: ['三', '四'],
        sourceRanges: [
          {
            href: 'OEBPS/Text/book.xhtml',
            start: 2,
            end: 4,
            startFragment: 'two',
          },
        ],
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
      {
        href: 'OEBPS/Text/three.xhtml',
        start: 0,
        end: 1,
        endFragment: 'end',
      },
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
    const navigation = [
      { text: '目录页', href: 'OEBPS/nav.xhtml', children: [] },
    ];
    const chapters = buildEpubChapterPlan(navigation, [
      { href: 'OEBPS/Text/one.xhtml', title: '第一章', paragraphs: ['一'] },
      { href: 'OEBPS/Text/two.xhtml', paragraphs: ['二'] },
    ]);
    expect(chapters).toMatchObject([
      { chapterId: 'OEBPS/Text/one.xhtml', title: '第一章' },
      { chapterId: 'OEBPS/Text/two.xhtml', title: '第 2 章' },
    ]);
    expect(buildEpubNavigationPlan(navigation, chapters)).toMatchObject([
      { chapterId: 'OEBPS/Text/one.xhtml', title: '第一章' },
      { chapterId: 'OEBPS/Text/two.xhtml', title: '第 2 章' },
    ]);
  });

  it('keeps fragment navigation actionable when a non-monotonic toc falls back', () => {
    const navigation = [
      { text: '附录', href: 'Text/notes.xhtml#note', children: [] },
      { text: '正文', href: 'Text/chapter.xhtml#start', children: [] },
    ];
    const chapters = buildEpubChapterPlan(navigation, [
      {
        href: 'Text/chapter.xhtml',
        paragraphs: ['正文'],
        anchors: { start: 0 },
      },
      {
        href: 'Text/notes.xhtml',
        paragraphs: ['附录'],
        anchors: { note: 0 },
      },
    ]);

    expect(buildEpubNavigationPlan(navigation, chapters)).toMatchObject([
      { href: 'Text/notes.xhtml#note', chapterId: 'Text/notes.xhtml' },
      { href: 'Text/chapter.xhtml#start', chapterId: 'Text/chapter.xhtml' },
    ]);
  });

  it('keeps structural native navigation entries alongside readable chapters', () => {
    const navigation = [
      {
        text: '第一卷',
        children: [
          {
            text: '第一章',
            href: 'Text/one.xhtml',
            children: [],
          },
        ],
      },
    ];
    const chapters = buildEpubChapterPlan(navigation, [
      { href: 'Text/one.xhtml', paragraphs: ['正文'] },
    ]);

    expect(buildEpubNavigationPlan(navigation, chapters)).toEqual([
      {
        id: 'nav-0',
        title: '第一卷',
        level: 0,
        href: undefined,
        chapterId: undefined,
        parentId: undefined,
      },
      {
        id: 'nav-1',
        title: '第一章',
        level: 1,
        href: 'Text/one.xhtml',
        chapterId: 'Text/one.xhtml',
        parentId: 'nav-0',
      },
    ]);
  });

  it('keeps image-only and non-spine navigation targets as readable chapters', () => {
    const navigation = [
      { text: '封面', href: 'Text/cover.xhtml', children: [] },
      {
        text: '正文',
        href: 'Text/chapter.xhtml#start',
        children: [],
      },
      { text: '附录', href: 'Text/notes.xhtml#note', children: [] },
    ];
    const chapters = buildEpubChapterPlan(navigation, [
      { href: 'Text/cover.xhtml', paragraphs: [], hasContent: true },
      {
        href: 'Text/chapter.xhtml',
        paragraphs: ['标题', '正文'],
        anchors: { start: 0 },
        hasContent: true,
      },
      {
        href: 'Text/notes.xhtml',
        paragraphs: ['附录内容'],
        anchors: { note: 0 },
        hasContent: true,
      },
    ]);

    expect(chapters).toEqual([
      {
        chapterId: 'Text/cover.xhtml',
        title: '封面',
        paragraphs: [],
        sourceRanges: [{ href: 'Text/cover.xhtml', start: 0, end: 0 }],
      },
      {
        chapterId: 'Text/chapter.xhtml#start',
        title: '正文',
        paragraphs: ['标题', '正文'],
        sourceRanges: [
          {
            href: 'Text/chapter.xhtml',
            start: 0,
            end: 2,
            startFragment: 'start',
          },
        ],
      },
      {
        chapterId: 'Text/notes.xhtml#note',
        title: '附录',
        paragraphs: ['附录内容'],
        sourceRanges: [
          {
            href: 'Text/notes.xhtml',
            start: 0,
            end: 1,
            startFragment: 'note',
          },
        ],
      },
    ]);
    expect(
      buildEpubNavigationPlan(navigation, chapters).map(
        ({ title, chapterId }) => ({ title, chapterId }),
      ),
    ).toEqual([
      { title: '封面', chapterId: 'Text/cover.xhtml' },
      { title: '正文', chapterId: 'Text/chapter.xhtml#start' },
      { title: '附录', chapterId: 'Text/notes.xhtml#note' },
    ]);
  });

  it('keeps duplicate spine occurrences addressable in fallback order', () => {
    const chapters = buildEpubChapterPlan(
      [],
      [
        { href: 'Text/repeated.xhtml', paragraphs: ['第一次'] },
        { href: 'Text/repeated.xhtml', paragraphs: ['第二次'] },
      ],
    );

    expect(
      chapters.map(({ chapterId, paragraphs }) => ({
        chapterId,
        paragraphs,
      })),
    ).toEqual([
      { chapterId: 'Text/repeated.xhtml', paragraphs: ['第一次'] },
      {
        chapterId: 'Text/repeated.xhtml::spine-1',
        paragraphs: ['第二次'],
      },
    ]);
  });
});
