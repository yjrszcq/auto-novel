import { describe, expect, it } from 'vitest';

import {
  Epub,
  createSpineFallbackNavigation,
  normalizeEpubArchivePath,
  normalizeEpubNavigationHref,
  normalizeEpubNavigationItems,
  resolveEpubArchiveHref,
} from '../src/util/file/epub';

describe('EPUB navigation normalization', () => {
  it('reads package metadata while preserving multiple creators and languages', () => {
    const epub = new Epub('metadata.epub');
    const children = [
      { localName: 'title', textContent: '  书名  ' },
      { localName: 'creator', textContent: '作者一' },
      { localName: 'creator', textContent: '作者二' },
      { localName: 'description', textContent: '第一行\n第二行' },
      { localName: 'language', textContent: 'ja' },
      { localName: 'language', textContent: 'zh-CN' },
    ];
    epub.packageDoc = {
      getElementsByTagName: () => ({ item: () => ({ children }) }),
    } as unknown as Document;
    expect(epub.getBookMetadata()).toEqual({
      title: '书名',
      authors: ['作者一', '作者二'],
      description: '第一行\n第二行',
      languages: ['ja', 'zh-CN'],
    });
  });
  it('resolves EPUB3 navigation links relative to the navigation document', () => {
    expect(
      normalizeEpubNavigationHref(
        'OEBPS/nav/toc.xhtml',
        '../Text/chapter-01.xhtml#part-2',
      ),
    ).toBe('OEBPS/Text/chapter-01.xhtml#part-2');
  });

  it('canonicalizes encoded and non-standard archive paths once', () => {
    expect(
      resolveEpubArchiveHref(
        'OPS/Text/chapter.xhtml',
        '../Images/cover%20art.jpg#preview',
      ),
    ).toBe('OPS/Images/cover art.jpg#preview');
    expect(normalizeEpubArchivePath('OPS\\Images\\cover art.jpg')).toBe(
      'OPS/Images/cover art.jpg',
    );
    expect(
      resolveEpubArchiveHref('OPS/Text/chapter.xhtml', 'https://example.com'),
    ).toBeUndefined();
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

  it('exposes canonical resources and terminates cyclic fallback chains', () => {
    const epub = new Epub('fallback.epub');
    epub.items.set('preferred', {
      id: 'preferred',
      href: 'media/chapter.bin',
      path: 'OPS/media/chapter.bin',
      mediaType: 'application/x-custom',
      overlay: null,
      properties: null,
      fallback: 'fallback',
      blob: new Blob(),
    });
    epub.items.set('fallback', {
      id: 'fallback',
      href: 'text/chapter.xhtml',
      path: 'OPS/text/chapter.xhtml',
      mediaType: 'application/xhtml+xml',
      overlay: null,
      properties: null,
      fallback: 'preferred',
      doc: {} as Document,
    });

    expect(
      epub.resolveResource('OPS/nav/toc.xhtml', '../text/chapter.xhtml')?.id,
    ).toBe('fallback');
    expect(epub.getFallbackChain('preferred').map((item) => item.id)).toEqual([
      'preferred',
      'fallback',
    ]);
  });

  it('keeps duplicate spine occurrences and their linear semantics', () => {
    const epub = new Epub('spine.epub');
    const resource = {
      id: 'chapter',
      href: 'Text/chapter.xhtml',
      path: 'OPS/Text/chapter.xhtml',
      mediaType: 'application/xhtml+xml',
      overlay: null,
      properties: null,
      fallback: null,
      doc: {} as Document,
    };
    epub.items.set(resource.id, resource);
    epub.itemrefs.push(
      { idref: resource.id, linear: 'no', properties: ['page-spread-left'] },
      { idref: resource.id, linear: null, properties: null },
    );

    expect(epub.iterSpine()).toEqual([
      {
        index: 0,
        idref: 'chapter',
        linear: false,
        properties: ['page-spread-left'],
        resource,
      },
      {
        index: 1,
        idref: 'chapter',
        linear: true,
        properties: [],
        resource,
      },
    ]);
  });
});
