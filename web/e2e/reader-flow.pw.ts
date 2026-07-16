import { expect, test } from '@playwright/test';

const bookId = 'reader-flow.txt';
const unsafeText = '<img src=x onerror="window.__readerXss=true">';

test('opens a local bookshelf book safely and keeps the legacy reader link', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/bookshelf');
  expect(
    await page
      .locator('html')
      .evaluate((element) => getComputedStyle(element).scrollBehavior),
  ).toBe('auto');
  await expect(page.getByRole('heading', { name: '书架' })).toBeVisible();

  await page.evaluate(
    async ({ bookId, unsafeText }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('volumes', 4);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });

      const transaction = database.transaction(
        ['metadata', 'chapter', 'reader-cover'],
        'readwrite',
      );
      transaction.objectStore('metadata').put({
        id: bookId,
        createAt: 1,
        toc: [{ chapterId: '0' }, { chapterId: '1' }],
        glossaryId: 'glossary',
        glossary: {},
        favoredId: 'default',
      });
      transaction.objectStore('chapter').put({
        id: `${bookId}/0`,
        volumeId: bookId,
        paragraphs: [unsafeText, '安全文本', '长段落'.repeat(4000)],
        segmentIds: ['segment-0', 'segment-1'],
      });
      transaction.objectStore('chapter').put({
        id: `${bookId}/1`,
        volumeId: bookId,
        paragraphs: ['第二章'],
        segmentIds: ['chapter-1-segment-0'],
      });
      transaction.objectStore('reader-cover').put({
        bookId,
        blob: new Blob(['custom cover'], { type: 'image/png' }),
        source: 'custom',
        updatedAt: 1,
      });
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
    },
    { bookId, unsafeText },
  );

  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'reader-flow' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '查看《reader-flow》详情' }).click();
  await expect(page).toHaveURL(/\/books\/reader-flow\.txt\/details$/);
  await expect(
    page.getByText('总计 2 / GPT 0 / Sakura 0', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.book-details__reading-progress')).toHaveText(
    '阅读进度 0%',
  );
  await expect(page.getByText('翻译进度', { exact: true })).toHaveCount(0);
  await expect(page.getByText('语言', { exact: true })).toHaveCount(0);
  await expect(page.getByText('目录', { exact: true })).toHaveCount(0);
  await expect(page.getByText('本地书籍', { exact: true })).toHaveCount(0);

  await expect(page.getByText('本地全文检索', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '下载原文', exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: '下载译文', exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: '下载', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '打开目录', exact: true }),
  ).toHaveCount(1);
  await expect(page.getByRole('button', { name: '排队GPT' })).toBeVisible();
  await expect(page.getByRole('button', { name: '排队Sakura' })).toBeVisible();
  await expect(page.locator('.book-details__hero-shelf-actions')).toBeVisible();
  await expect(page.getByRole('button', { name: '置顶书籍' })).toBeVisible();
  await expect(page.getByRole('button', { name: '移出书架' })).toBeVisible();
  await page.locator('.book-details__hero-content > .book-cover').hover();
  await expect(
    page.getByRole('button', { name: '移除自定义封面' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '移除自定义封面' }).click();
  await expect(
    page.getByRole('button', { name: '移除自定义封面' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: '打开目录', exact: true }).click();
  await expect(page.getByText('共 2 章', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /第 2 章/ }).click();
  await expect
    .poll(() => new URL(page.url()).pathname)
    .toBe('/books/reader-flow.txt/read/1');

  await page.goto('/bookshelf');
  await page.getByRole('button', { name: '移出书架' }).click();
  await expect(
    page.getByText('书架中还没有书籍', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '从本地书架添加' }).first().click();
  await expect(page.getByText('本地小说', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '下载' })).not.toBeVisible();
  await page.getByRole('button', { name: '加入书架' }).click();
  await expect(
    page.getByRole('heading', { name: 'reader-flow' }),
  ).toBeVisible();

  const startReadingButton = page.getByRole('button', { name: '开始阅读' });
  await startReadingButton.focus();
  await expect(startReadingButton).toBeFocused();
  await startReadingButton.click();
  await expect(page).toHaveURL(/\/books\/reader-flow\.txt\/read\/0$/);
  await expect(page.getByText(unsafeText, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__readerXss)).toBeUndefined();
  await page.getByRole('button', { name: '目录' }).click();
  await expect(page.getByText('共 2 章', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  const readerTop = page.locator('.book-reader__top');
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  await expect
    .poll(() =>
      readerTop.evaluate((element) =>
        Math.round(element.getBoundingClientRect().top),
      ),
    )
    .toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: '下一章' }).click();
  await expect(page).toHaveURL(/\/books\/reader-flow\.txt\/read\/1$/);
  await expect
    .poll(() =>
      readerTop.evaluate((element) =>
        Math.round(element.getBoundingClientRect().top),
      ),
    )
    .toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: '更多' }).click();
  await page.getByRole('button', { name: '添加书签' }).click();
  await expect(page.getByRole('button', { name: '书签 (1)' })).toBeVisible();

  await page.goto('/workspace/reader/reader-flow.txt/0');
  await expect(page).toHaveURL(/\/books\/reader-flow\.txt\/read\/0$/);
  await expect(page.getByText('安全文本', { exact: true })).toBeVisible();
});

test('persists the global reading version selected in Settings', async ({
  page,
}) => {
  await page.goto('/setting');
  await expect(page.getByText('阅读偏好', { exact: true })).toBeVisible();

  const selector = page.locator('#reader-default-mode');
  await expect(selector).toHaveAttribute('aria-busy', 'false');
  await expect(selector.getByRole('radio', { name: '询问' })).toHaveCount(0);
  await selector.getByText('日中', { exact: true }).click();
  await expect(selector.getByRole('radio', { name: '日中' })).toBeChecked();

  await expect
    .poll(() =>
      page.evaluate(async () => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('volumes', 4);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });
        const transaction = database.transaction('reader-settings', 'readonly');
        const request = transaction
          .objectStore('reader-settings')
          .get('default');
        const setting = await new Promise<{ defaultMode?: string } | undefined>(
          (resolve, reject) => {
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
          },
        );
        database.close();
        return setting?.defaultMode;
      }),
    )
    .toBe('original-translated');

  await page.reload();
  await expect(selector.getByRole('radio', { name: '日中' })).toBeChecked();
});
