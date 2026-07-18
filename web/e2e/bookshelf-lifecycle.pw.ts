import { expect, test, type Page } from '@playwright/test';

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

test('imports and persists the complete bookshelf listing lifecycle', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '本地书架' })).toBeVisible();
  await uploadBooks(page);
  await expect(page.getByText(alphaFilename, { exact: true })).toBeVisible();
  await expect(page.getByText(betaFilename, { exact: true })).toBeVisible();

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
  await page.getByRole('button', { name: '移出书架', exact: true }).click();
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Beta Upload' })).toHaveCount(
    0,
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Beta Upload' })).toHaveCount(
    0,
  );

  await page.getByRole('button', { name: '从本地书架添加' }).click();
  const localDrawer = page.locator('.n-drawer').filter({ hasText: '本地小说' });
  await expect(
    localDrawer.getByText(betaFilename, { exact: true }),
  ).toBeVisible();
  await localDrawer
    .locator('.n-list-item')
    .filter({ hasText: betaFilename })
    .getByRole('button', { name: '加入书架', exact: true })
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
