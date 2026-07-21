import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readdir, readFile, stat } from 'node:fs/promises';

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

const assetFiles = await readdir('dist/assets');
const javascriptAssets = assetFiles.filter((name) => name.endsWith('.js'));
const readerAsset = javascriptAssets.find((name) =>
  name.startsWith('BookReader-'),
);
assert(readerAsset !== undefined, '生产包缺少阅读器 chunk');
const readerSource = await readFile(`dist/assets/${readerAsset}`, 'utf8');
const openccAssetNames = [
  ...readerSource.matchAll(/full-[A-Za-z0-9_-]+\.js/g),
].map(([name]) => name);
assert(
  new Set(openccAssetNames).size === 1,
  '阅读器未生成唯一的 OpenCC 动态依赖 chunk',
);
const openccAsset = openccAssetNames[0];
assert(javascriptAssets.includes(openccAsset), '生产包缺少 OpenCC chunk');
assert(
  (await stat(`dist/assets/${openccAsset}`)).size > 1_000_000,
  'OpenCC chunk 体积异常',
);
assert(
  (await stat(`dist/assets/${readerAsset}`)).size < 500_000,
  'OpenCC 字典被内联进阅读器主 chunk',
);

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
  const workerSource = await workerResponse.text();
  assert(
    workerSource.includes(`assets/${openccAsset}`),
    'Service Worker 未预缓存 OpenCC chunk',
  );
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

  await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('volumes');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = database.transaction(
      ['metadata', 'chapter', 'reader-settings'],
      'readwrite',
    );
    transaction.objectStore('metadata').put({
      id: 'offline-script.txt',
      createAt: 1,
      toc: [{ chapterId: '0', title: '离线字形' }],
      sourceFormat: 'txt',
      glossaryId: 'glossary',
      glossary: {},
      favoredId: 'default',
      sourceBookMetadata: {
        title: '离线字形',
        languages: ['zh-CN'],
      },
    });
    transaction.objectStore('chapter').put({
      id: 'offline-script.txt/0',
      volumeId: 'offline-script.txt',
      paragraphs: ['头发发展在里面'],
      segmentIds: ['offline-script-segment'],
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
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });

  await context.setOffline(true);
  await page.goto(`${origin}/books/offline-script.txt/read/0`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() =>
    document.body.textContent?.includes('頭髮發展在裏面'),
  );
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
