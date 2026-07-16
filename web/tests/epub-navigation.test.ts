import { describe, expect, it } from 'vitest';

import {
  createSpineFallbackNavigation,
  normalizeEpubNavigationHref,
  normalizeEpubNavigationItems,
} from '../src/util/file/epub';

describe('EPUB navigation normalization', () => {
  it('resolves EPUB3 navigation links relative to the navigation document', () => {
    expect(
      normalizeEpubNavigationHref(
        'OEBPS/nav/toc.xhtml',
        '../Text/chapter-01.xhtml#part-2',
      ),
    ).toBe('OEBPS/Text/chapter-01.xhtml#part-2');
  });

  it('keeps local fragments and rejects external navigation targets', () => {
    expect(normalizeEpubNavigationHref('OEBPS/nav.xhtml', '#chapter-2')).toBe(
      'OEBPS/nav.xhtml#chapter-2',
    );
    expect(
      normalizeEpubNavigationHref(
        'OEBPS/nav.xhtml',
        'https://example.com/book.xhtml#chapter-2',
      ),
    ).toBeUndefined();
  });

  it('creates a spine-only fallback without manifest-only documents', () => {
    expect(
      createSpineFallbackNavigation([
        { href: 'OEBPS/Text/one.xhtml', title: '第一章' },
        { href: 'OEBPS/Text/two.xhtml' },
      ]),
    ).toEqual([
      { text: '第一章', href: 'OEBPS/Text/one.xhtml', children: [] },
      { text: '第 2 章', href: 'OEBPS/Text/two.xhtml', children: [] },
    ]);
  });

  it('preserves nested EPUB2 or EPUB3 navigation nodes and duplicate targets', () => {
    expect(
      normalizeEpubNavigationItems('OEBPS/toc.ncx', [
        {
          text: '第一卷',
          href: 'Text/one.xhtml',
          children: [
            {
              text: '第一章',
              href: 'Text/one.xhtml#chapter-1',
              children: [],
            },
            {
              text: '第一章（重复目录）',
              href: 'Text/one.xhtml#chapter-1',
              children: [],
            },
          ],
        },
      ]),
    ).toEqual([
      {
        text: '第一卷',
        href: 'OEBPS/Text/one.xhtml',
        children: [
          {
            text: '第一章',
            href: 'OEBPS/Text/one.xhtml#chapter-1',
            children: [],
          },
          {
            text: '第一章（重复目录）',
            href: 'OEBPS/Text/one.xhtml#chapter-1',
            children: [],
          },
        ],
      },
    ]);
  });
});
