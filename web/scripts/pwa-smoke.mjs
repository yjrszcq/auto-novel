import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

import { chromium } from '@playwright/test';

const getAvailablePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address === 'string' || address === null) {
        server.close();
        reject(new Error('无法分配 PWA 测试端口'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });

const waitForServer = async (url, timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The preview process may still be binding its socket.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`PWA 预览服务未在 ${timeoutMs}ms 内启动`);
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const port = await getAvailablePort();
const origin = `http://127.0.0.1:${port}`;
const corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack';
const preview = spawn(
  corepack,
  [
    'pnpm',
    'vite',
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--strictPort',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);

let previewOutput = '';
preview.stdout.on('data', (chunk) => {
  previewOutput += chunk;
});
preview.stderr.on('data', (chunk) => {
  previewOutput += chunk;
});

let browser;
try {
  await waitForServer(origin);

  const [manifestResponse, workerResponse] = await Promise.all([
    fetch(`${origin}/manifest.webmanifest`),
    fetch(`${origin}/sw.js`),
  ]);
  assert(manifestResponse.ok, 'manifest.webmanifest 无法访问');
  assert(workerResponse.ok, 'sw.js 无法访问');
  assert(
    manifestResponse.headers.get('content-type')?.includes('manifest'),
    'manifest.webmanifest 的 Content-Type 不正确',
  );

  const manifest = await manifestResponse.json();
  assert(manifest.display === 'standalone', 'PWA display 不是 standalone');
  assert(manifest.start_url === '/', 'PWA start_url 不是根路径');
  assert(
    manifest.icons.some(
      (icon) => icon.sizes === '192x192' && icon.type === 'image/png',
    ),
    'PWA 缺少 192x192 PNG 图标',
  );
  assert(
    manifest.icons.some(
      (icon) => icon.sizes === '512x512' && icon.purpose?.includes('maskable'),
    ),
    'PWA 缺少 512x512 maskable 图标',
  );

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'allow',
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: 'networkidle' });

  const registration = await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    return {
      controlled: navigator.serviceWorker.controller !== null,
      count: registrations.length,
      scriptURL: registrations[0]?.active?.scriptURL ?? '',
      manifestHref:
        document.querySelector('link[rel="manifest"]')?.getAttribute('href') ??
        '',
      appleIconHref:
        document
          .querySelector('link[rel="apple-touch-icon"]')
          ?.getAttribute('href') ?? '',
    };
  });
  assert(registration.controlled, '重新加载后页面未被 Service Worker 控制');
  assert(registration.count === 1, '页面注册了非预期数量的 Service Worker');
  assert(registration.scriptURL.endsWith('/sw.js'), '活动 Worker 不是 /sw.js');
  assert(
    registration.manifestHref === '/manifest.webmanifest',
    '页面未关联生成的 manifest',
  );
  assert(
    registration.appleIconHref === '/apple-touch-icon.png',
    '页面未关联 Apple touch icon',
  );

  await context.setOffline(true);
  await page.goto(`${origin}/setting`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.title.includes('设置'));

  const runtimeConfigResolved = await page.evaluate(async () => {
    try {
      await fetch('/api/runtime-config');
      return true;
    } catch {
      return false;
    }
  });
  assert(
    !runtimeConfigResolved,
    '运行时配置在离线状态下仍然命中缓存，应保持 NetworkOnly',
  );
  assert(pageErrors.length === 0, `离线页面异常：${pageErrors.join('\n')}`);

  await context.close();
  console.log('PWA production smoke passed');
} catch (error) {
  if (previewOutput.trim()) console.error(previewOutput.trim());
  throw error;
} finally {
  await browser?.close();
  preview.kill('SIGTERM');
}
