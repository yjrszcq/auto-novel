import { expect, test, type Download, type Page } from '@playwright/test';
import {
  BlobReader,
  BlobWriter,
  TextReader,
  TextWriter,
  ZipReader,
  ZipWriter,
} from '@zip.js/zip.js';

const alphaFilename = 'Alpha Upload.txt';
const betaFilename = 'Beta Upload.txt';
const alphaText = Array.from(
  { length: 1001 },
  (_, index) => `Alpha line ${index + 1}`,
).join('\n');

const confirmTxtPreview = async (page: Page, filename: string) => {
  const preview = page.getByRole('dialog', { name: 'TXT 目录预览' });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText(filename);
  await preview
    .getByRole('button', { name: '确认目录并导入', exact: true })
    .click();
};

const uploadBooks = async (page: Page) => {
  const uploadInput = page.locator('input[type="file"]').first();
  await uploadInput.setInputFiles([
    {
      name: alphaFilename,
      mimeType: 'text/plain',
      buffer: Buffer.from(alphaText),
    },
    {
      name: betaFilename,
      mimeType: 'text/plain',
      buffer: Buffer.from('Beta line 1\nBeta line 2'),
    },
  ]);
  await confirmTxtPreview(page, alphaFilename);
  await confirmTxtPreview(page, betaFilename);
};

test('reviews queued TXT catalogs without overflowing a mobile viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles([
      {
        name: 'Review One.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('plain line\nbody\nlast line'),
      },
      {
        name: 'Review Two.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(
          Array.from(
            { length: 500 },
            (_, index) => `Chapter ${index + 1} Title\nbody ${index + 1}`,
          ).join('\n'),
        ),
      },
    ]);

  const preview = page.getByRole('dialog', { name: 'TXT 目录预览' });
  await expect(preview).toContainText('Review One.txt');
  const bounds = await preview.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  expect(await preview.locator('.txt-source-line').count()).toBeLessThanOrEqual(
    120,
  );
  await preview.locator('.txt-source-line').first().locator('button').click();
  await expect(preview.locator('.txt-heading-row')).toHaveCount(1);

  await preview.getByRole('button', { name: '严格', exact: true }).click();
  await page
    .locator('.n-popover')
    .getByRole('button', { name: '重新解析', exact: true })
    .click();
  await expect(preview.locator('.txt-heading-row')).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      localStorage.getItem('auto-novel:txt-parse-mode'),
    ),
  ).toBe('strict');

  await preview.getByRole('button', { name: '跳过此书', exact: true }).click();
  await expect(preview).toContainText('Review Two.txt');
  await expect(preview.locator('.txt-heading-row')).not.toHaveCount(0);
  expect(await preview.locator('.txt-heading-row').count()).toBeLessThanOrEqual(
    80,
  );
  await preview.getByRole('button', { name: '取消批次', exact: true }).click();
  await expect(preview).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Review One' })).toHaveCount(
    0,
  );
  await expect(page.getByRole('heading', { name: 'Review Two' })).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

const epubFilename = 'Presentation Lifecycle.epub';
const sourceCover = Uint8Array.from([1, 2, 3, 4]);
const customCover = Uint8Array.from([5, 6, 7, 8]);
const linkedCover = Uint8Array.from([9, 10, 11, 12]);

const createMinimalEpub = async () => {
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
    <dc:identifier id="book-id">presentation-lifecycle</dc:identifier>
    <dc:title>原始 EPUB 标题</dc:title>
    <dc:creator>原始作者</dc:creator>
    <dc:description>原始简介</dc:description>
    <dc:language>ja</dc:language>
  </metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image"/>
    <item id="style" href="styles/book.css" media-type="text/css"/>
  </manifest>
  <spine><itemref idref="chapter"/></spine>
</package>`),
  );
  await writer.add(
    'OEBPS/chapter.xhtml',
    new TextReader(`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title>
<link rel="stylesheet" href="styles/book.css"/></head>
<body><h1>第一章</h1><img src="images/cover.png" alt="章节插图"/><p>原文段落</p></body></html>`),
  );
  await writer.add(
    'OEBPS/styles/book.css',
    new TextReader('body { writing-mode: vertical-rl; color: navy; }'),
  );
  await writer.add(
    'OEBPS/images/cover.png',
    new BlobReader(new Blob([sourceCover], { type: 'image/png' })),
  );
  await writer.close();
  return Buffer.from(await (await output.getData()).arrayBuffer());
};

const readDownload = async (download: Download) => {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};

const listArchiveEntries = async (buffer: Buffer) => {
  const reader = new ZipReader(
    new BlobReader(new Blob([Uint8Array.from(buffer)])),
  );
  try {
    return (await reader.getEntries()).map((entry) => entry.filename).sort();
  } finally {
    await reader.close();
  }
};

const inspectEpub = async (buffer: Buffer) => {
  const reader = new ZipReader(
    new BlobReader(new Blob([Uint8Array.from(buffer)])),
  );
  try {
    const entries = new Map(
      (await reader.getEntries()).map((entry) => [entry.filename, entry]),
    );
    const packageXml = await entries.get('OEBPS/content.opf')!.getData!(
      new TextWriter(),
    );
    const chapterXml = await entries.get('OEBPS/chapter.xhtml')!.getData!(
      new TextWriter(),
    );
    const cover = await entries.get('OEBPS/images/cover.png')!.getData!(
      new BlobWriter(),
    );
    const style = await entries.get('OEBPS/styles/book.css')!.getData!(
      new TextWriter(),
    );
    return {
      packageXml,
      chapterXml,
      style,
      cover: Buffer.from(await cover.arrayBuffer()),
    };
  } finally {
    await reader.close();
  }
};

test('imports and persists the complete bookshelf listing lifecycle', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '轻小说机翻机器人' }),
  ).toBeVisible();
  const emptyBookshelf = page.locator('.bookshelf-empty-state');
  await expect(emptyBookshelf).toContainText('还没有本地书籍');
  const emptyBookshelfLayout = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>(
      '.bookshelf-page__header',
    );
    const icon = document.querySelector<HTMLElement>(
      '.bookshelf-empty-state .n-empty__icon',
    );
    const addButton = document.querySelector<HTMLElement>(
      '.bookshelf-empty-state button',
    );
    if (header === null || icon === null || addButton === null) {
      throw new Error('缺少空书架布局元素');
    }
    const buttonBounds = addButton.getBoundingClientRect();
    return {
      buttonBorderRadius: Number.parseFloat(
        getComputedStyle(addButton).borderRadius,
      ),
      buttonHeight: buttonBounds.height,
      iconGap:
        icon.getBoundingClientRect().top -
        header.getBoundingClientRect().bottom,
    };
  });
  expect(emptyBookshelfLayout.iconGap).toBeGreaterThanOrEqual(50);
  expect(emptyBookshelfLayout.buttonBorderRadius).toBeLessThan(
    emptyBookshelfLayout.buttonHeight / 2 - 1,
  );
  await expect(page.locator('.drop-zone-wrap')).toHaveCount(1);
  await page.evaluate(() => {
    document.dispatchEvent(
      new DragEvent('dragenter', { bubbles: true, cancelable: true }),
    );
  });
  await expect(page.locator('.drop-zone-wrap')).toBeVisible();
  await page.evaluate(() => {
    document.dispatchEvent(
      new DragEvent('dragleave', {
        bubbles: true,
        cancelable: true,
        relatedTarget: null,
      }),
    );
  });
  await expect(page.locator('.drop-zone-wrap')).toBeHidden();
  const emptyStateDesktopViewport = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileEmptyIconGap = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>(
      '.bookshelf-page__header',
    );
    const icon = document.querySelector<HTMLElement>(
      '.bookshelf-empty-state .n-empty__icon',
    );
    if (header === null || icon === null) {
      throw new Error('缺少手机版空书架布局元素');
    }
    return (
      icon.getBoundingClientRect().top - header.getBoundingClientRect().bottom
    );
  });
  expect(mobileEmptyIconGap).toBeGreaterThanOrEqual(50);
  if (emptyStateDesktopViewport !== null) {
    await page.setViewportSize(emptyStateDesktopViewport);
  }
  await expect(
    page.getByText('本版本仅管理本地导入的小说', { exact: false }),
  ).toHaveCount(0);
  await uploadBooks(page);
  await expect(
    page.getByRole('heading', { name: 'Alpha Upload' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Beta Upload' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '阅读', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '刷新', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.bookshelf-header-filter')).toContainText('筛选');
  const headerActionLayout = await page
    .locator('.bookshelf-page__header-actions button')
    .evaluateAll((buttons) =>
      buttons.map((button) => {
        const bounds = button.getBoundingClientRect();
        return {
          height: Math.round(bounds.height),
          left: Math.round(bounds.left),
          right: Math.round(bounds.right),
          top: Math.round(bounds.top),
        };
      }),
    );
  expect(headerActionLayout).toHaveLength(3);
  await expect(
    page.locator('.bookshelf-page__header-actions button'),
  ).toHaveText(['筛选', '选择', '添加']);
  expect(
    new Set(headerActionLayout.map(({ left, right }) => right - left)).size,
  ).toBe(1);
  expect(new Set(headerActionLayout.map(({ height }) => height)).size).toBe(1);
  expect(new Set(headerActionLayout.map(({ top }) => top)).size).toBe(1);
  expect(
    headerActionLayout
      .slice(1)
      .every(
        ({ left }, index) =>
          left - headerActionLayout[index].right >= 0 &&
          left - headerActionLayout[index].right <= 12,
      ),
  ).toBe(true);
  const commandBarTops = await page.evaluate(() => {
    const top = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (element === null) throw new Error(`缺少首页操作控件：${selector}`);
      return Math.round(element.getBoundingClientRect().top);
    };
    return [
      top('.bookshelf-page__header-actions button'),
      top('.bookshelf-header-filter'),
      top('.bookshelf-toolbar__sort'),
    ];
  });
  expect(new Set(commandBarTops).size).toBe(1);
  const rightAlignedToolbar = await page.evaluate(() => {
    const header = document
      .querySelector<HTMLElement>('.bookshelf-page__header')
      ?.getBoundingClientRect();
    const toolbar = document
      .querySelector<HTMLElement>('.bookshelf-toolbar')
      ?.getBoundingClientRect();
    if (header === undefined || toolbar === undefined) {
      throw new Error('缺少首页书架操作栏');
    }
    return {
      headerRight: Math.round(header.right),
      toolbarRight: Math.round(toolbar.right),
      toolbarWidth: Math.round(toolbar.width),
    };
  });
  expect(rightAlignedToolbar.toolbarRight).toBe(
    rightAlignedToolbar.headerRight,
  );
  expect(rightAlignedToolbar.toolbarWidth).toBeLessThanOrEqual(286);
  const refreshWidth = await page
    .locator('.bookshelf-toolbar__refresh')
    .evaluate((button) => Math.round(button.getBoundingClientRect().width));
  expect(refreshWidth).toBe(
    headerActionLayout[0].right - headerActionLayout[0].left,
  );

  const imported = await page.evaluate(
    async ({ alphaId, betaId }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('volumes');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      const requestResult = <Value>(request: IDBRequest<Value>) =>
        new Promise<Value>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      const alphaMetadata = await requestResult(
        database.transaction('metadata').objectStore('metadata').get(alphaId),
      );
      const betaMetadata = await requestResult(
        database.transaction('metadata').objectStore('metadata').get(betaId),
      );
      const alphaChapters = await Promise.all(
        alphaMetadata.toc.map(
          (entry: { chapterId: string }) =>
            requestResult(
              database
                .transaction('chapter')
                .objectStore('chapter')
                .get(`${alphaId}/${entry.chapterId}`),
            ) as Promise<{
              paragraphs: string[];
              segmentIds: string[];
              sourceStartLine: number;
              sourceEndLine: number;
            }>,
        ),
      );
      const storedFile = await requestResult(
        database.transaction('file').objectStore('file').get(alphaId),
      );
      database.close();
      return {
        alphaMetadata,
        betaMetadata,
        alphaChapters,
        hasFile: storedFile !== undefined,
      };
    },
    { alphaId: alphaFilename, betaId: betaFilename },
  );
  expect(imported.alphaMetadata.toc).toHaveLength(2);
  expect(imported.betaMetadata.toc).toHaveLength(1);
  expect(imported.alphaMetadata.sourceBookMetadata.title).toBe('Alpha Upload');
  expect(
    imported.alphaChapters.map((chapter) => chapter.paragraphs.length),
  ).toEqual([1000, 1]);
  expect(
    imported.alphaChapters.map(({ sourceStartLine, sourceEndLine }) => [
      sourceStartLine,
      sourceEndLine,
    ]),
  ).toEqual([
    [0, 999],
    [1000, 1000],
  ]);
  expect(
    imported.alphaMetadata.toc.every(({ chapterId }: { chapterId: string }) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        chapterId,
      ),
    ),
  ).toBe(true);
  expect(
    imported.alphaChapters
      .flatMap((chapter) => chapter.segmentIds)
      .every((id) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          id,
        ),
      ),
  ).toBe(true);
  expect(imported.hasFile).toBe(true);
  const alphaFirstChapterId = imported.alphaMetadata.toc[0].chapterId;

  const contextAlphaCard = page
    .locator('.book-card')
    .filter({ hasText: 'Alpha Upload' });
  const alphaCover = contextAlphaCard.getByRole('button', {
    name: '查看《Alpha Upload》详情',
    exact: true,
  });
  await alphaCover.click({ button: 'right' });
  const bookContextMenu = page.locator('.bookshelf-book-context-menu');
  await expect(bookContextMenu).toBeVisible();
  for (const label of [
    '阅读书籍',
    '排队 GPT',
    '排队 Sakura',
    '下载译文',
    '下载原文',
    '删除书籍',
  ]) {
    await expect(
      bookContextMenu.getByText(label, { exact: true }),
    ).toBeVisible();
  }
  await expect(bookContextMenu.getByText('GPT', { exact: true })).toBeVisible();
  await expect(bookContextMenu.getByText('0/2', { exact: true })).toHaveCount(
    2,
  );
  await expect(
    bookContextMenu.getByText('Sakura', { exact: true }),
  ).toBeVisible();
  await expect(
    bookContextMenu.getByText('置顶书籍', { exact: true }),
  ).toBeVisible();
  await bookContextMenu.getByText('置顶书籍', { exact: true }).click();
  await expect(page.getByText('书籍已置顶', { exact: true })).toBeVisible();
  await expect(contextAlphaCard.getByLabel('已置顶')).toBeVisible();

  await alphaCover.click({ button: 'right' });
  await expect(
    bookContextMenu.getByText('取消置顶', { exact: true }),
  ).toBeVisible();
  await bookContextMenu.getByText('取消置顶', { exact: true }).click();
  await expect(page.getByText('已取消置顶', { exact: true })).toBeVisible();
  await expect(contextAlphaCard.getByLabel('已置顶')).toHaveCount(0);

  await alphaCover.click({ button: 'right' });
  await expect(
    bookContextMenu.getByText('置顶书籍', { exact: true }),
  ).toBeVisible();
  const readerPopupPromise = page.waitForEvent('popup');
  await bookContextMenu.getByText('阅读书籍', { exact: true }).click();
  const readerPopup = await readerPopupPromise;
  await expect(readerPopup).toHaveURL(
    new RegExp(
      `/books/${encodeURIComponent(alphaFilename)}/read/${alphaFirstChapterId}$`,
    ),
  );
  await readerPopup.close();

  await alphaCover.click({ button: 'right' });
  await expect(bookContextMenu).toBeVisible();
  await bookContextMenu.getByText('删除书籍', { exact: true }).click();
  const contextDeleteDialog = page
    .getByRole('dialog')
    .filter({ hasText: '删除书籍' });
  await expect(contextDeleteDialog).toContainText('Alpha Upload');
  await contextDeleteDialog
    .getByRole('button', { name: '取消', exact: true })
    .click();

  await alphaCover.click({ button: 'right' });
  const translatedContextDownload = page.waitForEvent('download');
  await bookContextMenu.getByText('下载译文', { exact: true }).click();
  expect((await translatedContextDownload).suggestedFilename()).not.toMatch(
    /\.zip$/i,
  );

  await alphaCover.click({ button: 'right' });
  const originalContextDownload = page.waitForEvent('download');
  await bookContextMenu.getByText('下载原文', { exact: true }).click();
  expect((await originalContextDownload).suggestedFilename()).toBe(
    alphaFilename,
  );

  await alphaCover.click({ button: 'right' });
  await bookContextMenu.getByText('排队 GPT', { exact: true }).click();
  await expect(page.getByText('1本小说已排队，0本失败').last()).toBeVisible();
  await alphaCover.click({ button: 'right' });
  await bookContextMenu.getByText('排队 Sakura', { exact: true }).click();
  await expect(page.getByText('1本小说已排队，0本失败').last()).toBeVisible();
  const contextQueuedBooks = await page.evaluate(() => {
    const readJobs = (key: string) =>
      JSON.parse(localStorage.getItem(key) ?? '{"jobs":[]}').jobs as Array<{
        description: string;
      }>;
    return {
      gpt: readJobs('auto-novel:workspace:gpt'),
      sakura: readJobs('auto-novel:workspace:sakura'),
    };
  });
  expect(contextQueuedBooks.gpt[0]?.description).toBe(alphaFilename);
  expect(contextQueuedBooks.sakura[0]?.description).toBe(alphaFilename);
  await page.evaluate(() => {
    for (const key of [
      'auto-novel:workspace:gpt',
      'auto-novel:workspace:sakura',
    ]) {
      const workspace = JSON.parse(
        localStorage.getItem(key) ?? '{"jobs":[]}',
      ) as { jobs: unknown[] };
      workspace.jobs = [];
      localStorage.setItem(key, JSON.stringify(workspace));
    }
  });
  await page.reload();

  const contextMenuDesktopViewport = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await alphaCover.scrollIntoViewIfNeeded();
  const mobileAlphaCoverBounds = await alphaCover.boundingBox();
  expect(mobileAlphaCoverBounds).not.toBeNull();
  const longPressPosition = {
    x: Math.round(
      mobileAlphaCoverBounds!.x + mobileAlphaCoverBounds!.width / 2,
    ),
    y: Math.round(
      mobileAlphaCoverBounds!.y + mobileAlphaCoverBounds!.height / 2,
    ),
  };
  await alphaCover.dispatchEvent('pointerdown', {
    ...longPressPosition,
    pointerId: 1,
    pointerType: 'touch',
  });
  await page.waitForTimeout(1050);
  await expect(bookContextMenu).toBeVisible();
  await alphaCover.dispatchEvent('pointerup', {
    ...longPressPosition,
    pointerId: 1,
    pointerType: 'touch',
  });
  const mobileContextMenuBounds = await bookContextMenu.boundingBox();
  expect(mobileContextMenuBounds).not.toBeNull();
  expect(mobileContextMenuBounds!.x).toBeGreaterThanOrEqual(8);
  expect(mobileContextMenuBounds!.y).toBeGreaterThanOrEqual(8);
  expect(
    mobileContextMenuBounds!.x + mobileContextMenuBounds!.width,
  ).toBeLessThanOrEqual(382);
  expect(
    mobileContextMenuBounds!.y + mobileContextMenuBounds!.height,
  ).toBeLessThanOrEqual(836);
  await page.mouse.click(4, 4);
  await expect(bookContextMenu).toBeHidden();
  if (contextMenuDesktopViewport !== null) {
    await page.setViewportSize(contextMenuDesktopViewport);
  }
  await page.evaluate(() => window.scrollTo(0, 0));

  const search = page.getByPlaceholder('输入书名，搜索书架');
  await search.fill('beta');
  await expect(
    page.getByRole('heading', { name: 'Beta Upload' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Alpha Upload' })).toHaveCount(
    0,
  );
  await search.clear();

  await page.locator('.bookshelf-toolbar__sort .n-base-selection').click();
  await page
    .locator('.n-base-select-menu')
    .getByText('书籍标题', { exact: true })
    .click();
  await expect(page.locator('.book-card h2')).toHaveText([
    'Alpha Upload',
    'Beta Upload',
  ]);

  await page.getByRole('button', { name: '选择', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '选择', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('button', { name: '排队 GPT', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: '排队 Sakura', exact: true }),
  ).toBeDisabled();
  await page
    .locator('.book-card')
    .filter({ hasText: 'Alpha Upload' })
    .getByRole('button', { name: '选择书籍', exact: true })
    .click();
  const selectionToolbar = page.locator('.bookshelf-selection-toolbar');
  const selectionActionAlignment = await selectionToolbar.evaluate(
    (toolbar) => {
      const selection = toolbar.querySelector<HTMLElement>(
        '.bookshelf-selection-toolbar__selection',
      );
      const actions = toolbar.querySelector<HTMLElement>(
        '.bookshelf-selection-toolbar__actions',
      );
      if (selection === null || actions === null) {
        throw new Error('缺少书架批量操作组');
      }
      return {
        actionsRight: Math.round(actions.getBoundingClientRect().right),
        selectionLeft: Math.round(selection.getBoundingClientRect().left),
        toolbarLeft: Math.round(toolbar.getBoundingClientRect().left),
        toolbarRight: Math.round(toolbar.getBoundingClientRect().right),
      };
    },
  );
  expect(
    selectionActionAlignment.toolbarRight -
      selectionActionAlignment.actionsRight,
  ).toBeLessThanOrEqual(16);
  expect(
    selectionActionAlignment.selectionLeft -
      selectionActionAlignment.toolbarLeft,
  ).toBeLessThanOrEqual(16);
  const filterButtonForLayout = page.getByRole('button', {
    name: '书架筛选',
    exact: true,
  });
  await filterButtonForLayout.click();
  const filterPanelForLayout = page.locator('.bookshelf-filter-panel');
  await expect(filterPanelForLayout).toBeVisible();
  const desktopExpandedGaps = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>(
      '.bookshelf-page__header',
    );
    const selection = document.querySelector<HTMLElement>(
      '.bookshelf-selection-toolbar',
    );
    const filter = document.querySelector<HTMLElement>(
      '.bookshelf-filter-panel',
    );
    const firstBook = document.querySelector<HTMLElement>('.book-card');
    if (
      header === null ||
      selection === null ||
      filter === null ||
      firstBook === null
    ) {
      throw new Error('缺少电脑版书架展开布局元素');
    }
    return {
      filterToBooks:
        firstBook.getBoundingClientRect().top -
        filter.getBoundingClientRect().bottom,
      headerToSelection:
        selection.getBoundingClientRect().top -
        header.getBoundingClientRect().bottom,
      selectionToFilter:
        filter.getBoundingClientRect().top -
        selection.getBoundingClientRect().bottom,
    };
  });
  expect(desktopExpandedGaps.headerToSelection).toBeGreaterThanOrEqual(0);
  expect(desktopExpandedGaps.headerToSelection).toBeLessThanOrEqual(6);
  expect(desktopExpandedGaps.selectionToFilter).toBeGreaterThanOrEqual(0);
  expect(desktopExpandedGaps.selectionToFilter).toBeLessThanOrEqual(4);
  expect(desktopExpandedGaps.filterToBooks).toBeGreaterThanOrEqual(0);
  expect(desktopExpandedGaps.filterToBooks).toBeLessThanOrEqual(12);

  const desktopViewport = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileSelectionLayout = await selectionToolbar.evaluate((toolbar) => {
    const selection = toolbar.querySelector<HTMLElement>(
      '.bookshelf-selection-toolbar__selection',
    );
    const pinActions = toolbar.querySelector<HTMLElement>(
      '.bookshelf-selection-toolbar__pin-actions',
    );
    const queueActions = toolbar.querySelector<HTMLElement>(
      '.bookshelf-selection-toolbar__queue-actions',
    );
    const fileActions = toolbar.querySelector<HTMLElement>(
      '.bookshelf-selection-toolbar__file-actions',
    );
    if (
      selection === null ||
      pinActions === null ||
      queueActions === null ||
      fileActions === null
    ) {
      throw new Error('缺少手机版书架选择工具栏元素');
    }
    const toolbarBounds = toolbar.getBoundingClientRect();
    const selectionBounds = selection.getBoundingClientRect();
    const pinBounds = pinActions.getBoundingClientRect();
    const queueBounds = queueActions.getBoundingClientRect();
    const fileBounds = fileActions.getBoundingClientRect();
    return {
      fileLeft: Math.round(fileBounds.left),
      fileRight: Math.round(fileBounds.right),
      fileTop: Math.round(fileBounds.top),
      pinLeft: Math.round(pinBounds.left),
      pinRight: Math.round(pinBounds.right),
      pinTop: Math.round(pinBounds.top),
      queueLeft: Math.round(queueBounds.left),
      queueRight: Math.round(queueBounds.right),
      queueTop: Math.round(queueBounds.top),
      selectionBottom: Math.round(selectionBounds.bottom),
      selectionLeft: Math.round(selectionBounds.left),
      selectionRight: Math.round(selectionBounds.right),
      selectionTop: Math.round(selectionBounds.top),
      toolbarLeft: Math.round(toolbarBounds.left),
      toolbarRight: Math.round(toolbarBounds.right),
    };
  });
  expect(
    mobileSelectionLayout.selectionLeft - mobileSelectionLayout.toolbarLeft,
  ).toBeLessThanOrEqual(16);
  expect(
    mobileSelectionLayout.toolbarRight - mobileSelectionLayout.pinRight,
  ).toBeLessThanOrEqual(16);
  expect(mobileSelectionLayout.pinRight).toBeLessThanOrEqual(
    mobileSelectionLayout.toolbarRight,
  );
  expect(mobileSelectionLayout.pinLeft).toBeGreaterThanOrEqual(
    mobileSelectionLayout.selectionRight,
  );
  expect(mobileSelectionLayout.pinTop).toBe(mobileSelectionLayout.selectionTop);
  expect(mobileSelectionLayout.queueTop).toBeGreaterThan(
    mobileSelectionLayout.selectionBottom,
  );
  expect(
    mobileSelectionLayout.queueLeft - mobileSelectionLayout.toolbarLeft,
  ).toBeLessThanOrEqual(16);
  expect(mobileSelectionLayout.fileTop).toBe(mobileSelectionLayout.queueTop);
  expect(
    mobileSelectionLayout.toolbarRight - mobileSelectionLayout.fileRight,
  ).toBeLessThanOrEqual(16);
  expect(mobileSelectionLayout.fileRight).toBeLessThanOrEqual(
    mobileSelectionLayout.toolbarRight,
  );
  expect(mobileSelectionLayout.fileLeft).toBeGreaterThanOrEqual(
    mobileSelectionLayout.queueRight,
  );
  const mobileFilterButton = filterButtonForLayout;
  const mobileFilterPanel = filterPanelForLayout;
  await expect(mobileFilterPanel).toBeVisible();
  const mobileVerticalGaps = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>(
      '.bookshelf-page__header',
    );
    const selection = document.querySelector<HTMLElement>(
      '.bookshelf-selection-toolbar',
    );
    const filter = document.querySelector<HTMLElement>(
      '.bookshelf-filter-panel',
    );
    const firstBook = document.querySelector<HTMLElement>('.book-card');
    if (
      header === null ||
      selection === null ||
      filter === null ||
      firstBook === null
    ) {
      throw new Error('缺少手机版书架纵向布局元素');
    }
    return {
      filterToBooks:
        firstBook.getBoundingClientRect().top -
        filter.getBoundingClientRect().bottom,
      headerToSelection:
        selection.getBoundingClientRect().top -
        header.getBoundingClientRect().bottom,
      selectionToFilter:
        filter.getBoundingClientRect().top -
        selection.getBoundingClientRect().bottom,
    };
  });
  expect(mobileVerticalGaps.headerToSelection).toBeLessThanOrEqual(6);
  expect(mobileVerticalGaps.selectionToFilter).toBeLessThanOrEqual(4);
  expect(mobileVerticalGaps.filterToBooks).toBeLessThanOrEqual(12);

  await selectionToolbar
    .getByRole('button', { name: '删除', exact: true })
    .click();
  const mobileDeleteConfirm = page.locator('.n-popconfirm');
  await expect(mobileDeleteConfirm).toBeVisible();
  const mobileDeleteConfirmBounds = await mobileDeleteConfirm.boundingBox();
  expect(mobileDeleteConfirmBounds).not.toBeNull();
  expect(mobileDeleteConfirmBounds!.x).toBeGreaterThanOrEqual(8);
  expect(
    mobileDeleteConfirmBounds!.x + mobileDeleteConfirmBounds!.width,
  ).toBeLessThanOrEqual(382);
  await mobileDeleteConfirm
    .getByRole('button', { name: '取消', exact: true })
    .click();
  await mobileFilterButton.click();
  await expect(mobileFilterPanel).toBeHidden();
  if (desktopViewport !== null) {
    await page.setViewportSize(desktopViewport);
  }
  const batchButtonStyles = await selectionToolbar
    .getByRole('button')
    .evaluateAll((buttons) =>
      buttons.map((button) => {
        const style = getComputedStyle(button);
        return {
          borderRadius: Number.parseFloat(style.borderRadius),
          height: button.getBoundingClientRect().height,
        };
      }),
    );
  expect(new Set(batchButtonStyles.map(({ height }) => height)).size).toBe(1);
  expect(
    new Set(batchButtonStyles.map(({ borderRadius }) => borderRadius)).size,
  ).toBe(1);
  expect(
    batchButtonStyles.every(
      ({ borderRadius, height }) => borderRadius < height / 2 - 1,
    ),
  ).toBe(true);
  await selectionToolbar
    .getByRole('button', { name: '排队 GPT', exact: true })
    .click();
  await expect(page.getByText('1本小说已排队，0本失败').last()).toBeVisible();
  await selectionToolbar
    .getByRole('button', { name: '排队 Sakura', exact: true })
    .click();
  await expect(page.getByText('1本小说已排队，0本失败').last()).toBeVisible();
  const singleShelfDownload = page.waitForEvent('download');
  await selectionToolbar
    .getByRole('button', { name: '下载', exact: true })
    .click();
  expect((await singleShelfDownload).suggestedFilename()).not.toMatch(
    /\.zip$/i,
  );
  await page.getByRole('button', { name: '置顶', exact: true }).click();
  await expect(page.getByText('已置顶 1 本书', { exact: true })).toBeVisible();
  await page.reload();
  const alphaCard = page
    .locator('.book-card')
    .filter({ hasText: 'Alpha Upload' });
  await expect(alphaCard.getByLabel('已置顶')).toBeVisible();

  await page.getByRole('button', { name: '选择', exact: true }).click();
  await page
    .locator('.book-card')
    .filter({ hasText: 'Beta Upload' })
    .getByRole('button', { name: '选择书籍', exact: true })
    .click();
  await page
    .locator('.book-card')
    .filter({ hasText: 'Alpha Upload' })
    .getByRole('button', { name: '选择书籍', exact: true })
    .click();
  const multipleShelfDownload = page.waitForEvent('download');
  await selectionToolbar
    .getByRole('button', { name: '下载', exact: true })
    .click();
  const shelfArchive = await multipleShelfDownload;
  expect(shelfArchive.suggestedFilename()).toBe('批量下载[2].zip');
  expect(
    await listArchiveEntries(await readDownload(shelfArchive)),
  ).toHaveLength(2);
  await selectionToolbar
    .getByRole('button', { name: '反选', exact: true })
    .click();
  await expect(
    selectionToolbar.getByText('已选择 0 本', { exact: true }),
  ).toBeVisible();
  await selectionToolbar
    .getByRole('button', { name: '全选', exact: true })
    .click();
  await expect(
    selectionToolbar.getByText('已选择 2 本', { exact: true }),
  ).toBeVisible();
  await page
    .locator('.book-card')
    .filter({ hasText: 'Alpha Upload' })
    .getByRole('button', { name: '取消选择', exact: true })
    .click();
  await selectionToolbar
    .getByRole('button', { name: '删除', exact: true })
    .click();
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await expect(page.getByText('1 本书已删除，0 本删除失败')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Beta Upload' })).toHaveCount(
    0,
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Beta Upload' })).toHaveCount(
    0,
  );
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: betaFilename,
      mimeType: 'text/plain',
      buffer: Buffer.from('Beta line 1\nBeta line 2'),
    });
  await confirmTxtPreview(page, betaFilename);
  await expect(
    page.getByRole('heading', { name: 'Beta Upload' }),
  ).toBeVisible();

  await page.evaluate(() => {
    const key = 'auto-novel:settings';
    const settings = {
      theme: 'system',
      autoTopJobWhenAddTask: false,
      menuCollapsed: false,
      workspaceSound: false,
      localVolumeOrder: { value: 'byCreateAt', desc: true },
      homeDownloadMode: 'zh',
      homeDownloadPriority: 'gpt',
      embedMetadataInOriginalDownload: false,
      embedMetadataInTranslatedDownload: false,
      downloadFormat: {
        mode: 'jp-zh',
        translationsMode: 'parallel',
        translations: ['gpt', 'sakura'],
      },
    };
    localStorage.setItem(key, JSON.stringify(settings));
  });
  await page.reload();

  await page.goto('/workspace/gpt');
  await page.getByRole('button', { name: '本地书架', exact: true }).click();
  const workspaceDrawer = page
    .locator('.n-drawer')
    .filter({ hasText: '本地小说' });
  await expect(
    workspaceDrawer.getByRole('link', { name: betaFilename, exact: true }),
  ).toHaveAttribute(
    'href',
    new RegExp(
      `/books/${encodeURIComponent(betaFilename)}/read/[0-9a-f-]{36}$`,
    ),
  );
  await expect(
    workspaceDrawer.getByRole('link', { name: betaFilename, exact: true }),
  ).toHaveAttribute('target', '_blank');
  await expect(
    workspaceDrawer.getByRole('button', { name: '阅读', exact: true }),
  ).toHaveCount(0);
  await workspaceDrawer
    .getByRole('button', { name: '全选', exact: true })
    .click();
  await expect(
    workspaceDrawer.getByText('已选择 2 本', { exact: true }),
  ).toBeVisible();
  const archiveDownload = page.waitForEvent('download');
  await workspaceDrawer
    .getByRole('button', { name: '下载选中的书', exact: true })
    .click();
  const archive = await archiveDownload;
  expect(archive.suggestedFilename()).toBe('批量下载[2].zip');
  expect(await listArchiveEntries(await readDownload(archive))).toEqual([
    'jp-zh.Bgs.Alpha Upload.txt',
    'jp-zh.Bgs.Beta Upload.txt',
  ]);
  await workspaceDrawer
    .getByRole('button', { name: '反选', exact: true })
    .click();
  await expect(
    workspaceDrawer.getByText('已选择 0 本', { exact: true }),
  ).toBeVisible();
  await workspaceDrawer
    .getByRole('checkbox', { name: `选择 ${betaFilename}` })
    .click();
  await workspaceDrawer
    .getByRole('button', { name: '更多本地小说操作' })
    .click();
  await page
    .locator('.n-dropdown-menu')
    .getByText('排队', { exact: true })
    .click();
  await expect(page.getByText('1本小说已排队，0本失败')).toBeVisible();
  await workspaceDrawer
    .getByRole('button', { name: '更多本地小说操作' })
    .click();
  await page
    .locator('.n-dropdown-menu')
    .getByText('删除', { exact: true })
    .click();
  const deleteDialog = page
    .getByRole('dialog')
    .filter({ hasText: '删除选中的书' });
  await expect(deleteDialog).toContainText('这将删除选中的 1 本书');
  await page.keyboard.press('Escape');

  await page.goto('/');

  await page.evaluate(async (bookId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('volumes');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = database.transaction(
      ['metadata', 'chapter', 'reader-progress'],
      'readwrite',
    );
    const metadataStore = transaction.objectStore('metadata');
    const metadataRequest = metadataStore.get(bookId);
    metadataRequest.onsuccess = () => {
      const metadata = metadataRequest.result;
      metadata.toc.forEach((entry: { chapterId: string; gpt?: string }) => {
        entry.gpt = metadata.glossaryId;
        const chapterStore = transaction.objectStore('chapter');
        const chapterRequest = chapterStore.get(`${bookId}/${entry.chapterId}`);
        chapterRequest.onsuccess = () => {
          const chapter = chapterRequest.result;
          chapter.gpt = {
            glossaryId: 'translated',
            glossary: {},
            paragraphs: chapter.paragraphs.map(() => '译文'),
          };
          chapterStore.put(chapter);
        };
      });
      metadataStore.put(metadata);
      transaction.objectStore('reader-progress').put({
        bookId,
        chapterId: metadata.toc[0].chapterId,
        updatedAt: 1,
      });
    };
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }, alphaFilename);
  await page.reload();

  const filterButton = page.getByRole('button', {
    name: '书架筛选',
    exact: true,
  });
  await expect(filterButton).toHaveAttribute('aria-pressed', 'false');
  await filterButton.click();
  const filterPanel = page.locator('.bookshelf-filter-panel');
  await expect(filterPanel).toBeVisible();
  await expect(filterButton).toHaveText('筛选');
  await expect(filterButton).toHaveAttribute('aria-pressed', 'true');
  const inlineFilterLayout = await page.evaluate(() => {
    const toolbar = document.querySelector<HTMLElement>('.bookshelf-toolbar');
    const panel = document.querySelector<HTMLElement>(
      '.bookshelf-filter-panel',
    );
    if (toolbar === null || panel === null) {
      throw new Error('缺少书架筛选布局');
    }
    return {
      panelParentClass: panel.parentElement?.className,
      panelTop: Math.round(panel.getBoundingClientRect().top),
      toolbarBottom: Math.round(toolbar.getBoundingClientRect().bottom),
    };
  });
  expect(inlineFilterLayout.panelParentClass).toContain('bookshelf-page');
  expect(inlineFilterLayout.panelTop).toBeGreaterThanOrEqual(
    inlineFilterLayout.toolbarBottom - 8,
  );
  const readingFilters = filterPanel
    .locator('.bookshelf-filter-panel__group')
    .nth(0);
  const translationStatusFilters = filterPanel
    .locator('.bookshelf-filter-panel__group')
    .nth(1);
  const translatorFilters = filterPanel
    .locator('.bookshelf-filter-panel__group')
    .nth(2);
  await translatorFilters
    .getByRole('button', { name: 'GPT', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Alpha Upload' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Beta Upload' })).toHaveCount(
    0,
  );
  await translatorFilters
    .getByRole('button', { name: '全部', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Beta Upload' }),
  ).toBeVisible();
  await translationStatusFilters
    .getByRole('button', { name: '已译完' })
    .click();
  await expect(filterButton).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('heading', { name: 'Alpha Upload' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Beta Upload' })).toHaveCount(
    0,
  );
  await readingFilters.getByRole('button', { name: '阅读中' }).click();
  await expect(
    readingFilters.getByRole('button', { name: '阅读中' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    translationStatusFilters.getByRole('button', { name: '已译完' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await translationStatusFilters
    .getByRole('button', { name: '未翻译' })
    .click();
  await expect(page.getByRole('heading', { name: 'Alpha Upload' })).toHaveCount(
    0,
  );
  await expect(page.getByRole('heading', { name: 'Beta Upload' })).toHaveCount(
    0,
  );
  const filteredEmptyState = page.locator('.bookshelf-empty-state');
  await expect(filteredEmptyState).toContainText('没有符合当前筛选条件的书籍');
  const filteredEmptyIconGap = await page.evaluate(() => {
    const filter = document.querySelector<HTMLElement>(
      '.bookshelf-filter-panel',
    );
    const icon = document.querySelector<HTMLElement>(
      '.bookshelf-empty-state .n-empty__icon',
    );
    if (filter === null || icon === null) {
      throw new Error('缺少筛选空状态布局元素');
    }
    return (
      icon.getBoundingClientRect().top - filter.getBoundingClientRect().bottom
    );
  });
  expect(filteredEmptyIconGap).toBeGreaterThanOrEqual(50);
  await readingFilters.getByRole('button', { name: '全部' }).click();
  await expect(
    page.getByRole('heading', { name: 'Beta Upload' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Alpha Upload' })).toHaveCount(
    0,
  );
  await expect(filterButton).toHaveText('筛选');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByPlaceholder('输入书名，搜索书架')).toBeVisible();
  const mobileFilterPanelBounds = await filterPanel.boundingBox();
  expect(mobileFilterPanelBounds).not.toBeNull();
  expect(mobileFilterPanelBounds!.x).toBeGreaterThanOrEqual(0);
  expect(
    mobileFilterPanelBounds!.x + mobileFilterPanelBounds!.width,
  ).toBeLessThanOrEqual(390);
  const mobileSort = page.locator('.bookshelf-toolbar__sort');
  const mobileSortBounds = await mobileSort.boundingBox();
  expect(mobileSortBounds).not.toBeNull();
  expect(mobileSortBounds!.width).toBeGreaterThanOrEqual(124);
  await mobileSort.locator('.n-base-selection').click();
  const mobileSortMenu = page.locator('.n-base-select-menu');
  await expect(mobileSortMenu).toBeVisible();
  const mobileSortOptions = mobileSortMenu.locator(
    '.n-base-select-option__content',
  );
  await expect(mobileSortOptions).toHaveCount(5);
  const mobileSortOptionsFit = await mobileSortOptions.evaluateAll((options) =>
    options.every((option) => option.scrollWidth <= option.clientWidth),
  );
  expect(mobileSortOptionsFit).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('heading', { name: 'Beta Upload' }),
  ).toBeVisible();
  await filterButton.click();
  await expect(filterButton).toHaveText('筛选');
  await expect(filterButton).toHaveAttribute('aria-pressed', 'false');
  await expect(filterPanel).toBeHidden();
  const collapsedMobileGaps = await page.evaluate(() => {
    const notice = document.querySelector<HTMLElement>('.notice');
    const header = document.querySelector<HTMLElement>(
      '.bookshelf-page__header',
    );
    const firstBook = document.querySelector<HTMLElement>('.book-card');
    if (notice === null || header === null || firstBook === null) {
      throw new Error('缺少手机版书架收起布局元素');
    }
    return {
      menuToBooks:
        firstBook.getBoundingClientRect().top -
        header.getBoundingClientRect().bottom,
      noticeToMenu:
        header.getBoundingClientRect().top -
        notice.getBoundingClientRect().bottom,
    };
  });
  expect(Math.abs(collapsedMobileGaps.menuToBooks - 12)).toBeLessThanOrEqual(1);
  expect(
    Math.abs(
      collapsedMobileGaps.menuToBooks - collapsedMobileGaps.noticeToMenu,
    ),
  ).toBeLessThanOrEqual(1);
  await expect(
    page.getByRole('heading', { name: 'Alpha Upload' }),
  ).toBeVisible();

  await page.goto('/');
  const uploadInput = page.locator('input[type="file"]').first();
  await uploadInput.setInputFiles({
    name: alphaFilename,
    mimeType: 'text/plain',
    buffer: Buffer.from('duplicate'),
  });
  await confirmTxtPreview(page, alphaFilename);
  await expect(page.getByText(/上传失败: Error: 小说已经存在/)).toBeVisible();
  await uploadInput.setInputFiles({
    name: 'unsupported.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('not a supported novel'),
  });
  await expect(page.getByText(/上传失败: 文件类型不允许/)).toBeVisible();
});

test('keeps EPUB presentation edits, downloads, and source data independent', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const sourceEpub = await createMinimalEpub();
  await page.route('**/linked-cover.png', (route) =>
    route.fulfill({
      body: Buffer.from(linkedCover),
      contentType: 'image/png',
    }),
  );
  await page.goto('/');
  await page.locator('input[type="file"]').first().setInputFiles({
    name: epubFilename,
    mimeType: 'application/epub+zip',
    buffer: sourceEpub,
  });
  await expect(
    page.getByRole('heading', { name: '原始 EPUB 标题' }),
  ).toBeVisible();

  await page.evaluate(async (bookId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('volumes');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = database.transaction(
      ['metadata', 'chapter'],
      'readwrite',
    );
    const metadataStore = transaction.objectStore('metadata');
    const metadataRequest = metadataStore.get(bookId);
    metadataRequest.onsuccess = () => {
      const metadata = metadataRequest.result;
      const chapterId = metadata.toc[0].chapterId;
      const chapterStore = transaction.objectStore('chapter');
      const chapterRequest = chapterStore.get(`${bookId}/${chapterId}`);
      chapterRequest.onsuccess = () => {
        const chapter = chapterRequest.result;
        chapter.gpt = {
          glossaryId: metadata.glossaryId,
          glossary: {},
          paragraphs: chapter.paragraphs.map(
            (_: string, index: number) => `真实译文 ${index + 1}`,
          ),
        };
        chapterStore.put(chapter);
        metadata.toc[0].gpt = metadata.glossaryId;
        metadataStore.put(metadata);
      };
    };
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }, epubFilename);

  await page.goto(`/books/${encodeURIComponent(epubFilename)}/edit`);
  const form = page.locator('.metadata-edit__form');
  const descriptionInput = form.locator('textarea');
  await expect(descriptionInput).toHaveAttribute('rows', '10');
  const desktopDescriptionHeight = await descriptionInput.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  expect(desktopDescriptionHeight).toBeGreaterThanOrEqual(180);
  const metadataEditDesktopViewport = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(descriptionInput).toHaveAttribute('rows', '10');
  const mobileDescriptionHeight = await descriptionInput.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  expect(mobileDescriptionHeight).toBeGreaterThanOrEqual(180);
  if (metadataEditDesktopViewport !== null) {
    await page.setViewportSize(metadataEditDesktopViewport);
  }
  await form.locator('input').first().fill('展示 EPUB 标题');
  await descriptionInput.fill('展示简介');
  await page
    .locator('.metadata-edit__cover-field input[type="file"]')
    .setInputFiles({
      name: 'custom.png',
      mimeType: 'image/png',
      buffer: Buffer.from(customCover),
    });
  const selects = form.locator('.n-select');
  await selects.nth(1).click();
  await page
    .locator('.n-base-select-menu:visible')
    .last()
    .getByText('开启', { exact: true })
    .click();
  await selects.nth(2).click();
  await page
    .locator('.n-base-select-menu:visible')
    .last()
    .getByText('关闭', { exact: true })
    .click();
  await page.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page).toHaveURL(/\/details$/);

  const storedAfterEdit = await page.evaluate(async (bookId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('volumes');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = database.transaction(
      ['metadata', 'file', 'reader-cover'],
      'readonly',
    );
    const metadataRequest = transaction.objectStore('metadata').get(bookId);
    const fileRequest = transaction.objectStore('file').get(bookId);
    const coverRequest = transaction.objectStore('reader-cover').get(bookId);
    const result = await new Promise<{
      metadata: {
        sourceBookMetadata: unknown;
        bookMetadata: unknown;
        downloadMetadataPreference: unknown;
      };
      file: { file: File };
      cover: { source?: string };
    }>((resolve, reject) => {
      transaction.oncomplete = () =>
        resolve({
          metadata: metadataRequest.result,
          file: fileRequest.result,
          cover: coverRequest.result,
        });
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    return {
      ...result,
      fileBytes: Array.from(
        new Uint8Array(await result.file.file.arrayBuffer()),
      ),
    };
  }, epubFilename);
  expect(storedAfterEdit.metadata).toMatchObject({
    sourceBookMetadata: {
      title: '原始 EPUB 标题',
      authors: ['原始作者'],
      description: '原始简介',
      languages: ['ja'],
    },
    bookMetadata: {
      title: '展示 EPUB 标题',
      description: '展示简介',
    },
    downloadMetadataPreference: {
      original: 'embed',
      translated: 'source',
    },
  });
  expect(storedAfterEdit.cover.source).toBe('custom');
  expect(Buffer.from(storedAfterEdit.fileBytes)).toEqual(sourceEpub);

  const [embeddedOriginalDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '下载原文', exact: true }).click(),
  ]);
  const embeddedOriginal = await inspectEpub(
    await readDownload(embeddedOriginalDownload),
  );
  expect(embeddedOriginal.packageXml).toContain('展示 EPUB 标题');
  expect(embeddedOriginal.packageXml).toContain('展示简介');
  expect(embeddedOriginal.cover).toEqual(Buffer.from(customCover));

  const [translatedDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '下载译文', exact: true }).click(),
  ]);
  const translated = await inspectEpub(await readDownload(translatedDownload));
  expect(translated.packageXml).toContain('原始 EPUB 标题');
  expect(translated.chapterXml).toContain('真实译文');
  expect(translated.chapterXml).toContain('alt="章节插图"');
  expect(translated.style).toContain('writing-mode: vertical-rl');
  expect(translated.cover).toEqual(Buffer.from(sourceCover));

  await page.goto(`/books/${encodeURIComponent(epubFilename)}/edit`);
  const coverField = page.locator('.metadata-edit__cover-field');
  await coverField.getByRole('button', { name: '移除', exact: true }).click();
  await coverField
    .locator('input[type="text"]')
    .fill('http://127.0.0.1:4173/linked-cover.png');
  await coverField.getByRole('button', { name: '应用', exact: true }).click();
  await page.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page).toHaveURL(/\/details$/);
  const [linkedOriginalDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '下载原文', exact: true }).click(),
  ]);
  const linkedOriginal = await inspectEpub(
    await readDownload(linkedOriginalDownload),
  );
  expect(linkedOriginal.cover).toEqual(Buffer.from(linkedCover));

  await page.goto(`/books/${encodeURIComponent(epubFilename)}/edit`);
  await page
    .getByRole('button', { name: '还原原始元信息', exact: true })
    .click();
  await expect(form.locator('input').first()).toHaveValue('原始 EPUB 标题');
  await expect(form.locator('textarea')).toHaveValue('原始简介');
  await expect(form).toContainText('原始作者');
  await expect(form).toContainText('日语');
  await expect(
    coverField.getByRole('button', { name: '上传', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page).toHaveURL(/\/details$/);

  const restoredMetadata = await page.evaluate(async (bookId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('volumes');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = database.transaction('metadata', 'readonly');
    const request = transaction.objectStore('metadata').get(bookId);
    const metadata = await new Promise<unknown>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return metadata;
  }, epubFilename);
  expect(restoredMetadata).toMatchObject({
    sourceBookMetadata: { title: '原始 EPUB 标题' },
    bookMetadata: {
      title: '原始 EPUB 标题',
      authors: ['原始作者'],
      description: '原始简介',
      coverUrl: '',
      languages: ['ja'],
    },
    downloadMetadataPreference: {
      original: 'embed',
      translated: 'source',
    },
  });
  await expect
    .poll(() =>
      page.evaluate(async (bookId) => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('volumes');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });
        const transaction = database.transaction('reader-cover', 'readonly');
        const request = transaction.objectStore('reader-cover').get(bookId);
        const cover = await new Promise<{ source?: string } | undefined>(
          (resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          },
        );
        database.close();
        return cover?.source;
      }, epubFilename),
    )
    .toBe('embedded');
});

test('permanent deletion removes exactly one complete book graph', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: betaFilename,
      mimeType: 'text/plain',
      buffer: Buffer.from('delete me'),
    });
  await confirmTxtPreview(page, betaFilename);
  await expect(
    page.getByRole('heading', { name: 'Beta Upload' }),
  ).toBeVisible();
  await page.evaluate(async (bookId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('volumes');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const stores = [
      'reader-settings',
      'reader-bookshelf',
      'reader-book-preference',
      'reader-progress',
      'reader-reading-stats',
      'reader-cover',
      'reader-bookmark',
      'reader-chapter-cache',
    ];
    const transaction = database.transaction(stores, 'readwrite');
    transaction.objectStore('reader-settings').put({
      id: 'default',
      defaultMode: 'original',
      translationPriority: ['gpt', 'sakura', 'youdao', 'baidu'],
      fontSize: 18,
      lineHeight: 1.8,
      contentWidth: 900,
      horizontalPadding: 24,
      theme: 'system',
      flow: 'auto',
      updatedAt: 1,
    });
    for (const target of [bookId, 'other-book']) {
      transaction.objectStore('reader-bookshelf').put({
        bookId: target,
        pinned: false,
        addedAt: 1,
        updatedAt: 1,
      });
      transaction.objectStore('reader-book-preference').put({
        bookId: target,
        preferredMode: 'original',
        updatedAt: 1,
      });
      transaction.objectStore('reader-progress').put({
        bookId: target,
        chapterId: '0',
        updatedAt: 1,
      });
      transaction.objectStore('reader-reading-stats').put({
        bookId: target,
        totalReadingMs: 1,
        lastReadAt: 1,
      });
      transaction.objectStore('reader-cover').put({
        bookId: target,
        blob: new Blob([target], { type: 'image/png' }),
        source: 'custom',
        updatedAt: 1,
      });
      transaction.objectStore('reader-bookmark').put({
        id: `${target}-bookmark`,
        bookId: target,
        chapterId: '0',
        createdAt: 1,
      });
      transaction.objectStore('reader-chapter-cache').put({
        key: `${target}/0/current`,
        bookId: target,
        chapterId: '0',
        contentRevision: 'current',
        cachedAt: 1,
      });
    }
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }, betaFilename);

  await page.getByRole('button', { name: '查看《Beta Upload》详情' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/books/${encodeURIComponent(betaFilename)}/details$`),
  );
  const [rawDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '下载原文', exact: true }).click(),
  ]);
  expect((await readDownload(rawDownload)).toString()).toBe('delete me');

  await page.getByRole('button', { name: '删除书籍', exact: true }).click();
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: 'Beta Upload' })).toHaveCount(
    0,
  );

  const remaining = await page.evaluate(async (bookId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('volumes');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const storeNames = Array.from(database.objectStoreNames);
    const transaction = database.transaction(storeNames, 'readonly');
    const read = (store: string, key: string) =>
      transaction.objectStore(store).get(key);
    const targetRequests = [
      read('metadata', bookId),
      read('file', bookId),
      read('chapter', `${bookId}/0`),
      read('reader-bookshelf', bookId),
      read('reader-book-preference', bookId),
      read('reader-progress', bookId),
      read('reader-reading-stats', bookId),
      read('reader-cover', bookId),
      read('reader-bookmark', `${bookId}-bookmark`),
      read('reader-chapter-cache', `${bookId}/0/current`),
    ];
    const preservedRequests = [
      read('reader-settings', 'default'),
      read('reader-bookshelf', 'other-book'),
      read('reader-book-preference', 'other-book'),
      read('reader-progress', 'other-book'),
      read('reader-reading-stats', 'other-book'),
      read('reader-cover', 'other-book'),
      read('reader-bookmark', 'other-book-bookmark'),
      read('reader-chapter-cache', 'other-book/0/current'),
    ];
    const result = await new Promise<{
      target: unknown[];
      preserved: unknown[];
    }>((resolve, reject) => {
      transaction.oncomplete = () =>
        resolve({
          target: targetRequests.map((request) => request.result),
          preserved: preservedRequests.map((request) => request.result),
        });
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    return result;
  }, betaFilename);
  expect(remaining.target.every((value) => value === undefined)).toBe(true);
  expect(remaining.preserved.every((value) => value !== undefined)).toBe(true);
  await page.reload();
  await expect(page.getByText(betaFilename, { exact: true })).toHaveCount(0);
});
