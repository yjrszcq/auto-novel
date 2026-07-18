import { expect, test } from '@playwright/test';
import { BlobReader, BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';

const createToolboxEpub = async (cover: Buffer) => {
  const output = new BlobWriter('application/epub+zip');
  const writer = new ZipWriter(output);
  await writer.add('mimetype', new TextReader('application/epub+zip'), {
    level: 0,
  });
  await writer.add(
    'META-INF/container.xml',
    new TextReader(`<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`),
  );
  await writer.add(
    'OEBPS/content.opf',
    new TextReader(`<?xml version="1.0" encoding="utf-8"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">toolbox-image</dc:identifier>
    <dc:title>工具箱图片测试</dc:title>
    <dc:language>ja</dc:language>
  </metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/>
  </manifest>
  <spine><itemref idref="chapter"/></spine>
</package>`),
  );
  await writer.add(
    'OEBPS/chapter.xhtml',
    new TextReader(`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title></head>
<body><h1>第一章</h1><p>工具箱正文</p></body></html>`),
  );
  await writer.add(
    'OEBPS/cover.png',
    new BlobReader(new Blob([cover], { type: 'image/png' })),
  );
  await writer.close();
  return Buffer.from(await (await output.getData()).arrayBuffer());
};

test('previews compressed EPUB images without leaving the viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/workspace/toolbox');
  await expect(
    page.getByRole('heading', { name: '小说工具箱', exact: true }),
  ).toBeVisible();
  const cover = Buffer.from(
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 480;
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('测试浏览器无法创建画布');
      context.fillStyle = '#5eddb8';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#202124';
      context.beginPath();
      context.arc(160, 200, 80, 0, Math.PI * 2);
      context.fill();
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) =>
            value === null
              ? reject(new Error('测试浏览器无法编码 PNG'))
              : resolve(value),
          'image/png',
        ),
      );
      return [...new Uint8Array(await blob.arrayBuffer())];
    }),
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: 'toolbox-image.epub',
    mimeType: 'application/epub+zip',
    buffer: await createToolboxEpub(cover),
  });
  await page.getByText('EPUB：压缩图片', { exact: true }).click();
  await page.getByText('PNG', { exact: true }).click();
  await expect(
    page.getByRole('radio', { name: 'PNG', exact: true }),
  ).toBeChecked();
  await page.evaluate(() => {
    const created: string[] = [];
    const revoked: string[] = [];
    const createObjectURL = URL.createObjectURL.bind(URL);
    const revokeObjectURL = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (object) => {
      const value = createObjectURL(object);
      created.push(value);
      return value;
    };
    URL.revokeObjectURL = (value) => {
      revoked.push(value);
      revokeObjectURL(value);
    };
    (
      window as typeof window & {
        toolboxObjectUrls: { created: string[]; revoked: string[] };
      }
    ).toolboxObjectUrls = { created, revoked };
  });
  await page.getByRole('button', { name: '预览效果', exact: true }).click();
  const thumbnail = page.locator('.n-image img').first();
  const previewError = page.locator('.n-message');
  if (await previewError.isVisible()) {
    throw new Error(await previewError.innerText());
  }
  await expect(thumbnail).toBeVisible();
  await thumbnail.click();

  const comparison = page.locator('img-comparison-slider');
  await expect(comparison).toBeVisible();
  await expect(comparison.locator('img[slot="first"]')).toHaveAttribute(
    'alt',
    '压缩前',
  );
  await expect(comparison.locator('img[slot="second"]')).toHaveAttribute(
    'alt',
    '压缩后',
  );

  const expectInsideViewport = async () => {
    const bounds = await comparison.boundingBox();
    const viewport = page.viewportSize();
    if (bounds === null || viewport === null) {
      throw new Error('缺少图片比较弹窗或视口');
    }
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
  };
  await expectInsideViewport();

  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await thumbnail.click();
  await expect(comparison).toBeVisible();
  await expectInsideViewport();

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '预览效果', exact: true }).click();
  const urlLifecycle = await page.evaluate(
    () =>
      (
        window as typeof window & {
          toolboxObjectUrls: { created: string[]; revoked: string[] };
        }
      ).toolboxObjectUrls,
  );
  expect(urlLifecycle.created.length).toBeGreaterThan(0);
  expect(urlLifecycle.revoked).toEqual(
    expect.arrayContaining(urlLifecycle.created),
  );
});
