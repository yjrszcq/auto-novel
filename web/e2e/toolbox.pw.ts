import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
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
    <dc:description>用于转换预览的书籍简介</dc:description>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="empty" href="empty.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/>
    <item id="illustration" href="illustration.png" media-type="image/png"/>
  </manifest>
  <spine><itemref idref="chapter"/><itemref idref="empty"/></spine>
</package>`),
  );
  await writer.add(
    'OEBPS/nav.xhtml',
    new TextReader(`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>目录</title></head><body><nav epub:type="toc"><ol>
    <li><span>第一卷</span><ol>
      <li><a href="chapter.xhtml">第一章</a></li>
      <li><a href="empty.xhtml">空章节</a></li>
    </ol></li>
  </ol></nav></body>
</html>`),
  );
  await writer.add(
    'OEBPS/chapter.xhtml',
    new TextReader(`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title></head>
<body><h1>第一章</h1><p>工具箱正文</p></body></html>`),
  );
  await writer.add(
    'OEBPS/empty.xhtml',
    new TextReader(`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>空章节</title></head><body></body></html>`),
  );
  await writer.add(
    'OEBPS/cover.png',
    new BlobReader(new Blob([cover], { type: 'image/png' })),
  );
  await writer.add(
    'OEBPS/illustration.png',
    new BlobReader(new Blob([cover], { type: 'image/png' })),
  );
  await writer.close();
  return Buffer.from(await (await output.getData()).arrayBuffer());
};

const createPngCover = async (page: Page) =>
  Buffer.from(
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

test('previews compressed EPUB images without leaving the viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/workspace/toolbox');
  await expect(
    page.getByRole('heading', { name: '小说工具箱', exact: true }),
  ).toBeVisible();
  const cover = await createPngCover(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: 'toolbox-image.epub',
    mimeType: 'application/epub+zip',
    buffer: await createToolboxEpub(cover),
  });
  const sourceSection = page.locator('.toolbox-file-section').filter({
    has: page.getByRole('heading', { name: '源文件', exact: true }),
  });
  await expect(sourceSection).toContainText('已选择 1/1');
  await expect(sourceSection).toContainText('toolbox-image.epub');
  await expect(sourceSection).toContainText('EPUB');
  await expect(sourceSection).toContainText('源文件');
  await expect(sourceSection).not.toContainText('计算中');
  await expect(
    page.getByRole('checkbox', { name: '选择 toolbox-image.epub' }),
  ).toBeChecked();

  await page.getByRole('button', { name: '预览 toolbox-image.epub' }).click();
  await expect(page.getByText('工具箱正文')).toBeVisible();
  await page.keyboard.press('Escape');

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

  let downloadCount = 0;
  page.on('download', () => {
    downloadCount += 1;
  });
  await page.getByRole('button', { name: '压缩', exact: true }).click();
  const operation = page.locator('.toolbox-operation');
  await expect(operation).toContainText('压缩图片');
  await expect(operation).toContainText('已完成 1/1');
  const resultSection = page.locator('.toolbox-file-section').filter({
    has: page.getByRole('heading', { name: '处理结果', exact: true }),
  });
  await expect(resultSection).toContainText('toolbox-image.epub');
  await expect(resultSection).toContainText('处理结果');
  const resultBounds = await resultSection.boundingBox();
  expect(resultBounds).not.toBeNull();
  expect(resultBounds!.x).toBeGreaterThanOrEqual(0);
  expect(resultBounds!.x + resultBounds!.width).toBeLessThanOrEqual(390);
  expect(downloadCount).toBe(0);

  const explicitDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载所选', exact: true }).click();
  expect((await explicitDownload).suggestedFilename()).toBe(
    'toolbox-image.epub',
  );
  expect(downloadCount).toBe(1);

  await page.getByRole('button', { name: '移除所选', exact: true }).click();
  await expect(resultSection).toHaveCount(0);

  await page.getByRole('button', { name: '压缩', exact: true }).click();
  await expect(resultSection).toBeVisible();
  await page.getByRole('button', { name: '替换源文件', exact: true }).click();
  await expect(resultSection).toHaveCount(0);
  expect(downloadCount).toBe(1);
  const operationBounds = await operation.boundingBox();
  expect(operationBounds).not.toBeNull();
  expect(operationBounds!.x).toBeGreaterThanOrEqual(0);
  expect(operationBounds!.x + operationBounds!.width).toBeLessThanOrEqual(390);

  await page.getByRole('button', { name: '清空选择', exact: true }).click();
  await expect(sourceSection).toContainText('已选择 0/1');
  await page.getByText('TXT：修复OCR换行', { exact: true }).click();
  await expect(page.getByText('当前选择中没有 TXT 文件。')).toBeVisible();
});

test('releases completed image previews when a later image fails', async ({
  page,
}) => {
  await page.goto('/workspace/toolbox');
  const cover = await createPngCover(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: 'toolbox-preview-failure.epub',
    mimeType: 'application/epub+zip',
    buffer: await createToolboxEpub(cover),
  });
  await page.getByText('EPUB：压缩图片', { exact: true }).click();
  await page.getByText('PNG', { exact: true }).click();
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
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    let encodeCount = 0;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      encodeCount += 1;
      if (encodeCount === 2) {
        callback(null);
        return;
      }
      toBlob.call(this, callback, type, quality);
    };
    (
      window as typeof window & {
        toolboxObjectUrls: { created: string[]; revoked: string[] };
      }
    ).toolboxObjectUrls = { created, revoked };
  });

  await page.getByRole('button', { name: '预览效果', exact: true }).click();
  await expect(page.locator('.n-message')).toContainText('预览失败');
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
  await expect(page.locator('.n-image img')).toHaveCount(0);
});

test('reviews OCR changes before generating a result', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/workspace/toolbox');
  let downloadCount = 0;
  page.on('download', () => {
    downloadCount += 1;
  });
  await page.locator('input[type="file"]').setInputFiles({
    name: 'ocr-review.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      '第一行没有句号\n继续这一段\n最后结束。\n\n# 标题\n保留正文。',
    ),
  });
  await page.getByText('TXT：修复OCR换行', { exact: true }).click();

  const resultSection = page.locator('.toolbox-file-section').filter({
    has: page.getByRole('heading', { name: '处理结果', exact: true }),
  });
  await expect(resultSection).toHaveCount(0);
  await page.getByRole('button', { name: '分析变更', exact: true }).click();
  await expect(
    page.getByText('预计修改 1 处，涉及 1 个文件', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.ocr-change__before')).toContainText(
    '第一行没有句号',
  );
  await expect(page.locator('.ocr-change__after')).toContainText(
    '第一行没有句号继续这一段最后结束。',
  );
  const analysisBounds = await page.locator('.ocr-analysis').boundingBox();
  expect(analysisBounds).not.toBeNull();
  expect(analysisBounds!.x).toBeGreaterThanOrEqual(0);
  expect(analysisBounds!.x + analysisBounds!.width).toBeLessThanOrEqual(390);
  expect(downloadCount).toBe(0);

  await page.getByRole('button', { name: '确认生成', exact: true }).click();
  await expect(resultSection).toBeVisible();
  expect(downloadCount).toBe(0);
  await resultSection
    .getByRole('button', { name: '预览 ocr-review.txt' })
    .click();
  await expect(page.locator('.toolbox-file-card__preview')).toContainText(
    '第一行没有句号继续这一段最后结束。',
  );
});

test('manages and exports normalized glossary candidates', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/workspace/toolbox');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'glossary.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('カタカナ ｶﾀｶﾅ ベータ ベータ ガンマ ガンマ アルファ'),
  });

  const threshold = page.locator('.n-input-number input');
  await threshold.fill('2');
  await threshold.press('Enter');
  await expect(page.getByText('候选 3 个 / 当前显示 3 个')).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'カタカナ', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'ベータ', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'ガンマ', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'アルファ', exact: true }),
  ).toHaveCount(0);

  const search = page.getByPlaceholder('搜索候选词');
  await search.fill('カタ');
  await expect(page.getByText('候选 3 个 / 当前显示 1 个')).toBeVisible();
  await search.fill('');

  const katakanaRow = page.getByRole('row').filter({ hasText: 'カタカナ' });
  await katakanaRow.getByPlaceholder('请输入中文翻译').fill('片假名');
  await expect(katakanaRow.getByText('手工', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: '选择 カタカナ' }).check();
  await page.getByRole('button', { name: '移除所选', exact: true }).click();
  await expect(
    page.getByRole('cell', { name: 'カタカナ', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: '撤销删除', exact: true }).click();
  await expect(
    page.getByRole('cell', { name: 'カタカナ', exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('row')
      .filter({ hasText: 'カタカナ' })
      .getByPlaceholder('请输入中文翻译'),
  ).toHaveValue('片假名');

  const corsHeaders = {
    'access-control-allow-origin': 'http://127.0.0.1:4173',
    'access-control-allow-credentials': 'true',
  };
  await page.route('https://fanyi.baidu.com/sug', (route) =>
    route.fulfill({ status: 200, headers: corsHeaders, body: '{}' }),
  );
  await page.route(
    'https://fanyi.baidu.com/ait/text/translate',
    async (route) => {
      const query = route.request().postDataJSON()?.query as string;
      if (query.includes('\n') || query === 'ベータ') {
        await route.fulfill({
          status: 500,
          headers: corsHeaders,
          body: 'failed',
        });
        return;
      }
      const event = {
        errno: 0,
        errmsg: '',
        data: {
          event: 'Translating',
          message: '',
          list: [
            {
              id: '1',
              paraIdx: 0,
              src: query,
              dst: query === 'ガンマ' ? '伽马' : `译-${query}`,
              metadata: '',
            },
          ],
        },
      };
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders, 'content-type': 'text/event-stream' },
        body: `data: ${JSON.stringify(event)}\n\n`,
      });
    },
  );
  await page.getByRole('button', { name: '百度翻译', exact: true }).click();
  await expect(
    page.getByText('部分词语翻译失败，成功结果和手工编辑已保留'),
  ).toBeVisible();
  await expect(
    page.getByRole('row').filter({ hasText: 'ベータ' }).getByText('失败'),
  ).toBeVisible();
  await expect(
    page
      .getByRole('row')
      .filter({ hasText: 'ガンマ' })
      .getByPlaceholder('请输入中文翻译'),
  ).toHaveValue('伽马');
  await expect(
    page
      .getByRole('row')
      .filter({ hasText: 'カタカナ' })
      .getByPlaceholder('请输入中文翻译'),
  ).toHaveValue('片假名');

  const tableBounds = await page.locator('.glossary-table').boundingBox();
  expect(tableBounds).not.toBeNull();
  expect(tableBounds!.x).toBeGreaterThanOrEqual(0);
  expect(tableBounds!.x + tableBounds!.width).toBeLessThanOrEqual(390);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载术语表', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('工具箱术语表.txt');
});

test('previews EPUB conversion options before generating TXT', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/workspace/toolbox');
  const cover = await createPngCover(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: 'toolbox-image.epub',
    mimeType: 'application/epub+zip',
    buffer: await createToolboxEpub(cover),
  });
  await page.getByText('EPUB：转换成TXT', { exact: true }).click();
  let downloadCount = 0;
  page.on('download', () => {
    downloadCount += 1;
  });

  const resultSection = page.locator('.toolbox-file-section').filter({
    has: page.getByRole('heading', { name: '处理结果', exact: true }),
  });
  await expect(resultSection).toHaveCount(0);
  await page.getByRole('button', { name: '预览转换', exact: true }).click();
  const conversionPreview = page.locator('.conversion-preview');
  await expect(conversionPreview).toContainText('空章节：空章节');
  await expect(page.locator('.conversion-preview__text')).toContainText(
    '# 第一卷',
  );
  await expect(page.locator('.conversion-preview__text')).toContainText(
    '## 第一章',
  );
  await expect(page.locator('.conversion-preview__text')).not.toContainText(
    '用于转换预览的书籍简介',
  );

  await page.getByRole('checkbox', { name: '书籍简介' }).check();
  await expect(conversionPreview).toHaveCount(0);
  await page.getByRole('checkbox', { name: '章节标题' }).uncheck();
  await page.getByRole('button', { name: '预览转换', exact: true }).click();
  await expect(page.locator('.conversion-preview__text')).toContainText(
    '用于转换预览的书籍简介',
  );
  await expect(page.locator('.conversion-preview__text')).not.toContainText(
    '## 第一章',
  );
  const previewBounds = await conversionPreview.boundingBox();
  expect(previewBounds).not.toBeNull();
  expect(previewBounds!.x).toBeGreaterThanOrEqual(0);
  expect(previewBounds!.x + previewBounds!.width).toBeLessThanOrEqual(390);
  expect(downloadCount).toBe(0);

  await page.getByRole('button', { name: '确认生成', exact: true }).click();
  await expect(resultSection).toContainText('toolbox-image.txt');
  expect(downloadCount).toBe(0);
  await resultSection
    .getByRole('button', { name: '预览 toolbox-image.txt' })
    .click();
  await expect(page.locator('.toolbox-file-card__preview')).toContainText(
    '用于转换预览的书籍简介',
  );
  await expect(page.locator('.toolbox-file-card__preview')).not.toContainText(
    '## 第一章',
  );
});
