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
        ['metadata', 'chapter'],
        'readwrite',
      );
      transaction.objectStore('metadata').put({
        id: bookId,
        createAt: 1,
        toc: [{ chapterId: '0' }],
        glossaryId: 'glossary',
        glossary: {},
        favoredId: 'default',
      });
      transaction.objectStore('chapter').put({
        id: `${bookId}/0`,
        volumeId: bookId,
        paragraphs: [unsafeText, '安全文本'],
        segmentIds: ['segment-0', 'segment-1'],
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
  const startReadingButton = page.getByRole('button', { name: '开始阅读' });
  await startReadingButton.focus();
  await expect(startReadingButton).toBeFocused();
  await startReadingButton.click();
  await expect(page).toHaveURL(/\/books\/reader-flow\.txt\/read\/0$/);
  await expect(page.getByText(unsafeText, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__readerXss)).toBeUndefined();
  await page.getByRole('button', { name: '添加书签' }).click();
  await expect(page.getByRole('button', { name: '书签 (1)' })).toBeVisible();

  await page.goto('/workspace/reader/reader-flow.txt/0');
  await expect(page).toHaveURL(/\/books\/reader-flow\.txt\/read\/0$/);
  await expect(page.getByText('安全文本', { exact: true })).toBeVisible();
});
