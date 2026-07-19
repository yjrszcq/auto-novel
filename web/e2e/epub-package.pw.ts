import { expect, test } from '@playwright/test';
import { BlobReader, BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';

import type { Epub as ParsedEpub } from '../src/util/file/epub';
import type { createEpubRichChapter as CreateEpubRichChapter } from '../src/stores/local/EpubRichChapter';

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
    <item id="chapter" href="Text/chapter%20one.xhtml" media-type="application/xhtml+xml"/>
    <item id="notes" href="Text/notes.xhtml" media-type="application/xhtml+xml"/>
    <item id="style" href="Styles/book.css" media-type="text/css"/>
    <item id="cover" href="Images/cover%20art.svg" media-type="image/svg+xml" properties="cover-image"/>
    <item id="font" href="Fonts/reader.woff2" media-type="font/woff2"/>
    <item id="audio" href="Media/sample.mp3" media-type="audio/mpeg"/>
  </manifest>
  <spine>
    <itemref idref="cover-page" linear="no"/>
    <itemref idref="chapter"/>
  </spine>
</package>`),
  );
  await writer.add(
    'OPS/nav/toc.xhtml',
    new TextReader(`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>目录</title></head><body>
<nav epub:type="toc"><h1>目录</h1><ol>
  <li><a href="../Text/cover.xhtml">封面</a></li>
  <li><span>第一卷</span><ol>
    <li><a href="../Text/chapter%20one.xhtml#start">第一章</a></li>
  </ol></li>
  <li><a href="../Text/notes.xhtml#note-1">附录</a></li>
</ol></nav>
</body></html>`),
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
<section id="start"><h1 class="chapter-title" style="break-before: page">第一章</h1><p>第一段</p>
<ul><li>第一项</li><li>第二项 <ruby>字<rt>じ</rt></ruby></li></ul>
<table><tbody><tr><td>单元格</td></tr></tbody></table>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>
<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math><audio src="../Media/sample.mp3" controls="controls"/></section>
</body></html>`),
  );
  await writer.add(
    'OPS/Text/notes.xhtml',
    new TextReader(`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>附录</title></head>
<body><aside id="note-1"><p>附录内容</p></aside></body></html>`),
  );
  await writer.add(
    'OPS/Styles/book.css',
    new TextReader(`@font-face { font-family: Fixture; src: url('../Fonts/reader.woff2'); }
body { font-family: Fixture; }`),
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
      const request = indexedDB.open('volumes', 5);
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
      sourceFormat: metadata.sourceFormat,
      fileSize: storedFile.file.size,
    };
  });

  expect(imported.sourceFormat).toBe('epub');
  expect(imported.fileSize).toBeGreaterThan(0);
  expect(imported.navigation).toEqual([
    expect.objectContaining({ title: '封面', level: 0 }),
    expect.objectContaining({ title: '第一卷', level: 0 }),
    expect.objectContaining({
      title: '第一章',
      level: 1,
      href: 'OPS/Text/chapter one.xhtml#start',
    }),
    expect.objectContaining({
      title: '附录',
      level: 0,
      href: 'OPS/Text/notes.xhtml#note-1',
    }),
  ]);

  const richProjection = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('volumes', 5);
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
  expect(chapter?.paragraphs).toEqual([
    '第一章',
    '第一段',
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
});
