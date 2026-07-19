import { BlobReader, ZipReader } from '@zip.js/zip.js';
import { isProxy } from 'vue';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/util', () => ({ downloadFile: vi.fn() }));

import type { ParsedFile } from '../src/util/file';
import { Toolbox } from '../src/pages/workspace/components/Toolbox';
import { createToolboxOperation } from '../src/pages/workspace/components/ToolboxOperation';

const fakeFile = (name: string, content = name): ParsedFile =>
  ({
    name,
    type: 'txt',
    clone: vi.fn(async () => fakeFile(name, content)),
    toBlob: vi.fn(async () => new Blob([content], { type: 'text/plain' })),
  }) as unknown as ParsedFile;

describe('toolbox batch execution', () => {
  it('rejects empty input without invoking the processor', async () => {
    const modify = vi.fn();

    const result = await Toolbox.modifyFiles([], modify);

    expect(result.status).toBe('empty');
    expect(modify).not.toHaveBeenCalled();
  });

  it('keeps successful siblings when one file fails', async () => {
    const files = [fakeFile('a.txt'), fakeFile('b.txt'), fakeFile('c.txt')];
    const onProgress = vi.fn();

    const result = await Toolbox.modifyFiles(
      files,
      async (file) => {
        if (file.name === 'b.txt') throw new Error('broken');
      },
      { onProgress },
    );

    expect(result.status).toBe('partial');
    expect(result.completed).toBe(3);
    expect(result.outputs).toMatchObject([
      { sourceName: 'a.txt', file: { name: 'a.txt' } },
      { sourceName: 'c.txt', file: { name: 'c.txt' } },
    ]);
    expect(result.failures).toMatchObject([{ name: 'b.txt' }]);
    expect(onProgress).toHaveBeenLastCalledWith({
      total: 3,
      completed: 3,
      succeeded: 2,
      failed: 1,
      currentName: 'c.txt',
    });
  });

  it('converts a clone instead of exposing the loaded source object', async () => {
    const source = fakeFile('source.txt');
    let convertedInput: ParsedFile | undefined;

    const result = await Toolbox.convertFiles([source], async (file) => {
      convertedInput = file;
      return file;
    });

    expect(result.status).toBe('success');
    expect(convertedInput).not.toBe(source);
    expect(convertedInput?.name).toBe(source.name);
    expect(result.outputs[0]).toMatchObject({
      sourceName: source.name,
      file: { name: source.name },
    });
  });

  it('stops before the next file and suppresses its late result after cancel', async () => {
    const files = [fakeFile('a.txt'), fakeFile('b.txt')];
    const controller = new AbortController();
    const modify = vi.fn();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const resultPromise = Toolbox.modifyFiles(
      files,
      async () => {
        modify();
        await gate;
      },
      { signal: controller.signal },
    );
    await vi.waitFor(() => expect(modify).toHaveBeenCalledTimes(1));
    controller.abort();
    release?.();

    const result = await resultPromise;
    expect(result.status).toBe('cancelled');
    expect(result.completed).toBe(0);
    expect(result.outputs).toEqual([]);
    expect(modify).toHaveBeenCalledTimes(1);
  });

  it('downloads one result directly with its original filename', async () => {
    const save = vi.fn();

    await Toolbox.downloadFiles([fakeFile('result.txt', 'result')], { save });

    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]?.[0]).toBe('result.txt');
    await expect((save.mock.calls[0]?.[1] as Blob).text()).resolves.toBe(
      'result',
    );
  });

  it('keeps archive entries in deterministic input order', async () => {
    let archive: Blob | undefined;
    let archiveName = '';
    await Toolbox.downloadFiles([fakeFile('b.txt'), fakeFile('a.txt')], {
      save: (name, blob) => {
        archiveName = name;
        archive = blob;
      },
    });

    expect(archiveName).toBe('工具箱打包下载[2].zip');
    expect(archive).toBeDefined();
    const reader = new ZipReader(new BlobReader(archive!));
    const entries = await reader.getEntries();
    await reader.close();
    expect(entries.map((entry) => entry.filename)).toEqual(['b.txt', 'a.txt']);
  });

  it('rejects ambiguous duplicate archive entries', async () => {
    const save = vi.fn();

    await expect(
      Toolbox.downloadFiles(
        [fakeFile('same.txt', 'a'), fakeFile('same.txt', 'b')],
        { save },
      ),
    ).rejects.toThrow('下载结果中存在同名文件');
    expect(save).not.toHaveBeenCalled();
  });

  it('does not start a second operation while one is active', async () => {
    const operation = createToolboxOperation();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const task = vi.fn(async () => {
      await gate;
      return {
        status: 'cancelled' as const,
        total: 1,
        completed: 0,
        outputs: [],
        failures: [],
      };
    });

    const first = operation.run('测试操作', 1, task);
    await operation.run('重复操作', 1, task);
    expect(task).toHaveBeenCalledTimes(1);
    expect(operation.state.busy).toBe(true);

    operation.cancel();
    expect(operation.state.status).toBe('cancelling');
    release?.();
    await first;
    expect(operation.state.status).toBe('cancelled');
    expect(operation.state.busy).toBe(false);
  });

  it('retains result file instances without deep reactive proxies', async () => {
    const operation = createToolboxOperation();
    const output = fakeFile('result.txt');

    await operation.run('测试结果', 1, async () => ({
      status: 'success',
      total: 1,
      completed: 1,
      outputs: [{ sourceName: 'source.txt', file: output }],
      failures: [],
    }));

    expect(operation.state.outputs[0]?.file).toBe(output);
    expect(isProxy(operation.state.outputs[0]?.file)).toBe(false);
  });
});
