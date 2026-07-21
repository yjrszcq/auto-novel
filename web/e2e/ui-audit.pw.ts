import { expect, test, type Locator, type Page } from '@playwright/test';

const routes = [
  { path: '/', heading: '轻小说机翻机器人' },
  { path: '/workspace/toolbox', heading: '小说工具箱' },
  { path: '/workspace/gpt', heading: 'GPT工作区' },
  { path: '/workspace/sakura', heading: 'Sakura工作区' },
  { path: '/workspace/interactive', heading: '交互翻译' },
  { path: '/setting', heading: '设置' },
] as const;

const expectWithinViewport = async (element: Locator, page: Page) => {
  await expect
    .poll(async () => {
      const [bounds, viewport] = await Promise.all([
        element.boundingBox(),
        page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
      ]);
      return (
        bounds !== null &&
        bounds.x >= 0 &&
        bounds.y >= 0 &&
        bounds.x + bounds.width <= viewport.width &&
        bounds.y + bounds.height <= viewport.height
      );
    })
    .toBe(true);
};

const auditRoute = async (page: Page, route: (typeof routes)[number]) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto(route.path);
  await expect(
    page.getByRole('heading', { name: route.heading, exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    )
    .toBe(true);

  const overflowingControls = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    return [
      ...document.querySelectorAll<HTMLElement>(
        'button, input, textarea, select, [role="dialog"], [role="menu"], [role="tablist"]',
      ),
    ].flatMap((element) => {
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        Number(style.opacity) === 0 ||
        bounds.width === 0 ||
        bounds.height === 0 ||
        bounds.bottom <= 0 ||
        bounds.top >= innerHeight ||
        (bounds.left >= -1 && bounds.right <= viewportWidth + 1)
      ) {
        return [];
      }
      return [
        {
          tag: element.tagName,
          label: (
            element.getAttribute('aria-label') ??
            element.textContent ??
            ''
          )
            .trim()
            .slice(0, 80),
          left: Math.round(bounds.left),
          right: Math.round(bounds.right),
        },
      ];
    });
  });
  expect(overflowingControls).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
};

for (const viewport of [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 390, height: 844 },
] as const) {
  test(`keeps primary ${viewport.name} routes and overlays inside the viewport`, async ({
    browser,
  }) => {
    for (const route of routes) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
      });
      await auditRoute(page, route);
      await page.close();
    }

    const page = await browser.newPage({
      viewport: { width: viewport.width, height: viewport.height },
    });
    for (const { path, heading, action } of [
      {
        path: '/workspace/gpt',
        heading: 'GPT工作区',
        action: '添加翻译器',
      },
      {
        path: '/workspace/sakura',
        heading: 'Sakura工作区',
        action: '添加翻译器',
      },
      {
        path: '/workspace/toolbox',
        heading: '小说工具箱',
        action: '翻译器配置',
      },
      {
        path: '/workspace/interactive',
        heading: '交互翻译',
        action: '术语表[0]',
      },
    ]) {
      await page.goto(path);
      await expect(
        page.getByRole('heading', { name: heading, exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: action, exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expectWithinViewport(dialog, page);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    }

    if (viewport.name === 'mobile') {
      await page.goto('/');
      await page.getByRole('button', { name: '打开导航菜单' }).click();
      const drawer = page.locator('.n-drawer').filter({ visible: true });
      await expect(drawer).toBeVisible();
      await expectWithinViewport(drawer, page);
      await page.getByRole('link', { name: '设置', exact: true }).click();
      await expect(page).toHaveURL(/\/setting$/);
      await expect(drawer).toHaveCount(0);
    }
    await page.close();
  });
}

test('names shared icon-only controls from their tooltips', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/workspace/sakura');
  await expect(
    page.getByRole('heading', { name: 'Sakura工作区' }),
  ).toBeVisible();
  for (const name of ['测试', '设置（请先停止）', '删除']) {
    await expect(page.getByRole('button', { name }).first()).toBeVisible();
  }
});
