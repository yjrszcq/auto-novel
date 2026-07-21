import { expect, test } from '@playwright/test';
import {
  BlobReader,
  BlobWriter,
  TextReader,
  TextWriter,
  ZipReader,
  ZipWriter,
} from '@zip.js/zip.js';

import type { Epub as ParsedEpub } from '../src/util/file/epub';
import type { createEpubRichChapter as CreateEpubRichChapter } from '../src/stores/local/EpubRichChapter';
import type { getTranslationFile as GetTranslationFile } from '../src/stores/local/GetTranslationFile';
import type { createLocalVolumeDao as CreateLocalVolumeDao } from '../src/stores/local/LocalVolumeDao';

const createStandardsFixture = async () => {
  const output = new BlobWriter('application/epub+zip');
  const writer = new ZipWriter(output);
  await writer.add('mimetype', new TextReader('application/epub+zip'), {
    level: 0,
  });
  await writer.add(
    'META-INF/container.xml',
    new TextReader(`<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`),
  );
  await writer.add(
    'OPS/package.opf',
    new TextReader(`<?xml version="1.0" encoding="utf-8"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">rich-fixture</dc:identifier>
    <dc:title>富内容 EPUB 测试</dc:title>
    <dc:creator>测试作者</dc:creator>
    <dc:language>ja</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav/toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover-page" href="Text/cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter-bin" href="Media/chapter.bin" media-type="application/x-custom" fallback="chapter"/>
    <item id="chapter" href="Text/chapter%20one.xhtml" media-type="application/xhtml+xml"/>
    <item id="fixed" href="Text/fixed.xhtml" media-type="application/xhtml+xml"/>
    <item id="notes" href="Text/notes.xhtml" media-type="application/xhtml+xml"/>
    <item id="style" href="Styles/book.css" media-type="text/css"/>
    <item id="cover" href="Images/cover%20art.svg" media-type="image/svg+xml" properties="cover-image"/>
    <item id="font" href="Fonts/reader.woff2" media-type="font/woff2"/>
    <item id="audio" href="Media/sample.mp3" media-type="audio/mpeg"/>
    <item id="missing" href="Images/missing.png" media-type="image/png"/>
    <item id="remote" href="https://example.com/remote.css" media-type="text/css"/>
  </manifest>
  <spine>
    <itemref idref="cover-page" linear="no"/>
    <itemref idref="chapter-bin"/>
    <itemref idref="fixed" properties="rendition:layout-pre-paginated"/>
  </spine>
</package>`),
  );
  await writer.add(
    'OPS/nav/toc.xhtml',
    new TextReader(`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>目录</title></head><body>
<nav epub:type="landmarks toc"><h1>目录</h1><div><ol>
  <li><a href="../Text/cover.xhtml">封面</a></li>
  <li><a href="../Text/cover.xhtml">第一卷</a><ol>
    <li><span>第一篇</span><ol>
      <li><a href="../Text/chapter%20one.xhtml#start">第一章</a></li>
    </ol></li>
  </ol></li>
  <li><a href="../Text/fixed.xhtml">固定版式</a></li>
  <li><a href="../Text/notes.xhtml#note-1">附录</a></li>
</ol></div></nav>
</body></html>`),
  );
  await writer.add(
    'OPS/Text/fixed.xhtml',
    new TextReader(`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>固定版式</title>
<meta name="viewport" content="width=600,height=800"/></head>
<body><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800" width="600" height="800">
<rect width="600" height="800" fill="#173f5f"/><text x="50" y="100" fill="white">固定版式页面</text>
</svg></body></html>`),
  );
  await writer.add(
    'OPS/Text/cover.xhtml',
    new TextReader(`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>封面</title>
<link rel="stylesheet" href="../Styles/book.css"/></head>
<body><img src="../Images/cover%20art.svg" alt="封面"/></body></html>`),
  );
  await writer.add(
    'OPS/Text/chapter one.xhtml',
    new TextReader(`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title>
<link rel="stylesheet" href="../Styles/book.css"/></head><body>
<section id="start"><p class="preview-image"><img src="../Images/cover%20art.svg" alt="预览插图"/></p>
<h1 class="chapter-title" style="break-before: page">第一章</h1>
<p>第一段 <a href="notes.xhtml#note-1">参见附录</a> <a href="https://example.org/author">外部网站</a></p>
<ul><li>第一项</li><li>第二项 <ruby>字<rt>じ</rt></ruby></li></ul>
<table><tbody><tr><td>单元格</td></tr></tbody></table><aside class="vertical-note">纵排注记</aside>
${Array.from({ length: 30 }, (_, index) => `<p>分页测试段落 ${index + 1}</p>`).join('\n')}
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>
<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math><audio src="../Media/sample.mp3" controls="controls"/>
<img src="https://example.com/tracker.png" alt="应被阻止"/><script>window.epubScriptExecuted = true</script></section>
</body></html>`),
  );
  await writer.add(
    'OPS/Text/notes.xhtml',
    new TextReader(`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>附录</title></head>
<body><aside id="note-1"><p>附录内容 <a href="chapter%20one.xhtml#start">返回正文</a></p></aside></body></html>`),
  );
  await writer.add(
    'OPS/Styles/book.css',
    new TextReader(`@font-face { font-family: Fixture; src: url('../Fonts/reader.woff2'); }
body { font-family: Fixture; }
.chapter-title { font-size: 2.25em; font-weight: 800; }
.vertical-note { writing-mode: vertical-rl; }`),
  );
  await writer.add(
    'OPS/Images/cover art.svg',
    new TextReader(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 16"><rect width="10" height="16" fill="teal"/></svg>',
    ),
  );
  await writer.add(
    'OPS/Fonts/reader.woff2',
    new BlobReader(new Blob([Uint8Array.from([1, 2, 3])])),
  );
  await writer.add(
    'OPS/Media/sample.mp3',
    new BlobReader(new Blob([Uint8Array.from([4, 5, 6])])),
  );
  await writer.close();
  return Buffer.from(await (await output.getData()).arrayBuffer());
};

test('imports a canonical EPUB 3 package and preserves its nested navigation', async ({
  page,
}) => {
  const remotePublicationRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith('https://example.com/')) {
      remotePublicationRequests.push(request.url());
    }
  });
  await page.goto('/');
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: 'rich fixture.epub',
      mimeType: 'application/epub+zip',
      buffer: await createStandardsFixture(),
    });
  await expect(
    page.getByRole('heading', { name: '富内容 EPUB 测试' }),
  ).toBeVisible();

  const imported = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('volumes');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = database.transaction(['metadata', 'file'], 'readonly');
    const metadata = await new Promise<Record<string, unknown>>(
      (resolve, reject) => {
        const request = transaction
          .objectStore('metadata')
          .get('rich fixture.epub');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      },
    );
    const storedFile = await new Promise<{ file: File }>((resolve, reject) => {
      const request = transaction.objectStore('file').get('rich fixture.epub');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    database.close();
    return {
      navigation: metadata.navigation,
      importDiagnostics: metadata.importDiagnostics,
      sourceFormat: metadata.sourceFormat,
      fileSize: storedFile.file.size,
    };
  });

  expect(imported.sourceFormat).toBe('epub');
  expect(imported.fileSize).toBeGreaterThan(0);
  expect(imported.navigation).toEqual([
    expect.objectContaining({ title: '封面', level: 0 }),
    expect.objectContaining({ title: '第一卷', level: 0 }),
    expect.objectContaining({ title: '第一篇', level: 1 }),
    expect.objectContaining({
      title: '第一章',
      level: 2,
      href: 'OPS/Text/chapter one.xhtml#start',
    }),
    expect.objectContaining({
      title: '固定版式',
      level: 0,
      href: 'OPS/Text/fixed.xhtml',
    }),
    expect.objectContaining({
      title: '附录',
      level: 0,
      href: 'OPS/Text/notes.xhtml#note-1',
    }),
  ]);
  expect(imported.importDiagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: 'active-content-disabled' }),
      expect.objectContaining({ code: 'missing-resource' }),
      expect.objectContaining({ code: 'remote-resource-disabled' }),
    ]),
  );

  const translatedEpubBytes = await page.evaluate(async () => {
    const dynamicImport = (path: string) => import(/* @vite-ignore */ path);
    const { createLocalVolumeDao } = (await dynamicImport(
      '/src/stores/local/LocalVolumeDao.ts',
    )) as { createLocalVolumeDao: typeof CreateLocalVolumeDao };
    const { getTranslationFile } = (await dynamicImport(
      '/src/stores/local/GetTranslationFile.ts',
    )) as { getTranslationFile: typeof GetTranslationFile };
    const dao = await createLocalVolumeDao();
    await dao.updateMetadata('rich fixture.epub', (metadata) => ({
      ...metadata,
      toc: metadata.toc.map((entry) => ({
        ...entry,
        titleTranslations: {
          gpt: {
            text: `译题：${entry.title}`,
            glossaryId: metadata.glossaryId,
            sourceTitle: entry.title ?? '',
          },
        },
      })),
      navigation: metadata.navigation?.map((entry) => ({
        ...entry,
        titleTranslations: {
          gpt: {
            text: `译题：${entry.title}`,
            glossaryId: metadata.glossaryId,
            sourceTitle: entry.title,
          },
        },
      })),
    }));
    const { blob } = await getTranslationFile(dao, {
      id: 'rich fixture.epub',
      mode: 'zh',
      translationsMode: 'priority',
      translations: ['gpt'],
    });
    dao.close();
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  const translatedEpub = new ZipReader(
    new BlobReader(new Blob([Uint8Array.from(translatedEpubBytes)])),
  );
  const translatedEntries = await translatedEpub.getEntries();
  const translatedNavigation = translatedEntries.find(
    (entry) => entry.filename === 'OPS/nav/toc.xhtml',
  );
  expect(translatedNavigation?.getData).toBeDefined();
  const translatedNavigationText = await translatedNavigation!.getData!(
    new TextWriter(),
  );
  await translatedEpub.close();
  expect(translatedNavigationText).toContain('译题：第一卷');
  expect(translatedNavigationText).toContain('译题：第一篇');
  expect(translatedNavigationText).toContain('译题：第一章');

  const richProjection = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('volumes');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = database.transaction(['file', 'chapter'], 'readonly');
    const storedFile = await new Promise<{ file: File }>((resolve, reject) => {
      const request = transaction.objectStore('file').get('rich fixture.epub');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const chapters = await new Promise<
      Array<{
        id: string;
        paragraphs: string[];
        segmentIds: string[];
        sourceRanges: Array<{ href: string; start: number; end: number }>;
      }>
    >((resolve, reject) => {
      const request = transaction.objectStore('chapter').getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    database.close();

    const dynamicImport = (path: string) => import(/* @vite-ignore */ path);
    const { Epub } = (await dynamicImport('/src/util/file/epub.ts')) as {
      Epub: { fromFile(file: File): Promise<ParsedEpub> };
    };
    const { createEpubRichChapter } = (await dynamicImport(
      '/src/stores/local/EpubRichChapter.ts',
    )) as { createEpubRichChapter: typeof CreateEpubRichChapter };
    const epub = await Epub.fromFile(storedFile.file);
    return chapters
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((chapter) => ({
        id: chapter.id,
        paragraphs: chapter.paragraphs,
        segmentIds: chapter.segmentIds,
        rich: createEpubRichChapter(epub, chapter),
      }));
  });

  const cover = richProjection.find((chapter) =>
    chapter.id.endsWith('/Text/cover.xhtml'),
  );
  expect(cover?.paragraphs).toEqual([]);
  expect(cover?.rich?.documents[0]?.content).toContain('<img');
  const chapter = richProjection.find((item) => item.id.includes('#start'));
  expect(chapter?.paragraphs.slice(0, 5)).toEqual([
    '第一章',
    '第一段 参见附录 外部网站',
    '第一项',
    '第二项 字',
    '单元格',
  ]);
  expect(chapter?.rich?.documents[0]).toMatchObject({
    sourcePath: 'OPS/Text/chapter one.xhtml',
    stylesheetHrefs: ['../Styles/book.css'],
  });
  for (const segmentId of chapter?.segmentIds ?? []) {
    expect(chapter?.rich?.documents[0]?.content).toContain(segmentId);
  }
  expect(chapter?.rich?.documents[0]?.content).toContain('<ul');
  expect(chapter?.rich?.documents[0]?.content).toContain('<table');
  const fixed = richProjection.find((item) =>
    item.id.endsWith('/Text/fixed.xhtml'),
  );
  expect(fixed?.rich?.documents[0]).toMatchObject({
    layout: 'pre-paginated',
    viewport: { width: 600, height: 800 },
  });

  await page.evaluate(
    async ({ chapterId, translations }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('volumes');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      const transaction = database.transaction(['chapter'], 'readwrite');
      const chapterStore = transaction.objectStore('chapter');
      const chapterRequest = chapterStore.get(chapterId);
      const storedChapter = await new Promise<Record<string, unknown>>(
        (resolve, reject) => {
          chapterRequest.onerror = () => reject(chapterRequest.error);
          chapterRequest.onsuccess = () => resolve(chapterRequest.result);
        },
      );
      chapterStore.put({
        ...storedChapter,
        gpt: { glossaryId: 'fixture', glossary: {}, paragraphs: translations },
      });
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
    },
    {
      chapterId: chapter!.id,
      translations: chapter!.paragraphs.map((text, index) =>
        index === 1 ? '译文 头发发展在里面' : `译文 ${text}`,
      ),
    },
  );

  await page.goto('/books/rich%20fixture.epub/details');
  await page.getByRole('button', { name: '开始阅读' }).click();
  await expect(page.locator('[data-reader-epub-host]')).toHaveCount(1);
  await expect
    .poll(() =>
      page
        .locator('[data-reader-epub-host]')
        .evaluate((host) =>
          host.shadowRoot?.querySelector('img')?.getAttribute('src'),
        ),
    )
    .toMatch(/^blob:/);

  const chooseFlow = async (label: string) => {
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const flowSetting = page
      .locator('.book-reader__settings-grid .n-form-item')
      .filter({ hasText: '阅读流' });
    await flowSetting.locator('.n-base-selection').click();
    await page
      .locator('.n-base-select-menu')
      .getByText(label, { exact: true })
      .click();
    await page.keyboard.press('Escape');
  };
  const chooseScript = async (label: string) => {
    const readerUrl = page.url();
    await page.goto('/setting');
    const scriptSetting = page.locator('#reader-chinese-script');
    await expect(scriptSetting).toHaveAttribute('aria-busy', 'false');
    await scriptSetting.getByText(label, { exact: true }).click();
    await expect(
      scriptSetting.getByRole('radio', { name: label, exact: true }),
    ).toBeChecked();
    await page.goto(readerUrl);
    await expect(richHost).toBeAttached();
  };
  const chooseReadingLanguage = async (label: string) => {
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const languageSetting = page
      .locator('.book-reader__settings-grid .n-form-item')
      .filter({ hasText: '阅读语言' });
    await languageSetting.locator('.n-base-selection').click();
    await page
      .locator('.n-base-select-menu')
      .getByText(label, { exact: true })
      .click();
    await page.keyboard.press('Escape');
  };
  await chooseFlow('滚动');
  const nextPreviewHost = page
    .locator('[data-reader-chapter-preview="next"] [data-reader-epub-host]')
    .first();
  await expect(nextPreviewHost).toBeAttached();
  await expect
    .poll(() =>
      nextPreviewHost.evaluate((host) => ({
        title: host.shadowRoot?.querySelector('.chapter-title')?.textContent,
        fontSize: getComputedStyle(
          host.shadowRoot!.querySelector('.chapter-title')!,
        ).fontSize,
        fontWeight: getComputedStyle(
          host.shadowRoot!.querySelector('.chapter-title')!,
        ).fontWeight,
        imageSrc: host.shadowRoot
          ?.querySelector('img[alt="预览插图"]')
          ?.getAttribute('src'),
        imageLoaded:
          host.shadowRoot?.querySelector<HTMLImageElement>(
            'img[alt="预览插图"]',
          )?.complete,
        lastOriginalParagraph: Array.from(
          host.shadowRoot?.querySelectorAll(
            'p[data-reader-language-side="original"]',
          ) ?? [],
        ).at(-1)?.textContent,
      })),
    )
    .toMatchObject({
      title: '第一章',
      fontSize: '40.5px',
      fontWeight: '800',
      imageSrc: expect.stringMatching(/^blob:/),
      imageLoaded: true,
      lastOriginalParagraph: expect.stringMatching(/^分页测试段落 \d+$/),
    });
  await page.keyboard.press('ArrowRight');
  const previousPreviewHost = page
    .locator('[data-reader-chapter-preview="previous"] [data-reader-epub-host]')
    .first();
  await expect(previousPreviewHost).toBeAttached();
  await expect
    .poll(() =>
      previousPreviewHost.evaluate((host) => {
        const image =
          host.shadowRoot?.querySelector<HTMLImageElement>('img[alt="封面"]');
        return {
          src: image?.getAttribute('src'),
          loaded: image?.complete,
        };
      }),
    )
    .toEqual({ src: expect.stringMatching(/^blob:/), loaded: true });
  await chooseFlow('自动（电脑分页，手机滚动）');
  await expect
    .poll(() =>
      page.locator('[data-reader-epub-host]').evaluate((host) => ({
        title: host.shadowRoot?.querySelector('h1')?.textContent,
        list: host.shadowRoot?.querySelector('li')?.textContent,
        table: host.shadowRoot?.querySelector('td')?.textContent,
        remoteSource: host.shadowRoot
          ?.querySelector('img[alt="应被阻止"]')
          ?.getAttribute('src'),
        fontFamily: getComputedStyle(
          host.shadowRoot!.querySelector('.epub-document')!,
        ).fontFamily,
        writingMode: getComputedStyle(
          host.shadowRoot!.querySelector('.vertical-note')!,
        ).writingMode,
      })),
    )
    .toMatchObject({
      title: '第一章',
      list: '第一项',
      table: '单元格',
      remoteSource: null,
      fontFamily: 'Fixture',
      writingMode: 'vertical-rl',
    });
  const richHost = page
    .locator('[data-reader-epub-host]')
    .filter({ hasText: '分页测试段落 30' });
  const paginatedViewport = page.locator('.book-reader__content--paginated');
  await expect
    .poll(() =>
      paginatedViewport.evaluate(
        (viewport) => viewport.scrollWidth > viewport.clientWidth,
      ),
    )
    .toBe(true);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press('PageDown');
  await expect
    .poll(() => paginatedViewport.evaluate((viewport) => viewport.scrollLeft))
    .toBeGreaterThan(0);
  await page.keyboard.press('PageUp');
  await expect
    .poll(() => paginatedViewport.evaluate((viewport) => viewport.scrollLeft))
    .toBe(0);
  await chooseFlow('滚动');
  await expect(page.locator('.book-reader__content--scrolled')).toBeVisible();
  await expect(richHost).not.toHaveAttribute('style', /width:/);
  await chooseFlow('自动（电脑分页，手机滚动）');
  await expect(page.locator('.book-reader__content--paginated')).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('.book-reader__content--paginated')
        .evaluate((viewport) => viewport.scrollWidth > viewport.clientWidth),
    )
    .toBe(true);
  expect(remotePublicationRequests).toEqual([]);
  expect(await page.evaluate(() => 'epubScriptExecuted' in window)).toBe(false);
  const firstSegmentId = chapter!.segmentIds[0];
  const chineseSegmentId = chapter!.segmentIds[1]!;

  const getRichStructure = () =>
    richHost.evaluate((host, segmentId) => {
      const shadow = host.shadowRoot!;
      const original = shadow.querySelector<HTMLElement>(
        `[data-reader-segment-id="${segmentId}"][data-reader-language-side="original"]`,
      )!;
      const internal = shadow.querySelector<HTMLAnchorElement>(
        '[data-epub-href="notes.xhtml#note-1"]',
      );
      const external = shadow.querySelector<HTMLAnchorElement>(
        'a[href="https://example.org/author"]',
      );
      return {
        originalText: original.textContent?.trim(),
        originalId: original.id,
        originalClass: original.className,
        internalHref: internal?.getAttribute('href'),
        internalTarget: internal?.getAttribute('data-epub-href'),
        externalHref: external?.getAttribute('href'),
        externalRel: external?.getAttribute('rel'),
        imageUsesBlobUrl:
          shadow
            .querySelector('img')
            ?.getAttribute('src')
            ?.startsWith('blob:') ?? false,
      };
    }, firstSegmentId);
  const structureBeforeScript = await getRichStructure();

  const getLanguageOrder = () =>
    richHost.evaluate(
      (host, segmentId) =>
        Array.from(
          host.shadowRoot?.querySelectorAll(
            `[data-reader-segment-id="${segmentId}"]`,
          ) ?? [],
        )
          .filter((element) => getComputedStyle(element).display !== 'none')
          .map((element) => ({
            language: (element as HTMLElement).dataset.readerLanguageSide,
            text: element.textContent?.trim(),
          })),
      firstSegmentId,
    );
  await chooseReadingLanguage('中文');
  await expect
    .poll(getLanguageOrder)
    .toEqual([
      expect.objectContaining({ language: 'translated', text: '译文 第一章' }),
    ]);
  await page.setViewportSize({ width: 800, height: 900 });
  const narrowSegment = page.locator(
    `[data-reader-segment-id="${firstSegmentId}"][data-reader-language-side="translated"]`,
  );
  await chooseScript('繁體中文');
  await expect
    .poll(getLanguageOrder)
    .toEqual([
      expect.objectContaining({ language: 'translated', text: '譯文 第一章' }),
    ]);
  await expect(narrowSegment).toBeAttached();
  await expect
    .poll(() =>
      richHost.evaluate((host, segmentId) => {
        const elements = host.shadowRoot?.querySelectorAll<HTMLElement>(
          `[data-reader-segment-id="${segmentId}"]`,
        );
        return {
          original: Array.from(elements ?? []).find(
            (element) => element.dataset.readerLanguageSide === 'original',
          )?.textContent,
          translated: Array.from(elements ?? []).find(
            (element) => element.dataset.readerLanguageSide === 'translated',
          )?.textContent,
        };
      }, chineseSegmentId),
    )
    .toEqual({
      original: expect.stringContaining('第一段 参见附录 外部网站'),
      translated: expect.stringContaining('頭髮發展在裏面'),
    });
  expect(await getRichStructure()).toEqual(structureBeforeScript);
  await page.setViewportSize({ width: 1280, height: 500 });
  await chooseScript('简体中文');
  await expect
    .poll(getLanguageOrder)
    .toEqual([
      expect.objectContaining({ language: 'translated', text: '译文 第一章' }),
    ]);
  expect(await getRichStructure()).toEqual(structureBeforeScript);
  await chooseReadingLanguage('中日对照');
  await expect
    .poll(getLanguageOrder)
    .toEqual([
      expect.objectContaining({ language: 'translated', text: '译文 第一章' }),
      expect.objectContaining({ language: 'original', text: '第一章' }),
    ]);
  await chooseReadingLanguage('日中对照');
  await expect
    .poll(getLanguageOrder)
    .toEqual([
      expect.objectContaining({ language: 'original', text: '第一章' }),
      expect.objectContaining({ language: 'translated', text: '译文 第一章' }),
    ]);
  await chooseReadingLanguage('原文（日文）');
  await expect
    .poll(getLanguageOrder)
    .toEqual([
      expect.objectContaining({ language: 'original', text: '第一章' }),
    ]);

  const externalLink = page.getByRole('link', { name: '外部网站' });
  await expect(externalLink).toHaveAttribute('target', '_blank');
  await expect(externalLink).toHaveAttribute('rel', 'noopener noreferrer');
  await page.getByRole('link', { name: '参见附录' }).click();
  await page.waitForFunction(
    () =>
      new URL(location.href).searchParams.get('epub') ===
      'OPS/Text/notes.xhtml#note-1',
  );
  await expect(page.getByText('附录内容')).toBeVisible();

  await page.getByRole('link', { name: '返回正文' }).click();
  await page.waitForFunction(
    () =>
      new URL(location.href).searchParams.get('epub') ===
      'OPS/Text/chapter one.xhtml#start',
  );
  await expect(page.getByRole('heading', { name: '第一章' })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '目录', exact: true }).click();
  const catalog = page.getByRole('dialog', { name: '目录' });
  await expect(catalog.getByText('第一卷', { exact: true })).toBeVisible();
  await expect(catalog.getByText('第一篇', { exact: true })).toHaveCount(0);
  await expect(catalog.getByText('第一章', { exact: true })).toHaveCount(0);
  await catalog.getByRole('button', { name: '第一卷' }).click();
  await expect(catalog).toBeVisible();
  expect(new URL(page.url()).searchParams.get('epub')).toBe(
    'OPS/Text/chapter one.xhtml#start',
  );
  await expect(catalog.getByText('第一篇', { exact: true })).toBeVisible();
  await expect(catalog.getByText('第一章', { exact: true })).toHaveCount(0);
  await catalog.getByRole('button', { name: '第一篇' }).click();
  await expect(catalog.getByText('第一章', { exact: true })).toBeVisible();
  await catalog.getByRole('button', { name: '第一卷' }).click();
  await expect(catalog.getByText('第一篇', { exact: true })).toHaveCount(0);
  await expect(catalog.getByText('第一章', { exact: true })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('epub')).toBe(
    'OPS/Text/chapter one.xhtml#start',
  );
  await catalog.getByRole('button', { name: '第一卷' }).click();
  await expect(catalog.getByText('第一章', { exact: true })).toBeVisible();
  await catalog.getByRole('button', { name: /第一章/ }).click();
  await expect(catalog).toHaveCount(0);
  await page.waitForFunction(
    () =>
      new URL(location.href).searchParams.get('epub') ===
      'OPS/Text/chapter one.xhtml#start',
  );
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await catalog.getByRole('button', { name: /附录/ }).click();
  await expect(catalog).toHaveCount(0);
  await page.waitForFunction(
    () =>
      new URL(location.href).searchParams.get('epub') ===
      'OPS/Text/notes.xhtml#note-1',
  );
  await expect(page.getByText('附录内容')).toBeVisible();
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await catalog.getByRole('button', { name: /固定版式/ }).click();
  await expect(catalog).toHaveCount(0);
  const fixedHost = page
    .locator('[data-reader-epub-host]')
    .filter({ hasText: '固定版式页面' });
  await expect
    .poll(() =>
      fixedHost.evaluate((host) => ({
        height: Number.parseFloat(host.style.height),
        transform: (
          host.shadowRoot?.querySelector('.epub-document') as HTMLElement | null
        )?.style.transform,
      })),
    )
    .toMatchObject({
      height: expect.any(Number),
      transform: expect.stringMatching(/^scale\(/),
    });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.reload();
  await expect(
    page.locator('[data-reader-epub-host]').filter({ hasText: '固定版式页面' }),
  ).toBeVisible();
});
