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
};

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
  </manifest>
  <spine><itemref idref="chapter"/></spine>
</package>`),
  );
  await writer.add(
    'OEBPS/chapter.xhtml',
    new TextReader(`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title></head>
<body><h1>第一章</h1><p>原文段落</p></body></html>`),
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
    return {
      packageXml,
      chapterXml,
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
  await expect(page.getByRole('heading', { name: '本地书架' })).toBeVisible();
  await uploadBooks(page);
  await expect(page.getByText(alphaFilename, { exact: true })).toBeVisible();
  await expect(page.getByText(betaFilename, { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: '阅读', exact: true }),
  ).toHaveCount(0);

  const alphaHomeTitle = page.getByRole('button', {
    name: `打开《${alphaFilename}》`,
  });
  await alphaHomeTitle.click();
  const addToBookshelfDialog = page
    .getByRole('dialog')
    .filter({ hasText: '尚未加入书架' });
  await expect(addToBookshelfDialog).toContainText(alphaFilename);
  const addedBookPagePromise = page.waitForEvent('popup');
  await addToBookshelfDialog
    .getByRole('button', { name: '加入书架', exact: true })
    .click();
  const addedBookPage = await addedBookPagePromise;
  await expect(addedBookPage).toHaveURL(
    new RegExp(`/books/${encodeURIComponent(alphaFilename)}/details$`),
  );
  await expect(page).toHaveURL('/');
  await addedBookPage.close();

  const existingBookPagePromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: `打开《${alphaFilename}》` }).click();
  const existingBookPage = await existingBookPagePromise;
  await expect(existingBookPage).toHaveURL(
    new RegExp(`/books/${encodeURIComponent(alphaFilename)}/details$`),
  );
  await expect(page).toHaveURL('/');
  await existingBookPage.close();

  const imported = await page.evaluate(
    async ({ alphaId, betaId }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('volumes', 5);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      const transaction = database.transaction(
        ['metadata', 'chapter', 'file'],
        'readonly',
      );
      const alphaMetadataRequest = transaction
        .objectStore('metadata')
        .get(alphaId);
      const betaMetadataRequest = transaction
        .objectStore('metadata')
        .get(betaId);
      const alphaChapterRequests = ['0', '1000'].map((chapterId) =>
        transaction.objectStore('chapter').get(`${alphaId}/${chapterId}`),
      );
      const alphaFileRequest = transaction.objectStore('file').get(alphaId);
      const result = await new Promise<{
        alphaMetadata: {
          toc: unknown[];
          sourceBookMetadata: { title: string };
        };
        betaMetadata: { toc: unknown[]; sourceBookMetadata: { title: string } };
        alphaChapters: Array<{ paragraphs: string[]; segmentIds: string[] }>;
        hasFile: boolean;
      }>((resolve, reject) => {
        transaction.oncomplete = () =>
          resolve({
            alphaMetadata: alphaMetadataRequest.result,
            betaMetadata: betaMetadataRequest.result,
            alphaChapters: alphaChapterRequests.map(
              (request) => request.result,
            ),
            hasFile: alphaFileRequest.result !== undefined,
          });
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
      return result;
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
    imported.alphaChapters
      .flatMap((chapter) => chapter.segmentIds)
      .every((id) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          id,
        ),
      ),
  ).toBe(true);
  expect(imported.hasFile).toBe(true);

  await page.goto('/bookshelf');
  await expect(
    page.getByRole('heading', { name: 'Alpha Upload' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Beta Upload' }),
  ).toBeVisible();

  const search = page.getByPlaceholder('搜索书名');
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
    .getByText('标题', { exact: true })
    .click();
  await expect(page.locator('.book-card h2')).toHaveText([
    'Alpha Upload',
    'Beta Upload',
  ]);

  await page.getByRole('button', { name: '选择', exact: true }).click();
  await page
    .locator('.book-card')
    .filter({ hasText: 'Alpha Upload' })
    .getByRole('button', { name: '选择书籍', exact: true })
    .click();
  const selectionToolbar = page.locator('.bookshelf-selection-toolbar');
  const singleShelfDownload = page.waitForEvent('download');
  await selectionToolbar
    .getByRole('button', { name: '下载', exact: true })
    .click();
  expect((await singleShelfDownload).suggestedFilename()).not.toMatch(
    /\.zip$/i,
  );
  await page.getByRole('button', { name: '置顶', exact: true }).click();
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
  await page.getByRole('button', { name: '移出书架', exact: true }).click();
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Beta Upload' })).toHaveCount(
    0,
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Beta Upload' })).toHaveCount(
    0,
  );

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
  await page.getByRole('button', { name: '从本地书架添加' }).click();
  const localDrawer = page.locator('.n-drawer').filter({ hasText: '本地小说' });
  await expect(
    localDrawer.getByRole('button', { name: '添加', exact: true }),
  ).toBeVisible();
  await expect(
    localDrawer.getByRole('button', { name: '更多本地小说操作' }),
  ).toHaveCount(0);
  const addSelectedButton = localDrawer.getByRole('button', {
    name: '将选中的书加入书架',
    exact: true,
  });
  await expect(addSelectedButton).toBeDisabled();
  await expect(
    localDrawer.getByRole('button', { name: '下载选中的书', exact: true }),
  ).toHaveCount(0);
  await expect(
    localDrawer.getByRole('button', { name: '加入书架', exact: true }),
  ).toHaveCount(0);
  await localDrawer
    .getByRole('checkbox', { name: `选择 ${betaFilename}` })
    .click();
  await expect(
    localDrawer.getByText('已选择 1 本', { exact: true }),
  ).toBeVisible();
  await expect(addSelectedButton).toBeEnabled();

  await page.goto('/workspace/gpt');
  await page.getByRole('button', { name: '本地书架', exact: true }).click();
  const workspaceDrawer = page
    .locator('.n-drawer')
    .filter({ hasText: '本地小说' });
  await expect(
    workspaceDrawer.getByRole('link', { name: betaFilename, exact: true }),
  ).toHaveAttribute(
    'href',
    `/books/${encodeURIComponent(betaFilename)}/read/0`,
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

  await page.goto('/bookshelf');
  await page.getByRole('button', { name: '从本地书架添加' }).click();
  const addDrawer = page.locator('.n-drawer').filter({ hasText: '本地小说' });
  await expect(
    addDrawer.getByText(betaFilename, { exact: true }),
  ).toBeVisible();
  await addDrawer
    .getByRole('checkbox', { name: `选择 ${betaFilename}` })
    .click();
  await addDrawer
    .getByRole('button', { name: '将选中的书加入书架', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Beta Upload' }),
  ).toBeVisible();

  await page.evaluate(async (bookId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('volumes', 5);
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
      metadata.toc.forEach((chapter: { gpt?: string }) => {
        chapter.gpt = metadata.glossaryId;
      });
      metadataStore.put(metadata);
    };
    for (const chapterId of ['0', '1000']) {
      const chapterStore = transaction.objectStore('chapter');
      const chapterRequest = chapterStore.get(`${bookId}/${chapterId}`);
      chapterRequest.onsuccess = () => {
        const chapter = chapterRequest.result;
        chapter.gpt = {
          glossaryId: 'translated',
          glossary: {},
          paragraphs: chapter.paragraphs.map(() => '译文'),
        };
        chapterStore.put(chapter);
      };
    }
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }, alphaFilename);
  await page.reload();

  await page.locator('.bookshelf-toolbar__filter .n-base-selection').click();
  await page
    .locator('.n-base-select-menu')
    .getByText('已译完', { exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Alpha Upload' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Beta Upload' })).toHaveCount(
    0,
  );
  await page.locator('.bookshelf-toolbar__filter .n-base-selection').click();
  await page
    .locator('.n-base-select-menu')
    .getByText('未翻译', { exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Beta Upload' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Alpha Upload' })).toHaveCount(
    0,
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.bookshelf-toolbar__search')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Beta Upload' }),
  ).toBeVisible();

  await page.goto('/');
  const uploadInput = page.locator('input[type="file"]').first();
  await uploadInput.setInputFiles({
    name: alphaFilename,
    mimeType: 'text/plain',
    buffer: Buffer.from('duplicate'),
  });
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
  await expect(page.getByText(epubFilename, { exact: true })).toBeVisible();

  await page.evaluate(async (bookId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('volumes', 5);
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
  await form.locator('input').first().fill('展示 EPUB 标题');
  await form.locator('textarea').fill('展示简介');
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
      const request = indexedDB.open('volumes', 5);
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
      const request = indexedDB.open('volumes', 5);
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
          const request = indexedDB.open('volumes', 5);
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
  await expect(page.getByText(betaFilename, { exact: true })).toBeVisible();
  await page.evaluate(async (bookId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('volumes', 5);
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
      'reader-annotation',
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
        listed: true,
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
      transaction.objectStore('reader-annotation').put({
        id: `${target}-annotation`,
        bookId: target,
        chapterId: '0',
        segmentId: 'segment',
        languageSide: 'original',
        startOffset: 0,
        endOffset: 1,
        quote: 'x',
        style: 'highlight',
        createdAt: 1,
        updatedAt: 1,
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

  const [rawDownload] = await Promise.all([
    page.waitForEvent('download'),
    page
      .locator('.n-list-item')
      .filter({ hasText: betaFilename })
      .getByRole('button', { name: '原文', exact: true })
      .click(),
  ]);
  expect((await readDownload(rawDownload)).toString()).toBe('delete me');

  const targetItem = page
    .locator('.n-list-item')
    .filter({ hasText: betaFilename });
  await targetItem
    .getByRole('button', {
      name: `真的要删除《${betaFilename}》吗？`,
      exact: true,
    })
    .click();
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await expect(page.getByText(betaFilename, { exact: true })).toHaveCount(0);

  const remaining = await page.evaluate(async (bookId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('volumes', 5);
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
      read('reader-annotation', `${bookId}-annotation`),
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
      read('reader-annotation', 'other-book-annotation'),
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
