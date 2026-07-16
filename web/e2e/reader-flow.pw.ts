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
        navigation: [
          { id: 'part', title: '第一部', level: 0 },
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
    { bookId, unsafeText },
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
    page.getByRole('button', { name: '移出书架', exact: true }),
  ).toHaveCount(0);
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
  await expect(
    page.getByRole('button', { name: '目录', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('共 2 章', { exact: true })).toBeVisible();
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
        chapterIndex: bounds('.book-details__catalog-index'),
        chapterStatus: bounds('.book-details__catalog-button .n-tag'),
        title: bounds('.book-details__catalog-close'),
        total: bounds('.book-details__catalog-header .n-text'),
      };
    });
    expect(catalogLayout.title.left).toBe(catalogLayout.chapterIndex.left);
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
  await page.getByRole('button', { name: /第 2 章/ }).click();
  await expect
    .poll(() => new URL(page.url()).pathname)
    .toBe('/books/reader-flow.txt/read/1');

  await page.goto('/books/reader-flow.txt/details');
  await page.getByRole('button', { name: '移出书架', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '加入书架', exact: true }),
  ).toBeVisible();
  await page.goto('/bookshelf');
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

  await page.getByRole('button', { name: '查看《reader-flow》详情' }).click();
  await expect(page).toHaveURL(/\/books\/reader-flow\.txt\/details$/);
  const startReadingButton = page.getByRole('button', { name: '开始阅读' });
  await startReadingButton.focus();
  await expect(startReadingButton).toBeFocused();
  await startReadingButton.click();
  await expect(page).toHaveURL(/\/books\/reader-flow\.txt\/read\/0$/);
  await expect(page.getByText(unsafeText, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__readerXss)).toBeUndefined();
  const readerCatalogButton = page.getByRole('button', { name: '目录' });
  await readerCatalogButton.click();
  await expect(page.getByText('共 2 章', { exact: true })).toBeVisible();
  await expect(page.getByText('第一部', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '目录' })).toBeVisible();
  await expect(page.getByRole('button', { name: '关闭目录' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(readerCatalogButton).toBeFocused();

  const readerTop = page.locator('.book-reader__app-bar');
  await expect(readerTop).toBeVisible();
  const readerContent = page.locator('.book-reader__content');
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
  await expect(page.locator('.book-reader__bottom-navigation')).toHaveCSS(
    'height',
    '52px',
  );
  const readerBounds = await readerContent.boundingBox();
  if (readerBounds === null) throw new Error('缺少分页正文视口');
  await readerContent.click({
    position: { x: readerBounds.width * 0.9, y: readerBounds.height * 0.5 },
  });
  await expect
    .poll(() => readerContent.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
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
  await readerContent.click({
    position: { x: readerBounds.width * 0.1, y: readerBounds.height * 0.5 },
  });
  await expect(page).toHaveURL(/\/books\/reader-flow\.txt\/read\/0$/);
  await expect
    .poll(() => readerContent.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(readerContent).toHaveClass(/book-reader__content--scrolled/);
  const translationToggle = page.getByRole('button', {
    name: '展开未翻译操作',
  });
  await expect(translationToggle).toBeVisible();
  await expect(page.getByRole('button', { name: 'GPT 翻译本章' })).toBeHidden();
  await translationToggle.click();
  await expect(
    page.getByRole('button', { name: 'GPT 翻译本章' }),
  ).toBeVisible();
  const translationLayer = page.locator(
    '.book-reader__translation-popover-layer',
  );
  const translationPopover = page.locator('.book-reader__translation-popover');
  await expect(translationLayer).toHaveCSS('position', 'fixed');
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
  await expect(page.getByRole('button', { name: 'GPT 翻译本章' })).toBeHidden();
  await expect(page.locator('.book-reader__bottom-navigation')).toHaveCSS(
    'height',
    '76px',
  );
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
  await readerContent.dispatchEvent('touchstart', {
    touches: [{ identifier: 0, clientX: 180, clientY: 500 }],
  });
  await readerContent.dispatchEvent('touchend', {
    changedTouches: [{ identifier: 0, clientX: 180, clientY: 420 }],
  });
  await expect(page).toHaveURL(/\/books\/reader-flow\.txt\/read\/1$/);
  await expect
    .poll(() =>
      readerTop.evaluate((element) =>
        Math.round(element.getBoundingClientRect().top),
      ),
    )
    .toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: '工具', exact: true }).click();
  await page.getByRole('button', { name: '添加书签' }).click();
  await expect(page.getByRole('button', { name: '书签 (1)' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: '添加书签', exact: true }),
  ).toBeHidden();
  await expect(page.locator('.n-drawer-mask')).toHaveCount(0);
  const readerParagraph = readerContent.locator('p').first();
  await readerParagraph.click();
  await expect(readerTop).toHaveCount(0);
  await expect(page.locator('.book-reader__progress-track')).toBeVisible();
  await readerParagraph.click();
  await expect(readerTop).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/books/reader-flow.txt/read/0');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const flowSetting = page
    .locator('.book-reader__settings-theme')
    .filter({ hasText: '阅读流' });
  await flowSetting.locator('.n-base-selection').click();
  await page.getByText('滚动', { exact: true }).click();
  await expect(readerContent).toHaveClass(/book-reader__content--scrolled/);
  await page.keyboard.press('Escape');
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  await readerContent.dispatchEvent('wheel', { deltaY: 120 });
  await expect(page).toHaveURL(/\/books\/reader-flow\.txt\/read\/1$/);

  await page.goto('/workspace/reader/reader-flow.txt/0');
  await expect(page).toHaveURL(/\/books\/reader-flow\.txt\/read\/0$/);
  await expect(page.getByText('安全文本', { exact: true })).toBeVisible();
});

test('uses a configured default cover for a local book without one', async ({
  page,
}) => {
  await page.goto('/bookshelf');
  await expect(page.getByRole('heading', { name: '书架' })).toBeVisible();

  await page.evaluate(async () => {
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
      id: 'default-cover.txt',
      createAt: 1,
      toc: [{ chapterId: '0' }],
      glossaryId: 'glossary',
      glossary: {},
      favoredId: 'default',
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
  let reportConfigRequest!: () => void;
  const configRequested = new Promise<void>((resolve) => {
    reportConfigRequest = resolve;
  });
  await page.route('**/config/config.json', async (route) => {
    reportConfigRequest();
    await configResponse;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ defaultBookCoverImage: 'images/banner.webp' }),
    });
  });

  await page.reload();
  await configRequested;
  await expect(
    page.getByRole('heading', { name: 'default-cover' }),
  ).toBeVisible();
  await expect(page.locator('.book-cover__initials')).toHaveCount(0);
  releaseConfig();
  const defaultCover = page.locator('img[alt="default-cover 封面"]');
  await expect(defaultCover).toHaveAttribute(
    'src',
    '/config/images/banner.webp',
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
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/bookshelf');
  await expect(page.getByRole('heading', { name: '书架' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: '前往工作区', exact: true }),
  ).toHaveCount(0);
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
      description: bounds('.bookshelf-page p'),
      filter: bounds('.bookshelf-toolbar__filter'),
      header: bounds('.bookshelf-page__header'),
      search: bounds('.bookshelf-toolbar__search'),
      sort: bounds('.bookshelf-toolbar__sort'),
      title: bounds('.bookshelf-page h1'),
    };
  });
  expect(bookshelfLayout.add.left).toBeGreaterThan(bookshelfLayout.title.left);
  expect(bookshelfLayout.add.top).toBeLessThan(bookshelfLayout.search.top);
  expect(
    Math.abs(
      bookshelfLayout.add.top +
        bookshelfLayout.add.height / 2 -
        (bookshelfLayout.title.top + bookshelfLayout.title.height / 2),
    ),
  ).toBeLessThanOrEqual(1);
  expect(bookshelfLayout.description.left).toBe(bookshelfLayout.header.left);
  expect(bookshelfLayout.description.right).toBe(bookshelfLayout.header.right);
  expect(bookshelfLayout.search.top).toBeLessThan(bookshelfLayout.filter.top);
  expect(bookshelfLayout.filter.left).toBe(bookshelfLayout.search.left);
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
test('persists the global reading version selected in Settings', async ({
  page,
}) => {
  await page.goto('/setting');
  await expect(page.getByText('阅读偏好', { exact: true })).toBeVisible();

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
