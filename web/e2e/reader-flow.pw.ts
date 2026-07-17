import { expect, test } from '@playwright/test';

const bookId = 'reader-flow.txt';
const unsafeText = '<img src=x onerror="window.__readerXss=true">';
const descriptionHtml =
  '<div><p><strong style="color:red" onclick="window.__descriptionXss=true">安全简介</strong></p><p>第二段</p><img src=x onerror="window.__descriptionXss=true"><svg><script>window.__descriptionXss=true</script></svg></div>';

test('keeps inherited reader themes opaque and responsive to system changes', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/bookshelf');
  await expect(page.getByRole('heading', { name: '书架' })).toBeVisible();
  await expect(page.locator('.n-skeleton')).toHaveCount(0);
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('volumes', 5);
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

  await page.getByRole('button', { name: '白天', exact: true }).click();
  await expect(reader).toHaveClass(/book-reader--light/);
  await expect(appBar).toHaveCSS('background-color', 'rgb(241, 241, 241)');

  await page.getByRole('button', { name: '设置', exact: true }).click();
  const themeSetting = page
    .locator('.book-reader__settings-theme')
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
});

test('opens a local bookshelf book safely through the current reader route', async ({
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
    async ({ bookId, descriptionHtml, unsafeText }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('volumes', 5);
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
    page.getByRole('button', { name: '移出书架', exact: true }),
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
  await page
    .getByRole('listitem')
    .getByRole('button', { name: '加入书架' })
    .click();
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
  const readerCatalogButton = page.getByRole('button', { name: '目录' });
  await readerCatalogButton.click();
  await expect(page.getByText('共 2 章', { exact: true })).toBeVisible();
  await expect(page.getByText('第一部', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '目录' })).toBeVisible();
  await expect(page.getByRole('button', { name: '关闭目录' })).toBeFocused();
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
      .getByRole('button', { name: 'GPT 翻译本章' })
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
  await expect(translationPopover).toHaveCSS(
    'background-color',
    'rgb(247, 223, 160)',
  );
  await expect(translationPopover).toHaveCSS(
    'border-color',
    'rgb(200, 135, 16)',
  );
  await expect(translationPopover).toHaveCSS('border-width', '1px');
  await expect(translationPopover.locator('strong')).toHaveCSS(
    'color',
    'rgb(91, 67, 0)',
  );
  await expect(
    translationPopover
      .getByRole('button', { name: 'GPT 翻译本章' })
      .locator('.n-button__content'),
  ).toHaveCSS('color', 'rgb(91, 67, 0)');
  await expect(
    translationPopover
      .getByRole('button', { name: 'GPT 翻译本章' })
      .locator('.n-button__border'),
  ).toHaveCSS('border-color', 'rgb(240, 160, 32)');
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
  await page.getByRole('button', { name: '夜晚', exact: true }).click();
  await translationToggle.click();
  await expect(translationPopover).toHaveCSS(
    'border-color',
    'rgb(158, 106, 39)',
  );
  await expect(
    translationPopover
      .getByRole('button', { name: 'GPT 翻译本章' })
      .locator('.n-button__border'),
  ).toHaveCSS('border-color', 'rgb(139, 120, 100)');
  await page.getByRole('button', { name: '收起未翻译操作' }).click();
  await page.getByRole('button', { name: '白天', exact: true }).click();
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
  await expect(page.locator('.book-reader__loading')).toHaveCount(0);
  await expect(page).toHaveURL(/\/books\/reader-flow\.txt\/read\/1$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(3);
  await expect
    .poll(() =>
      readerTop.evaluate((element) =>
        Math.round(element.getBoundingClientRect().top),
      ),
    )
    .toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: '工具', exact: true }).click();
  await expect(
    page
      .getByRole('button', { name: '添加书签' })
      .locator('.n-button__content'),
  ).toHaveCSS('color', 'rgb(51, 54, 57)');
  await page.getByRole('button', { name: '添加书签' }).click();
  await expect(page.getByRole('button', { name: '书签 (1)' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: '添加书签', exact: true }),
  ).toBeHidden();
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
    .locator('.book-reader__settings-theme')
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
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '工具', exact: true }).click();
  await expect(
    page
      .getByRole('dialog', { name: '阅读工具' })
      .getByRole('button', { name: '添加书签' })
      .locator('.n-button__border'),
  ).toHaveCSS('border-top-color', 'rgb(157, 139, 108)');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await themeSetting.locator('.n-base-selection').click();
  await page.locator('.n-base-select-menu').getByText('浅色').click();
  const flowSetting = page
    .locator('.book-reader__settings-theme')
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
        .locator('.reader-segment-layout')
        .evaluate((element) => getComputedStyle(element).columnCount),
    )
    .toBe('auto');
  await page.keyboard.press('Escape');
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  await readerContent.dispatchEvent('wheel', { deltaY: 120 });
  await expect(page.locator('.book-reader__loading')).toHaveCount(0);
  await expect(page).toHaveURL(/\/books\/reader-flow\.txt\/read\/1$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(3);

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
        const request = indexedDB.open('volumes', 5);
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
  const completeChapterMoreButton = completeChapterHeader.getByRole('button', {
    name: '更多阅读工具',
  });
  const completeChapterHeaderBounds = await completeChapterHeader.boundingBox();
  const completeChapterMoreBounds =
    await completeChapterMoreButton.boundingBox();
  if (
    completeChapterHeaderBounds === null ||
    completeChapterMoreBounds === null
  ) {
    throw new Error('缺少完整译文章节的手机顶栏');
  }
  expect(
    Math.round(completeChapterMoreBounds.x + completeChapterMoreBounds.width),
  ).toBe(
    Math.round(
      completeChapterHeaderBounds.x + completeChapterHeaderBounds.width,
    ),
  );
});

test('continues paging backward after loading an earlier long-chapter window', async ({
  page,
}) => {
  const windowedBookId = 'windowed-reader.txt';
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/bookshelf');
  await expect(page.getByRole('heading', { name: '书架' })).toBeVisible();
  await page.evaluate(
    async ({ bookId }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('volumes', 5);
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

  await readerContent.evaluate((element) =>
    element.scrollTo({ left: 0, behavior: 'auto' }),
  );
  await readerContent.click({
    position: { x: bounds.width * 0.1, y: bounds.height * 0.5 },
  });
  await expect(
    readerContent.locator('[data-reader-segment-id="windowed-segment-521"]'),
  ).toBeAttached();
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
  await page.goto('/bookshelf');
  await expect(page.getByRole('heading', { name: '书架' })).toBeVisible();

  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('volumes', 5);
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
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/bookshelf');
  await expect(page.getByRole('heading', { name: '书架' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: '前往工作区', exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('.bookshelf-page__notice')).toContainText(
    '书籍和阅读数据仅保存在当前浏览器。',
  );
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
      notice: bounds('.bookshelf-page__notice'),
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
  expect(bookshelfLayout.notice.left).toBe(bookshelfLayout.header.left);
  expect(bookshelfLayout.notice.right).toBe(bookshelfLayout.header.right);
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
          const request = indexedDB.open('volumes', 5);
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
