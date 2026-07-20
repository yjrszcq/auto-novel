import { expect, test, type Page } from '@playwright/test';

const bookId = 'catalog-maintenance.txt';
const sourceLines = [
  '第一卷 星海',
  '第一章 出发',
  '正文一',
  '第二章 归来',
  '正文二',
];

const seedBook = async (page: Page) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '轻小说机翻机器人' }),
  ).toBeVisible();
  await expect(page.locator('.n-skeleton')).toHaveCount(0);
  await page.evaluate(
    async ({ bookId, sourceLines }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('volumes');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      const transaction = database.transaction(
        ['metadata', 'chapter', 'file'],
        'readwrite',
      );
      transaction.objectStore('metadata').put({
        id: bookId,
        createAt: 1,
        toc: [
          {
            chapterId: 'volume',
            title: '第一卷 星海',
            level: 1,
            sourceStartLine: 0,
            sourceEndLine: 0,
          },
          {
            chapterId: 'chapter-one',
            title: '第一章 出发',
            level: 2,
            parentChapterId: 'volume',
            sourceStartLine: 1,
            sourceEndLine: 2,
          },
          {
            chapterId: 'chapter-two',
            title: '第二章 归来',
            level: 2,
            parentChapterId: 'volume',
            sourceStartLine: 3,
            sourceEndLine: 4,
          },
        ],
        navigation: [
          {
            id: 'txt:volume',
            title: '第一卷 星海',
            level: 1,
            chapterId: 'volume',
          },
          {
            id: 'txt:chapter-one',
            title: '第一章 出发',
            level: 2,
            chapterId: 'chapter-one',
            parentId: 'txt:volume',
          },
          {
            id: 'txt:chapter-two',
            title: '第二章 归来',
            level: 2,
            chapterId: 'chapter-two',
            parentId: 'txt:volume',
          },
        ],
        sourceFormat: 'txt',
        glossaryId: 'glossary',
        glossary: {},
        favoredId: 'default',
        sourceBookMetadata: { title: '目录维护测试', languages: ['zh'] },
      });
      const chapters = [
        { id: 'volume', start: 0, end: 0 },
        { id: 'chapter-one', start: 1, end: 2 },
        { id: 'chapter-two', start: 3, end: 4 },
      ];
      for (const chapter of chapters) {
        const lines = sourceLines.slice(chapter.start, chapter.end + 1);
        transaction.objectStore('chapter').put({
          id: `${bookId}/${chapter.id}`,
          volumeId: bookId,
          paragraphs: lines,
          segmentIds: lines.map(
            (_, index) => `${chapter.id}-segment-${chapter.start + index}`,
          ),
          sourceLines: lines.map((_, index) => chapter.start + index),
          sourceStartLine: chapter.start,
          sourceEndLine: chapter.end,
        });
      }
      transaction.objectStore('file').put({
        id: bookId,
        file: new File([sourceLines.join('\n')], bookId, {
          type: 'text/plain',
        }),
      });
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
    },
    { bookId, sourceLines },
  );
};

test('edits TXT catalog titles and rebuilds hierarchy on desktop and mobile', async ({
  page,
}) => {
  await seedBook(page);
  await page.goto(`/books/${encodeURIComponent(bookId)}/details`);

  await page.getByRole('button', { name: '打开目录', exact: true }).click();
  const detailsCatalog = page.locator('.book-details-catalog-drawer');
  await detailsCatalog
    .getByRole('button', { name: '编辑目录', exact: true })
    .click();
  const titleEditor = page.getByRole('dialog', {
    name: '编辑目录显示文本',
  });
  await expect(titleEditor).toBeVisible();
  await expect(detailsCatalog).toBeHidden();
  const editExplanation = page.getByText(
    '此处只修改目录显示文本，不改变正文、章节边界、层级、译文或阅读位置。',
    { exact: true },
  );
  await expect(editExplanation).toHaveCount(0);
  await titleEditor
    .getByRole('button', { name: '目录标题编辑说明', exact: true })
    .click();
  await expect(editExplanation).toBeVisible();
  await titleEditor
    .getByRole('button', { name: '目录标题编辑说明', exact: true })
    .click();
  const titleInputs = titleEditor.locator('input');
  await expect(titleInputs).toHaveCount(3);
  await titleInputs.first().fill('自定义卷名');
  await titleEditor
    .getByRole('button', { name: '保存标题', exact: true })
    .click();
  await expect(
    page.getByText('目录显示文本已保存', { exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: '打开目录', exact: true }).click();
  await expect(
    detailsCatalog.getByText('自定义卷名', { exact: true }),
  ).toBeVisible();
  await expect(
    detailsCatalog.getByText('第一章 出发', { exact: true }),
  ).toHaveCount(0);
  await detailsCatalog
    .getByRole('button')
    .filter({ hasText: '自定义卷名' })
    .click();
  await expect(
    detailsCatalog.getByText('第一章 出发', { exact: true }),
  ).toBeVisible();
  await detailsCatalog
    .getByRole('button', { name: '目录', exact: true })
    .click();

  const afterTitleEdit = await page.evaluate(async (bookId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('volumes');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const chapters = await new Promise<unknown[]>((resolve, reject) => {
      const request = database
        .transaction('chapter')
        .objectStore('chapter')
        .index('byVolumeId')
        .getAll(bookId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return chapters;
  }, bookId);
  expect(afterTitleEdit).toHaveLength(3);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '打开目录', exact: true }).click();
  await detailsCatalog
    .getByRole('button', { name: '编辑目录', exact: true })
    .click();
  await expect(titleEditor).toBeVisible();
  const editorBounds = await titleEditor.boundingBox();
  expect(editorBounds).not.toBeNull();
  expect(editorBounds!.x).toBeGreaterThanOrEqual(0);
  expect(editorBounds!.x + editorBounds!.width).toBeLessThanOrEqual(390);
  expect(editorBounds!.y + editorBounds!.height).toBeLessThanOrEqual(844);
  await titleEditor
    .getByRole('button', { name: '重新解析目录', exact: true })
    .click();
  const confirmation = page.locator('.n-popconfirm');
  await confirmation
    .getByRole('button', { name: '进入预览', exact: true })
    .click();
  const preview = page.getByRole('dialog', { name: '重新解析 TXT 目录' });
  await expect(preview).toBeVisible();
  await expect(titleEditor).toBeHidden();
  const previewBounds = await preview.boundingBox();
  expect(previewBounds).not.toBeNull();
  expect(previewBounds!.x).toBeGreaterThanOrEqual(0);
  expect(previewBounds!.x + previewBounds!.width).toBeLessThanOrEqual(390);
  expect(previewBounds!.y + previewBounds!.height).toBeLessThanOrEqual(844);
  await preview
    .getByRole('button', { name: '确认并完整重建', exact: true })
    .click();
  await expect(
    page.getByText('目录已完整重建', { exact: false }),
  ).toBeVisible();

  const rebuilt = await page.evaluate(async (bookId) => {
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
    const metadata = await requestResult(
      database.transaction('metadata').objectStore('metadata').get(bookId),
    );
    const chapters = await requestResult(
      database
        .transaction('chapter')
        .objectStore('chapter')
        .index('byVolumeId')
        .getAll(bookId),
    );
    database.close();
    const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]));
    return {
      metadata,
      text: metadata.toc
        .map((entry) =>
          byId.get(`${bookId}/${entry.chapterId}`).paragraphs.join('\n'),
        )
        .join('\n'),
    };
  }, bookId);
  expect(rebuilt.text).toBe(sourceLines.join('\n'));
  expect(rebuilt.metadata.toc.map((entry) => entry.title)).toEqual([
    '第一卷 星海',
    '第一章 出发',
    '第二章 归来',
  ]);
  expect(rebuilt.metadata.navigation[1].parentId).toBe(
    `txt:${rebuilt.metadata.toc[0].chapterId}`,
  );

  await page.goto(
    `/books/${encodeURIComponent(bookId)}/read/${rebuilt.metadata.toc[0].chapterId}`,
  );
  await page.getByRole('button', { name: '目录', exact: true }).click();
  const readerCatalog = page.getByRole('dialog', { name: '目录' });
  await expect(
    readerCatalog.getByText('第一卷 星海', { exact: true }),
  ).toBeVisible();
  await expect(
    readerCatalog.getByText('第一章 出发', { exact: true }),
  ).toHaveCount(0);
  await readerCatalog
    .locator('.book-reader__catalog-item')
    .filter({ hasText: '第一卷 星海' })
    .click();
  await expect(
    readerCatalog.getByText('第一章 出发', { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
