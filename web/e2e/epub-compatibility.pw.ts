import { expect, test } from '@playwright/test';
import {
  BlobReader,
  BlobWriter,
  TextReader,
  TextWriter,
  ZipReader,
  ZipWriter,
} from '@zip.js/zip.js';
import type { Page } from '@playwright/test';
import type { Epub as ParsedEpub } from '../src/util/file/epub';

const createEpub = async (entries: Record<string, string>) => {
  const output = new BlobWriter('application/epub+zip');
  const writer = new ZipWriter(output);
  for (const [path, content] of Object.entries(entries)) {
    await writer.add(path, new TextReader(content));
  }
  await writer.close();
  return Buffer.from(await (await output.getData()).arrayBuffer());
};

const container = `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles><rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

const upload = async (
  page: Page,
  name: string,
  entries: Record<string, string>,
) => {
  await page.goto('/');
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name,
      mimeType: 'application/epub+zip',
      buffer: await createEpub(entries),
    });
};

test('imports EPUB 2 HTML and NCX through manifest fallbacks', async ({
  page,
}) => {
  await upload(page, 'legacy.epub', {
    'META-INF/container.xml': container,
    'OPS/content.opf': `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>旧版兼容测试</dc:title><dc:language>ja</dc:language>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="preferred" href="chapter.bin" media-type="application/x-custom" fallback="chapter"/>
    <item id="chapter" href="Text/chapter.html" media-type="text/html"/>
    <item id="optional" href="Images/optional.png" media-type="image/png"/>
  </manifest>
  <spine toc="ncx"><itemref idref="preferred"/></spine>
</package>`,
    'OPS/toc.ncx': `<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>
  <navPoint id="volume"><navLabel><text>第一卷</text></navLabel><content src="Text/chapter.html"/>
    <navPoint id="chapter"><navLabel><text>第一章</text></navLabel><content src="Text/chapter.html#start"/></navPoint>
  </navPoint>
</navMap></ncx>`,
    'OPS/Text/chapter.html': `<!doctype html><html><head><title>第一章</title>
<style>body { writing-mode: vertical-rl; }</style></head>
<body><h1 id="start">第一章</h1><p>兼容正文</p></body></html>`,
  });

  await expect(
    page.getByRole('heading', { name: '旧版兼容测试' }),
  ).toBeVisible();
  const imported = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('volumes');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = database.transaction(['metadata', 'chapter']);
    const getAll = <T>(store: string) =>
      new Promise<T[]>((resolve, reject) => {
        const request = transaction.objectStore(store).getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
    const [metadata, chapters] = await Promise.all([
      getAll<{
        navigation: Array<{ title: string; href: string }>;
        importDiagnostics: Array<{ code: string; path: string }>;
      }>('metadata'),
      getAll<{ paragraphs: string[] }>('chapter'),
    ]);
    database.close();
    return { metadata: metadata[0], chapters };
  });
  expect(imported.metadata?.navigation).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        title: '第一章',
        href: 'OPS/Text/chapter.html#start',
      }),
    ]),
  );
  expect(imported.metadata?.importDiagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: 'missing-resource',
        path: 'OPS/chapter.bin',
      }),
      expect.objectContaining({
        code: 'missing-resource',
        path: 'OPS/Images/optional.png',
      }),
    ]),
  );
  expect(imported.chapters[0]?.paragraphs).toEqual(['第一章', '兼容正文']);

  const exportedBytes = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('volumes');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const storedFile = await new Promise<{ file: File }>((resolve, reject) => {
      const request = database
        .transaction('file', 'readonly')
        .objectStore('file')
        .get('legacy.epub');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    database.close();
    const dynamicImport = (path: string) => import(/* @vite-ignore */ path);
    const { Epub } = (await dynamicImport('/src/util/file/epub.ts')) as {
      Epub: { fromFile(file: File): Promise<ParsedEpub> };
    };
    const epub = await Epub.fromFile(storedFile.file);
    epub.updateNavigationTitles(['译题：第一卷', '译题：第一章']);
    return [...new Uint8Array(await (await epub.toBlob()).arrayBuffer())];
  });
  const exported = new ZipReader(
    new BlobReader(new Blob([Uint8Array.from(exportedBytes)])),
  );
  const entries = await exported.getEntries();
  const ncx = entries.find((entry) => entry.filename === 'OPS/toc.ncx');
  expect(ncx?.getData).toBeDefined();
  const ncxText = await ncx!.getData!(new TextWriter());
  await exported.close();
  expect(ncxText).toContain('译题：第一卷');
  expect(ncxText).toContain('译题：第一章');
});

test('recovers malformed XHTML and reports the fallback', async ({ page }) => {
  await upload(page, 'recover.epub', {
    'META-INF/container.xml': container,
    'OPS/content.opf': `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>恢复测试</dc:title></metadata>
  <manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="chapter"/></spine>
</package>`,
    'OPS/chapter.xhtml':
      '<html><head><title>恢复章节</title></head><body><p>未闭合正文</body></html>',
  });

  await expect(page.getByRole('heading', { name: '恢复测试' })).toBeVisible();
  await expect(page.getByText(/应用 2 项兼容处理/)).toBeVisible();
});

test('rejects encrypted reading content with a clear upload error', async ({
  page,
}) => {
  await upload(page, 'encrypted.epub', {
    'META-INF/container.xml': container,
    'META-INF/encryption.xml': `<?xml version="1.0"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
  <enc:EncryptedData><enc:EncryptionMethod Algorithm="urn:vendor:drm"/>
    <enc:CipherData><enc:CipherReference URI="OPS/chapter.xhtml"/></enc:CipherData>
  </enc:EncryptedData>
</encryption>`,
    'OPS/content.opf': `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>加密测试</dc:title></metadata>
  <manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="chapter"/></spine>
</package>`,
    'OPS/chapter.xhtml':
      '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>受保护正文</p></body></html>',
  });

  await expect(
    page.getByText(/此 EPUB 包含不支持的受保护内容：OPS\/chapter.xhtml/),
  ).toBeVisible();
});

test('reports malformed required package data without creating a book', async ({
  page,
}) => {
  await upload(page, 'malformed.epub', {
    'META-INF/container.xml': container,
    'OPS/content.opf': `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>损坏测试</dc:title></metadata>
  <manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
</package>`,
    'OPS/chapter.xhtml':
      '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>正文</p></body></html>',
  });

  await expect(page.getByText(/EPUB 包文档缺少 spine/)).toBeVisible();
  await expect(page.getByRole('heading', { name: '损坏测试' })).toHaveCount(0);
});
