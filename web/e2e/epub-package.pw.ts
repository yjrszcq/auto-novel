import { expect, test } from '@playwright/test';
import { BlobReader, BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';

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
<section id="start"><h1>第一章</h1><p>第一段</p><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>
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
});
