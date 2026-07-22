import { expect, test, type Locator } from '@playwright/test';

import { startOpenAiTestServer } from '../tests/helpers/openai-test-server';

const bookId = 'reader-flow.txt';
const unsafeText = '<img src=x onerror="window.__readerXss=true">';
const descriptionHtml =
  '<div><p><strong style="color:red" onclick="window.__descriptionXss=true">安全简介</strong></p><p>第二段</p><img src=x onerror="window.__descriptionXss=true"><svg><script>window.__descriptionXss=true</script></svg></div>';

const expectButtonIconCentered = async (button: Locator) => {
  const offset = await button.evaluate((element) => {
    const icon = element.querySelector('.n-button__icon');
    if (icon === null) return { x: Number.NaN, y: Number.NaN };
    const buttonBounds = element.getBoundingClientRect();
    const iconBounds = icon.getBoundingClientRect();
    return {
      x:
        iconBounds.x +
        iconBounds.width / 2 -
        (buttonBounds.x + buttonBounds.width / 2),
      y:
        iconBounds.y +
        iconBounds.height / 2 -
        (buttonBounds.y + buttonBounds.height / 2),
    };
  });
  expect(Math.abs(offset.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(offset.y)).toBeLessThanOrEqual(1);
};

const expectSheetAboveBottomNavigation = async (
  sheet: Locator,
  bottomNavigation: Locator,
) => {
  const [sheetBounds, navigationBounds] = await Promise.all([
    sheet.boundingBox(),
    bottomNavigation.boundingBox(),
  ]);
  expect(sheetBounds).not.toBeNull();
  expect(navigationBounds).not.toBeNull();
  expect(
    Math.abs(sheetBounds!.y + sheetBounds!.height - navigationBounds!.y),
  ).toBeLessThanOrEqual(1);
};

test('switches translated catalog titles with the reader language mode', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '轻小说机翻机器人' }),
  ).toBeVisible();
  await expect(page.locator('.n-skeleton')).toHaveCount(0);
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('volumes');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = database.transaction(
      ['metadata', 'chapter', 'reader-settings'],
      'readwrite',
    );
    const titleTranslations = {
      gpt: {
        text: '译题：启程',
        glossaryId: 'glossary',
        sourceTitle: '第一章：出发',
      },
    };
    transaction.objectStore('metadata').put({
      id: 'translated-catalog.txt',
      createAt: 1,
      toc: [
        {
          chapterId: '0',
          title: '第一章：出发',
          titleTranslations,
        },
      ],
      navigation: [
        {
          id: 'txt:0',
          title: '第一章：出发',
          titleTranslations,
          level: 1,
          chapterId: '0',
        },
      ],
      sourceFormat: 'txt',
      glossaryId: 'glossary',
      glossary: {},
      favoredId: 'default',
      sourceBookMetadata: { title: '目录译题测试', languages: ['ja'] },
    });
    transaction.objectStore('chapter').put({
      id: 'translated-catalog.txt/0',
      volumeId: 'translated-catalog.txt',
      paragraphs: ['第一章：出发', '正文'],
      segmentIds: ['title', 'body'],
      gpt: {
        glossaryId: 'glossary',
        glossary: {},
        paragraphs: ['译题：启程', '译文'],
      },
    });
    transaction.objectStore('reader-settings').put({
      id: 'default',
      defaultMode: 'translated',
      translationPriority: ['gpt', 'sakura', 'youdao', 'baidu'],
      autoTranslationPreloadPages: 3,
      retranslationPolicy: 'ask',
      fontSize: 18,
      lineHeight: 1.9,
      contentWidth: 840,
      horizontalPadding: 24,
      theme: 'system',
      flow: 'auto',
      updatedAt: 1,
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });

  await page.goto('/books/translated-catalog.txt/read/0');
  await expect(page.locator('.book-reader__chapter-status')).toHaveText(
    '译题：启程',
  );
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await expect(page.locator('.book-reader__catalog-title')).toHaveText(
    '译题：启程',
  );
  await page.keyboard.press('Escape');
  await page.keyboard.press('4');
  await expect(page.locator('.book-reader__chapter-status')).toHaveText(
    '第一章：出发',
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.keyboard.press('1');
  await expect(page.locator('.book-reader__chapter-status')).toHaveText(
    '译题：启程',
  );
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await expect(page.locator('.book-reader__catalog-title')).toHaveText(
    '译题：启程',
  );
});

test('keeps inherited reader themes opaque and responsive to system changes', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '轻小说机翻机器人' }),
  ).toBeVisible();
  await expect(page.locator('.n-skeleton')).toHaveCount(0);
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('volumes');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = database.transaction(
      ['metadata', 'chapter', 'reader-settings', 'reader-book-preference'],
      'readwrite',
    );
    transaction.objectStore('metadata').put({
      id: 'theme-reader.txt',
      createAt: 1,
      toc: [{ chapterId: '0', title: '主题测试' }],
      sourceFormat: 'txt',
      glossaryId: 'glossary',
      glossary: {},
      favoredId: 'default',
      sourceBookMetadata: { title: '主题测试', languages: ['zh'] },
    });
    transaction.objectStore('chapter').put({
      id: 'theme-reader.txt/0',
      volumeId: 'theme-reader.txt',
      paragraphs: ['桌面与手机主题正文'],
      segmentIds: ['theme-segment-0'],
    });
    transaction.objectStore('reader-settings').put({
      id: 'default',
      defaultMode: 'original',
      translationPriority: ['gpt', 'sakura', 'youdao', 'baidu'],
      fontSize: 18,
      lineHeight: 1.9,
      contentWidth: 840,
      horizontalPadding: 24,
      theme: 'system',
      flow: 'auto',
      updatedAt: 1,
    });
    transaction.objectStore('reader-book-preference').put({
      bookId: 'theme-reader.txt',
      style: { theme: undefined },
      updatedAt: 1,
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });

  await page.goto('/books/theme-reader.txt/read/0');
  const reader = page.locator('.book-reader');
  const appBar = page.locator('.book-reader__app-bar');
  const bottomNavigation = page.locator('.book-reader__bottom-navigation');
  await expect(reader).toHaveClass(/book-reader--dark/);
  await expect(appBar).toHaveCSS('background-color', 'rgb(36, 36, 36)');
  await expect(bottomNavigation).toHaveCSS(
    'background-color',
    'rgb(36, 36, 36)',
  );
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await expectSheetAboveBottomNavigation(
    page.locator('.reader-sheet'),
    bottomNavigation,
  );
  await expectSheetAboveBottomNavigation(
    page.locator('.reader-sheet__panel'),
    bottomNavigation,
  );
  await expect(page.locator('.reader-sheet__content')).toHaveCSS(
    'scrollbar-color',
    'rgb(98, 98, 98) rgb(36, 36, 36)',
  );
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '目录' })).toHaveCount(0);
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '目录' })).toHaveCount(0);
  const chineseReaderSettings = page.getByRole('dialog', {
    name: '阅读设置',
  });
  await expect(chineseReaderSettings).toBeVisible();
  for (const label of [
    '自动翻译预翻译页数',
    '阅读语言',
    'GPT 翻译器',
    'Sakura 翻译器',
  ]) {
    await expect(
      chineseReaderSettings.getByText(label, { exact: true }),
    ).toHaveCount(0);
  }
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '阅读设置' })).toHaveCount(0);

  await page.getByRole('button', { name: '白天', exact: true }).click();
  await expect(reader).toHaveClass(/book-reader--light/);
  await expect(appBar).toHaveCSS('background-color', 'rgb(241, 241, 241)');

  await page.getByRole('button', { name: '设置', exact: true }).click();
  const themeSetting = page
    .locator('.book-reader__settings-grid .n-form-item')
    .filter({ hasText: '主题' });
  await themeSetting.locator('.n-base-selection').click();
  await page.locator('.n-base-select-menu').getByText('跟随系统').click();
  await page.keyboard.press('Escape');
  await expect(reader).toHaveClass(/book-reader--dark/);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(appBar).toHaveCSS('background-color', 'rgb(36, 36, 36)');
  await expect(bottomNavigation).toHaveCSS(
    'background-color',
    'rgb(36, 36, 36)',
  );
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await expect(reader).toHaveClass(/book-reader--light/);
  await expect(appBar).toHaveCSS('background-color', 'rgb(241, 241, 241)');
  await expect(bottomNavigation).toHaveCSS(
    'background-color',
    'rgb(241, 241, 241)',
  );
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await expectSheetAboveBottomNavigation(
    page.locator('.reader-sheet'),
    bottomNavigation,
  );
  await expectSheetAboveBottomNavigation(
    page.locator('.reader-sheet__panel'),
    bottomNavigation,
  );
  await page.getByRole('button', { name: '工具', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '目录' })).toHaveCount(0);
  const chineseReaderTools = page.getByRole('dialog', { name: '阅读工具' });
  await expect(chineseReaderTools).toBeVisible();
  await expect(
    chineseReaderTools.getByRole('button', {
      name: '阅读语言',
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    chineseReaderTools.getByRole('button', {
      name: '刷新本页',
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: '工具', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '阅读工具' })).toHaveCount(0);
});

test('opens a local bookshelf book safely through the current reader route', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  expect(
    await page
      .locator('html')
      .evaluate((element) => getComputedStyle(element).scrollBehavior),
  ).toBe('auto');
  await expect(
    page.getByRole('heading', { name: '轻小说机翻机器人' }),
  ).toBeVisible();

  await page.evaluate(
    async ({ bookId, descriptionHtml, unsafeText }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('volumes');
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
        navigation: [
          { id: 'part', title: '第一部', level: 0, chapterId: '1' },
          {
            id: 'chapter-0',
            title: '安全开端',
            level: 1,
            parentId: 'part',
            chapterId: '0',
          },
          {
            id: 'chapter-1',
            title: '第二章',
            level: 1,
            parentId: 'part',
            chapterId: '1',
          },
        ],
        glossaryId: 'glossary',
        glossary: {},
        favoredId: 'default',
        sourceFormat: 'txt',
        sourceBookMetadata: {
          title: 'reader-flow',
          authors: [],
          languages: ['ja'],
        },
        bookMetadata: { description: descriptionHtml, languages: ['ja'] },
      });
      transaction.objectStore('chapter').put({
        id: `${bookId}/0`,
        volumeId: bookId,
        paragraphs: [unsafeText, '安全文本', '长段落'.repeat(4000)],
        segmentIds: ['segment-0', 'segment-1', 'segment-2'],
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
    { bookId, descriptionHtml, unsafeText },
  );

  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'reader-flow' }),
  ).toBeVisible();
  await expect(page.getByText('阅读 0%', { exact: true })).toHaveCount(0);
  await expect(page.getByText('翻译 0%', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '开始阅读', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '删除书籍', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: '查看《reader-flow》详情' }).click();
  await expect(page).toHaveURL(/\/books\/reader-flow\.txt\/details$/);
  const infoActionAlignment = await page.evaluate(() => {
    const info = document.querySelector<HTMLElement>(
      '.book-details__info-button',
    );
    const edit = document.querySelector<HTMLElement>(
      '.book-details__edit-button',
    );
    if (info === null || edit === null) {
      throw new Error('缺少书籍信息或编辑按钮');
    }
    const infoBounds = info.getBoundingClientRect();
    const editBounds = edit.getBoundingClientRect();
    return Math.abs(
      infoBounds.top +
        infoBounds.height / 2 -
        (editBounds.top + editBounds.height / 2),
    );
  });
  expect(infoActionAlignment).toBeLessThanOrEqual(1);
  const infoActionStyles = await page.evaluate(() => {
    const info = document.querySelector<HTMLElement>(
      '.book-details__info-button',
    );
    const edit = document.querySelector<HTMLElement>(
      '.book-details__edit-button',
    );
    if (info === null || edit === null) {
      throw new Error('缺少书籍信息或编辑按钮');
    }
    return {
      editBackground: getComputedStyle(edit).backgroundColor,
      editColor: getComputedStyle(edit).color,
      infoColor: getComputedStyle(info).color,
    };
  });
  expect(infoActionStyles.editColor).toBe(infoActionStyles.infoColor);
  expect(infoActionStyles.editBackground).toBe('rgba(0, 0, 0, 0)');
  await expect(
    page.locator('.book-details__title .book-details__edit-button'),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '编辑书籍展示信息', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('总计 2 / GPT 0 / Sakura 0', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.book-details__reading-progress')).toHaveText(
    '阅读进度 0%',
  );
  await expect(page.locator('.book-details__hero-summary')).toContainText(
    '书籍信息',
  );
  const bookDescription = page.locator('.book-details__description');
  await expect(bookDescription.locator('p')).toHaveText(['安全简介', '第二段']);
  await expect(bookDescription.locator('strong')).toHaveText('安全简介');
  await expect(bookDescription.locator('img, script, svg')).toHaveCount(0);
  await expect(bookDescription.locator('[onclick], [style]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__descriptionXss)).toBeUndefined();
  await expect(page.locator('.book-details__content .n-p')).toHaveCount(0);
  await expect(page.locator('.book-details__info-dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '书籍信息', exact: true }).click();
  const bookInfoDialog = page.locator('.book-details__info-dialog');
  await expect(bookInfoDialog).toBeVisible();
  await expect(bookInfoDialog.locator('dt')).toHaveText([
    '作者',
    '语言',
    '章节',
    '书签',
    '导入时间',
    '上次阅读',
    '累计阅读',
    '本地文件',
  ]);
  await expect(bookInfoDialog.locator('dd')).toHaveText([
    '—',
    '日语（ja）',
    '2 章',
    '0',
    '1970/1/1 08:00:00',
    '—',
    '0 分钟',
    'reader-flow.txt',
  ]);
  await expect(
    bookInfoDialog.locator('.book-details__info-item--wide'),
  ).toContainText('reader-flow.txt');
  await bookInfoDialog.locator('.n-base-close').click();
  await expect(bookInfoDialog).toHaveCount(0);
  await expect(page.getByText('阅读语言', { exact: true })).toBeVisible();
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
  await expect(page.getByRole('button', { name: '删除书籍' })).toBeVisible();
  const desktopDetailsViewport = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '删除书籍' }).click();
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
  if (desktopDetailsViewport !== null) {
    await page.setViewportSize(desktopDetailsViewport);
  }
  await expect(
    page.getByRole('button', { name: '返回首页', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: '编辑书籍展示信息', exact: true })
    .click();
  await expect(page).toHaveURL(/\/books\/reader-flow\.txt\/edit$/);
  const coverField = page.locator('.metadata-edit__cover-field');
  await expect(
    coverField.getByRole('button', { name: '移除', exact: true }),
  ).toBeVisible();
  await coverField.getByRole('button', { name: '移除', exact: true }).click();
  await expect(
    coverField.getByRole('button', { name: '上传', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page).toHaveURL(/\/books\/reader-flow\.txt\/details$/);
  await page.getByRole('button', { name: '打开目录', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '目录', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('共 2 章', { exact: true })).toBeVisible();
  await page
    .locator('.book-details__catalog-button')
    .filter({ hasText: '第一部' })
    .click();
  const expectCatalogAlignment = async () => {
    const catalogLayout = await page.evaluate(() => {
      const bounds = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (element === null) {
          throw new Error(`缺少目录布局元素：${selector}`);
        }
        const { left, right } = element.getBoundingClientRect();
        return { left: Math.round(left), right: Math.round(right) };
      };
      return {
        chapterStatus: bounds('.book-details__catalog-button .n-tag'),
        total: bounds('.book-details__catalog-header .n-text'),
        catalogIndexes: document.querySelectorAll(
          '.book-details__catalog-index',
        ).length,
      };
    });
    expect(catalogLayout.catalogIndexes).toBe(0);
    expect(catalogLayout.total.right).toBe(catalogLayout.chapterStatus.right);
  };
  await expectCatalogAlignment();
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '目录', exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '打开目录', exact: true }).click();
  await expectCatalogAlignment();
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '目录', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: '打开目录', exact: true }).click();
  await page.getByRole('button', { name: /第二章/ }).click();
  await expect
    .poll(() => new URL(page.url()).pathname)
    .toBe('/books/reader-flow.txt/read/1');

  await page.goto('/books/reader-flow.txt/details');
  await page.getByRole('button', { name: '返回首页', exact: true }).click();
  await expect(page).toHaveURL('/');
  await expect(
    page.getByRole('heading', { name: 'reader-flow' }),
  ).toBeVisible();

  await page.getByRole('button', { name: '查看《reader-flow》详情' }).click();
  await expect(page).toHaveURL(/\/books\/reader-flow\.txt\/details$/);
  const startReadingButton = page.getByRole('button', { name: /阅读$/ });
  await startReadingButton.focus();
  await expect(startReadingButton).toBeFocused();
  await startReadingButton.click();
  await expect(page).toHaveURL(/\/books\/reader-flow\.txt\/read\/[01]$/);
  await page.goto('/books/reader-flow.txt/read/0');
  await expect(page.getByText(unsafeText, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__readerXss)).toBeUndefined();
  const chapterNavigation = page.locator('.book-reader__bottom-navigation');
  const previousChapterButton = chapterNavigation.getByRole('button', {
    name: '上一章',
  });
  const nextChapterButton = chapterNavigation.getByRole('button', {
    name: '下一章',
  });
  await expect(previousChapterButton).toBeDisabled();
  await expect(nextChapterButton).toBeEnabled();
  await chapterNavigation.getByRole('button', { name: '工具' }).click();
  const readerTools = page.getByRole('dialog', { name: '阅读工具' });
  await expect(readerTools.getByRole('button', { name: '上一章' })).toHaveCount(
    0,
  );
  await expect(readerTools.getByRole('button', { name: '下一章' })).toHaveCount(
    0,
  );
  await chapterNavigation.getByRole('button', { name: '工具' }).click();
  await nextChapterButton.click();
  await expect(page).toHaveURL(/\/books\/reader-flow\.txt\/read\/1$/);
  await chapterNavigation.getByRole('button', { name: '上一章' }).click();
  await expect(page).toHaveURL(/\/books\/reader-flow\.txt\/read\/0$/);
  await expect
    .poll(() =>
      page
        .locator('.book-reader__content')
        .evaluate((element) => element.scrollLeft),
    )
    .toBe(0);
  await page.goto('/books/reader-flow.txt/read/0?segment=segment-0');
  await page.goto('/books/reader-flow.txt/read/0');
  const readerContent = page.locator('.book-reader__content');
  const expectPaginatedVerticalAlignment = async (paddingTop: number) => {
    await expect
      .poll(() =>
        readerContent.evaluate((element, expectedPaddingTop) => {
          const viewport = element.getBoundingClientRect();
          const layout = element
            .querySelector<HTMLElement>('.reader-segment-layout')
            ?.getBoundingClientRect();
          const visibleTextTops = [...element.querySelectorAll('p')]
            .flatMap((paragraph) => [...paragraph.getClientRects()])
            .filter(
              (rect) =>
                rect.right > viewport.left && rect.left < viewport.right,
            )
            .map((rect) => rect.top - viewport.top);
          const firstTextTop = Math.min(...visibleTextTops);
          return (
            Math.abs(window.scrollY) <= 1 &&
            Math.abs(element.scrollTop) <= 1 &&
            layout !== undefined &&
            Math.abs(layout.top - viewport.top) <= 1 &&
            Number.isFinite(firstTextTop) &&
            Math.abs(firstTextTop - expectedPaddingTop) <= 2
          );
        }, paddingTop),
      )
      .toBe(true);
  };
  const readerCatalogButton = page.getByRole('button', {
    name: '目录',
    exact: true,
  });
  await readerCatalogButton.click();
  await expect(page.getByText('共 2 章', { exact: true })).toBeVisible();
  await expect(page.getByText('第一部', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '目录' })).toBeVisible();
  await expect(page.getByRole('button', { name: '关闭目录' })).toBeFocused();
  await page
    .locator('.book-reader__catalog-item')
    .filter({ hasText: '第一部' })
    .click();
  await expect(page).toHaveURL(/\/books\/reader-flow\.txt\/read\/0$/);
  await expect(
    page
      .getByRole('dialog', { name: '目录' })
      .getByText('未翻译', { exact: true })
      .first(),
  ).toHaveCSS('color', 'rgb(51, 54, 57)');
  await page.keyboard.press('Escape');
  await expect(readerCatalogButton).toBeFocused();

  const readerTop = page.locator('.book-reader__app-bar');
  await expect(readerTop).toBeVisible();
  const bookmarkButton = readerTop.getByRole('button', {
    name: '添加当前位置书签',
  });
  await expect(bookmarkButton).toHaveAttribute('aria-pressed', 'false');
  await bookmarkButton.click();
  await expect(page.getByText('已添加书签', { exact: true })).toBeVisible();
  const removeBookmarkButton = readerTop.getByRole('button', {
    name: '取消当前位置书签',
  });
  await expect(removeBookmarkButton).toHaveAttribute('aria-pressed', 'true');
  await removeBookmarkButton.click();
  await expect(page.getByText('已移除书签', { exact: true })).toBeVisible();
  await expect(bookmarkButton).toHaveAttribute('aria-pressed', 'false');
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(readerContent).toHaveClass(/book-reader__content--paginated/);
  await expect(readerContent).not.toHaveClass(
    /book-reader__content--double-spread/,
  );
  await expect
    .poll(() =>
      readerContent
        .locator('.reader-segment-layout')
        .evaluate((element) => getComputedStyle(element).columnCount),
    )
    .toBe('1');
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(
    readerTop
      .getByRole('button', { name: 'GPT 自动翻译' })
      .locator('.n-button__content'),
  ).toHaveCSS('color', 'rgb(51, 54, 57)');
  await expect(readerContent).toHaveClass(/book-reader__content--paginated/);
  await expect(readerContent).toHaveClass(
    /book-reader__content--double-spread/,
  );
  await expect
    .poll(() =>
      readerContent
        .locator('.reader-segment-layout')
        .evaluate((element) => getComputedStyle(element).columnCount),
    )
    .toBe('2');
  await expect
    .poll(() =>
      readerContent.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
    )
    .toBe(true);
  await page.setViewportSize({ width: 1920, height: 800 });
  await expect
    .poll(() =>
      readerContent.evaluate((element) => {
        const viewport = element.getBoundingClientRect();
        const visibleRects = [...element.querySelectorAll('p')]
          .flatMap((paragraph) => [...paragraph.getClientRects()])
          .filter(
            (rect) => rect.right > viewport.left && rect.left < viewport.right,
          );
        return visibleRects.every((rect) => {
          const pageLeft =
            rect.left < viewport.left + viewport.width / 2
              ? viewport.left
              : viewport.left + viewport.width / 2;
          const pageRight = pageLeft + viewport.width / 2;
          return rect.left - pageLeft >= 49 && pageRight - rect.right >= 49;
        });
      }),
    )
    .toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(readerContent.locator('.reader-segment-layout')).toHaveCSS(
    'padding-top',
    '44px',
  );
  await expect(page.locator('.book-reader__bottom-navigation')).toHaveCSS(
    'height',
    '52px',
  );
  await expect
    .poll(async () => {
      const before = await readerContent.evaluate(
        (element) => element.scrollWidth,
      );
      await page.waitForTimeout(200);
      const after = await readerContent.evaluate(
        (element) => element.scrollWidth,
      );
      return before === after ? after : -1;
    })
    .toBeGreaterThan(0);
  const visibleControlsGeometry = await readerContent.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      top: Math.round(rect.top),
      height: Math.round(rect.height),
      clientHeight: element.clientHeight,
      scrollWidth: element.scrollWidth,
      scrollLeft: element.scrollLeft,
    };
  });
  const overlayToggleBounds = await readerContent.boundingBox();
  if (overlayToggleBounds === null) throw new Error('缺少菜单覆盖测试视口');
  await readerContent.click({
    position: {
      x: overlayToggleBounds.width * 0.5,
      y: overlayToggleBounds.height * 0.5,
    },
  });
  await expect(readerTop).toHaveCount(0);
  await expect
    .poll(() =>
      readerContent.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          top: Math.round(rect.top),
          height: Math.round(rect.height),
          clientHeight: element.clientHeight,
          scrollWidth: element.scrollWidth,
          scrollLeft: element.scrollLeft,
        };
      }),
    )
    .toEqual(visibleControlsGeometry);
  await readerContent.click({
    position: {
      x: overlayToggleBounds.width * 0.5,
      y: overlayToggleBounds.height * 0.5,
    },
  });
  await expect(readerTop).toBeVisible();
  const readerBounds = await readerContent.boundingBox();
  if (readerBounds === null) throw new Error('缺少分页正文视口');
  await readerContent.click({
    position: { x: readerBounds.width * 0.9, y: readerBounds.height * 0.5 },
  });
  await expect
    .poll(() => readerContent.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
  const desktopPreviousChapterEnd = await readerContent.evaluate(
    (element) => element.scrollLeft,
  );
  await readerContent.click({
    position: { x: readerBounds.width * 0.1, y: readerBounds.height * 0.5 },
  });
  await expect(page).toHaveURL(/\/books\/reader-flow\.txt\/read\/0$/);
  await expect
    .poll(() => readerContent.evaluate((element) => element.scrollLeft))
    .toBeLessThan(desktopPreviousChapterEnd);
  await readerContent.click({
    position: { x: readerBounds.width * 0.9, y: readerBounds.height * 0.5 },
  });
  await expect
    .poll(() => readerContent.evaluate((element) => element.scrollLeft))
    .toBe(desktopPreviousChapterEnd);
  await expect
    .poll(() =>
      readerContent.evaluate((element) => {
        const page = element.scrollLeft / Math.max(1, element.clientWidth);
        return Math.abs(page - Math.round(page));
      }),
    )
    .toBeLessThan(0.01);
  await expect
    .poll(() =>
      readerContent.evaluate((element) => {
        const viewport = element.getBoundingClientRect();
        return [...element.querySelectorAll('p')]
          .flatMap((paragraph) => [...paragraph.getClientRects()])
          .filter(
            (rect) => rect.right > viewport.left && rect.left < viewport.right,
          )
          .every(
            (rect) =>
              rect.left >= viewport.left - 0.5 &&
              rect.right <= viewport.right + 0.5,
          );
      }),
    )
    .toBe(true);
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(readerContent).not.toHaveClass(
    /book-reader__content--double-spread/,
  );
  await expect
    .poll(() =>
      readerContent.evaluate((element) => {
        const page = element.scrollLeft / Math.max(1, element.clientWidth);
        return Math.abs(page - Math.round(page));
      }),
    )
    .toBeLessThan(0.01);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(readerContent).toHaveClass(
    /book-reader__content--double-spread/,
  );
  await expect
    .poll(() =>
      readerContent.evaluate((element) => {
        const page = element.scrollLeft / Math.max(1, element.clientWidth);
        return Math.abs(page - Math.round(page));
      }),
    )
    .toBeLessThan(0.01);
  await readerContent.evaluate((element) =>
    element.scrollTo({ left: element.scrollWidth, behavior: 'auto' }),
  );
  await expect
    .poll(() =>
      readerContent.evaluate(
        (element) =>
          element.scrollLeft + element.clientWidth >= element.scrollWidth - 2,
      ),
    )
    .toBe(true);
  await readerContent.click({
    position: { x: readerBounds.width * 0.9, y: readerBounds.height * 0.5 },
  });
  await expect(page).toHaveURL(/\/books\/reader-flow\.txt\/read\/1$/);
  await expectPaginatedVerticalAlignment(44);
  await readerContent.click({
    position: { x: readerBounds.width * 0.1, y: readerBounds.height * 0.5 },
  });
  await expect(page).toHaveURL(/\/books\/reader-flow\.txt\/read\/0$/);
  await expect
    .poll(() => readerContent.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
  await expectPaginatedVerticalAlignment(44);
  for (let index = 0; index < 3; index += 1) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await readerContent.evaluate((element) =>
        element.scrollTo({ left: element.scrollWidth, behavior: 'auto' }),
      );
      await readerContent.click({
        position: {
          x: readerBounds.width * 0.9,
          y: readerBounds.height * 0.5,
        },
      });
      if (page.url().endsWith('/read/1')) break;
    }
    await expect(page).toHaveURL(/\/books\/reader-flow\.txt\/read\/1$/);
    await expectPaginatedVerticalAlignment(44);
    await readerContent.click({
      position: { x: readerBounds.width * 0.1, y: readerBounds.height * 0.5 },
    });
    await expect(page).toHaveURL(/\/books\/reader-flow\.txt\/read\/0$/);
    await expectPaginatedVerticalAlignment(44);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(readerContent).toHaveClass(/book-reader__content--scrolled/);
  const translationToggle = page.getByRole('button', {
    name: '展开未翻译操作',
  });
  await expect(translationToggle).toBeVisible();
  await expect(page.getByRole('button', { name: 'GPT 自动翻译' })).toBeHidden();
  await translationToggle.click();
  await expect(
    page.getByRole('button', { name: 'GPT 自动翻译' }),
  ).toBeVisible();
  const translationLayer = page.locator('.reader-sheet--top');
  const translationPopover = translationLayer.locator('.reader-sheet__panel');
  await expect(
    translationPopover.getByRole('button', {
      name: '阅读语言',
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    translationPopover.getByRole('button', {
      name: '刷新本页',
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(translationLayer).toHaveCSS('position', 'fixed');
  await expect(translationPopover).toHaveCSS('border-top-width', '0px');
  await expect(translationPopover).toHaveCSS('border-bottom-width', '1px');
  const mobileAppBarBounds = await page
    .locator('.book-reader__app-bar')
    .boundingBox();
  const translationPopoverBounds = await translationPopover.boundingBox();
  expect(mobileAppBarBounds).not.toBeNull();
  expect(translationPopoverBounds).not.toBeNull();
  expect(
    Math.abs(
      translationPopoverBounds!.y -
        (mobileAppBarBounds!.y + mobileAppBarBounds!.height),
    ),
  ).toBeLessThanOrEqual(1);
  const popoverTop = await translationPopover.evaluate((element) =>
    Math.round(element.getBoundingClientRect().top),
  );
  await page.evaluate(() => window.scrollBy(0, 300));
  await expect
    .poll(() =>
      translationPopover.evaluate((element) =>
        Math.round(element.getBoundingClientRect().top),
      ),
    )
    .toBe(popoverTop);
  const translationLayerBounds = await translationLayer.boundingBox();
  if (translationLayerBounds === null) throw new Error('缺少翻译悬浮层');
  await translationLayer.click({
    position: { x: 4, y: translationLayerBounds.height - 4 },
  });
  await expect(page.getByRole('button', { name: 'GPT 自动翻译' })).toBeHidden();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const mobileReaderSettings = page.getByRole('dialog', {
    name: '阅读设置',
  });
  await expect(
    mobileReaderSettings.getByText('阅读语言', { exact: true }),
  ).toBeVisible();
  await expect(
    mobileReaderSettings.getByText('GPT 翻译器', { exact: true }),
  ).toBeVisible();
  const mobileSettingsBoundsBeforeHelp =
    await mobileReaderSettings.boundingBox();
  await mobileReaderSettings
    .getByRole('button', { name: '自动翻译预翻译说明' })
    .click();
  const preloadExplanation = page.locator('.book-reader__mobile-preload-help');
  await expect(preloadExplanation).toBeVisible();
  const preloadExplanationBounds = await preloadExplanation.boundingBox();
  expect(preloadExplanationBounds).not.toBeNull();
  expect(preloadExplanationBounds!.x).toBeGreaterThanOrEqual(0);
  expect(
    preloadExplanationBounds!.x + preloadExplanationBounds!.width,
  ).toBeLessThanOrEqual(390);
  expect(await mobileReaderSettings.boundingBox()).toEqual(
    mobileSettingsBoundsBeforeHelp,
  );
  await mobileReaderSettings
    .getByRole('button', { name: '自动翻译预翻译说明' })
    .click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '夜晚', exact: true }).click();
  await translationToggle.click();
  await expect(translationPopover).toBeVisible();
  await page.getByRole('button', { name: '收起未翻译操作' }).click();
  await page.getByRole('button', { name: '白天', exact: true }).click();
  await expect(page.locator('.book-reader__bottom-navigation')).toHaveCSS(
    'height',
    '76px',
  );
  const crossChapterPreview = async (direction: 'previous' | 'next') => {
    await expect(
      page.locator(`[data-reader-chapter-preview="${direction}"]`),
    ).toBeVisible();
    await page.waitForTimeout(100);
    await page.evaluate((targetDirection) => {
      const preview = document.querySelector<HTMLElement>(
        `[data-reader-chapter-preview="${targetDirection}"][data-reader-adjacent-preview="true"]`,
      );
      const edge =
        targetDirection === 'next'
          ? (document
              .querySelector<HTMLElement>('.book-reader__app-bar')
              ?.getBoundingClientRect().bottom ?? 0)
          : (document
              .querySelector<HTMLElement>('.book-reader__bottom-navigation')
              ?.getBoundingClientRect().top ?? window.innerHeight);
      const rect = preview?.getBoundingClientRect();
      window.scrollTo(
        0,
        window.scrollY +
          (targetDirection === 'next'
            ? (rect?.top ?? 0) - edge - 4
            : (rect?.bottom ?? 0) - edge + 4),
      );
    }, direction);
    const wheelPoint = await page
      .locator('.book-reader__content')
      .evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          x: Math.max(
            1,
            Math.min(window.innerWidth - 1, rect.x + rect.width / 2),
          ),
          y: Math.max(
            1,
            Math.min(window.innerHeight - 1, window.innerHeight / 2),
          ),
        };
      });
    await page.mouse.move(wheelPoint.x, wheelPoint.y);
    await page.mouse.wheel(0, direction === 'next' ? 50 : -50);
  };
  await page.evaluate(() => {
    const current = document.querySelector<HTMLElement>(
      '[data-reader-chapter-id]',
    );
    const navigation = document.querySelector<HTMLElement>(
      '.book-reader__bottom-navigation',
    );
    window.scrollTo(
      0,
      window.scrollY +
        (current?.getBoundingClientRect().bottom ?? 0) -
        (navigation?.getBoundingClientRect().top ?? window.innerHeight),
    );
  });
  await expect
    .poll(() =>
      readerTop.evaluate((element) =>
        Math.round(element.getBoundingClientRect().top),
      ),
    )
    .toBeLessThanOrEqual(1);
  await expect(page.locator('.book-reader__loading')).toHaveCount(0);
  await expect(
    readerContent.locator('.book-reader__continuous-chapter'),
  ).toHaveCount(2);
  await expect(
    readerContent.locator('[data-reader-chapter-id="0"]'),
  ).toBeVisible();
  await crossChapterPreview('next');
  await expect(page).toHaveURL(/\/books\/reader-flow\.txt\/read\/1$/);
  await expect(
    readerContent.locator('[data-reader-chapter-id="1"]'),
  ).toBeVisible();
  await crossChapterPreview('previous');
  await expect(page).toHaveURL(/\/books\/reader-flow\.txt\/read\/0$/);
  await crossChapterPreview('next');
  await expect(page).toHaveURL(/\/books\/reader-flow\.txt\/read\/1$/);
  await expect
    .poll(() =>
      readerTop.evaluate((element) =>
        Math.round(element.getBoundingClientRect().top),
      ),
    )
    .toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: '工具', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: '阅读工具' }).getByRole('button', {
      name: '添加书签',
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '书籍信息', exact: true }),
  ).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '书籍信息' })).toBeHidden();
  await expect(page.locator('.n-drawer-mask')).toHaveCount(0);
  await readerContent.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        clientX: rect.left + rect.width / 2,
        clientY: Math.max(rect.top, 0) + 200,
      }),
    );
  });
  await expect(readerTop).toHaveCount(0);
  await expect(page.locator('.book-reader__progress-track')).toBeVisible();
  await readerContent.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        clientX: rect.left + rect.width / 2,
        clientY: Math.max(rect.top, 0) + 200,
      }),
    );
  });
  await expect(readerTop).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/books/reader-flow.txt/read/0');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(
    page.locator('.book-reader__settings-grid .n-form-item-label').first(),
  ).toHaveCSS('color', 'rgb(31, 34, 37)');
  const themeSetting = page
    .locator('.book-reader__settings-grid .n-form-item')
    .filter({ hasText: '主题' });
  await themeSetting.locator('.n-base-selection').click();
  await page.locator('.n-base-select-menu').getByText('护眼').click();
  await expect(page.locator('.book-reader')).toHaveClass(/book-reader--sepia/);
  await expect(themeSetting.locator('.n-base-selection-label')).toHaveCSS(
    'background-color',
    'rgb(240, 229, 203)',
  );
  await expect(page.locator('.n-slider-rail').first()).toHaveCSS(
    'background-color',
    'rgb(199, 185, 154)',
  );
  await themeSetting.locator('.n-base-selection').click();
  await expect(page.locator('.n-base-select-menu')).toHaveCSS(
    'background-color',
    'rgb(240, 229, 203)',
  );
  await page.locator('.n-base-select-menu').getByText('护眼').click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page
    .getByRole('dialog', { name: '目录' })
    .getByRole('button', { name: '第一部' })
    .click();
  await expect(
    page
      .getByRole('dialog', { name: '目录' })
      .getByText('未翻译', { exact: true })
      .first()
      .locator('..'),
  ).toHaveCSS('background-color', 'rgb(228, 215, 184)');
  await expect(
    page
      .getByRole('dialog', { name: '目录' })
      .locator('.book-reader__catalog-item--active'),
  ).toHaveCSS('color', 'rgb(47, 175, 134)');
  await expect(page.locator('.reader-sheet__content')).toHaveCSS(
    'scrollbar-color',
    'rgb(160, 142, 109) rgb(232, 221, 195)',
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '工具', exact: true }).click();
  await expect(
    page
      .getByRole('dialog', { name: '阅读工具' })
      .getByRole('button', { name: '书籍信息' })
      .locator('.n-button__border'),
  ).toHaveCSS('border-top-color', 'rgb(157, 139, 108)');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await themeSetting.locator('.n-base-selection').click();
  await page.locator('.n-base-select-menu').getByText('超暗').click();
  await expect(page.locator('.book-reader')).toHaveClass(
    /book-reader--ultra-dark/,
  );
  await expect(page.locator('.book-reader')).toHaveCSS(
    'background-color',
    'rgb(0, 0, 0)',
  );
  await expect(readerContent).toHaveCSS('color', 'rgb(75, 75, 75)');
  await expect(page.locator('.book-reader__app-bar')).toHaveCSS(
    'background-color',
    'rgb(5, 5, 5)',
  );
  await expect(page.locator('.book-reader__app-bar-translation')).toHaveCSS(
    'color',
    'rgb(64, 56, 47)',
  );
  expect(
    await page.locator('.book-reader').evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        background: style
          .getPropertyValue('--reader-warning-background')
          .trim(),
        border: style.getPropertyValue('--reader-warning-border').trim(),
        buttonBorder: style
          .getPropertyValue('--reader-warning-button-border')
          .trim(),
        text: style.getPropertyValue('--reader-warning-text').trim(),
      };
    }),
  ).toEqual({
    background: '#060504',
    border: '#211a12',
    buttonBorder: '#282018',
    text: '#40382f',
  });
  await expect(themeSetting.locator('.n-base-selection-label')).toHaveCSS(
    'background-color',
    'rgb(11, 11, 11)',
  );
  const ultraDarkSliderHandles = page.locator('.reader-sheet .n-slider-handle');
  const ultraDarkSliderFills = page.locator(
    '.reader-sheet .n-slider-rail__fill',
  );
  await expect(ultraDarkSliderHandles).toHaveCount(4);
  await expect(ultraDarkSliderFills).toHaveCount(4);
  expect(
    await ultraDarkSliderHandles.evaluateAll((handles) =>
      handles.map((handle) => getComputedStyle(handle).backgroundColor),
    ),
  ).toEqual(Array(4).fill('rgb(36, 36, 36)'));
  expect(
    (
      await ultraDarkSliderFills.evaluateAll((fills) =>
        fills.map((fill) => getComputedStyle(fill).backgroundColor),
      )
    ).every(
      (color) => color === 'rgb(37, 73, 63)' || color === 'rgb(45, 87, 75)',
    ),
  ).toBe(true);
  expect(
    await page.locator('.book-reader').evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        track: style.getPropertyValue('--reader-progress-track').trim(),
        color: style.getPropertyValue('--reader-progress-color').trim(),
      };
    }),
  ).toEqual({ track: '#0c0c0c', color: '#25493f' });
  await themeSetting.locator('.n-base-selection').click();
  await page.locator('.n-base-select-menu').getByText('浅色').click();
  const flowSetting = page
    .locator('.book-reader__settings-grid .n-form-item')
    .filter({ hasText: '阅读流' });
  await flowSetting.locator('.n-base-selection').click();
  await page.getByText('滚动', { exact: true }).click();
  await expect(readerContent).toHaveClass(/book-reader__content--scrolled/);
  await expect(readerContent).not.toHaveClass(
    /book-reader__content--double-spread/,
  );
  await expect
    .poll(() =>
      readerContent
        .locator('[data-reader-chapter-id] .reader-segment-layout')
        .evaluate((element) => getComputedStyle(element).columnCount),
    )
    .toBe('auto');
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const current = document.querySelector<HTMLElement>(
      '[data-reader-chapter-id]',
    );
    const navigation = document.querySelector<HTMLElement>(
      '.book-reader__bottom-navigation',
    );
    window.scrollTo(
      0,
      window.scrollY +
        (current?.getBoundingClientRect().bottom ?? 0) -
        (navigation?.getBoundingClientRect().top ?? window.innerHeight),
    );
  });
  await expect(page.locator('.book-reader__loading')).toHaveCount(0);
  await expect(
    readerContent.locator('.book-reader__continuous-chapter'),
  ).toHaveCount(2);
  await crossChapterPreview('next');
  await expect(page).toHaveURL(/\/books\/reader-flow\.txt\/read\/1$/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await flowSetting.locator('.n-base-selection').click();
  await page.getByText('分页', { exact: true }).click();
  await expect(readerContent).toHaveClass(/book-reader__content--paginated/);
  await expect(readerContent.locator('.reader-segment-layout')).toHaveCSS(
    'padding-top',
    '46px',
  );
  await page.keyboard.press('Escape');
  const mobileReaderBounds = await readerContent.boundingBox();
  if (mobileReaderBounds === null) throw new Error('缺少手机分页正文视口');
  await readerContent.click({
    position: {
      x: mobileReaderBounds.width * 0.1,
      y: mobileReaderBounds.height * 0.5,
    },
  });
  await expect(page).toHaveURL(/\/books\/reader-flow\.txt\/read\/0$/);
  await expect
    .poll(() =>
      readerContent.evaluate((element) => {
        const pageLabel = element.getAttribute('aria-label');
        const match = pageLabel?.match(/第 (\d+) \/ (\d+) 页/);
        return match !== null && match !== undefined && match[1] === match[2];
      }),
    )
    .toBe(true);
  const mobilePreviousChapterEnd = await readerContent.evaluate(
    (element) => element.scrollLeft,
  );
  await readerContent.click({
    position: {
      x: mobileReaderBounds.width * 0.1,
      y: mobileReaderBounds.height * 0.5,
    },
  });
  await expect(page).toHaveURL(/\/books\/reader-flow\.txt\/read\/0$/);
  await expect
    .poll(() => readerContent.evaluate((element) => element.scrollLeft))
    .toBeLessThan(mobilePreviousChapterEnd);
  await readerContent.click({
    position: {
      x: mobileReaderBounds.width * 0.9,
      y: mobileReaderBounds.height * 0.5,
    },
  });
  await expect
    .poll(() => readerContent.evaluate((element) => element.scrollLeft))
    .toBe(mobilePreviousChapterEnd);
  await expect
    .poll(() =>
      readerContent.evaluate((element) => {
        const viewport = element.getBoundingClientRect();
        const visibleLefts = [...element.querySelectorAll('p')]
          .flatMap((paragraph) => [...paragraph.getClientRects()])
          .filter(
            (rect) => rect.right > viewport.left && rect.left < viewport.right,
          )
          .map((rect) => rect.left - viewport.left);
        return Math.min(...visibleLefts);
      }),
    )
    .toBeGreaterThanOrEqual(21);
  await readerContent.click({
    position: {
      x: mobileReaderBounds.width * 0.9,
      y: mobileReaderBounds.height * 0.5,
    },
  });
  await expect(page).toHaveURL(/\/books\/reader-flow\.txt\/read\/1$/);
  await expectPaginatedVerticalAlignment(46);
  await expect
    .poll(() => readerContent.evaluate((element) => element.scrollLeft))
    .toBe(0);
  for (let index = 0; index < 3; index += 1) {
    await readerContent.click({
      position: {
        x: mobileReaderBounds.width * 0.1,
        y: mobileReaderBounds.height * 0.5,
      },
    });
    await expect(page).toHaveURL(/\/books\/reader-flow\.txt\/read\/0$/);
    await expectPaginatedVerticalAlignment(46);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await readerContent.evaluate((element) =>
        element.scrollTo({ left: element.scrollWidth, behavior: 'auto' }),
      );
      await readerContent.click({
        position: {
          x: mobileReaderBounds.width * 0.9,
          y: mobileReaderBounds.height * 0.5,
        },
      });
      if (page.url().endsWith('/read/1')) break;
    }
    await expect(page).toHaveURL(/\/books\/reader-flow\.txt\/read\/1$/);
    await expectPaginatedVerticalAlignment(46);
  }
  const firstChapterTwoSegment = readerContent.locator(
    '[data-reader-segment-id="chapter-1-segment-0"]',
  );
  await expect(firstChapterTwoSegment).toBeVisible();
  const firstSegmentBounds = await firstChapterTwoSegment.boundingBox();
  const currentReaderBounds = await readerContent.boundingBox();
  if (firstSegmentBounds === null || currentReaderBounds === null) {
    throw new Error('缺少跨章后的首段布局');
  }
  expect(firstSegmentBounds.x).toBeGreaterThanOrEqual(currentReaderBounds.x);

  await page.goto('/books/reader-flow.txt/read/0');
  await expect(page.getByText('安全文本', { exact: true })).toBeVisible();

  await page.evaluate(
    async ({ bookId }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('volumes');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      const transaction = database.transaction('chapter', 'readwrite');
      const store = transaction.objectStore('chapter');
      const chapter = await new Promise<Record<string, unknown>>(
        (resolve, reject) => {
          const request = store.get(`${bookId}/0`);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        },
      );
      store.put({
        ...chapter,
        gpt: {
          glossaryId: 'gpt',
          glossary: {},
          paragraphs: ['安全译文', '完整译文', '长译文'],
        },
      });
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
    },
    { bookId },
  );
  await page.reload();
  await expect(
    page.getByRole('button', { name: '展开未翻译操作' }),
  ).toHaveCount(0);
  const completeChapterHeader = page.locator('.book-reader__app-bar');
  const completeChapterBookmarkButton = completeChapterHeader.getByRole(
    'button',
    {
      name: '添加当前位置书签',
    },
  );
  const completeChapterHeaderBounds = await completeChapterHeader.boundingBox();
  const completeChapterBookmarkBounds =
    await completeChapterBookmarkButton.boundingBox();
  if (
    completeChapterHeaderBounds === null ||
    completeChapterBookmarkBounds === null
  ) {
    throw new Error('缺少完整译文章节的手机顶栏');
  }
  expect(
    Math.round(
      completeChapterBookmarkBounds.x + completeChapterBookmarkBounds.width,
    ),
  ).toBe(
    Math.round(
      completeChapterHeaderBounds.x + completeChapterHeaderBounds.width,
    ),
  );
});

test('keeps keyboard pagination and every reading mode across responsive layout', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const modeBookId = 'reader-mode-progress.txt';
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '轻小说机翻机器人' }),
  ).toBeVisible({ timeout: 10_000 });
  await page.evaluate(async (bookId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('volumes');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const paragraphs = Array.from(
      { length: 80 },
      (_, index) => `原文 ${index + 1} ${'分页稳定性内容'.repeat(10)}`,
    );
    const transaction = database.transaction(
      [
        'metadata',
        'chapter',
        'reader-settings',
        'reader-bookshelf',
        'reader-book-preference',
      ],
      'readwrite',
    );
    transaction.objectStore('metadata').put({
      id: bookId,
      createAt: 1,
      toc: [
        { chapterId: '0', title: '模式与进度', gpt: 'gpt-glossary' },
        { chapterId: '1', title: '快捷键章节' },
      ],
      sourceFormat: 'txt',
      glossaryId: 'glossary',
      glossary: {},
      favoredId: 'default',
      sourceBookMetadata: {
        title: '模式与进度',
        authors: [],
        languages: ['ja'],
      },
    });
    transaction.objectStore('chapter').put({
      id: `${bookId}/0`,
      volumeId: bookId,
      paragraphs,
      segmentIds: paragraphs.map((_, index) => `mode-segment-${index}`),
      gpt: {
        glossaryId: 'gpt-glossary',
        glossary: {},
        paragraphs: paragraphs.map(
          (_, index) => `译文 ${index + 1} ${'分页稳定性译文'.repeat(10)}`,
        ),
      },
    });
    transaction.objectStore('chapter').put({
      id: `${bookId}/1`,
      volumeId: bookId,
      paragraphs: ['第二章快捷键正文'],
      segmentIds: ['mode-chapter-1-segment'],
    });
    transaction.objectStore('reader-settings').put({
      id: 'default',
      defaultMode: 'original-translated',
      translationPriority: ['gpt', 'sakura', 'youdao', 'baidu'],
      fontSize: 18,
      lineHeight: 1.9,
      contentWidth: 840,
      horizontalPadding: 64,
      theme: 'light',
      flow: 'paginated',
      updatedAt: 1,
    });
    transaction.objectStore('reader-bookshelf').put({
      bookId,
      pinned: false,
      addedAt: 1,
      updatedAt: 1,
    });
    transaction.objectStore('reader-book-preference').put({
      bookId,
      style: { theme: 'dark' },
      updatedAt: 1,
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }, modeBookId);

  await page.goto(`/books/${modeBookId}/read/0`);
  const reader = page.locator('.book-reader');
  const readerContent = page.locator('.book-reader__content');
  const layout = readerContent.locator('.reader-segment-layout');
  await expect(reader).toHaveClass(/book-reader--dark/);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollHeight <=
          document.documentElement.clientHeight,
      ),
    )
    .toBe(true);
  await expect(page.locator('.book-reader__app-bar')).toHaveCSS(
    'background-color',
    'rgb(36, 36, 36)',
  );
  await expect(layout).toHaveClass(
    /reader-segment-layout--original-translated/,
  );
  await expect(layout).toHaveCSS('padding-left', '64px');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const paginationSettings = page.getByRole('dialog', { name: '阅读设置' });
  const contentWidthSetting = paginationSettings
    .locator('.n-form-item')
    .filter({ hasText: '正文宽度' });
  const contentWidthSlider = contentWidthSetting.getByRole('slider');
  const contentWidthSliderRail = contentWidthSetting.locator('.n-slider');
  const contentWidthSliderBounds = await contentWidthSliderRail.boundingBox();
  expect(contentWidthSliderBounds).not.toBeNull();
  await contentWidthSliderRail.click({
    position: { x: 1, y: contentWidthSliderBounds!.height / 2 },
  });
  await expect(contentWidthSlider).toHaveAttribute('aria-valuenow', '480');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(layout).toHaveCSS('padding-left', '80px');

  await page.getByRole('button', { name: '工具', exact: true }).click();
  await expect(
    page
      .getByRole('dialog', { name: '阅读工具' })
      .getByRole('button', { name: '阅读语言', exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole('dialog', { name: '阅读工具' })
      .getByRole('button', { name: '刷新本页', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '关闭阅读工具' }).click();

  const chooseMode = async (shortcut: string, expectedClass: RegExp) => {
    await page.keyboard.press(shortcut);
    await expect(layout).toHaveClass(expectedClass);
  };
  await chooseMode('1', /reader-segment-layout--translated$/);
  await expect(
    readerContent.locator('.reader-segment').first().locator('p'),
  ).toHaveClass(/reader-segment__translated/);
  await chooseMode('2', /reader-segment-layout--translated-original/);
  await expect(
    readerContent.locator('.reader-segment').first().locator('p'),
  ).toHaveClass([/reader-segment__translated/, /reader-segment__original/]);
  await chooseMode('3', /reader-segment-layout--original-translated/);
  await expect(
    readerContent.locator('.reader-segment').first().locator('p'),
  ).toHaveClass([/reader-segment__original/, /reader-segment__translated/]);
  await chooseMode('4', /reader-segment-layout--original$/);
  await expect(layout).toHaveClass(/reader-segment-layout--original$/);
  await expect(
    readerContent.locator('.reader-segment').first().locator('p'),
  ).toHaveCount(1);

  await readerContent.focus();
  const initialScrollLeft = await readerContent.evaluate(
    (element) => element.scrollLeft,
  );
  await page.keyboard.press('PageDown');
  await expect
    .poll(() => readerContent.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(initialScrollLeft);
  const getLeftPageSegment = () =>
    readerContent.evaluate((element) => {
      const viewport = element.getBoundingClientRect();
      return [
        ...element.querySelectorAll<HTMLElement>(
          '[data-reader-segment-id] [data-reader-language-side]',
        ),
      ]
        .flatMap((paragraph) =>
          [...paragraph.getClientRects()]
            .filter(
              (rect) =>
                rect.right > viewport.left && rect.left < viewport.right,
            )
            .map((rect) => ({
              left: rect.left,
              top: rect.top,
              segmentId: paragraph.closest<HTMLElement>(
                '[data-reader-segment-id]',
              )?.dataset.readerSegmentId,
            })),
        )
        .sort(
          (left, right) => left.left - right.left || left.top - right.top,
        )[0]?.segmentId;
    });
  const expectModeSwitchKeepsPosition = async (
    key: string,
    expectedClass: RegExp,
  ) => {
    const anchor = await getLeftPageSegment();
    expect(anchor).toBeTruthy();
    await page.keyboard.press(key);
    await expect(layout).toHaveClass(expectedClass);
    await expect
      .poll(() =>
        readerContent.evaluate((element, segmentId) => {
          const viewport = element.getBoundingClientRect();
          const segment = element.querySelector<HTMLElement>(
            `[data-reader-segment-id="${segmentId}"]`,
          );
          return (
            segment !== null &&
            [...segment.getClientRects()].some(
              (rect) =>
                rect.right > viewport.left && rect.left < viewport.right,
            )
          );
        }, anchor),
      )
      .toBe(true);
  };
  await expectModeSwitchKeepsPosition(
    '1',
    /reader-segment-layout--translated$/,
  );
  await expectModeSwitchKeepsPosition(
    '2',
    /reader-segment-layout--translated-original/,
  );
  await expectModeSwitchKeepsPosition(
    '3',
    /reader-segment-layout--original-translated/,
  );
  await expectModeSwitchKeepsPosition('4', /reader-segment-layout--original$/);
  const visibleSegmentId = await getLeftPageSegment();
  expect(visibleSegmentId).toBeTruthy();
  await expect
    .poll(() =>
      page.evaluate(async (bookId) => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('volumes');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });
        const transaction = database.transaction('reader-progress', 'readonly');
        const request = transaction.objectStore('reader-progress').get(bookId);
        const value = await new Promise<
          { segmentId?: string; scrollRatio?: number } | undefined
        >((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        database.close();
        return value;
      }, modeBookId),
    )
    .toMatchObject({
      segmentId: visibleSegmentId,
      scrollRatio: expect.any(Number),
    });

  await page.reload();
  await expect(layout).toHaveClass(
    /reader-segment-layout--original-translated/,
  );
  await expect
    .poll(() =>
      readerContent.evaluate((element, segmentId) => {
        const viewport = element.getBoundingClientRect();
        const target = element.querySelector<HTMLElement>(
          `[data-reader-segment-id="${segmentId}"]`,
        );
        return (
          target !== null &&
          [...target.getClientRects()].some(
            (rect) => rect.right > viewport.left && rect.left < viewport.right,
          )
        );
      }, visibleSegmentId),
    )
    .toBe(true);

  await page.setViewportSize({ width: 800, height: 1100 });
  await expect(readerContent).not.toHaveClass(
    /book-reader__content--double-spread/,
  );
  await expect
    .poll(() =>
      readerContent.evaluate((element, segmentId) => {
        const viewport = element.getBoundingClientRect();
        const target = element.querySelector<HTMLElement>(
          `[data-reader-segment-id="${segmentId}"]`,
        );
        return (
          target !== null &&
          [...target.getClientRects()].some(
            (rect) => rect.right > viewport.left && rect.left < viewport.right,
          )
        );
      }, visibleSegmentId),
    )
    .toBe(true);
  await expectModeSwitchKeepsPosition(
    '2',
    /reader-segment-layout--translated-original/,
  );
  await expectModeSwitchKeepsPosition('4', /reader-segment-layout--original$/);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(readerContent).toHaveClass(
    /book-reader__content--double-spread/,
  );
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('volumes');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = database.transaction('reader-settings', 'readwrite');
    const store = transaction.objectStore('reader-settings');
    const request = store.get('default');
    const current = await new Promise<Record<string, unknown>>(
      (resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      },
    );
    store.put({ ...current, flow: 'scrolled', updatedAt: Date.now() });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });
  await page.reload();
  await expect(readerContent).toHaveClass(/book-reader__content--scrolled/);
  const activeScrolledLayout = readerContent.locator(
    '[data-reader-chapter-id] .reader-segment-layout',
  );
  const scrolledAnchor = readerContent.locator(
    '[data-reader-segment-id="mode-segment-40"] [data-reader-language-side="original"]',
  );
  await scrolledAnchor.evaluate((element) =>
    element.scrollIntoView({ block: 'start', behavior: 'auto' }),
  );
  await scrolledAnchor.evaluate((element) => {
    const visibleTop =
      document
        .querySelector<HTMLElement>('.book-reader__app-bar')
        ?.getBoundingClientRect().bottom ?? 0;
    window.scrollBy({
      top: element.getBoundingClientRect().top - visibleTop,
      behavior: 'auto',
    });
  });
  const getScrollAnchor = (targetOffset?: number | null) =>
    scrolledAnchor.evaluate((element, requestedOffset) => {
      const top =
        document
          .querySelector<HTMLElement>('.book-reader__app-bar')
          ?.getBoundingClientRect().bottom ?? 0;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const positions: Array<{ offset: number; top: number }> = [];
      let node = walker.nextNode();
      let paragraphOffset = 0;
      while (node !== null) {
        const text = node.textContent ?? '';
        for (let offset = 0; offset < text.length; offset += 1) {
          const range = document.createRange();
          range.setStart(node, offset);
          range.setEnd(node, offset + 1);
          for (const rect of range.getClientRects()) {
            const absoluteOffset = paragraphOffset + offset;
            if (
              requestedOffset === absoluteOffset ||
              ((requestedOffset === undefined || requestedOffset === null) &&
                rect.top >= top - 1 &&
                rect.bottom <= window.innerHeight + 1)
            ) {
              positions.push({ offset: absoluteOffset, top: rect.top });
            }
          }
        }
        paragraphOffset += text.length;
        node = walker.nextNode();
      }
      return positions.sort((left, right) => left.top - right.top)[0];
    }, targetOffset);
  const scrollAnchor = await getScrollAnchor();
  expect(scrollAnchor).toBeTruthy();
  await page.keyboard.press('2');
  await expect(activeScrolledLayout).toHaveClass(
    /reader-segment-layout--translated-original/,
  );
  await expect
    .poll(async () => {
      const restoredAnchor = await getScrollAnchor(scrollAnchor?.offset);
      return restoredAnchor === undefined || scrollAnchor === undefined
        ? Number.POSITIVE_INFINITY
        : Math.abs(restoredAnchor.top - scrollAnchor.top);
    })
    .toBeLessThanOrEqual(2);
  await page.keyboard.press('4');
  await expect(activeScrolledLayout).toHaveClass(
    /reader-segment-layout--original$/,
  );
  await page.evaluate(() => {
    const selector = '[data-reader-segment-id="mode-chapter-1-segment"]';
    const state = {
      maximumCount: 0,
      duplicateLocations: [] as Array<{
        chapterId?: string;
        previewChapterId?: string;
        previewDirection?: string;
      }>,
    };
    const update = () => {
      const matches = [...document.querySelectorAll<HTMLElement>(selector)];
      state.maximumCount = Math.max(state.maximumCount, matches.length);
      if (matches.length > 1) {
        state.duplicateLocations = matches.map((element) => {
          const chapter = element.closest<HTMLElement>(
            '[data-reader-chapter-id]',
          );
          const preview = element.closest<HTMLElement>(
            '[data-reader-chapter-preview]',
          );
          return {
            chapterId: chapter?.dataset.readerChapterId,
            previewChapterId: preview?.dataset.readerPreviewChapterId,
            previewDirection: preview?.dataset.readerChapterPreview,
          };
        });
      }
    };
    const observer = new MutationObserver(update);
    observer.observe(document.querySelector('.book-reader__content')!, {
      childList: true,
      subtree: true,
    });
    update();
    Object.assign(window, {
      __readerDuplicateSegmentAudit: { state, observer },
    });
  });
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(new RegExp(`/read/1$`));
  await expect(
    readerContent.locator('[data-reader-segment-id="mode-chapter-1-segment"]'),
  ).toHaveCount(1);
  const duplicateSegmentAudit = await page.evaluate(() => {
    const audit = (
      window as typeof window & {
        __readerDuplicateSegmentAudit: {
          state: {
            maximumCount: number;
            duplicateLocations: Array<{
              chapterId?: string;
              previewChapterId?: string;
              previewDirection?: string;
            }>;
          };
          observer: MutationObserver;
        };
      }
    ).__readerDuplicateSegmentAudit;
    audit.observer.disconnect();
    return audit.state;
  });
  expect(duplicateSegmentAudit).toEqual({
    maximumCount: 1,
    duplicateLocations: [],
  });
  await page.keyboard.press('ArrowLeft');
  await expect(page).toHaveURL(new RegExp(`/read/0$`));
  expect(pageErrors).toEqual([]);
});

test('keeps reader search, bookmarks, speech, and lookups on stable segments', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const toolsBookId = 'reader-tools.txt';
  await page.addInitScript(() => {
    const speechEvents: Array<{ type: string; text?: string; lang?: string }> =
      [];
    class FakeUtterance {
      lang = '';
      constructor(public text: string) {}
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: FakeUtterance,
    });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancel: () => speechEvents.push({ type: 'cancel' }),
        speak: (utterance: FakeUtterance) =>
          speechEvents.push({
            type: 'speak',
            text: utterance.text,
            lang: utterance.lang,
          }),
      },
    });
    Object.assign(window, { __readerSpeechEvents: speechEvents });
  });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '轻小说机翻机器人' }),
  ).toBeVisible();
  await page.evaluate(async (bookId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('volumes');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = database.transaction(
      ['metadata', 'chapter', 'reader-settings'],
      'readwrite',
    );
    transaction.objectStore('metadata').put({
      id: bookId,
      createAt: 1,
      toc: [
        { chapterId: '0', title: '工具第一章' },
        { chapterId: '1', title: '工具第二章', gpt: 'gpt-glossary' },
      ],
      sourceFormat: 'txt',
      glossaryId: 'glossary',
      glossary: {},
      favoredId: 'default',
      sourceBookMetadata: {
        title: '阅读工具测试',
        authors: [],
        languages: ['ja'],
      },
    });
    transaction.objectStore('chapter').put({
      id: `${bookId}/0`,
      volumeId: bookId,
      paragraphs: ['开头选择词语结尾', '第一章第二段'],
      segmentIds: ['tools-segment-0', 'tools-segment-1'],
    });
    transaction.objectStore('chapter').put({
      id: `${bookId}/1`,
      volumeId: bookId,
      paragraphs: ['第二章原文'],
      segmentIds: ['tools-chapter-1-segment'],
      gpt: {
        glossaryId: 'gpt-glossary',
        glossary: {},
        paragraphs: ['唯一搜尋譯文'],
      },
    });
    transaction.objectStore('reader-settings').put({
      id: 'default',
      defaultMode: 'original',
      translationPriority: ['gpt', 'sakura', 'youdao', 'baidu'],
      fontSize: 18,
      lineHeight: 1.9,
      contentWidth: 840,
      horizontalPadding: 24,
      theme: 'light',
      flow: 'scrolled',
      updatedAt: 1,
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }, toolsBookId);

  await page.goto(`/books/${toolsBookId}/read/0`);
  const firstParagraph = page
    .locator('[data-reader-segment-id="tools-segment-0"] p')
    .first();
  await expect(firstParagraph).toContainText('选择词语');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const flowSetting = page
    .locator('.book-reader__settings-grid .n-form-item')
    .filter({ hasText: '阅读流' });
  await flowSetting.locator('.n-base-selection').click();
  await expect(
    page.getByText('自动（电脑分页，手机滚动）', { exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '阅读设置' })).toBeHidden();
  const selectQuery = async () => {
    await firstParagraph.evaluate((paragraph) => {
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      let start = -1;
      while (node !== null) {
        start = node.textContent?.indexOf('选择词语') ?? -1;
        if (start >= 0) break;
        node = walker.nextNode();
      }
      if (node === null || start < 0) throw new Error('找不到选择文本');
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + '选择词语'.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
  };

  await page
    .getByRole('button', { name: '添加当前位置书签', exact: true })
    .click();
  await expect(page.getByText('已添加书签', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '工具', exact: true }).click();
  const speechButton = page.getByRole('button', {
    name: '朗读当前段',
    exact: true,
  });
  await speechButton.click();
  await expect(speechButton).toHaveClass(/n-button--primary-type/);
  await speechButton.click();
  await expect(speechButton).not.toHaveClass(/n-button--primary-type/);
  const speechEvents = await page.evaluate(
    () =>
      (
        window as unknown as {
          __readerSpeechEvents: Array<{
            type: string;
            text?: string;
            lang?: string;
          }>;
        }
      ).__readerSpeechEvents,
  );
  expect(speechEvents).toContainEqual({
    type: 'speak',
    text: '第一章第二段',
    lang: 'ja-JP',
  });
  expect(speechEvents.filter((event) => event.type === 'cancel')).toHaveLength(
    2,
  );

  await page.getByRole('button', { name: '全文搜索', exact: true }).click();
  const searchDialog = page.getByRole('dialog', { name: '全文搜索' });
  await searchDialog.getByPlaceholder('搜索原文和译文').fill('唯一搜寻译文');
  await searchDialog.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(
    searchDialog.getByText('工具第二章', { exact: true }),
  ).toBeVisible();
  await expect(
    searchDialog.getByText('唯一搜尋譯文', { exact: true }),
  ).toBeVisible();
  await expect(searchDialog.getByText('译文', { exact: true })).toBeVisible();
  await searchDialog.getByText('工具第二章', { exact: true }).click();
  await expect(page).toHaveURL(
    /\/books\/reader-tools\.txt\/read\/1\?segment=tools-chapter-1-segment$/,
  );
  await expect(
    page.locator('[data-reader-segment-id="tools-chapter-1-segment"]'),
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const chapterStatus = page.locator('.book-reader__chapter-status');
  const bookStatus = page.locator('.book-reader__book-status');
  const progressStatus = page.locator('.book-reader__reading-progress-status');
  const timeStatus = page.locator('.book-reader__time-status');
  await expect(bookStatus).toHaveText('阅读工具测试');
  await expect(bookStatus).toHaveCSS('text-overflow', 'ellipsis');
  await expect(progressStatus).toContainText(/^\d{1,3}%/);
  await expect(timeStatus).toHaveText(/^\d{2}:\d{2}$/);
  await expect(bookStatus).toHaveCSS(
    'font-size',
    await chapterStatus.evaluate(
      (element) => getComputedStyle(element).fontSize,
    ),
  );
  await expect(progressStatus).toHaveCSS(
    'color',
    await chapterStatus.evaluate((element) => getComputedStyle(element).color),
  );
  const statusBars = page.locator('.book-reader__status-bar');
  await expect(statusBars).toHaveCount(2);
  for (const statusBar of await statusBars.all()) {
    await expect(statusBar).toHaveCSS('background-color', 'rgb(250, 250, 250)');
    const bounds = await statusBar.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeCloseTo(0, 0);
    expect(bounds!.width).toBeCloseTo(390, 0);
  }
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await flowSetting.locator('.n-base-selection').click();
  await page.getByText('自动', { exact: true }).click();
  await expect(flowSetting.locator('.n-base-selection-label')).toHaveText(
    '自动',
  );
  await page.getByRole('button', { name: '关闭阅读设置' }).click();
  await page.getByRole('button', { name: '工具', exact: true }).click();
  await page.getByRole('button', { name: '书签 (1)', exact: true }).click();
  const bookmarksDialog = page.getByRole('dialog', { name: '书签' });
  await bookmarksDialog.getByText('工具第一章', { exact: true }).click();
  await expect(page).toHaveURL(/\/books\/reader-tools\.txt\/read\/0$/);
  await expect(firstParagraph).toBeVisible();

  await selectQuery();
  await expect(page.locator('.book-reader__app-bar')).toBeVisible();
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.locator('.book-reader__content').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        clientX: rect.left + rect.width / 2,
        clientY: Math.max(rect.top, 0) + 200,
      }),
    );
  });
  await expect(page.locator('.book-reader__app-bar')).toHaveCount(0);
  await selectQuery();
  await expect(
    page.getByRole('button', { name: 'AI', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await expect(page).toHaveURL(/\/books\/reader-tools\.txt\/read\/0$/);
  const interactiveDialog = page.getByRole('dialog', { name: 'AI 查词' });
  await expect(interactiveDialog).toBeVisible();
  await expect(
    interactiveDialog.getByPlaceholder('输入需要翻译的文本'),
  ).toHaveValue('选择词语');
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await expect(interactiveDialog).toBeHidden();

  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await expect(interactiveDialog).toBeVisible();
  await expect(
    interactiveDialog.getByPlaceholder('输入需要翻译的文本'),
  ).toHaveValue('');
  await page.getByRole('button', { name: '关闭AI 查词' }).click();

  await page.getByRole('button', { name: '工具', exact: true }).click();
  await page.getByRole('button', { name: '书籍信息', exact: true }).click();
  const bookInfoDialog = page.getByRole('dialog', { name: '书籍信息' });
  await expect(bookInfoDialog.getByText('阅读工具测试')).toBeVisible();
  await expect(bookInfoDialog.getByText('工具第一章')).toBeVisible();
  await page.getByRole('button', { name: '关闭书籍信息' }).click();

  const persistedTools = await page.evaluate(async (bookId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('volumes');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = database.transaction('reader-bookmark', 'readonly');
    const bookmarkRequest = transaction
      .objectStore('reader-bookmark')
      .index('byBookId')
      .getAll(bookId);
    const result = await new Promise<{
      bookmarks: Array<{ segmentId?: string; offsetRatio?: number }>;
    }>((resolve, reject) => {
      transaction.oncomplete = () =>
        resolve({
          bookmarks: bookmarkRequest.result,
        });
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    return result;
  }, toolsBookId);
  expect(persistedTools.bookmarks).toMatchObject([
    { segmentId: 'tools-segment-0', offsetRatio: 0 },
  ]);
});

test('uses the global Chinese script for rendering and speech', async ({
  page,
}) => {
  const bookId = 'reader-chinese-script.txt';
  await page.addInitScript(() => {
    const speechEvents: string[] = [];
    class FakeUtterance {
      lang = '';
      constructor(public text: string) {}
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: FakeUtterance,
    });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancel: () => {},
        speak: (utterance: FakeUtterance) => speechEvents.push(utterance.text),
      },
    });
    Object.assign(window, { __readerScriptSpeech: speechEvents });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '轻小说机翻机器人' }),
  ).toBeVisible();
  await page.evaluate(async (id) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('volumes');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = database.transaction(
      ['metadata', 'chapter', 'reader-settings'],
      'readwrite',
    );
    transaction.objectStore('metadata').put({
      id,
      createAt: 1,
      toc: [{ chapterId: '0', title: '字形测试' }],
      sourceFormat: 'txt',
      glossaryId: 'glossary',
      glossary: {},
      favoredId: 'default',
      sourceBookMetadata: { title: id, languages: ['zh-CN'] },
    });
    const paragraphs = Array.from(
      { length: 48 },
      (_, index) => `第${index}段头发发展在里面`,
    );
    transaction.objectStore('chapter').put({
      id: `${id}/0`,
      volumeId: id,
      paragraphs,
      segmentIds: paragraphs.map((_, index) => `script-segment-${index}`),
    });
    transaction.objectStore('reader-settings').put({
      id: 'default',
      defaultMode: 'original',
      translationPriority: ['gpt', 'sakura', 'youdao', 'baidu'],
      chineseScript: 'traditional',
      fontSize: 18,
      lineHeight: 1.9,
      contentWidth: 840,
      horizontalPadding: 24,
      theme: 'light',
      flow: 'scrolled',
      updatedAt: 1,
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }, bookId);

  await page.goto(`/books/${bookId}/read/0?segment=script-segment-24`);
  const anchor = page.locator('[data-reader-segment-id="script-segment-24"]');
  await expect(anchor).toContainText('頭髮發展在裏面');

  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: '阅读设置' }).getByText('中文字形'),
  ).toHaveCount(0);
  await page.getByRole('button', { name: '关闭阅读设置', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '阅读设置' })).toBeHidden();

  await page.getByRole('button', { name: '工具', exact: true }).click();
  await page.getByRole('button', { name: '朗读当前段', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { __readerScriptSpeech: string[] }
        ).__readerScriptSpeech.at(-1),
      ),
    )
    .toContain('頭髮發展在裏面');

  const persisted = await page.evaluate(async (id) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('volumes');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const chapter = await new Promise<{ paragraphs: string[] }>(
      (resolve, reject) => {
        const request = database
          .transaction('chapter')
          .objectStore('chapter')
          .get(`${id}/0`);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      },
    );
    database.close();
    return chapter.paragraphs[24];
  }, bookId);
  expect(persisted).toContain('头发发展在里面');
});

test('automatically translates a reader window without persisting a partial chapter', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const temporaryBookId = 'reader-temporary-translation.txt';
  const server = await startOpenAiTestServer({ responseDelayMs: 1_000 });
  try {
    await page.addInitScript((endpoint) => {
      localStorage.setItem(
        'auto-novel:workspace:gpt',
        JSON.stringify({
          workers: [
            {
              id: 'reader-default-worker',
              endpoint,
              model: 'reader-test-model',
              key: 'reader-test-key',
              concurrency: 2,
            },
            {
              id: 'reader-selected-worker',
              endpoint,
              model: 'reader-selected-model',
              key: 'reader-selected-key',
              concurrency: 2,
            },
          ],
          jobs: [],
          jobRecords: [],
        }),
      );
    }, server.endpoint);
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: '轻小说机翻机器人' }),
    ).toBeVisible();
    await page.evaluate(async (bookId) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('volumes');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      const transaction = database.transaction(
        [
          'metadata',
          'file',
          'chapter',
          'reader-settings',
          'reader-book-preference',
        ],
        'readwrite',
      );
      transaction.objectStore('metadata').put({
        id: bookId,
        createAt: 1,
        toc: [{ chapterId: '0', title: '临时翻译章节' }],
        sourceFormat: 'txt',
        glossaryId: 'glossary',
        glossary: {},
        favoredId: 'default',
        sourceBookMetadata: {
          title: '临时翻译测试',
          authors: [],
          languages: ['ja'],
        },
      });
      transaction.objectStore('chapter').put({
        id: `${bookId}/0`,
        volumeId: bookId,
        paragraphs: Array.from(
          { length: 24 },
          (_, index) => `临时原文第 ${index + 1} 段`,
        ),
        segmentIds: Array.from(
          { length: 24 },
          (_, index) => `temporary-segment-${index}`,
        ),
      });
      transaction.objectStore('file').put({
        id: bookId,
        file: new File(['テスト\n'.repeat(12), 'サンプル\n'], bookId, {
          type: 'text/plain',
        }),
      });
      transaction.objectStore('reader-settings').put({
        id: 'default',
        defaultMode: 'translated',
        translationPriority: ['gpt', 'sakura', 'youdao', 'baidu'],
        autoTranslationPreloadPages: 0,
        fontSize: 18,
        lineHeight: 1.9,
        contentWidth: 840,
        horizontalPadding: 24,
        theme: 'light',
        flow: 'scrolled',
        updatedAt: 1,
      });
      transaction.objectStore('reader-book-preference').put({
        bookId,
        preferredMode: 'original-translated',
        updatedAt: 1,
      });
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
    }, temporaryBookId);

    await page.goto(`/books/${temporaryBookId}/read/0`);
    const source = page.locator(
      '[data-reader-segment-id="temporary-segment-0"]',
    );
    await expect(source).toContainText('临时原文第 1 段');
    await expect(source).not.toContainText('未翻译');
    await page.getByRole('button', { name: '工具', exact: true }).click();
    const toolsDialog = page.getByRole('dialog', { name: '阅读工具' });
    await expect(
      toolsDialog.getByRole('button', { name: 'GPT 自动翻译', exact: true }),
    ).toHaveCount(0);
    await expect(
      toolsDialog.getByRole('button', {
        name: 'Sakura 自动翻译',
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      toolsDialog.getByRole('button', { name: '阅读语言', exact: true }),
    ).toHaveCount(0);
    await expect(
      toolsDialog.getByRole('button', { name: '刷新本页', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '工具', exact: true }).click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const readerSettings = page.getByRole('dialog', { name: '阅读设置' });
    const readingLanguageSetting = readerSettings
      .locator('.n-form-item')
      .filter({ hasText: '阅读语言' });
    await readingLanguageSetting.locator('.n-select').click();
    for (const label of ['中文', '中日对照', '日中对照', '原文（日文）']) {
      await expect(page.getByText(label, { exact: true }).last()).toBeVisible();
    }
    await page.getByText('日中对照', { exact: true }).last().click();
    const readingWarning = page.getByText('翻译后生效', { exact: true });
    await expect(readingWarning).toBeVisible();
    const readingLanguageBounds = await readingLanguageSetting.boundingBox();
    const preloadSettingBounds = await readerSettings
      .locator('.n-form-item')
      .filter({ hasText: '自动翻译预翻译页数' })
      .boundingBox();
    const retranslationPolicyBounds = await readerSettings
      .locator('.n-form-item')
      .filter({ hasText: '重翻完成后' })
      .boundingBox();
    const readingSelectBounds = await readingLanguageSetting
      .locator('.n-base-selection')
      .boundingBox();
    const readingWarningBounds = await readingWarning.boundingBox();
    expect(readingLanguageBounds).not.toBeNull();
    expect(preloadSettingBounds).not.toBeNull();
    expect(retranslationPolicyBounds).not.toBeNull();
    expect(readingSelectBounds).not.toBeNull();
    expect(readingWarningBounds).not.toBeNull();
    expect(readingLanguageBounds!.x).toBeLessThan(preloadSettingBounds!.x);
    expect(preloadSettingBounds!.x).toBeLessThan(retranslationPolicyBounds!.x);
    expect(
      Math.abs(
        readingWarningBounds!.x +
          readingWarningBounds!.width -
          (readingSelectBounds!.x + readingSelectBounds!.width),
      ),
    ).toBeLessThanOrEqual(2);
    await expect(
      readerSettings.getByText('自动翻译预翻译页数', { exact: true }),
    ).toBeVisible();
    await readerSettings
      .locator('.n-form-item')
      .filter({ hasText: 'GPT 翻译器' })
      .locator('.n-select')
      .click();
    await page
      .getByText(/reader-selected-model/, { exact: false })
      .last()
      .click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: '工具', exact: true }).click();
    await expect(
      toolsDialog.getByRole('button', { name: '重新翻译', exact: true }),
    ).toBeDisabled();
    await page
      .getByRole('dialog', { name: '阅读工具' })
      .getByRole('button', { name: '术语表', exact: true })
      .click();
    const glossaryDialog = page.getByRole('dialog', { name: '术语表处理' });
    const glossaryMinimumInput = glossaryDialog.locator(
      '.glossary-toolbar__minimum-input input',
    );
    await expect(glossaryMinimumInput).toHaveValue('10');
    await glossaryMinimumInput.fill('1');
    await glossaryMinimumInput.press('Enter');
    await expect(
      glossaryDialog.locator('tbody tr').filter({ hasText: 'テスト' }),
    ).toBeVisible();
    await glossaryDialog
      .getByRole('button', { name: '扫描', exact: true })
      .click();
    const glossaryRow = glossaryDialog.locator('tbody tr').filter({
      hasText: 'テスト',
    });
    await expect(glossaryRow).toBeVisible();
    await expect(
      glossaryDialog.locator('tbody tr').filter({ hasText: 'ダミー' }),
    ).toHaveCount(0);
    const untranslatedGlossaryRow = glossaryDialog.locator('tbody tr').filter({
      hasText: 'サンプル',
    });
    await expect(untranslatedGlossaryRow).toBeVisible();
    await expect(
      untranslatedGlossaryRow.getByText('未翻译', { exact: true }),
    ).toBeVisible();
    await expect(
      glossaryRow.getByText('未翻译', { exact: true }),
    ).toBeVisible();
    await glossaryRow.locator('input').fill('');
    await expect(
      glossaryRow.getByText('未翻译', { exact: true }),
    ).toBeVisible();
    await glossaryRow.locator('input').fill('测试词');
    await expect(glossaryRow.getByText('手工', { exact: true })).toBeVisible();
    await untranslatedGlossaryRow
      .getByRole('button', { name: '移除 サンプル', exact: true })
      .click();
    await expect(untranslatedGlossaryRow).toHaveCount(0);
    await glossaryDialog
      .getByRole('button', { name: '应用到本书', exact: true })
      .click();
    await expect(
      page.getByText('术语表已应用，未完成的自动翻译缓存已清除', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(glossaryDialog).toBeHidden();
    await page.getByRole('button', { name: '工具', exact: true }).click();
    await toolsDialog
      .getByRole('button', { name: '术语表', exact: true })
      .click();
    await expect(glossaryDialog).toBeVisible();
    await expect(
      glossaryDialog.locator('tbody tr').filter({ hasText: 'テスト' }),
    ).toBeVisible();
    await expect(
      glossaryDialog.locator('tbody tr').filter({ hasText: 'サンプル' }),
    ).toHaveCount(0);
    await glossaryDialog
      .getByRole('button', { name: '关闭术语表处理', exact: true })
      .click();
    await expect(glossaryDialog).toBeHidden();
    await source.evaluate((element) =>
      element.scrollIntoView({ block: 'start', behavior: 'auto' }),
    );
    const automaticTranslationButton = page
      .locator('.book-reader__app-bar-translation')
      .getByRole('button', { name: 'GPT 自动翻译', exact: true });
    await automaticTranslationButton.click();
    await expect(
      page.getByText('已开启 GPT 自动翻译', { exact: true }),
    ).toBeVisible();
    await expect(automaticTranslationButton).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(source).toContainText('译文第1行', { timeout: 15_000 });
    await automaticTranslationButton.evaluate((button) => button.click());
    await expect(
      page.getByText('已停止自动翻译', { exact: true }),
    ).toBeVisible();
    await expect(automaticTranslationButton).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(
      page.locator('.reader-segment-layout').filter({ has: source }),
    ).toHaveClass(/reader-segment-layout--original-translated/);
    await page.keyboard.press('4');
    await expect(source).toContainText('临时原文第 1 段');
    await page.keyboard.press('1');
    await expect(source).toContainText('译文第1行');

    const persistedChapter = await page.evaluate(async (bookId) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('volumes');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      const chapter = await new Promise<Record<string, unknown> | undefined>(
        (resolve, reject) => {
          const transaction = database.transaction('chapter', 'readonly');
          const request = transaction.objectStore('chapter').get(`${bookId}/0`);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        },
      );
      database.close();
      return chapter;
    }, temporaryBookId);
    expect(persistedChapter).not.toHaveProperty('gpt');
    expect(server.requests.length).toBeGreaterThan(0);
    expect(
      server.requests.every(
        ({ body }) => body.model === 'reader-selected-model',
      ),
    ).toBe(true);
    await expect
      .poll(() =>
        page.evaluate(async (bookId) => {
          const database = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('volumes');
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
          });
          const request = database
            .transaction('reader-chapter-cache', 'readonly')
            .objectStore('reader-chapter-cache')
            .index('byBookId')
            .getAll(bookId);
          const values = await new Promise<
            Array<{ kind?: string; purpose?: string }>
          >((resolve, reject) => {
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
          });
          database.close();
          return values.filter(
            (value) =>
              value.kind === 'automatic-translation' &&
              value.purpose === 'automatic',
          ).length;
        }, temporaryBookId),
      )
      .toBeGreaterThan(0);

    const persistedGlossary = await page.evaluate(async (bookId) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('volumes');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      const metadata = await new Promise<{
        glossary: Record<string, string>;
        glossaryCandidateCounts?: Record<string, number>;
        glossaryExcludedWords?: string[];
      }>((resolve, reject) => {
        const transaction = database.transaction('metadata', 'readonly');
        const request = transaction.objectStore('metadata').get(bookId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      database.close();
      return metadata;
    }, temporaryBookId);
    expect(persistedGlossary.glossary).toEqual({ テスト: '测试词' });
    expect(persistedGlossary.glossaryCandidateCounts).toEqual({
      テスト: 12,
      サンプル: 1,
    });
    expect(persistedGlossary.glossaryExcludedWords).toEqual(['サンプル']);

    await page.reload();
    await expect(source).toContainText('临时原文第 1 段');
    await expect(source).not.toContainText('译文第1行');

    await page.getByRole('button', { name: '设置', exact: true }).click();
    const readerSettingsDialog = page.getByRole('dialog', {
      name: '阅读设置',
    });
    const readerPreloadInput = readerSettingsDialog.getByRole('textbox', {
      name: '自动翻译预翻译页数',
    });
    await expect(readerPreloadInput).toHaveValue('0');
    await readerPreloadInput.fill('20');
    await readerPreloadInput.press('Tab');
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const database = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('volumes');
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
          });
          const setting = await new Promise<
            { autoTranslationPreloadPages?: number } | undefined
          >((resolve, reject) => {
            const transaction = database.transaction(
              'reader-settings',
              'readonly',
            );
            const request = transaction
              .objectStore('reader-settings')
              .get('default');
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
          });
          database.close();
          return setting?.autoTranslationPreloadPages;
        }),
      )
      .toBe(20);
    await page.getByRole('button', { name: '设置', exact: true }).click();

    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await automaticTranslationButton.click();
    await expect(page.getByText('全书翻译已完成', { exact: true })).toBeVisible(
      { timeout: 15_000 },
    );
    await expect
      .poll(
        () =>
          page.evaluate(async (bookId) => {
            const database = await new Promise<IDBDatabase>(
              (resolve, reject) => {
                const request = indexedDB.open('volumes');
                request.onerror = () => reject(request.error);
                request.onsuccess = () => resolve(request.result);
              },
            );
            const transaction = database.transaction(
              ['metadata', 'chapter'],
              'readonly',
            );
            const chapterRequest = transaction
              .objectStore('chapter')
              .get(`${bookId}/0`);
            const metadataRequest = transaction
              .objectStore('metadata')
              .get(bookId);
            const persisted = await new Promise<{
              chapter?: {
                gpt?: { glossaryId?: string; paragraphs?: string[] };
              };
              metadata?: {
                glossaryId?: string;
                toc?: Array<{ gpt?: string }>;
              };
            }>((resolve, reject) => {
              transaction.oncomplete = () =>
                resolve({
                  chapter: chapterRequest.result,
                  metadata: metadataRequest.result,
                });
              transaction.onerror = () => reject(transaction.error);
            });
            database.close();
            const glossaryId = persisted.metadata?.glossaryId;
            return {
              paragraphCount: persisted.chapter?.gpt?.paragraphs?.length,
              usesCurrentGlossary:
                glossaryId !== undefined &&
                persisted.chapter?.gpt?.glossaryId === glossaryId &&
                persisted.metadata?.toc?.[0]?.gpt === glossaryId,
            };
          }, temporaryBookId),
        { timeout: 15_000 },
      )
      .toEqual({
        paragraphCount: 24,
        usesCurrentGlossary: true,
      });
    await expect
      .poll(() =>
        page.evaluate(async (bookId) => {
          const database = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('volumes');
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
          });
          const request = database
            .transaction('reader-chapter-cache', 'readonly')
            .objectStore('reader-chapter-cache')
            .index('byBookId')
            .getAll(bookId);
          const values = await new Promise<Array<{ kind?: string }>>(
            (resolve, reject) => {
              request.onerror = () => reject(request.error);
              request.onsuccess = () => resolve(request.result);
            },
          );
          database.close();
          return values.filter(
            (value) => value.kind === 'automatic-translation',
          ).length;
        }, temporaryBookId),
      )
      .toBe(0);

    await page.reload();
    await expect(source).toContainText('译文第1行');
    await expect(automaticTranslationButton).toBeHidden();

    await page.getByRole('button', { name: '设置', exact: true }).click();
    const completedReaderSettings = page.getByRole('dialog', {
      name: '阅读设置',
    });
    await completedReaderSettings
      .locator('.n-form-item')
      .filter({ hasText: 'GPT 翻译器' })
      .locator('.n-select')
      .click();
    await page
      .getByText(/reader-selected-model/, { exact: false })
      .last()
      .click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: '工具', exact: true }).click();
    for (const label of ['术语表', '清除翻译缓存', '重新翻译']) {
      await expect(
        page
          .getByRole('dialog', { name: '阅读工具' })
          .getByRole('button', { name: label, exact: true }),
      ).toBeVisible();
    }
    const retranslateButton = page
      .getByRole('dialog', { name: '阅读工具' })
      .getByRole('button', { name: '重新翻译', exact: true });
    await expect(retranslateButton).toBeEnabled();
    await expect(retranslateButton).toHaveAttribute('aria-pressed', 'false');
    await retranslateButton.click();
    const retranslationSourceDialog = page.getByRole('dialog', {
      name: '重新翻译',
    });
    const retranslationScopeSetting = retranslationSourceDialog
      .locator('.n-form-item')
      .filter({ hasText: '范围' });
    await expect(
      retranslationScopeSetting.locator('.n-base-selection-label'),
    ).toHaveText('仅本章');
    await expect(
      retranslationSourceDialog.getByText('遇到未翻译章', { exact: true }),
    ).toHaveCount(0);
    await retranslationScopeSetting.locator('.n-base-selection').click();
    await page.locator('.n-base-select-menu').getByText('连续重翻').click();
    const untranslatedPolicySetting = retranslationSourceDialog
      .locator('.n-form-item')
      .filter({ hasText: '遇到未翻译章' });
    await expect(
      untranslatedPolicySetting.locator('.n-base-selection-label'),
    ).toHaveText('停止');
    await page.getByRole('button', { name: '关闭重新翻译' }).click();
    await page.getByRole('button', { name: '工具', exact: true }).click();
    await expect(retranslateButton).toHaveAttribute('aria-pressed', 'false');
    await retranslateButton.click();
    await retranslationSourceDialog
      .getByRole('button', { name: 'GPT 自动翻译', exact: true })
      .click();
    await expect(
      page.getByText('已开始使用 GPT 重新翻译当前章', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '工具', exact: true }).click();
    await expect(retranslateButton).toHaveAttribute('aria-pressed', 'true');
    await expect(retranslateButton).toHaveClass(/n-button--primary-type/);
    await retranslateButton.click();
    await expect(page.getByRole('dialog', { name: '重新翻译' })).toHaveCount(0);
    await expect(retranslateButton).toHaveAttribute('aria-pressed', 'false');
    await expect(retranslateButton).not.toHaveClass(/n-button--primary-type/);
    await expect(
      page.getByText('已停止自动翻译', { exact: true }),
    ).toBeVisible();
    await retranslateButton.click();
    await retranslationSourceDialog
      .getByRole('button', { name: 'GPT 自动翻译', exact: true })
      .click();
    const retranslationDecision = page.getByRole('dialog', {
      name: '重翻已完成',
    });
    await expect(retranslationDecision).toBeVisible({ timeout: 15_000 });
    expect(server.requests.at(-1)?.body.model).toBe('reader-selected-model');
    await retranslationDecision
      .getByRole('button', { name: '不替换原有翻译', exact: true })
      .click();
    await expect(
      page.getByText('已保留原译文，重翻结果仍在缓存中', { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(async (bookId) => {
          const database = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('volumes');
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
          });
          const transaction = database.transaction(
            'reader-chapter-cache',
            'readonly',
          );
          const request = transaction
            .objectStore('reader-chapter-cache')
            .index('byBookId')
            .getAll(bookId);
          const values = await new Promise<
            Array<{ kind?: string; purpose?: string }>
          >((resolve, reject) => {
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
          });
          database.close();
          return values.filter(
            (value) =>
              value.kind === 'automatic-translation' &&
              value.purpose === 'retranslate',
          ).length;
        }, temporaryBookId),
      )
      .toBe(1);
    await page.getByRole('button', { name: '工具', exact: true }).click();
    await page
      .getByRole('dialog', { name: '阅读工具' })
      .getByRole('button', { name: '清除翻译缓存', exact: true })
      .click();
    await expect(
      page.getByText('已清除 1 条翻译缓存', { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(async (bookId) => {
          const database = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('volumes');
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
          });
          const request = database
            .transaction('reader-chapter-cache', 'readonly')
            .objectStore('reader-chapter-cache')
            .index('byBookId')
            .getAll(bookId);
          const values = await new Promise<Array<{ kind?: string }>>(
            (resolve, reject) => {
              request.onerror = () => reject(request.error);
              request.onsuccess = () => resolve(request.result);
            },
          );
          database.close();
          return values.filter(
            (value) => value.kind === 'automatic-translation',
          ).length;
        }, temporaryBookId),
      )
      .toBe(0);
  } finally {
    await server.close();
  }
});

test('continues paging backward after loading an earlier long-chapter window', async ({
  page,
}) => {
  const windowedBookId = 'windowed-reader.txt';
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '轻小说机翻机器人' }),
  ).toBeVisible();
  await page.evaluate(
    async ({ bookId }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('volumes');
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
        toc: [{ chapterId: '0' }, { chapterId: '1' }],
        glossaryId: 'glossary',
        glossary: {},
        favoredId: 'default',
        sourceFormat: 'txt',
        sourceBookMetadata: {
          title: 'windowed-reader',
          languages: ['zh'],
        },
      });
      const paragraphs = Array.from(
        { length: 1_001 },
        (_, index) => `第 ${index} 段 ${'窗口化长章节内容'.repeat(8)}`,
      );
      transaction.objectStore('chapter').put({
        id: `${bookId}/0`,
        volumeId: bookId,
        paragraphs,
        segmentIds: paragraphs.map((_, index) => `windowed-segment-${index}`),
      });
      transaction.objectStore('chapter').put({
        id: `${bookId}/1`,
        volumeId: bookId,
        paragraphs: ['下一章'],
        segmentIds: ['next-chapter-segment'],
      });
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
    },
    { bookId: windowedBookId },
  );

  await page.goto(`/books/${windowedBookId}/read/1`);
  const readerContent = page.locator('.book-reader__content');
  await expect(readerContent).toHaveClass(/book-reader__content--paginated/);
  const bounds = await readerContent.boundingBox();
  if (bounds === null) throw new Error('缺少长章节分页视口');
  await readerContent.click({
    position: { x: bounds.width * 0.1, y: bounds.height * 0.5 },
  });
  await expect(page).toHaveURL(/\/windowed-reader\.txt\/read\/0$/);
  await expect(
    readerContent.locator('[data-reader-segment-id="windowed-segment-761"]'),
  ).toBeAttached();
  await expect(readerContent.locator('[data-reader-segment-id]')).toHaveCount(
    240,
  );

  await readerContent.evaluate((element) =>
    element.scrollTo({ left: 0, behavior: 'auto' }),
  );
  await readerContent.click({
    position: { x: bounds.width * 0.1, y: bounds.height * 0.5 },
  });
  await expect(
    readerContent.locator('[data-reader-segment-id="windowed-segment-521"]'),
  ).toBeAttached();
  await expect(readerContent.locator('[data-reader-segment-id]')).toHaveCount(
    480,
  );
  const previousWindowPage = await readerContent.evaluate(
    (element) => element.scrollLeft,
  );
  expect(previousWindowPage).toBeGreaterThan(0);

  await readerContent.click({
    position: { x: bounds.width * 0.1, y: bounds.height * 0.5 },
  });
  await expect
    .poll(() => readerContent.evaluate((element) => element.scrollLeft))
    .toBeLessThan(previousWindowPage);
});

test('uses a configured default cover for a local book without one', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '轻小说机翻机器人' }),
  ).toBeVisible();

  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('volumes');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = database.transaction(
      ['metadata', 'chapter'],
      'readwrite',
    );
    transaction.objectStore('metadata').put({
      id: 'default-cover.txt',
      createAt: 1,
      toc: [{ chapterId: '0' }],
      glossaryId: 'glossary',
      glossary: {},
      favoredId: 'default',
      sourceFormat: 'txt',
      sourceBookMetadata: {
        title: 'default-cover',
        languages: ['zh'],
      },
    });
    transaction.objectStore('chapter').put({
      id: 'default-cover.txt/0',
      volumeId: 'default-cover.txt',
      paragraphs: ['无内嵌封面的正文'],
      segmentIds: ['segment-0'],
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });
  let releaseConfig!: () => void;
  const configResponse = new Promise<void>((resolve) => {
    releaseConfig = resolve;
  });
  let reportConfigRequest!: (imagePrefix: string) => void;
  const configRequested = new Promise<string>((resolve) => {
    reportConfigRequest = resolve;
  });
  await page.route(
    /\/(?:config\/config\.json|api\/runtime-config)$/,
    async (route) => {
      const imagePrefix = new URL(route.request().url()).pathname.startsWith(
        '/api/',
      )
        ? '/panel-content'
        : '/config';
      reportConfigRequest(imagePrefix);
      await configResponse;
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ defaultBookCoverImage: 'images/banner.webp' }),
      });
    },
  );

  await page.reload();
  const configImagePrefix = await configRequested;
  await expect(
    page.getByRole('heading', { name: 'default-cover' }),
  ).toBeVisible();
  await expect(page.locator('.book-cover__initials')).toHaveCount(0);
  releaseConfig();
  const defaultCover = page.locator('img[alt="default-cover 封面"]');
  await expect(defaultCover).toHaveAttribute(
    'src',
    `${configImagePrefix}/images/banner.webp`,
  );
  await expect
    .poll(() =>
      defaultCover.evaluate(
        (image) => (image as HTMLImageElement).naturalWidth,
      ),
    )
    .toBeGreaterThan(0);
  await expect(page.locator('.book-cover__initials')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '查看《default-cover》详情' }).click();
  await expect(page.getByText('阅读偏好', { exact: true })).toBeVisible();
  const preferenceSelects = page.locator('.book-details__select');
  await expect(preferenceSelects).toHaveCount(2);
  await expect(preferenceSelects.nth(0)).toBeVisible();
  await expect(preferenceSelects.nth(1)).toBeVisible();
  const mobileLayout = await page.evaluate(() => {
    const bounds = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (element === null) {
        throw new Error(`缺少移动端布局元素：${selector}`);
      }
      const { bottom, height, left, right, top } =
        element.getBoundingClientRect();
      return {
        bottom: Math.round(bottom),
        height: Math.round(height),
        left: Math.round(left),
        right: Math.round(right),
        top: Math.round(top),
      };
    };
    return {
      cover: bounds('.book-details__hero-content > .book-cover'),
      copy: bounds('.book-details__hero-copy'),
      shelfActions: bounds('.book-details__hero-shelf-actions'),
      shelfActionsLastButton: bounds(
        '.book-details__hero-shelf-actions button:last-child',
      ),
      primaryActions: bounds('.book-details__primary-actions'),
      readingProgress: bounds('.book-details__reading-progress'),
      returnToShelf: bounds('.book-details__return-to-shelf'),
      titleLineClamp: getComputedStyle(
        document.querySelector<HTMLElement>('.book-details__title b')!,
      ).webkitLineClamp,
      lastPreferenceSelect: bounds(
        '.book-details__setting-row:last-child .n-select',
      ),
      translationHeader: bounds('.book-details__translation-header .n-h2'),
    };
  });
  expect(mobileLayout.copy.left).toBeGreaterThan(mobileLayout.cover.left);
  expect(mobileLayout.shelfActions.left).toBeGreaterThan(
    mobileLayout.cover.left,
  );
  expect(mobileLayout.readingProgress.left).toBeGreaterThan(
    mobileLayout.cover.left,
  );
  expect(mobileLayout.readingProgress.top).toBeGreaterThan(
    mobileLayout.copy.top,
  );
  expect(mobileLayout.titleLineClamp).toBe('3');
  expect(
    mobileLayout.primaryActions.top - mobileLayout.cover.bottom,
  ).toBeCloseTo(24, 0);
  expect(
    mobileLayout.translationHeader.top -
      mobileLayout.lastPreferenceSelect.bottom,
  ).toBeCloseTo(32, 0);
  expect(
    Math.abs(mobileLayout.shelfActions.bottom - mobileLayout.cover.bottom),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(
      mobileLayout.returnToShelf.right - mobileLayout.primaryActions.right,
    ),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(
      mobileLayout.shelfActionsLastButton.right -
        mobileLayout.returnToShelf.right,
    ),
  ).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1280, height: 844 });
  const desktopLayout = await page.evaluate(() => {
    const bounds = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (element === null) {
        throw new Error(`缺少桌面端详情元素：${selector}`);
      }
      const { bottom, right, top } = element.getBoundingClientRect();
      return {
        bottom: Math.round(bottom),
        right: Math.round(right),
        top: Math.round(top),
      };
    };
    return {
      cover: bounds('.book-details__hero-content > .book-cover'),
      primaryActions: bounds('.book-details__primary-actions'),
      returnToShelf: bounds('.book-details__return-to-shelf'),
      shelfActions: bounds('.book-details__hero-shelf-actions'),
    };
  });
  expect(
    Math.abs(desktopLayout.shelfActions.bottom - desktopLayout.cover.bottom),
  ).toBeLessThanOrEqual(1);
  expect(
    desktopLayout.primaryActions.top - desktopLayout.cover.bottom,
  ).toBeCloseTo(24, 0);
  expect(
    Math.abs(
      desktopLayout.returnToShelf.right - desktopLayout.primaryActions.right,
    ),
  ).toBeLessThanOrEqual(1);
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '轻小说机翻机器人' }),
  ).toBeVisible();
  const desktopBookshelfColumnCount = await page
    .locator('.book-grid')
    .evaluate(
      (grid) =>
        getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length,
    );
  expect(desktopBookshelfColumnCount).toBe(6);
  await page.setViewportSize({ width: 1000, height: 844 });
  await expect
    .poll(() =>
      page
        .locator('.book-grid')
        .evaluate(
          (grid) =>
            getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/)
              .length,
        ),
    )
    .toBe(5);
  await page.setViewportSize({ width: 800, height: 844 });
  await expect
    .poll(() =>
      page
        .locator('.book-grid')
        .evaluate(
          (grid) =>
            getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/)
              .length,
        ),
    )
    .toBe(4);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole('heading', { name: '轻小说机翻机器人' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '前往工作区', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByPlaceholder('输入书名，搜索书架')).toBeVisible();
  await expect(page.locator('.bookshelf-page__notice')).toHaveCount(0);
  await expect(page.locator('.bookshelf-page h1')).toHaveCount(0);
  const bookshelfLayout = await page.evaluate(() => {
    const bounds = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (element === null) {
        throw new Error(`缺少移动端书架元素：${selector}`);
      }
      const { height, left, right, top } = element.getBoundingClientRect();
      return {
        height: Math.round(height),
        left: Math.round(left),
        right: Math.round(right),
        top: Math.round(top),
      };
    };
    return {
      add: bounds('.bookshelf-page__header-actions'),
      filter: bounds('.bookshelf-header-filter'),
      refresh: bounds('.bookshelf-toolbar__refresh'),
      sort: bounds('.bookshelf-toolbar__sort'),
      viewportWidth: window.innerWidth,
    };
  });
  expect(bookshelfLayout.add.right).toBeLessThanOrEqual(
    bookshelfLayout.viewportWidth,
  );
  expect(bookshelfLayout.filter.top).toBe(bookshelfLayout.add.top);
  expect(bookshelfLayout.refresh.left).toBeGreaterThanOrEqual(
    bookshelfLayout.add.right,
  );
  expect(bookshelfLayout.refresh.right - bookshelfLayout.refresh.left).toBe(
    bookshelfLayout.filter.right - bookshelfLayout.filter.left,
  );
  expect(bookshelfLayout.sort.left).toBeGreaterThan(
    bookshelfLayout.filter.left,
  );
  const bookshelfCardLayout = await page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>('.book-grid');
    const title = document.querySelector<HTMLElement>('.book-card h2');
    if (grid === null || title === null) {
      throw new Error('缺少移动端书架卡片');
    }
    return {
      columnCount: getComputedStyle(grid)
        .gridTemplateColumns.trim()
        .split(/\s+/).length,
      titleLineClamp:
        getComputedStyle(title).getPropertyValue('-webkit-line-clamp'),
    };
  });
  expect(bookshelfCardLayout.columnCount).toBe(3);
  expect(bookshelfCardLayout.titleLineClamp).toBe('2');
});
test('restores the complete source book presentation', async ({ page }) => {
  const restoredBookId = 'restore-metadata.epub';
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '轻小说机翻机器人' }),
  ).toBeVisible();
  await page.evaluate(async (bookId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('volumes');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = database.transaction(
      ['metadata', 'reader-cover'],
      'readwrite',
    );
    transaction.objectStore('metadata').put({
      id: bookId,
      createAt: 1,
      toc: [],
      glossaryId: 'glossary',
      glossary: {},
      favoredId: 'default',
      sourceFormat: 'epub',
      sourceBookMetadata: {
        title: '原始标题',
        authors: ['原始作者'],
        description: '原始简介',
        languages: ['ja'],
      },
      bookMetadata: {
        title: '修改标题',
        authors: ['修改作者'],
        description: '修改简介',
        languages: ['zh-CN'],
      },
    });
    transaction.objectStore('reader-cover').put({
      bookId,
      blob: new Blob(['custom-cover'], { type: 'image/png' }),
      source: 'custom',
      updatedAt: 1,
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }, restoredBookId);

  await page.goto(`/books/${restoredBookId}/edit`);
  const form = page.locator('.metadata-edit__form');
  const titleInput = form.locator('input').first();
  await expect(titleInput).toHaveValue('修改标题');
  await expect(form.locator('textarea')).toHaveValue('修改简介');
  await expect(
    page.getByRole('button', { name: '移除', exact: true }),
  ).toBeVisible();

  await titleInput.fill('   ');
  await page.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page).toHaveURL(/\/books\/restore-metadata\.epub\/edit$/);
  await expect(form.locator('.n-form-item-feedback')).toHaveText(
    '书名不能为空',
  );

  await page
    .getByRole('button', { name: '还原原始元信息', exact: true })
    .click();
  await expect(form.locator('input').first()).toHaveValue('原始标题');
  await expect(form.locator('textarea')).toHaveValue('原始简介');
  await expect(
    page.getByRole('button', { name: '上传', exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page).toHaveURL(/\/books\/restore-metadata\.epub\/details$/);
  await expect
    .poll(() =>
      page.evaluate(async (bookId) => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('volumes');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });
        const transaction = database.transaction(
          ['metadata', 'reader-cover'],
          'readonly',
        );
        const metadataRequest = transaction.objectStore('metadata').get(bookId);
        const coverRequest = transaction
          .objectStore('reader-cover')
          .get(bookId);
        const result = await new Promise<{
          metadata: { bookMetadata?: { title?: string } } | undefined;
          hasCover: boolean;
        }>((resolve, reject) => {
          transaction.oncomplete = () =>
            resolve({
              metadata: metadataRequest.result,
              hasCover: coverRequest.result !== undefined,
            });
          transaction.onerror = () => reject(transaction.error);
        });
        database.close();
        return {
          title: result.metadata?.bookMetadata?.title,
          hasCover: result.hasCover,
        };
      }, restoredBookId),
    )
    .toEqual({ title: '原始标题', hasCover: false });
});

test('persists the global reading version selected in Settings', async ({
  page,
}) => {
  await page.goto('/setting');
  await expect(page.getByText('阅读偏好', { exact: true })).toBeVisible();
  await expect(
    page.getByText('阅读页面，可以使用左右方向键跳转上/下一章。', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      '阅读页面，可以使用数字键 1～4 快速切换翻译（中文/中日/日中/原文）。',
      { exact: true },
    ),
  ).toBeVisible();

  const workspaceSetting = page
    .locator('.n-list-item')
    .filter({ has: page.getByText('工作区', { exact: true }) });
  await expect(workspaceSetting).toHaveCount(1);
  await expect(
    workspaceSetting.getByText('工作区添加时自动置顶', { exact: true }),
  ).toBeVisible();
  await expect(
    workspaceSetting.getByText('任务全部完成时语音提醒', { exact: true }),
  ).toBeVisible();
  await expect(
    workspaceSetting.getByRole('button', { name: '点击播放', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('工作区语音提醒', { exact: true })).toHaveCount(
    0,
  );

  const selector = page.locator('#reader-default-mode');
  await expect(selector).toHaveAttribute('aria-busy', 'false');
  await expect(selector.getByRole('radio', { name: '询问' })).toHaveCount(0);
  const chineseScriptSelector = page.locator('#reader-chinese-script');
  await expect(chineseScriptSelector).toHaveAttribute('aria-busy', 'false');
  await expect(
    chineseScriptSelector.getByRole('radio', { name: '原文' }),
  ).toBeChecked();
  const preloadControl = page.locator('.reader-preload-setting__input');
  const languageDetectionInput = page.getByRole('textbox', {
    name: '语言检测置信度阈值',
  });
  const languageHelpButton = page.getByRole('button', {
    name: '语言检测阈值说明',
  });
  const preloadHelpButton = page.getByRole('button', {
    name: '自动翻译预翻译说明',
  });
  await expect(languageDetectionInput).toHaveValue('95');
  await languageDetectionInput.fill('97');
  await languageDetectionInput.press('Tab');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('auto-novel:settings') ?? '{}')
            .languageDetectionConfidencePercent,
      ),
    )
    .toBe(97);
  const retranslationSelector = page.locator('#reader-retranslation-policy');
  const desktopControlBounds = await Promise.all(
    [
      selector,
      chineseScriptSelector,
      preloadControl,
      retranslationSelector,
    ].map((control) => control.boundingBox()),
  );
  expect(desktopControlBounds.every((bounds) => bounds !== null)).toBe(true);
  expect(
    desktopControlBounds.every(
      (bounds) => Math.abs(bounds!.x - desktopControlBounds[0]!.x) <= 1,
    ),
  ).toBe(true);
  const desktopPreloadBounds = desktopControlBounds[2]!;
  const desktopLanguageInputBounds = await page
    .locator('.language-detection-setting__input')
    .boundingBox();
  expect(desktopLanguageInputBounds).not.toBeNull();
  expect(
    Math.abs(desktopLanguageInputBounds!.width - desktopPreloadBounds.width),
  ).toBeLessThanOrEqual(1);
  await languageHelpButton.click();
  await expect(
    page.getByText(
      '仅采用高于阈值的正文检测结果；检测语言与文件元数据没有重合时以检测结果为准，否则补充缺失语言。',
      { exact: true },
    ),
  ).toBeVisible();
  await languageHelpButton.click();
  await preloadHelpButton.click();
  await expect(
    page.getByText('提前翻译当前页之后的页数；0 表示只处理当前可见页。', {
      exact: true,
    }),
  ).toBeVisible();
  await preloadHelpButton.click();

  const baiduAppId = page.getByRole('textbox', {
    name: '百度翻译 App ID',
  });
  const baiduSecret = page.getByRole('textbox', { name: '百度翻译密钥' });
  const youdaoAppKey = page.getByRole('textbox', {
    name: '有道翻译应用 ID',
  });
  const youdaoSecret = page.getByRole('textbox', {
    name: '有道翻译应用密钥',
  });
  await baiduAppId.fill('baidu-app');
  await baiduSecret.fill('baidu-secret');
  await youdaoAppKey.fill('youdao-app');
  await youdaoSecret.fill('youdao-secret');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('auto-novel:settings') ?? '{}')
            .translationApi,
      ),
    )
    .toEqual({
      baidu: { appId: 'baidu-app', secretKey: 'baidu-secret' },
      youdao: { appKey: 'youdao-app', appSecret: 'youdao-secret' },
    });
  await selector.getByText('日中', { exact: true }).click();
  await expect(selector.getByRole('radio', { name: '日中' })).toBeChecked();
  await chineseScriptSelector.getByText('繁體中文', { exact: true }).click();
  await expect(
    chineseScriptSelector.getByRole('radio', { name: '繁體中文' }),
  ).toBeChecked();

  const preloadInput = page.getByRole('textbox', {
    name: '自动翻译预翻译页数',
  });
  await expect(preloadInput).toHaveValue('3');
  await expect(preloadInput).toBeEnabled();
  await preloadInput.fill('7');
  await preloadInput.press('Tab');

  await expect
    .poll(() =>
      page.evaluate(async () => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('volumes');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });
        const transaction = database.transaction('reader-settings', 'readonly');
        const request = transaction
          .objectStore('reader-settings')
          .get('default');
        const setting = await new Promise<
          | {
              defaultMode?: string;
              autoTranslationPreloadPages?: number;
              chineseScript?: string;
            }
          | undefined
        >((resolve, reject) => {
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });
        database.close();
        return setting === undefined
          ? undefined
          : {
              defaultMode: setting.defaultMode,
              autoTranslationPreloadPages: setting.autoTranslationPreloadPages,
              chineseScript: setting.chineseScript,
            };
      }),
    )
    .toEqual({
      defaultMode: 'original-translated',
      autoTranslationPreloadPages: 7,
      chineseScript: 'traditional',
    });

  await page.reload();
  await expect(selector.getByRole('radio', { name: '日中' })).toBeChecked();
  await expect(
    chineseScriptSelector.getByRole('radio', { name: '繁體中文' }),
  ).toBeChecked();
  await expect(preloadInput).toHaveValue('7');
  await expect(languageDetectionInput).toHaveValue('97');
  await expect(baiduAppId).toHaveValue('baidu-app');
  await expect(youdaoAppKey).toHaveValue('youdao-app');

  await page.setViewportSize({ width: 390, height: 844 });
  const mobilePreloadLayout = await page
    .locator('.reader-preload-setting')
    .evaluate((row) => {
      const toBounds = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      };
      return {
        row: toBounds(row),
        input: toBounds(row.querySelector('.reader-preload-setting__input')!),
      };
    });
  const mobileLanguageInputBounds = await languageDetectionInput.boundingBox();
  expect(mobileLanguageInputBounds).not.toBeNull();
  expect(mobilePreloadLayout.input.x).toBeGreaterThanOrEqual(
    mobilePreloadLayout.row.x,
  );
  expect(
    mobilePreloadLayout.input.x + mobilePreloadLayout.input.width,
  ).toBeLessThanOrEqual(
    mobilePreloadLayout.row.x + mobilePreloadLayout.row.width,
  );
  expect(mobileLanguageInputBounds!.x).toBeGreaterThanOrEqual(0);
  expect(
    mobileLanguageInputBounds!.x + mobileLanguageInputBounds!.width,
  ).toBeLessThanOrEqual(390);
  for (const { helpButton, title, text } of [
    {
      helpButton: languageHelpButton,
      title: '语言检测阈值',
      text: '仅采用高于阈值的正文检测结果',
    },
    {
      helpButton: preloadHelpButton,
      title: '自动翻译预翻译',
      text: '提前翻译当前页之后的页数',
    },
  ]) {
    await helpButton.click();
    const dialog = page.getByRole('dialog', { name: title });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(text);
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    await dialog.getByRole('button', { name: 'close' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.locator('.n-popover').filter({ hasText: text }),
    ).toHaveCount(0);
  }
});

test('completes, persists, exports, and reads a concurrent GPT job', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) =>
    failedRequests.push(`${request.method()} ${request.url()}`),
  );
  const volumeId = 'translated-flow.txt';
  const task =
    `local/${volumeId}` +
    '?level=all&forceMetadata=false&startIndex=0&endIndex=65535';
  let releaseRequests: () => void = () => {};
  const requestBarrier = new Promise<void>((resolve) => {
    releaseRequests = resolve;
  });
  let announceTwoRequests: () => void = () => {};
  const twoRequestsArrived = new Promise<void>((resolve) => {
    announceTwoRequests = resolve;
  });
  const server = await startOpenAiTestServer({
    onChat: async (request) => {
      if (request.index === 1) announceTwoRequests();
      await requestBarrier;
      return { content: '#1:译文第1行\n#2:译文第2行' };
    },
  });
  try {
    await page.goto('/workspace/gpt');
    await expect(
      page.getByRole('heading', { name: 'GPT工作区' }),
    ).toBeVisible();
    await page.evaluate(
      async ({ endpoint, task, volumeId }) => {
        localStorage.setItem(
          'auto-novel:workspace:gpt',
          JSON.stringify({
            workers: [
              {
                id: 'integration-worker-a',
                endpoint,
                model: 'integration-model-a',
                key: 'integration-key-a',
                concurrency: 1,
              },
              {
                id: 'integration-worker-b',
                endpoint,
                model: 'integration-model-b',
                key: 'integration-key-b',
                concurrency: 1,
              },
            ],
            jobs: [
              {
                task,
                description: volumeId,
                createAt: 1,
              },
            ],
            jobRecords: [],
          }),
        );
        localStorage.setItem(
          'auto-novel:settings',
          JSON.stringify({
            homeDownloadMode: 'jp',
            downloadFormat: {
              mode: 'zh',
              translationsMode: 'parallel',
              translations: ['sakura'],
            },
          }),
        );

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
          id: volumeId,
          createAt: 1,
          toc: [
            { chapterId: 'chapter-a', title: '第一章' },
            { chapterId: 'chapter-b', title: '第二章' },
          ],
          sourceFormat: 'txt',
          glossaryId: 'glossary',
          glossary: {},
          favoredId: 'default',
          sourceBookMetadata: {
            title: '完整翻译流程',
            authors: ['测试作者'],
            languages: ['ja'],
          },
        });
        transaction.objectStore('chapter').put({
          id: `${volumeId}/chapter-a`,
          volumeId,
          paragraphs: ['第一章原文一', '第一章原文二'],
          segmentIds: ['chapter-a-1', 'chapter-a-2'],
        });
        transaction.objectStore('chapter').put({
          id: `${volumeId}/chapter-b`,
          volumeId,
          paragraphs: ['第二章原文一', '第二章原文二'],
          segmentIds: ['chapter-b-1', 'chapter-b-2'],
        });
        transaction.objectStore('file').put({
          id: volumeId,
          file: new File(
            ['第一章原文一\n第一章原文二\n第二章原文一\n第二章原文二'],
            volumeId,
            { type: 'text/plain' },
          ),
        });
        await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
        });
        database.close();
      },
      { endpoint: server.endpoint, task, volumeId },
    );

    await page.reload();
    const firstWorker = page
      .locator('.n-list-item')
      .filter({ hasText: 'integration-worker-a' });
    const secondWorker = page
      .locator('.n-list-item')
      .filter({ hasText: 'integration-worker-b' });
    await expect(firstWorker).toBeVisible();
    await expect(secondWorker).toBeVisible();
    const logButton = page.getByRole('button', { name: '日志', exact: true });
    const taskLog = page.locator('.n-card').filter({ hasText: 'GPT翻译' });
    await expect(logButton).toHaveAttribute('aria-pressed', 'false');
    await expect(taskLog).toBeHidden();
    const activeJob = page.locator('.job-queue').filter({ hasText: volumeId });
    const queuedChapters = activeJob.locator('.job-queue__chapter');
    await expect(activeJob.getByText('等待中', { exact: true })).toBeVisible();
    await expect(queuedChapters).toHaveCount(0);
    await activeJob.locator('.task-identity').click();
    await expect(queuedChapters).toHaveCount(2);
    await expect(activeJob.locator('.chapter-grid__progress')).toHaveCount(0);
    expect(
      await queuedChapters.first().evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return Math.abs(bounds.width - bounds.height);
      }),
    ).toBeLessThan(1);
    await firstWorker
      .getByRole('button', { name: '启动', exact: true })
      .click();
    await secondWorker
      .getByRole('button', { name: '启动', exact: true })
      .click();
    await twoRequestsArrived;
    expect(server.activeRequests).toBe(2);
    expect(server.requests).toHaveLength(2);
    await expect(activeJob.getByText('翻译中', { exact: true })).toBeVisible();
    await expect(activeJob.locator('.job-queue__chapter')).toHaveCount(2);
    await expect(
      activeJob.locator('.chapter-grid__chapter--translating'),
    ).toHaveCount(2);
    await expect(activeJob.locator('.chapter-grid__progress')).toHaveCount(2);
    await logButton.click();
    await expect(logButton).toHaveAttribute('aria-pressed', 'true');
    await expect(taskLog).toBeVisible();
    await expect(taskLog.getByText('章节1/2', { exact: true })).toBeVisible();
    await expect(taskLog.getByText('章节2/2', { exact: true })).toBeVisible();
    await expect(taskLog.getByText('章节0/2', { exact: true })).toHaveCount(0);
    await logButton.click();
    await expect(taskLog).toBeHidden();
    await page.getByRole('button', { name: '翻译器运行统计' }).click();
    const metricsPanel = page.getByRole('dialog', {
      name: '翻译器运行统计',
    });
    const runningMetric = metricsPanel
      .locator('.workspace-metrics-panel__metric')
      .filter({ hasText: '运行中' });
    await expect(runningMetric).toContainText('2');
    await expect(
      metricsPanel
        .locator('.workspace-metrics-panel__metric')
        .filter({ hasText: '已配置' }),
    ).toContainText('2');
    await expect(
      page.getByRole('alert').filter({ hasText: '正在混用不同模型或接口' }),
    ).toBeVisible();
    await expect(
      metricsPanel
        .locator('.workspace-metrics-panel__metric')
        .filter({ hasText: '活跃请求' }),
    ).toContainText('2/2');
    await metricsPanel.getByRole('button', { name: '关闭运行统计' }).click();
    await firstWorker
      .getByRole('button', { name: '停止', exact: true })
      .click();
    await page.getByRole('button', { name: '翻译器运行统计' }).click();
    await expect(runningMetric).toContainText('1');
    await expect(
      metricsPanel
        .locator('.workspace-metrics-panel__metric')
        .filter({ hasText: '已停止' }),
    ).toContainText('1');
    await metricsPanel.getByRole('button', { name: '关闭运行统计' }).click();
    releaseRequests();

    await expect
      .poll(() =>
        page.evaluate(() => {
          const workspace = JSON.parse(
            localStorage.getItem('auto-novel:workspace:gpt') ?? '{}',
          ) as {
            jobs?: unknown[];
            jobRecords?: Array<{
              progress?: { finished: number; error: number; total: number };
            }>;
          };
          return {
            queued: workspace.jobs?.length,
            records: workspace.jobRecords?.length,
            progress: workspace.jobRecords?.[0]?.progress,
          };
        }),
      )
      .toEqual({
        queued: 0,
        records: 1,
        progress: expect.objectContaining({
          finished: 2,
          error: 0,
          total: 2,
          elapsedMs: expect.any(Number),
        }),
      });
    expect(server.requests).toHaveLength(3);
    expect(server.maximumActiveRequests).toBe(2);
    await expect(
      firstWorker.getByRole('button', { name: '启动', exact: true }),
    ).toBeVisible();
    await expect(
      secondWorker.getByRole('button', { name: '启动', exact: true }),
    ).toBeVisible();
    for (const worker of [firstWorker, secondWorker]) {
      await expect(worker.getByRole('button', { name: '测试' })).toBeEnabled();
      await expect(
        worker.getByRole('button', { name: '设置（请先停止）' }),
      ).toBeEnabled();
    }
    await page.getByRole('button', { name: '翻译器运行统计' }).click();
    const completedMetricsPanel = page.getByRole('dialog', {
      name: '翻译器运行统计',
    });
    await expect(
      completedMetricsPanel
        .locator('.workspace-metrics-panel__metric')
        .filter({ hasText: '缓存' }),
    ).toContainText('2 条');
    await expect(
      completedMetricsPanel
        .locator('.workspace-metrics-panel__metric')
        .filter({ hasText: '命中' })
        .first(),
    ).toContainText('0');
    await expect(
      completedMetricsPanel
        .locator('.workspace-metrics-panel__metric')
        .filter({ hasText: '未命中' }),
    ).toContainText('0');
    await expect(
      completedMetricsPanel
        .locator('.workspace-metrics-panel__metric')
        .filter({ has: page.getByText('请求', { exact: true }) }),
    ).toContainText('3');
    await expect(
      completedMetricsPanel
        .locator('.workspace-metrics-panel__metric')
        .filter({ hasText: '故障' }),
    ).toContainText('0');
    await completedMetricsPanel
      .getByRole('button', { name: '关闭运行统计' })
      .click();

    const persisted = await page.evaluate(async (bookId) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('volumes');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      const transaction = database.transaction(
        ['metadata', 'chapter'],
        'readonly',
      );
      const metadataRequest = transaction.objectStore('metadata').get(bookId);
      const chapterARequest = transaction
        .objectStore('chapter')
        .get(`${bookId}/chapter-a`);
      const chapterBRequest = transaction
        .objectStore('chapter')
        .get(`${bookId}/chapter-b`);
      const result = await new Promise<{
        toc: Array<{ gpt?: string }>;
        chapters: Array<{ gpt?: { paragraphs: string[] } }>;
      }>((resolve, reject) => {
        transaction.oncomplete = () =>
          resolve({
            toc: metadataRequest.result.toc,
            chapters: [chapterARequest.result, chapterBRequest.result],
          });
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
      return result;
    }, volumeId);
    expect(persisted.toc.every((chapter) => chapter.gpt === 'glossary')).toBe(
      true,
    );
    expect(
      persisted.chapters.map((chapter) => chapter.gpt?.paragraphs),
    ).toEqual([
      ['译文第1行', '译文第2行'],
      ['译文第1行', '译文第2行'],
    ]);

    await page.reload();
    await expect(
      page
        .locator('.n-list-item')
        .filter({ hasText: volumeId })
        .getByText('已完成'),
    ).toBeVisible();
    const recordDownloadPromise = page.waitForEvent('download');
    await page
      .getByRole('button', { name: '下载本地小说', exact: true })
      .click();
    const recordDownload = await recordDownloadPromise;
    const recordDownloadStream = await recordDownload.createReadStream();
    const recordChunks: Buffer[] = [];
    for await (const chunk of recordDownloadStream) {
      recordChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    expect(Buffer.concat(recordChunks).toString('utf8')).toBe(
      '第一章原文一\n第一章原文二\n第二章原文一\n第二章原文二',
    );
    await page.goto('/setting');
    await page
      .getByRole('listitem')
      .filter({ has: page.getByText('下载', { exact: true }) })
      .getByText('中文', { exact: true })
      .click();
    await page.goto(`/books/${volumeId}/details`);
    await expect(page.getByText('总计 2 / GPT 2 / Sakura 0')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载译文', exact: true }).click();
    const download = await downloadPromise;
    const downloadStream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of downloadStream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks).toString('utf8')).toBe(
      ['译文第1行', '译文第2行', '译文第1行', '译文第2行'].join('\n'),
    );

    await page.getByRole('button', { name: '开始阅读', exact: true }).click();
    await expect(page).toHaveURL(
      /\/books\/translated-flow\.txt\/read\/chapter-a$/,
    );
    await expect(page.getByText('译文第1行', { exact: true })).toBeVisible();
    await expect(page.getByText('第一章原文一', { exact: true })).toHaveCount(
      0,
    );
    await expect(page.locator('[data-reader-segment-id]')).toHaveCount(2);
    await expect(
      page.locator('[data-reader-segment-id="chapter-a-1"]'),
    ).toContainText('译文第1行');
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toHaveLength(1);
    expect(failedRequests[0]).toContain('/v1/chat/completions');
  } finally {
    releaseRequests();
    await server.close();
  }
});

test('shares one Sakura job across compatible workers', async ({ page }) => {
  const volumeId = 'shared-sakura-job.txt';
  const task =
    `local/${volumeId}` +
    '?level=all&forceMetadata=false&startIndex=0&endIndex=65535';
  let releaseRequests: () => void = () => {};
  const requestBarrier = new Promise<void>((resolve) => {
    releaseRequests = resolve;
  });
  let announceTwoRequests: () => void = () => {};
  const twoRequestsArrived = new Promise<void>((resolve) => {
    announceTwoRequests = resolve;
  });
  const server = await startOpenAiTestServer({
    model: 'sakura-1.0.gguf',
    onChat: async (request) => {
      if (request.index === 1) announceTwoRequests();
      await requestBarrier;
      return { content: `Sakura译文${request.index + 1}` };
    },
  });
  const incompatibleServer = await startOpenAiTestServer({
    model: 'sakura-0.9.gguf',
  });

  try {
    await page.goto('/');
    await expect(page.locator('.n-skeleton')).toHaveCount(0);
    await expect(page.getByText('还没有本地书籍')).toBeVisible();
    await page.goto('/workspace/sakura');
    await page.evaluate(
      async ({ endpoint, incompatibleEndpoint, task, volumeId }) => {
        localStorage.setItem(
          'auto-novel:workspace:sakura',
          JSON.stringify({
            workers: [
              {
                id: 'sakura-worker-a',
                endpoint,
                segLength: 500,
                prevSegLength: 500,
                concurrency: 1,
              },
              {
                id: 'sakura-worker-b',
                endpoint,
                segLength: 500,
                prevSegLength: 500,
                concurrency: 1,
              },
              {
                id: 'sakura-worker-incompatible',
                endpoint: incompatibleEndpoint,
                segLength: 500,
                prevSegLength: 500,
                concurrency: 1,
              },
            ],
            jobs: [{ task, description: volumeId, createAt: 1 }],
            jobRecords: [],
          }),
        );

        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('volumes');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });
        const transaction = database.transaction(
          ['metadata', 'chapter'],
          'readwrite',
        );
        transaction.objectStore('metadata').put({
          id: volumeId,
          createAt: 1,
          toc: [
            { chapterId: 'chapter-a', title: '第一章' },
            { chapterId: 'chapter-b', title: '第二章' },
          ],
          sourceFormat: 'txt',
          glossaryId: 'glossary',
          glossary: {},
          favoredId: 'default',
          sourceBookMetadata: { title: volumeId, languages: ['ja'] },
        });
        transaction.objectStore('chapter').put({
          id: `${volumeId}/chapter-a`,
          volumeId,
          paragraphs: ['第一章原文'],
          segmentIds: ['chapter-a-1'],
        });
        transaction.objectStore('chapter').put({
          id: `${volumeId}/chapter-b`,
          volumeId,
          paragraphs: ['第二章原文'],
          segmentIds: ['chapter-b-1'],
        });
        await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
        });
        database.close();
      },
      {
        endpoint: server.endpoint,
        incompatibleEndpoint: incompatibleServer.endpoint,
        task,
        volumeId,
      },
    );
    await page.reload();

    await page
      .getByRole('button', { name: '批量控制翻译器', exact: true })
      .click();
    await page.getByText('启动全部', { exact: true }).click();
    await twoRequestsArrived;
    expect(server.maximumActiveRequests).toBe(2);
    const activeJob = page.locator('.job-queue').filter({ hasText: volumeId });
    await activeJob.locator('.task-identity').click();
    await expect(activeJob.locator('.job-queue__chapter')).toHaveCount(2);
    const incompatibleCard = page
      .locator('.n-list-item')
      .filter({ hasText: 'sakura-worker-incompatible' });
    await incompatibleCard
      .getByRole('button', { name: '启动', exact: true })
      .click();
    await expect(incompatibleCard).toContainText(
      '启动失败：Sakura 翻译器配置不兼容',
    );
    await page.getByRole('button', { name: '翻译器运行统计' }).click();
    const metricsPanel = page.getByRole('dialog', {
      name: '翻译器运行统计',
    });
    await expect(
      metricsPanel
        .locator('.workspace-metrics-panel__metric')
        .filter({ hasText: '运行中' }),
    ).toContainText('2');
    await expect(
      metricsPanel
        .locator('.workspace-metrics-panel__metric')
        .filter({ hasText: '活跃请求' }),
    ).toContainText('2/2');
    await expect(
      metricsPanel
        .locator('.workspace-metrics-panel__metric')
        .filter({ hasText: '未完成' }),
    ).toContainText('2');
    await metricsPanel.getByRole('button', { name: '关闭运行统计' }).click();

    releaseRequests();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const workspace = JSON.parse(
            localStorage.getItem('auto-novel:workspace:sakura') ?? '{}',
          ) as { jobs?: unknown[]; jobRecords?: unknown[] };
          return [workspace.jobs?.length, workspace.jobRecords?.length];
        }),
      )
      .toEqual([0, 1]);
    for (const workerId of ['sakura-worker-a', 'sakura-worker-b']) {
      const worker = page.locator('.n-list-item').filter({ hasText: workerId });
      await expect(
        worker.getByRole('button', { name: '启动', exact: true }),
      ).toBeVisible();
      await expect(worker.getByRole('button', { name: '测试' })).toBeEnabled();
      await expect(
        worker.getByRole('button', { name: '设置（请先停止）' }),
      ).toBeEnabled();
    }

    const translated = await page.evaluate(async (bookId) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('volumes');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      const transaction = database.transaction('chapter', 'readonly');
      const first = transaction
        .objectStore('chapter')
        .get(`${bookId}/chapter-a`);
      const second = transaction
        .objectStore('chapter')
        .get(`${bookId}/chapter-b`);
      const result = await new Promise<string[][]>((resolve, reject) => {
        transaction.oncomplete = () =>
          resolve([
            first.result.sakura.paragraphs,
            second.result.sakura.paragraphs,
          ]);
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
      return result;
    }, volumeId);
    expect(translated.flat().sort()).toEqual(['Sakura译文1', 'Sakura译文2']);
  } finally {
    releaseRequests();
    await incompatibleServer.close();
    await server.close();
  }
});

test('stops and resumes only unfinished GPT chapters', async ({ page }) => {
  const volumeId = 'resume-shared-job.txt';
  const task =
    `local/${volumeId}` +
    '?level=all&forceMetadata=false&startIndex=0&endIndex=65535';
  let releaseSecondRequest: () => void = () => {};
  const secondRequestBarrier = new Promise<void>((resolve) => {
    releaseSecondRequest = resolve;
  });
  let announceSecondRequest: () => void = () => {};
  const secondRequestStarted = new Promise<void>((resolve) => {
    announceSecondRequest = resolve;
  });
  const server = await startOpenAiTestServer({
    onChat: async (request) => {
      if (request.index === 1) {
        announceSecondRequest();
        await secondRequestBarrier;
      }
      return {
        content:
          request.index === 0
            ? '#1:已完成第一章'
            : request.index === 1
              ? '#1:不应写入的中止译文'
              : '#1:恢复后的第二章',
      };
    },
  });
  try {
    await page.goto('/workspace/gpt');
    await expect(
      page.getByRole('heading', { name: 'GPT工作区' }),
    ).toBeVisible();
    await page.evaluate(
      async ({ endpoint, task, volumeId }) => {
        localStorage.setItem(
          'auto-novel:workspace:gpt',
          JSON.stringify({
            workers: [
              {
                id: 'resume-worker',
                endpoint,
                model: 'resume-model',
                key: 'resume-key',
                concurrency: 1,
              },
            ],
            jobs: [{ task, description: volumeId, createAt: 1 }],
            jobRecords: [],
          }),
        );
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('volumes');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });
        const transaction = database.transaction(
          ['metadata', 'chapter'],
          'readwrite',
        );
        transaction.objectStore('metadata').put({
          id: volumeId,
          createAt: 1,
          toc: [
            { chapterId: 'chapter-a', title: '第一章' },
            { chapterId: 'chapter-b', title: '第二章' },
          ],
          sourceFormat: 'txt',
          glossaryId: 'glossary',
          glossary: {},
          favoredId: 'default',
          sourceBookMetadata: { title: volumeId, languages: ['ja'] },
        });
        transaction.objectStore('chapter').put({
          id: `${volumeId}/chapter-a`,
          volumeId,
          paragraphs: ['第一章原文'],
          segmentIds: ['chapter-a-1'],
        });
        transaction.objectStore('chapter').put({
          id: `${volumeId}/chapter-b`,
          volumeId,
          paragraphs: ['第二章原文'],
          segmentIds: ['chapter-b-1'],
        });
        await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
        });
        database.close();
      },
      { endpoint: server.endpoint, task, volumeId },
    );
    await page.reload();

    await page.getByRole('button', { name: '启动', exact: true }).click();
    await secondRequestStarted;
    const queueActions = page.getByRole('button', { name: '队列操作' });
    await queueActions.click();
    await page.getByText('停止当前任务', { exact: true }).click();
    releaseSecondRequest();
    await queueActions.click();
    await expect(page.getByText('继续队列', { exact: true })).toBeVisible();

    await expect
      .poll(() =>
        page.evaluate(() => {
          const workspace = JSON.parse(
            localStorage.getItem('auto-novel:workspace:gpt') ?? '{}',
          ) as { jobs?: Array<{ resumeTask?: string }> };
          const resumeTask = workspace.jobs?.[0]?.resumeTask;
          if (!resumeTask) return undefined;
          const query = resumeTask.split('?')[1] ?? '';
          return JSON.parse(
            new URLSearchParams(query).get('chapterIds') ?? '[]',
          ) as string[];
        }),
      )
      .toEqual(['chapter-b']);

    const pausedJob = page.locator('.job-queue').filter({ hasText: volumeId });
    await expect(pausedJob.getByText('等待中', { exact: true })).toBeVisible();
    await expect(pausedJob.locator('.job-queue__chapter')).toHaveCount(0);

    await page.getByText('继续队列', { exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const workspace = JSON.parse(
            localStorage.getItem('auto-novel:workspace:gpt') ?? '{}',
          ) as { jobs?: unknown[]; jobRecords?: unknown[] };
          return [workspace.jobs?.length, workspace.jobRecords?.length];
        }),
      )
      .toEqual([0, 1]);
    expect(server.requests).toHaveLength(3);

    const translated = await page.evaluate(async (bookId) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('volumes');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      const transaction = database.transaction('chapter', 'readonly');
      const first = transaction
        .objectStore('chapter')
        .get(`${bookId}/chapter-a`);
      const second = transaction
        .objectStore('chapter')
        .get(`${bookId}/chapter-b`);
      const result = await new Promise<string[][]>((resolve, reject) => {
        transaction.oncomplete = () =>
          resolve([first.result.gpt.paragraphs, second.result.gpt.paragraphs]);
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
      return result;
    }, volumeId);
    expect(translated).toEqual([['已完成第一章'], ['恢复后的第二章']]);
  } finally {
    releaseSecondRequest();
    await server.close();
  }
});

test('pretranslates across chapters and stops continuous retranslation at an untranslated chapter', async ({
  page,
}) => {
  test.setTimeout(45_000);
  const volumeId = 'reader-cross-chapter-translation.txt';
  const nonce = `${Date.now()}`;
  const server = await startOpenAiTestServer({ responseDelayMs: 250 });
  try {
    await page.addInitScript((endpoint) => {
      localStorage.setItem(
        'auto-novel:workspace:gpt',
        JSON.stringify({
          workers: [
            {
              id: 'reader-cross-chapter-worker',
              endpoint,
              model: 'reader-cross-chapter-model',
              key: 'reader-cross-chapter-key',
              concurrency: 1,
            },
          ],
          jobs: [],
          jobRecords: [],
        }),
      );
    }, server.endpoint);
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: '轻小说机翻机器人' }),
    ).toBeVisible();
    await expect(page.locator('.n-skeleton')).toHaveCount(0);
    await page.evaluate(
      async ({ bookId, nonce }) => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('volumes');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });
        const transaction = database.transaction(
          ['metadata', 'chapter', 'reader-settings'],
          'readwrite',
        );
        transaction.objectStore('metadata').put({
          id: bookId,
          createAt: 1,
          toc: [
            { chapterId: '0', title: '第一章', gpt: 'glossary' },
            { chapterId: '1', title: '第二章' },
            { chapterId: '2', title: '第三章' },
          ],
          sourceFormat: 'txt',
          glossaryId: 'glossary',
          glossary: {},
          favoredId: 'default',
          sourceBookMetadata: { title: bookId, languages: ['ja'] },
        });
        transaction.objectStore('chapter').put({
          id: `${bookId}/0`,
          volumeId: bookId,
          paragraphs: [`跨章回归甲零${nonce}`, `跨章回归甲一${nonce}`],
          segmentIds: ['0-0', '0-1'],
          gpt: {
            glossaryId: 'glossary',
            glossary: {},
            paragraphs: ['旧译文', ''],
          },
        });
        for (const chapterId of ['1', '2']) {
          transaction.objectStore('chapter').put({
            id: `${bookId}/${chapterId}`,
            volumeId: bookId,
            paragraphs: [
              `跨章回归${chapterId === '1' ? '乙' : '丙'}零${nonce}`,
            ],
            segmentIds: [`${chapterId}-0`],
          });
        }
        transaction.objectStore('reader-settings').put({
          id: 'default',
          defaultMode: 'original',
          translationPriority: ['gpt', 'sakura', 'youdao', 'baidu'],
          autoTranslationPreloadPages: 0,
          retranslationPolicy: 'replace',
          fontSize: 18,
          lineHeight: 1.9,
          contentWidth: 840,
          horizontalPadding: 24,
          theme: 'system',
          flow: 'scrolled',
          updatedAt: 1,
        });
        await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
        });
        database.close();
      },
      { bookId: volumeId, nonce },
    );

    await page.goto(`/books/${volumeId}/read/0`);
    const currentSource = page.locator('[data-reader-segment-id="0-0"]');
    await expect(currentSource).toBeVisible();
    await currentSource.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'auto' }),
    );
    const automaticButton = page
      .locator('.book-reader__app-bar-translation')
      .getByRole('button', { name: 'GPT 自动翻译', exact: true });
    await automaticButton.click();
    await expect(
      page.getByText('已开启 GPT 自动翻译', { exact: true }),
    ).toBeVisible();
    await expect
      .poll(
        async () => ({
          requests: server.requests.length,
          translated: await page.evaluate(async (bookId) => {
            const database = await new Promise<IDBDatabase>(
              (resolve, reject) => {
                const request = indexedDB.open('volumes');
                request.onerror = () => reject(request.error);
                request.onsuccess = () => resolve(request.result);
              },
            );
            const request = database
              .transaction('chapter', 'readonly')
              .objectStore('chapter')
              .get(`${bookId}/1`);
            const translated = await new Promise<string[] | undefined>(
              (resolve, reject) => {
                request.onerror = () => reject(request.error);
                request.onsuccess = () =>
                  resolve(request.result?.gpt?.paragraphs);
              },
            );
            database.close();
            return translated;
          }, volumeId),
        }),
        { timeout: 15_000 },
      )
      .toEqual({ requests: expect.any(Number), translated: ['译文第1行'] });
    await expect(page).toHaveURL(new RegExp(`/read/0$`));
    await automaticButton.click();

    await page.getByRole('button', { name: '工具', exact: true }).click();
    await page
      .getByRole('dialog', { name: '阅读工具' })
      .getByRole('button', { name: '重新翻译', exact: true })
      .click();
    const retranslation = page.getByRole('dialog', { name: '重新翻译' });
    await retranslation
      .locator('.n-form-item')
      .filter({ hasText: '范围' })
      .locator('.n-base-selection')
      .click();
    await page.locator('.n-base-select-menu').getByText('连续重翻').click();
    await expect(
      retranslation
        .locator('.n-form-item')
        .filter({ hasText: '遇到未翻译章' })
        .locator('.n-base-selection-label'),
    ).toHaveText('停止');
    await retranslation
      .getByRole('button', { name: 'GPT 自动翻译', exact: true })
      .click();

    await expect
      .poll(() => server.requests.length, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(4);
    await expect
      .poll(() =>
        page.evaluate(async (bookId) => {
          const database = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('volumes');
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
          });
          const transaction = database.transaction('chapter', 'readonly');
          const requests = ['0', '1', '2'].map((chapterId) =>
            transaction.objectStore('chapter').get(`${bookId}/${chapterId}`),
          );
          const translations = await new Promise<Array<string[] | undefined>>(
            (resolve, reject) => {
              transaction.oncomplete = () =>
                resolve(
                  requests.map((request) => request.result?.gpt?.paragraphs),
                );
              transaction.onerror = () => reject(transaction.error);
            },
          );
          database.close();
          return translations;
        }, volumeId),
      )
      .toEqual([['译文第1行', '译文第2行'], ['译文第1行'], undefined]);
    await page.getByRole('button', { name: '工具', exact: true }).click();
    await expect(
      page
        .getByRole('dialog', { name: '阅读工具' })
        .getByRole('button', { name: '重新翻译', exact: true }),
    ).toHaveAttribute('aria-pressed', 'false');
  } finally {
    await server.close();
  }
});

test('keeps workspace metrics draggable and local to the current page', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/workspace/toolbox');
  const toolboxTitleBounds = await page
    .getByRole('heading', { name: '小说工具箱', exact: true })
    .boundingBox();
  expect(toolboxTitleBounds).not.toBeNull();
  await page.goto('/workspace/interactive');
  const interactiveTitleBounds = await page
    .getByRole('heading', { name: '交互翻译', exact: true })
    .boundingBox();
  expect(interactiveTitleBounds).not.toBeNull();
  expect(interactiveTitleBounds!.y).toBeCloseTo(toolboxTitleBounds!.y, 0);
  await page.goto('/workspace/gpt');

  const trigger = page.getByRole('button', { name: '翻译器运行统计' });
  const title = page.getByRole('heading', { name: 'GPT工作区', exact: true });
  const gptContentBounds = await page.locator('.layout-content').boundingBox();
  const gptHeadingBounds = await page
    .locator('.workspace-page-heading')
    .boundingBox();
  expect(gptContentBounds).not.toBeNull();
  expect(gptHeadingBounds).not.toBeNull();
  expect(gptHeadingBounds!.y - gptContentBounds!.y).toBeCloseTo(28, 0);
  const triggerBounds = await trigger.boundingBox();
  const titleBounds = await title.boundingBox();
  expect(triggerBounds).not.toBeNull();
  expect(titleBounds).not.toBeNull();
  expect(titleBounds!.y).toBeCloseTo(toolboxTitleBounds!.y, 0);
  expect(
    Math.abs(
      triggerBounds!.y +
        triggerBounds!.height / 2 -
        (titleBounds!.y + titleBounds!.height / 2),
    ),
  ).toBeLessThanOrEqual(2);

  await trigger.click();
  const panel = page.getByRole('dialog', { name: '翻译器运行统计' });
  await expect(panel).toBeVisible();
  const desktopBounds = await panel.boundingBox();
  expect(desktopBounds).not.toBeNull();
  expect(desktopBounds!.width).toBeGreaterThanOrEqual(500);
  expect(desktopBounds!.width).toBeLessThanOrEqual(520);
  expect(1280 - desktopBounds!.x - desktopBounds!.width).toBeCloseTo(24, 0);
  expect(desktopBounds!.y).toBeCloseTo(64, 0);

  await page.mouse.click(600, 700);
  await expect(panel).toBeVisible();

  const dragHandle = panel.locator('.workspace-metrics-panel__header');
  const handleBounds = await dragHandle.boundingBox();
  expect(handleBounds).not.toBeNull();
  await page.mouse.move(
    handleBounds!.x + handleBounds!.width / 2,
    handleBounds!.y + handleBounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handleBounds!.x + handleBounds!.width / 2 - 300,
    handleBounds!.y + handleBounds!.height / 2 + 120,
    { steps: 5 },
  );
  await page.mouse.up();
  const draggedBounds = await panel.boundingBox();
  expect(draggedBounds).not.toBeNull();
  expect(draggedBounds!.x).toBeCloseTo(desktopBounds!.x - 300, 0);
  expect(draggedBounds!.y).toBeCloseTo(desktopBounds!.y + 120, 0);

  await trigger.click();
  await expect(panel).toHaveCount(0);
  await trigger.click();
  const rememberedBounds = await panel.boundingBox();
  expect(rememberedBounds).not.toBeNull();
  expect(rememberedBounds!.x).toBeCloseTo(draggedBounds!.x, 0);
  expect(rememberedBounds!.y).toBeCloseTo(draggedBounds!.y, 0);
  await panel.getByRole('button', { name: '关闭运行统计' }).click();
  await expect(panel).toHaveCount(0);

  await page.goto('/');
  await page.goto('/workspace/gpt');
  await page.getByRole('button', { name: '翻译器运行统计' }).click();
  const resetBounds = await page
    .getByRole('dialog', { name: '翻译器运行统计' })
    .boundingBox();
  expect(resetBounds).not.toBeNull();
  expect(1280 - resetBounds!.x - resetBounds!.width).toBeCloseTo(24, 0);
  expect(resetBounds!.y).toBeCloseTo(64, 0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/workspace/toolbox');
  const mobileToolboxTitleBounds = await page
    .getByRole('heading', { name: '小说工具箱', exact: true })
    .boundingBox();
  expect(mobileToolboxTitleBounds).not.toBeNull();
  await page.goto('/workspace/sakura');
  const sakuraContentBounds = await page
    .locator('.layout-content')
    .boundingBox();
  const sakuraHeadingBounds = await page
    .locator('.workspace-page-heading')
    .boundingBox();
  expect(sakuraContentBounds).not.toBeNull();
  expect(sakuraHeadingBounds).not.toBeNull();
  expect(sakuraHeadingBounds!.y - sakuraContentBounds!.y).toBeCloseTo(28, 0);
  const sakuraTitleBounds = await page
    .getByRole('heading', { name: 'Sakura工作区', exact: true })
    .boundingBox();
  expect(sakuraTitleBounds).not.toBeNull();
  expect(sakuraTitleBounds!.y).toBeCloseTo(mobileToolboxTitleBounds!.y, 0);
  await page.getByRole('button', { name: '翻译器运行统计' }).click();
  const sakuraPanel = page.getByRole('dialog', { name: '翻译器运行统计' });
  await expect(sakuraPanel).toBeVisible();
  const mobileBounds = await sakuraPanel.boundingBox();
  expect(mobileBounds).not.toBeNull();
  expect(mobileBounds!.width).toBeCloseTo(366, 0);
  expect(390 - mobileBounds!.x - mobileBounds!.width).toBeCloseTo(12, 0);
  expect(mobileBounds!.y).toBeCloseTo(58, 0);
  await expect(sakuraPanel).toHaveCSS('user-select', 'none');
  await expect(
    sakuraPanel.getByRole('region', { name: '翻译缓存统计' }),
  ).toBeVisible();
  const sakuraWorkerPage = sakuraPanel.getByRole('button', {
    name: '翻译器总览',
    exact: true,
  });
  const sakuraPipelinePage = sakuraPanel.getByRole('button', {
    name: '共享池',
    exact: true,
  });
  await sakuraWorkerPage.click();
  await expect(
    sakuraPanel.getByRole('region', { name: '翻译器总览' }),
  ).toBeVisible();
  await sakuraPipelinePage.click();
  await expect(
    sakuraPanel.getByRole('region', { name: '共享池统计' }),
  ).toBeVisible();
  const panelBody = sakuraPanel.locator('.workspace-metrics-panel__body');
  const panelBodyBounds = await panelBody.boundingBox();
  expect(panelBodyBounds).not.toBeNull();
  const longPressX = panelBodyBounds!.x + panelBodyBounds!.width / 2;
  const longPressY = panelBodyBounds!.y + panelBodyBounds!.height / 2;
  await page.mouse.move(longPressX, longPressY);
  await page.mouse.down();
  await page.waitForTimeout(250);
  await page.mouse.up();
  await expect(sakuraPanel).toBeVisible();
  await page.mouse.down();
  await page.waitForTimeout(1050);
  await expect(sakuraPanel).toHaveCount(0);
  await page.mouse.up();

  await page.setViewportSize({ width: 390, height: 420 });
  await page.goto('/workspace/gpt');
  const retryRecords = page.getByRole('button', {
    name: '重试未完成任务',
    exact: true,
  });
  await retryRecords.scrollIntoViewIfNeeded();
  const recordActions = retryRecords.locator('xpath=..');
  const recordActionBounds = await recordActions.boundingBox();
  expect(recordActionBounds).not.toBeNull();
  expect(recordActionBounds!.x + recordActionBounds!.width).toBeLessThanOrEqual(
    390,
  );
  await expect(retryRecords.locator('.c-button__label')).toBeVisible();
  await expect(
    page.getByRole('button', { name: '下载', exact: true }),
  ).toBeVisible();
  const clearRecords = page
    .getByRole('button', { name: '清空', exact: true })
    .last();
  await expect(clearRecords).toBeVisible();
  await expect(clearRecords.locator('.c-button__label')).toBeVisible();

  await page.getByRole('button', { name: '翻译器运行统计' }).click();
  const shortPanel = page.getByRole('dialog', { name: '翻译器运行统计' });
  const shortPanelBounds = await shortPanel.boundingBox();
  expect(shortPanelBounds).not.toBeNull();
  expect(shortPanelBounds!.y).toBeGreaterThanOrEqual(8);
  expect(shortPanelBounds!.y + shortPanelBounds!.height).toBeLessThanOrEqual(
    420 - 8,
  );
  const shortPanelBody = shortPanel.locator('.workspace-metrics-panel__body');
  await expect(shortPanelBody).toHaveCSS('touch-action', 'none');
  await expect
    .poll(() =>
      shortPanelBody.evaluate(
        (element) => element.scrollHeight <= element.clientHeight,
      ),
    )
    .toBe(true);
  const cachePage = shortPanel.getByRole('button', {
    name: '翻译缓存',
    exact: true,
  });
  const workerPage = shortPanel.getByRole('button', {
    name: '翻译器总览',
    exact: true,
  });
  const pipelinePage = shortPanel.getByRole('button', {
    name: '共享池',
    exact: true,
  });
  await expect(cachePage).toHaveAttribute('aria-pressed', 'true');
  await expect(
    shortPanel.getByRole('region', { name: '翻译缓存统计' }),
  ).toBeVisible();
  await expect(
    shortPanel.getByRole('region', { name: '翻译器总览' }),
  ).toHaveCount(0);
  await workerPage.click();
  await expect(workerPage).toHaveAttribute('aria-pressed', 'true');
  await expect(
    shortPanel.getByRole('region', { name: '翻译器总览' }),
  ).toBeVisible();
  await pipelinePage.click();
  await expect(pipelinePage).toHaveAttribute('aria-pressed', 'true');
  await expect(
    shortPanel
      .locator('.workspace-metrics-panel__metric')
      .filter({ hasText: '背压等待' }),
  ).toBeVisible();
  const pagedPanelBounds = await shortPanel.boundingBox();
  expect(pagedPanelBounds).not.toBeNull();
  expect(pagedPanelBounds!.y + pagedPanelBounds!.height).toBeLessThanOrEqual(
    420 - 8,
  );
});

test('keeps shared GPT worker controls usable on mobile', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/workspace/gpt');
  await page.evaluate(() => {
    localStorage.setItem(
      'auto-novel:workspace:gpt',
      JSON.stringify({
        workers: [
          {
            id: 'mobile-worker-a',
            endpoint: 'http://127.0.0.1:1',
            model: 'mobile-model-a',
            key: 'mobile-key-a',
            concurrency: 1,
          },
          {
            id: 'mobile-worker-b',
            endpoint: 'http://127.0.0.1:2',
            model: 'mobile-model-b',
            key: 'mobile-key-b',
            concurrency: 2,
          },
        ],
        jobs: [],
        jobRecords: [],
      }),
    );
  });
  await page.reload();

  const firstMobileWorker = page
    .locator('.n-list-item')
    .filter({ hasText: 'mobile-worker-a' });
  await expect(firstMobileWorker.locator('.pool-worker__name')).toHaveText(
    'mobile-worker-a',
  );
  await expect(firstMobileWorker.locator('.pool-worker__config')).toHaveText(
    'mobile-model-a[ey-a]',
  );
  await expect(firstMobileWorker.locator('.pool-worker__endpoint')).toHaveText(
    'http://127.0.0.1:1',
  );
  await expect(
    firstMobileWorker.locator('.pool-worker__endpoint'),
  ).not.toHaveAttribute('href');
  expect(
    await firstMobileWorker.locator('.drag-trigger').evaluate((handle) => {
      const thing = handle.closest('.n-thing');
      if (thing === null) return Number.POSITIVE_INFINITY;
      const thingBounds = thing.getBoundingClientRect();
      const handleBounds = handle.getBoundingClientRect();
      return Math.abs(
        handleBounds.top +
          handleBounds.height / 2 -
          (thingBounds.top + thingBounds.height / 2),
      );
    }),
  ).toBeLessThanOrEqual(1);
  const firstMobileWorkerActions = firstMobileWorker.locator(
    '.pool-worker__actions',
  );
  expect(
    await firstMobileWorkerActions.evaluate(
      (element) =>
        getComputedStyle(element).gridTemplateColumns.split(' ').length,
    ),
  ).toBe(2);
  const startButton = firstMobileWorker.getByRole('button', {
    name: '启动',
    exact: true,
  });
  await expect(startButton.locator('.c-button__label')).toBeHidden();
  const workerActionButtons = [
    startButton,
    firstMobileWorker.getByRole('button', { name: '测试', exact: true }),
    firstMobileWorker.getByRole('button', {
      name: '设置（请先停止）',
      exact: true,
    }),
    firstMobileWorker.getByRole('button', { name: '删除', exact: true }),
  ];
  const workerActionBounds = await Promise.all(
    workerActionButtons.map((button) => button.boundingBox()),
  );
  expect(workerActionBounds.every((bounds) => bounds !== null)).toBe(true);
  expect(workerActionBounds[0]!.y).toBe(workerActionBounds[1]!.y);
  expect(workerActionBounds[2]!.y).toBe(workerActionBounds[3]!.y);
  expect(workerActionBounds[2]!.y).toBeGreaterThan(workerActionBounds[0]!.y);
  const horizontalCenterDistance =
    workerActionBounds[1]!.x - workerActionBounds[0]!.x;
  const verticalCenterDistance =
    workerActionBounds[2]!.y - workerActionBounds[0]!.y;
  expect(
    Math.abs(horizontalCenterDistance - verticalCenterDistance),
  ).toBeLessThan(0.1);
  expect(
    workerActionBounds.every(
      (bounds) => bounds!.width < 32 && bounds!.height < 32,
    ),
  ).toBe(true);

  const gptAutomaticQueue = page.getByRole('button', {
    name: '自动队列',
  });
  const gptQueueActions = page.getByRole('button', { name: '队列操作' });
  await expect(gptAutomaticQueue).toHaveAttribute('aria-pressed', 'true');
  await expect(gptAutomaticQueue).toHaveClass(/n-button--primary-type/);
  await expect(gptAutomaticQueue.locator('.c-button__label')).toBeHidden();
  expect((await gptQueueActions.boundingBox())!.x).toBeGreaterThan(
    (await gptAutomaticQueue.boundingBox())!.x,
  );
  await expect(
    page
      .getByRole('button', { name: '添加翻译器' })
      .locator('.c-button__label'),
  ).toBeHidden();
  await expect(
    page
      .getByRole('button', { name: '清空缓存' })
      .locator('.c-button-confirm__label'),
  ).toBeHidden();
  await expect(
    page
      .getByRole('button', { name: '本地书架', exact: true })
      .locator('.c-button__label'),
  ).toBeHidden();
  for (const button of [
    page.getByRole('button', { name: '添加翻译器' }),
    page.getByRole('button', { name: '清空缓存' }),
    page.getByRole('button', { name: '本地书架', exact: true }),
    gptAutomaticQueue,
  ]) {
    await expectButtonIconCentered(button);
  }
  const gptLogButton = page.getByRole('button', {
    name: '日志',
    exact: true,
  });
  await expect(gptLogButton).toHaveAttribute('aria-pressed', 'false');
  await gptLogButton.click();
  await expect(gptLogButton).toHaveAttribute('aria-pressed', 'true');
  await gptLogButton.click();
  await gptAutomaticQueue.hover();
  await expect(
    page.getByText('自动处理后续任务：已开启', { exact: true }),
  ).toBeVisible();
  await gptAutomaticQueue.click();
  await expect(gptAutomaticQueue).toHaveAttribute('aria-pressed', 'false');
  await gptAutomaticQueue.click();
  await gptQueueActions.click();
  const gptQueueMenu = page.locator('.n-dropdown-menu:visible');
  await expect(page.getByText('清空队列', { exact: true })).toBeVisible();
  const gptQueueMenuBounds = await gptQueueMenu.boundingBox();
  expect(gptQueueMenuBounds).not.toBeNull();
  expect(gptQueueMenuBounds!.x + gptQueueMenuBounds!.width).toBeLessThanOrEqual(
    390,
  );
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: '本地书架', exact: true }).click();
  const gptLocalDrawer = page
    .locator('.n-drawer')
    .filter({ hasText: '本地小说' });
  const gptLocalAdd = gptLocalDrawer.getByRole('button', {
    name: '添加',
    exact: true,
  });
  await expect(gptLocalAdd).toBeVisible();
  await expect(gptLocalAdd.locator('.c-button__label')).toBeHidden();
  await gptLocalAdd.hover();
  await expect(
    page.getByText('支持拖拽上传 EPUB/TXT/SRT 文件', { exact: true }),
  ).toBeHidden();
  const gptLocalDownload = gptLocalDrawer.getByRole('button', {
    name: '下载选中的书',
    exact: true,
  });
  await expect(gptLocalDownload).toBeVisible();
  await expect(gptLocalDownload.locator('.c-button__label')).toBeHidden();
  await expectButtonIconCentered(gptLocalAdd);
  await expectButtonIconCentered(gptLocalDownload);
  await expect(
    gptLocalDrawer.getByText('已选择 0 本', { exact: true }),
  ).toBeVisible();
  await expect(
    gptLocalDrawer.getByRole('button', { name: '全选', exact: true }),
  ).toBeVisible();
  await expect(
    gptLocalDrawer.getByRole('button', { name: '反选', exact: true }),
  ).toBeVisible();
  await gptLocalDrawer
    .getByRole('button', { name: '更多本地小说操作' })
    .click();
  await expect(page.getByText('排队', { exact: true })).toBeVisible();
  await expect(page.getByText('删除', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('格式异常', { exact: true })).toBeVisible();
  const formatRetryInfo = page.getByRole('button', {
    name: '格式异常重试说明',
  });
  await expect(formatRetryInfo).toBeVisible();
  expect(
    await formatRetryInfo.evaluate((button) => {
      const group = button.parentElement?.querySelector('.n-input-group');
      if (group === null || group === undefined) return Number.NaN;
      return Math.round(
        button.getBoundingClientRect().left -
          group.getBoundingClientRect().right,
      );
    }),
  ).toBeLessThanOrEqual(8);
  const numberInputs = page.locator('.local-translate-options__number input');
  await expect(numberInputs).toHaveCount(4);
  expect(
    await numberInputs.evaluateAll((inputs) =>
      inputs.every((input) => getComputedStyle(input).textAlign === 'center'),
    ),
  ).toBe(true);
  const formatRetryInput = page.getByRole('textbox', {
    name: '格式异常重试次数',
  });
  const taskNumberInput = page.getByRole('textbox', { name: '均分任务数' });
  const formatRetryWidth = await formatRetryInput.evaluate(
    (input) => input.closest('.n-input-number')?.getBoundingClientRect().width,
  );
  const taskNumberWidth = await taskNumberInput.evaluate(
    (input) => input.closest('.n-input-number')?.getBoundingClientRect().width,
  );
  expect(
    Math.abs((formatRetryWidth ?? 0) - (taskNumberWidth ?? 0)),
  ).toBeLessThan(0.1);
  await expect(formatRetryInput).toHaveValue('3');
  await formatRetryInput.fill('5');
  await expect(formatRetryInput).toHaveValue('5');
  await page.keyboard.press('Escape');

  await page
    .getByRole('button', { name: '批量控制翻译器', exact: true })
    .click();
  await page.getByText('启动全部', { exact: true }).click();
  await page.getByRole('button', { name: '翻译器运行统计' }).click();
  const metricsPanel = page.getByRole('dialog', {
    name: '翻译器运行统计',
  });
  await metricsPanel
    .getByRole('button', { name: '翻译器总览', exact: true })
    .click();
  await expect(
    metricsPanel
      .locator('.workspace-metrics-panel__metric')
      .filter({ hasText: '运行中' }),
  ).toContainText('2');
  await expect(
    metricsPanel
      .locator('.workspace-metrics-panel__metric')
      .filter({ hasText: '活跃请求' }),
  ).toContainText('0/3');
  await expect(
    page.getByRole('alert').filter({ hasText: '正在混用不同模型或接口' }),
  ).toBeVisible();
  await expect(page.getByText('空闲，等待共享任务')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await metricsPanel.getByRole('button', { name: '关闭运行统计' }).click();
  await expect(metricsPanel).toHaveCount(0);
  await page
    .getByRole('button', { name: '批量控制翻译器', exact: true })
    .click();
  await page.getByText('停止全部', { exact: true }).click();
  await page.getByRole('button', { name: '翻译器运行统计' }).click();
  await expect(
    metricsPanel
      .locator('.workspace-metrics-panel__metric')
      .filter({ hasText: '运行中' }),
  ).toContainText('0');

  await page.goto('/workspace/sakura');
  await expect(
    page.getByRole('heading', { name: 'Sakura工作区' }),
  ).toBeVisible();
  const sakuraAutomaticQueue = page.getByRole('button', {
    name: '自动队列',
  });
  const sakuraQueueActions = page.getByRole('button', { name: '队列操作' });
  await expect(sakuraAutomaticQueue).toHaveAttribute('aria-pressed', 'true');
  await expect(sakuraAutomaticQueue).toHaveClass(/n-button--primary-type/);
  await expect(sakuraAutomaticQueue.locator('.c-button__label')).toBeHidden();
  expect((await sakuraQueueActions.boundingBox())!.x).toBeGreaterThan(
    (await sakuraAutomaticQueue.boundingBox())!.x,
  );
  await expect(
    page
      .getByRole('button', { name: '添加翻译器' })
      .locator('.c-button__label'),
  ).toBeHidden();
  await expect(
    page
      .getByRole('button', { name: '清空缓存' })
      .locator('.c-button-confirm__label'),
  ).toBeHidden();
  await expect(
    page
      .getByRole('button', { name: '本地书架', exact: true })
      .locator('.c-button__label'),
  ).toBeHidden();
  for (const button of [
    page.getByRole('button', { name: '添加翻译器' }),
    page.getByRole('button', { name: '清空缓存' }),
    page.getByRole('button', { name: '本地书架', exact: true }),
    sakuraAutomaticQueue,
  ]) {
    await expectButtonIconCentered(button);
  }
  await sakuraAutomaticQueue.click();
  await expect(sakuraAutomaticQueue).toHaveAttribute('aria-pressed', 'false');
  await sakuraAutomaticQueue.click();
  await sakuraQueueActions.click();
  const sakuraQueueMenuBounds = await page
    .locator('.n-dropdown-menu:visible')
    .boundingBox();
  expect(sakuraQueueMenuBounds).not.toBeNull();
  expect(
    sakuraQueueMenuBounds!.x + sakuraQueueMenuBounds!.width,
  ).toBeLessThanOrEqual(390);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '本地书架', exact: true }).click();
  const sakuraLocalDrawer = page
    .locator('.n-drawer')
    .filter({ hasText: '本地小说' });
  await expect(
    sakuraLocalDrawer.getByRole('button', { name: '添加', exact: true }),
  ).toBeVisible();
  await expect(
    sakuraLocalDrawer.getByRole('button', {
      name: '下载选中的书',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    sakuraLocalDrawer.getByText('已选择 0 本', { exact: true }),
  ).toBeVisible();
  await expect(
    sakuraLocalDrawer.getByRole('button', { name: '全选', exact: true }),
  ).toBeVisible();
  await expect(
    sakuraLocalDrawer.getByRole('button', { name: '反选', exact: true }),
  ).toBeVisible();
  await sakuraLocalDrawer
    .getByRole('button', { name: '更多本地小说操作' })
    .click();
  await expect(page.getByText('排队', { exact: true })).toBeVisible();
  await expect(page.getByText('删除', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('格式异常', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: '格式异常重试次数' }),
  ).toHaveValue('3');
  await page
    .getByRole('button', { name: '批量控制翻译器', exact: true })
    .click();
  await expect(page.getByText('启动全部', { exact: true })).toBeVisible();
  await expect(page.getByText('停止全部', { exact: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('edits and auto-scans an empty glossary for a queued book', async ({
  page,
}) => {
  const volumeId = 'queued-glossary.txt';
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '轻小说机翻机器人' }),
  ).toBeVisible();
  await page.evaluate(async (bookId) => {
    localStorage.setItem(
      'auto-novel:workspace:gpt',
      JSON.stringify({
        workers: [],
        jobs: [
          {
            task: `local/${bookId}?level=normal&translateMetadata=true&forceMetadata=false&startIndex=0&endIndex=65535&formatRetryCount=3`,
            description: bookId,
            createAt: 1,
          },
        ],
        jobRecords: [],
      }),
    );
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
      toc: [{ chapterId: 'chapter', title: '术语表测试' }],
      sourceFormat: 'txt',
      glossaryId: 'empty-glossary',
      glossary: {},
      favoredId: 'default',
      sourceBookMetadata: { title: bookId, languages: ['ja'] },
    });
    transaction.objectStore('chapter').put({
      id: `${bookId}/chapter`,
      volumeId: bookId,
      paragraphs: ['テスト'],
      segmentIds: ['segment-0'],
    });
    transaction.objectStore('file').put({
      id: bookId,
      file: new File(['テスト\n'.repeat(12)], bookId, {
        type: 'text/plain',
      }),
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }, volumeId);
  await page.goto('/workspace/gpt');

  const queueItem = page.locator('.job-queue').filter({ hasText: volumeId });
  const editGlossary = queueItem.getByRole('button', {
    name: '编辑术语表',
  });
  await expect(editGlossary).toBeVisible();
  await editGlossary.click();

  const dialog = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: '编辑术语表' }) });
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  expect(
    await dialog
      .locator('.glossary-toolbar__row--secondary')
      .evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.split(' ').length,
      ),
  ).toBe(2);
  const tableBounds = await dialog.locator('.glossary-table').boundingBox();
  expect(tableBounds).not.toBeNull();
  expect(tableBounds!.x).toBeGreaterThanOrEqual(bounds!.x);
  expect(tableBounds!.x + tableBounds!.width).toBeLessThanOrEqual(
    bounds!.x + bounds!.width,
  );
  expect(
    await dialog
      .locator('.glossary-table table')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  const operationHeaderBounds = await dialog
    .getByRole('columnheader', { name: '操作', exact: true })
    .boundingBox();
  expect(operationHeaderBounds).not.toBeNull();
  expect(
    operationHeaderBounds!.x + operationHeaderBounds!.width,
  ).toBeLessThanOrEqual(bounds!.x + bounds!.width);
  const row = dialog.locator('tbody tr').filter({ hasText: 'テスト' });
  await expect(row).toBeVisible();
  const mobileActionRows = dialog.locator('.glossary-mobile-actions__row');
  await expect(mobileActionRows).toHaveCount(2);
  for (const [rowIndex, names] of [
    [0, ['保存到本书', '扫描', '翻译', '翻译器配置']],
    [1, ['全选当前', '移除所选', '撤销删除', '术语表']],
  ] as const) {
    const actionRow = mobileActionRows.nth(rowIndex);
    const actionRowBounds = await actionRow.boundingBox();
    const buttonBounds = await Promise.all(
      names.map((name) =>
        actionRow.getByRole('button', { name, exact: true }).boundingBox(),
      ),
    );
    expect(actionRowBounds).not.toBeNull();
    expect(buttonBounds.every((button) => button !== null)).toBe(true);
    const buttonCenterY = (
      button: NonNullable<(typeof buttonBounds)[number]>,
    ) => button.y + button.height / 2;
    expect(
      Math.abs(
        buttonCenterY(buttonBounds[0]!) - buttonCenterY(buttonBounds[1]!),
      ),
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(
        buttonCenterY(buttonBounds[1]!) - buttonCenterY(buttonBounds[2]!),
      ),
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(
        buttonCenterY(buttonBounds[2]!) - buttonCenterY(buttonBounds[3]!),
      ),
    ).toBeLessThanOrEqual(2);
    expect(
      buttonBounds[1]!.x - (buttonBounds[0]!.x + buttonBounds[0]!.width),
    ).toBeLessThanOrEqual(20);
    expect(
      buttonBounds[2]!.x - (buttonBounds[1]!.x + buttonBounds[1]!.width),
    ).toBeLessThanOrEqual(20);
    expect(
      Math.abs(
        buttonBounds[3]!.x +
          buttonBounds[3]!.width -
          (actionRowBounds!.x + actionRowBounds!.width),
      ),
    ).toBeLessThanOrEqual(1);
  }
  await row.locator('input').fill('队列译名');
  await dialog.getByRole('button', { name: '保存到本书' }).click();
  await expect(
    page.getByText('术语表已保存到本书', { exact: true }),
  ).toBeVisible();

  const glossary = await page.evaluate(async (bookId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('volumes');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const request = database
      .transaction('metadata', 'readonly')
      .objectStore('metadata')
      .get(bookId);
    const value = await new Promise<{
      glossary: Record<string, string>;
      glossaryCandidateCounts?: Record<string, number>;
    }>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return value;
  }, volumeId);
  expect(glossary.glossary).toEqual({ テスト: '队列译名' });
  expect(glossary.glossaryCandidateCounts).toEqual({ テスト: 12 });

  await page.goto(`/books/${volumeId}/read/chapter`);
  await page.getByRole('button', { name: '工具', exact: true }).click();
  const readerTools = page.getByRole('dialog', { name: '阅读工具' });
  await readerTools
    .getByRole('button', { name: '术语表', exact: true })
    .click();
  const readerGlossary = page.getByRole('dialog', { name: '术语表处理' });
  const readerRow = readerGlossary
    .locator('tbody tr')
    .filter({ hasText: 'テスト' });
  await expect(readerRow.locator('input')).toHaveValue('队列译名');
  await readerRow.locator('input').fill('阅读器译名');
  await readerGlossary
    .getByRole('button', { name: '应用到本书', exact: true })
    .click();
  await expect(
    page.getByText('术语表已应用，未完成的自动翻译缓存已清除', {
      exact: true,
    }),
  ).toBeVisible();

  await page.goto('/workspace/gpt');
  const refreshedQueueItem = page
    .locator('.job-queue')
    .filter({ hasText: volumeId });
  await refreshedQueueItem.getByRole('button', { name: '编辑术语表' }).click();
  const refreshedDialog = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: '编辑术语表' }) });
  await expect(
    refreshedDialog
      .locator('tbody tr')
      .filter({ hasText: 'テスト' })
      .locator('input'),
  ).toHaveValue('阅读器译名');
});

test('loads only the current GPT workspace schema', async ({ page }) => {
  await page.goto('/workspace/gpt');
  await page.evaluate(() => {
    localStorage.setItem(
      'workspace-gpt',
      JSON.stringify({
        workers: [
          {
            id: 'legacy-worker',
            endpoint: 'https://chat.openai.com/backend-api',
            type: 'web',
          },
        ],
        jobs: [],
        uncompletedJobs: [],
      }),
    );
    localStorage.setItem(
      'auto-novel:workspace:gpt',
      JSON.stringify({
        workers: [
          {
            id: 'current-worker',
            endpoint: 'https://api.example.com',
            model: 'current-model',
            key: 'current-key',
            concurrency: 2,
          },
        ],
        jobs: [],
        jobRecords: [],
      }),
    );
  });

  await page.reload();

  await expect(page.getByRole('heading', { name: 'GPT工作区' })).toBeVisible();
  await expect(
    page.locator('.n-list-item').filter({ hasText: 'current-worker' }),
  ).toBeVisible();
  await expect(
    page.locator('.n-list-item').filter({ hasText: 'legacy-worker' }),
  ).toHaveCount(0);
});

test('previews adjacent chapter edges before committing a chapter transition', async ({
  page,
}) => {
  const continuousBookId = 'chapter-scroll-boundary.txt';
  const chapterIds = ['0', '1', '2'];
  const paragraphs = (chapterIndex: number) =>
    Array.from(
      { length: chapterIndex === 0 ? 1_200 : 36 },
      (_, paragraphIndex) =>
        paragraphIndex === 0
          ? `第 ${chapterIndex + 1} 章`
          : `第 ${chapterIndex + 1} 章第 ${paragraphIndex + 1} 段单章滚动正文`,
    );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '轻小说机翻机器人' }),
  ).toBeVisible();
  await expect(page.locator('.n-skeleton')).toHaveCount(0);
  await page.evaluate(
    async ({ bookId, ids, chapterParagraphs }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('volumes');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      const transaction = database.transaction(
        ['metadata', 'chapter', 'reader-settings'],
        'readwrite',
      );
      transaction.objectStore('metadata').put({
        id: bookId,
        createAt: 1,
        toc: ids.map((chapterId, index) => ({
          chapterId,
          title: `第 ${index + 1} 章`,
        })),
        sourceFormat: 'txt',
        glossaryId: 'glossary',
        glossary: {},
        favoredId: 'default',
        sourceBookMetadata: {
          title: '连续滚动测试',
          authors: [],
          languages: ['zh'],
        },
      });
      for (const [index, chapterId] of ids.entries()) {
        transaction.objectStore('chapter').put({
          id: `${bookId}/${chapterId}`,
          volumeId: bookId,
          paragraphs: chapterParagraphs[index],
          segmentIds: chapterParagraphs[index].map(
            (_, paragraphIndex) => `continuous-${chapterId}-${paragraphIndex}`,
          ),
        });
      }
      transaction.objectStore('reader-settings').put({
        id: 'default',
        defaultMode: 'original',
        translationPriority: ['gpt', 'sakura', 'youdao', 'baidu'],
        fontSize: 18,
        lineHeight: 1.9,
        contentWidth: 840,
        horizontalPadding: 24,
        theme: 'light',
        flow: 'scrolled',
        updatedAt: 1,
      });
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
    },
    {
      bookId: continuousBookId,
      ids: chapterIds,
      chapterParagraphs: chapterIds.map((_, index) => paragraphs(index)),
    },
  );

  const loadedChapterIds = () =>
    page
      .locator('[data-reader-chapter-id]')
      .evaluateAll((elements) =>
        elements.map(
          (element) => (element as HTMLElement).dataset.readerChapterId,
        ),
      );

  await page.goto(`/books/${continuousBookId}/read/1`);
  await expect.poll(loadedChapterIds).toEqual(['1']);
  await expect(
    page.locator('[data-reader-chapter-preview="previous"]'),
  ).toBeVisible();
  await expect(
    page.locator(
      '[data-reader-chapter-preview="previous"][data-reader-adjacent-preview="true"]',
    ),
  ).toHaveAttribute('data-reader-preview-chapter-id', '0');
  await expect(
    page.locator('[data-reader-chapter-preview="next"]'),
  ).toBeVisible();
  const nextChapterPreview = page.locator(
    '[data-reader-chapter-preview="next"]',
  );
  await expect(
    nextChapterPreview.locator('.book-reader__continuous-chapter-title'),
  ).toHaveCount(0);
  await expect(
    nextChapterPreview.locator('.reader-segment__original', {
      hasText: /^第 3 章$/,
    }),
  ).toHaveCount(1);
  const currentStartOffset = () =>
    page.evaluate(() => {
      const current = document.querySelector<HTMLElement>(
        '[data-reader-chapter-id]',
      );
      const appBar = document.querySelector<HTMLElement>(
        '.book-reader__app-bar',
      );
      return (
        (current?.getBoundingClientRect().top ?? 0) -
        (appBar?.getBoundingClientRect().bottom ?? 0)
      );
    });
  const currentEndOffset = () =>
    page.evaluate(() => {
      const current = document.querySelector<HTMLElement>(
        '[data-reader-chapter-id]',
      );
      const navigation = document.querySelector<HTMLElement>(
        '.book-reader__bottom-navigation',
      );
      return (
        (current?.getBoundingClientRect().bottom ?? 0) -
        (navigation?.getBoundingClientRect().top ?? window.innerHeight)
      );
    });
  const crossPreview = async (direction: 'previous' | 'next') => {
    await expect(
      page.locator(
        `[data-reader-chapter-preview="${direction}"][data-reader-adjacent-preview="true"]`,
      ),
    ).toBeVisible();
    await page.waitForTimeout(100);
    await page.evaluate((targetDirection) => {
      const preview = document.querySelector<HTMLElement>(
        `[data-reader-chapter-preview="${targetDirection}"][data-reader-adjacent-preview="true"]`,
      );
      const edge =
        targetDirection === 'next'
          ? (document
              .querySelector<HTMLElement>('.book-reader__app-bar')
              ?.getBoundingClientRect().bottom ?? 0)
          : (document
              .querySelector<HTMLElement>('.book-reader__bottom-navigation')
              ?.getBoundingClientRect().top ?? window.innerHeight);
      const rect = preview?.getBoundingClientRect();
      window.scrollTo(
        0,
        window.scrollY +
          (targetDirection === 'next'
            ? (rect?.top ?? 0) - edge - 4
            : (rect?.bottom ?? 0) - edge + 4),
      );
    }, direction);
    const wheelPoint = await page
      .locator('.book-reader__content')
      .evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          x: Math.max(
            1,
            Math.min(window.innerWidth - 1, rect.x + rect.width / 2),
          ),
          y: Math.max(
            1,
            Math.min(window.innerHeight - 1, window.innerHeight / 2),
          ),
        };
      });
    await page.mouse.move(wheelPoint.x, wheelPoint.y);
    await page.mouse.wheel(0, direction === 'next' ? 50 : -50);
  };
  await expect.poll(currentStartOffset).toBeGreaterThanOrEqual(-70);
  await expect.poll(currentStartOffset).toBeLessThanOrEqual(1);
  await page.mouse.move(195, 400);
  await page.mouse.wheel(0, 600);
  await expect(page).toHaveURL(/\/read\/1$/);
  await expect.poll(currentStartOffset).toBeLessThan(-50);
  await expect(
    page.locator(
      '[data-reader-chapter-preview="previous"][data-reader-adjacent-preview="true"]',
    ),
  ).toHaveAttribute('data-reader-preview-chapter-id', '0');

  await crossPreview('previous');
  await expect(page).toHaveURL(/\/read\/0$/);
  await expect.poll(loadedChapterIds).toEqual(['0']);
  await expect.poll(currentEndOffset).toBeGreaterThanOrEqual(-1);
  await expect.poll(currentEndOffset).toBeLessThanOrEqual(1);

  await page.goto(`/books/${continuousBookId}/read/1`);
  await expect.poll(loadedChapterIds).toEqual(['1']);
  await crossPreview('next');
  await expect(page).toHaveURL(/\/read\/2$/);
  await expect.poll(loadedChapterIds).toEqual(['2']);
  await expect.poll(currentStartOffset).toBeGreaterThanOrEqual(-70);
  await expect.poll(currentStartOffset).toBeLessThanOrEqual(1);
});

test('crosses consecutive parent titles at their highest checkpoint', async ({
  page,
}) => {
  const bookId = 'hierarchical-scroll-checkpoint.txt';
  const chapterIds = ['before', 'volume', 'part', 'chapter', 'after'];
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '轻小说机翻机器人' }),
  ).toBeVisible();
  await expect(page.locator('.n-skeleton')).toHaveCount(0);
  await page.evaluate(
    async ({ id, chapters }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('volumes');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      const transaction = database.transaction(
        ['metadata', 'chapter', 'reader-settings'],
        'readwrite',
      );
      transaction.objectStore('metadata').put({
        id,
        createAt: 1,
        toc: chapters.map((chapterId) => ({ chapterId, title: chapterId })),
        navigation: [
          { id: 'before-nav', title: 'Before', level: 0, chapterId: 'before' },
          { id: 'volume-nav', title: 'Volume', level: 0, chapterId: 'volume' },
          {
            id: 'part-nav',
            title: 'Part',
            level: 1,
            chapterId: 'part',
            parentId: 'volume-nav',
          },
          {
            id: 'chapter-nav',
            title: 'Chapter',
            level: 2,
            chapterId: 'chapter',
            parentId: 'part-nav',
          },
          { id: 'after-nav', title: 'After', level: 0, chapterId: 'after' },
        ],
        sourceFormat: 'txt',
        glossaryId: 'glossary',
        glossary: {},
        favoredId: 'default',
        sourceBookMetadata: { title: id, languages: ['zh'] },
      });
      chapters.forEach((chapterId, chapterIndex) => {
        const paragraphs =
          chapterId === 'before' || chapterId === 'chapter'
            ? Array.from(
                { length: 40 },
                (_, index) => `${chapterId} content ${index}`,
              )
            : [`${chapterId} title`];
        transaction.objectStore('chapter').put({
          id: `${id}/${chapterId}`,
          volumeId: id,
          paragraphs,
          segmentIds: paragraphs.map(
            (_, index) => `hierarchy-${chapterIndex}-${index}`,
          ),
        });
      });
      transaction.objectStore('reader-settings').put({
        id: 'default',
        defaultMode: 'original',
        translationPriority: ['gpt', 'sakura', 'youdao', 'baidu'],
        fontSize: 18,
        lineHeight: 1.9,
        contentWidth: 840,
        horizontalPadding: 24,
        theme: 'light',
        flow: 'scrolled',
        updatedAt: 1,
      });
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
    },
    { id: bookId, chapters: chapterIds },
  );

  const crossCheckpoint = async (direction: 'previous' | 'next') => {
    const checkpoint = page.locator(
      `[data-reader-chapter-preview="${direction}"][data-reader-adjacent-preview="true"]`,
    );
    await expect(checkpoint).toBeVisible();
    await page.waitForTimeout(100);
    await page.evaluate((targetDirection) => {
      const preview = document.querySelector<HTMLElement>(
        `[data-reader-chapter-preview="${targetDirection}"][data-reader-adjacent-preview="true"]`,
      );
      const rect = preview!.getBoundingClientRect();
      const edge =
        targetDirection === 'next'
          ? (document
              .querySelector<HTMLElement>('.book-reader__app-bar')
              ?.getBoundingClientRect().bottom ?? 0)
          : (document
              .querySelector<HTMLElement>('.book-reader__bottom-navigation')
              ?.getBoundingClientRect().top ?? window.innerHeight);
      window.scrollBy(
        0,
        targetDirection === 'next'
          ? rect.top - edge - 4
          : rect.bottom - edge + 4,
      );
    }, direction);
    await page.mouse.move(195, 400);
    await page.mouse.wheel(0, direction === 'next' ? 50 : -50);
  };

  await page.goto(`/books/${bookId}/read/before`);
  const nextCheckpoint = page.locator(
    '[data-reader-chapter-preview="next"][data-reader-adjacent-preview="true"]',
  );
  await expect(nextCheckpoint).toHaveAttribute(
    'data-reader-preview-chapter-id',
    'volume',
  );
  await crossCheckpoint('next');
  await expect(page).toHaveURL(/\/read\/chapter$/);

  const previousCheckpoint = page.locator(
    '[data-reader-chapter-preview="previous"][data-reader-adjacent-preview="true"]',
  );
  await expect(previousCheckpoint).toHaveAttribute(
    'data-reader-preview-chapter-id',
    'volume',
  );
  await crossCheckpoint('previous');
  await expect(page).toHaveURL(/\/read\/before$/);
});

test('fills a large continuous viewport across consecutive short chapters and book edges', async ({
  page,
}) => {
  const shortBookId = 'continuous-short-chapters.txt';
  const chapterIds = Array.from({ length: 11 }, (_, index) => String(index));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '轻小说机翻机器人' }),
  ).toBeVisible();
  await expect(page.locator('.n-skeleton')).toHaveCount(0);
  await page.evaluate(
    async ({ bookId, ids }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('volumes');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      const transaction = database.transaction(
        ['metadata', 'chapter', 'reader-settings'],
        'readwrite',
      );
      transaction.objectStore('metadata').put({
        id: bookId,
        createAt: 1,
        toc: ids.map((chapterId, index) => ({
          chapterId,
          title: `短章 ${index + 1}`,
        })),
        sourceFormat: 'txt',
        glossaryId: 'glossary',
        glossary: {},
        favoredId: 'default',
        sourceBookMetadata: {
          title: '连续超短章测试',
          authors: [],
          languages: ['zh'],
        },
      });
      ids.forEach((chapterId, index) => {
        transaction.objectStore('chapter').put({
          id: `${bookId}/${chapterId}`,
          volumeId: bookId,
          paragraphs: [`短章 ${index + 1}`, `第 ${index + 1} 章正文`],
          segmentIds: [`short-${chapterId}-title`, `short-${chapterId}-body`],
        });
      });
      transaction.objectStore('reader-settings').put({
        id: 'default',
        defaultMode: 'original',
        translationPriority: ['gpt', 'sakura', 'youdao', 'baidu'],
        autoTranslationPreloadPages: 3,
        retranslationPolicy: 'ask',
        fontSize: 18,
        lineHeight: 1.9,
        contentWidth: 840,
        horizontalPadding: 24,
        theme: 'light',
        flow: 'scrolled',
        updatedAt: 1,
      });
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
    },
    { bookId: shortBookId, ids: chapterIds },
  );

  await page.goto(`/books/${shortBookId}/read/5`);
  const previewIds = (direction: 'previous' | 'next') =>
    page
      .locator(`[data-reader-chapter-preview="${direction}"]`)
      .evaluateAll((elements) =>
        elements.map(
          (element) => (element as HTMLElement).dataset.readerPreviewChapterId,
        ),
      );
  await expect
    .poll(() => previewIds('previous'))
    .toEqual(['0', '1', '2', '3', '4']);
  await expect
    .poll(() => previewIds('next'))
    .toEqual(['6', '7', '8', '9', '10']);
  await expect(
    page.locator(
      '[data-reader-chapter-preview="previous"][data-reader-adjacent-preview="true"]',
    ),
  ).toHaveAttribute('data-reader-preview-chapter-id', '4');
  await expect(
    page.locator(
      '[data-reader-chapter-preview="next"][data-reader-adjacent-preview="true"]',
    ),
  ).toHaveAttribute('data-reader-preview-chapter-id', '6');
  await expect(page.locator('[data-reader-chapter-id]')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => previewIds('previous')).toHaveLength(5);
  await expect.poll(() => previewIds('next')).toHaveLength(5);
});

test('refills continuous previews after the viewport grows without moving the reading anchor', async ({
  page,
}) => {
  const responsiveBookId = 'continuous-responsive-buffer.txt';
  const chapterIds = Array.from({ length: 15 }, (_, index) => String(index));
  const paragraphs = (chapterIndex: number) =>
    Array.from(
      { length: 18 },
      (_, paragraphIndex) =>
        `第 ${chapterIndex + 1} 章第 ${paragraphIndex + 1} 段响应式缓冲正文`,
    );
  await page.setViewportSize({ width: 390, height: 480 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '轻小说机翻机器人' }),
  ).toBeVisible();
  await expect(page.locator('.n-skeleton')).toHaveCount(0);
  await page.evaluate(
    async ({ bookId, ids, chapterParagraphs }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('volumes');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      const transaction = database.transaction(
        ['metadata', 'chapter', 'reader-settings'],
        'readwrite',
      );
      transaction.objectStore('metadata').put({
        id: bookId,
        createAt: 1,
        toc: ids.map((chapterId, index) => ({
          chapterId,
          title: `响应章 ${index + 1}`,
        })),
        sourceFormat: 'txt',
        glossaryId: 'glossary',
        glossary: {},
        favoredId: 'default',
        sourceBookMetadata: {
          title: '响应式连续缓冲测试',
          authors: [],
          languages: ['zh'],
        },
      });
      ids.forEach((chapterId, index) => {
        transaction.objectStore('chapter').put({
          id: `${bookId}/${chapterId}`,
          volumeId: bookId,
          paragraphs: chapterParagraphs[index],
          segmentIds: chapterParagraphs[index].map(
            (_, paragraphIndex) => `responsive-${chapterId}-${paragraphIndex}`,
          ),
        });
      });
      transaction.objectStore('reader-settings').put({
        id: 'default',
        defaultMode: 'original',
        translationPriority: ['gpt', 'sakura', 'youdao', 'baidu'],
        autoTranslationPreloadPages: 3,
        retranslationPolicy: 'ask',
        fontSize: 18,
        lineHeight: 1.9,
        contentWidth: 840,
        horizontalPadding: 24,
        theme: 'light',
        flow: 'scrolled',
        updatedAt: 1,
      });
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
    },
    {
      bookId: responsiveBookId,
      ids: chapterIds,
      chapterParagraphs: chapterIds.map((_, index) => paragraphs(index)),
    },
  );

  await page.goto(`/books/${responsiveBookId}/read/7`);
  const previewCount = (direction: 'previous' | 'next') =>
    page.locator(`[data-reader-chapter-preview="${direction}"]`).count();
  await expect.poll(() => previewCount('previous')).toBeGreaterThan(0);
  await expect.poll(() => previewCount('next')).toBeGreaterThan(0);
  const countsBefore = {
    previous: await previewCount('previous'),
    next: await previewCount('next'),
  };
  const currentSegmentOffset = () =>
    page.evaluate(() => {
      const segment = document.querySelector<HTMLElement>(
        '[data-reader-chapter-id="7"] [data-reader-segment-id="responsive-7-0"]',
      );
      const appBar = document.querySelector<HTMLElement>(
        '.book-reader__app-bar',
      );
      return (
        (segment?.getBoundingClientRect().top ?? 0) -
        (appBar?.getBoundingClientRect().bottom ?? 0)
      );
    });
  const offsetBefore = await currentSegmentOffset();

  await page.setViewportSize({ width: 1440, height: 1100 });
  await expect
    .poll(() => previewCount('previous'))
    .toBeGreaterThan(countsBefore.previous);
  await expect
    .poll(() => previewCount('next'))
    .toBeGreaterThan(countsBefore.next);
  expect(await previewCount('previous')).toBeLessThanOrEqual(6);
  expect(await previewCount('next')).toBeLessThanOrEqual(6);
  await expect
    .poll(async () => Math.abs((await currentSegmentOffset()) - offsetBefore))
    .toBeLessThanOrEqual(2);
  await expect(page.locator('[data-reader-chapter-id]')).toHaveCount(1);
});

test('stops continuous buffers naturally at first, last, and single-chapter boundaries', async ({
  page,
}) => {
  const boundaryBookId = 'continuous-book-boundaries.txt';
  const singleBookId = 'continuous-single-chapter.txt';
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '轻小说机翻机器人' }),
  ).toBeVisible();
  await expect(page.locator('.n-skeleton')).toHaveCount(0);
  await page.evaluate(
    async ({ boundaryId, singleId }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('volumes');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      const transaction = database.transaction(
        ['metadata', 'chapter', 'reader-settings'],
        'readwrite',
      );
      const metadata = transaction.objectStore('metadata');
      const chapter = transaction.objectStore('chapter');
      metadata.put({
        id: boundaryId,
        createAt: 1,
        toc: ['0', '1', '2'].map((chapterId) => ({ chapterId })),
        sourceFormat: 'txt',
        glossaryId: 'glossary',
        glossary: {},
        favoredId: 'default',
        sourceBookMetadata: {
          title: '首尾边界测试',
          authors: [],
          languages: ['zh'],
        },
      });
      ['0', '1', '2'].forEach((chapterId) => {
        chapter.put({
          id: `${boundaryId}/${chapterId}`,
          volumeId: boundaryId,
          paragraphs: [`边界章 ${chapterId}`, `边界正文 ${chapterId}`],
          segmentIds: [`boundary-${chapterId}-0`, `boundary-${chapterId}-1`],
        });
      });
      metadata.put({
        id: singleId,
        createAt: 1,
        toc: [{ chapterId: '0' }],
        sourceFormat: 'txt',
        glossaryId: 'glossary',
        glossary: {},
        favoredId: 'default',
        sourceBookMetadata: {
          title: '单章边界测试',
          authors: [],
          languages: ['zh'],
        },
      });
      chapter.put({
        id: `${singleId}/0`,
        volumeId: singleId,
        paragraphs: ['唯一章节', '唯一正文'],
        segmentIds: ['single-0', 'single-1'],
      });
      transaction.objectStore('reader-settings').put({
        id: 'default',
        defaultMode: 'original',
        translationPriority: ['gpt', 'sakura', 'youdao', 'baidu'],
        autoTranslationPreloadPages: 3,
        retranslationPolicy: 'ask',
        fontSize: 18,
        lineHeight: 1.9,
        contentWidth: 840,
        horizontalPadding: 24,
        theme: 'light',
        flow: 'scrolled',
        updatedAt: 1,
      });
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
    },
    { boundaryId: boundaryBookId, singleId: singleBookId },
  );

  await page.goto(`/books/${boundaryBookId}/read/0`);
  await expect(
    page.locator('[data-reader-chapter-preview="previous"]'),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-reader-chapter-preview="next"]'),
  ).toHaveCount(2);
  await page.mouse.move(195, 300);
  await page.mouse.wheel(0, -200);
  await expect(page).toHaveURL(/\/read\/0$/);

  await page.goto(`/books/${boundaryBookId}/read/2`);
  await expect(
    page.locator('[data-reader-chapter-preview="previous"]'),
  ).toHaveCount(2);
  await expect(
    page.locator('[data-reader-chapter-preview="next"]'),
  ).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.mouse.wheel(0, 200);
  await expect(page).toHaveURL(/\/read\/2$/);

  await page.goto(`/books/${singleBookId}/read/0`);
  await expect(page.locator('[data-reader-chapter-preview]')).toHaveCount(0);
  await page.mouse.wheel(0, -200);
  await page.mouse.wheel(0, 200);
  await expect(page).toHaveURL(/continuous-single-chapter\.txt\/read\/0$/);
});
