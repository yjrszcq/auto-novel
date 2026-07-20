import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { resolve } from 'node:path';

const [, , outputArgument, sizeArgument = '100'] = process.argv;

if (!outputArgument) {
  throw new Error(
    'Usage: node scripts/generate-txt-catalog-fixture.mjs <output.txt> [MiB]',
  );
}

const sizeMiB = Number(sizeArgument);
if (!Number.isFinite(sizeMiB) || sizeMiB <= 0 || sizeMiB > 1024) {
  throw new Error(
    'MiB must be a number greater than 0 and no greater than 1024.',
  );
}

const outputPath = resolve(outputArgument);
const targetBytes = Math.floor(sizeMiB * 1024 * 1024);
const output = createWriteStream(outputPath, { flags: 'wx' });
let writtenBytes = 0;
let chapter = 1;

while (writtenBytes < targetBytes) {
  const block = Buffer.from(
    [
      `第${chapter}章 中文目录标题`,
      `这是第 ${chapter} 章的中文正文，用于验证大文件解析期间主线程仍可交互。`,
      `第${chapter}話 日本語の目次`,
      `これはブラウザー内の文字コード判定と行索引を確認する本文です。`,
      `Chapter ${chapter} English Heading`,
      `This paragraph exercises multilingual catalog scoring and bounded preview windows.`,
      '',
    ].join('\n'),
  );
  const remaining = targetBytes - writtenBytes;
  const chunk = block.subarray(0, Math.min(block.byteLength, remaining));
  if (!output.write(chunk)) await once(output, 'drain');
  writtenBytes += chunk.byteLength;
  chapter += 1;
}

output.end();
await once(output, 'finish');

process.stdout.write(`${outputPath} (${writtenBytes} bytes)\n`);
