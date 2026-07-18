import { chromium } from '@playwright/test';

const baseUrl = process.argv[2]?.replace(/\/$/, '');
const mode = process.argv[3];
const supportedModes = new Set(['start-local', 'preview', 'docker']);
if (!baseUrl || !supportedModes.has(mode)) {
  throw new Error(
    '用法：node scripts/runtime-smoke.mjs <base-url> <start-local|preview|docker>',
  );
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    colorScheme: 'dark',
  });
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) =>
    failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`),
  );

  await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: '本地书架' }).waitFor();

  let configStatus = 'preview-fallback';
  if (mode !== 'preview') {
    const configPath =
      mode === 'start-local' ? '/config/config.json' : '/api/runtime-config';
    const configResponse = await page.request.get(`${baseUrl}${configPath}`);
    if (!configResponse.ok()) {
      throw new Error(`${mode} config failed: ${configResponse.status()}`);
    }
    const config = await configResponse.json();
    if (config.homeBackgroundImage !== 'images/banner.webp') {
      throw new Error(`${mode} returned an unexpected runtime config`);
    }
    const imagePrefix = mode === 'start-local' ? '/config' : '/panel-content';
    const imageResponse = await page.request.get(
      `${baseUrl}${imagePrefix}/${config.homeBackgroundImage}`,
    );
    if (!imageResponse.ok()) {
      throw new Error(`${mode} config image failed: ${imageResponse.status()}`);
    }
    configStatus = configResponse.status();
  }

  const filename = `runtime-${mode}-smoke.txt`;
  const title = filename.replace(/\.[^.]+$/, '');
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({
      name: filename,
      mimeType: 'text/plain',
      buffer: Buffer.from('第一章\n启动正文第一段\n启动正文第二段'),
    });
  await page.getByText(filename, { exact: true }).waitFor();
  await page.goto(`${baseUrl}/bookshelf`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: title }).waitFor();
  await page.goto(`${baseUrl}/books/${encodeURIComponent(filename)}/details`, {
    waitUntil: 'networkidle',
  });
  await page.getByText(title, { exact: true }).first().waitFor();
  await page.goto(`${baseUrl}/books/${encodeURIComponent(filename)}/read/0`, {
    waitUntil: 'networkidle',
  });
  await page.getByText('启动正文第一段', { exact: true }).waitFor();
  const chrome = await page.evaluate(() => {
    const top = document.querySelector('.book-reader__app-bar');
    const bottom = document.querySelector('.book-reader__bottom-navigation');
    const background = (element) =>
      element ? getComputedStyle(element).backgroundColor : '';
    return {
      top: background(top),
      bottom: background(bottom),
      bodyLength: document.body.innerText.length,
    };
  });

  const result = {
    mode,
    configStatus,
    chrome,
    pageErrors,
    consoleErrors,
    failedRequests,
  };
  console.log(JSON.stringify(result));
  if (
    pageErrors.length > 0 ||
    consoleErrors.length > 0 ||
    failedRequests.length > 0 ||
    chrome.bodyLength === 0 ||
    chrome.top === 'rgba(0, 0, 0, 0)' ||
    chrome.bottom === 'rgba(0, 0, 0, 0)'
  ) {
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
