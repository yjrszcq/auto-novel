import { BlobReader, ZipReader } from '@zip.js/zip.js';
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
  it('rejects empty input without producing a download', async () => {
    const download = vi.fn();
    const modify = vi.fn();

    const result = await Toolbox.modifyFiles([], modify, { download });

    expect(result.status).toBe('empty');
    expect(modify).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it('keeps successful siblings when one file fails', async () => {
    const files = [fakeFile('a.txt'), fakeFile('b.txt'), fakeFile('c.txt')];
    const download = vi.fn();
    const onProgress = vi.fn();

    const result = await Toolbox.modifyFiles(
      files,
      async (file) => {
        if (file.name === 'b.txt') throw new Error('broken');
      },
      { download, onProgress },
    );

    expect(result.status).toBe('partial');
    expect(result.completed).toBe(3);
    expect(result.outputs.map((file) => file.name)).toEqual(['a.txt', 'c.txt']);
    expect(result.failures).toMatchObject([{ name: 'b.txt' }]);
    expect(download).toHaveBeenCalledTimes(1);
    expect(
      (download.mock.calls[0]?.[0] as ParsedFile[]).map((file) => file.name),
    ).toEqual(['a.txt', 'c.txt']);
    expect(onProgress).toHaveBeenLastCalledWith({
      total: 3,
      completed: 3,
      succeeded: 2,
      failed: 1,
      currentName: 'c.txt',
    });
  });

  it('stops before the next file and suppresses late downloads after cancel', async () => {
    const files = [fakeFile('a.txt'), fakeFile('b.txt')];
    const controller = new AbortController();
    const download = vi.fn();
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
      { signal: controller.signal, download },
    );
    await vi.waitFor(() => expect(modify).toHaveBeenCalledTimes(1));
    controller.abort();
    release?.();

    const result = await resultPromise;
    expect(result.status).toBe('cancelled');
    expect(result.completed).toBe(0);
    expect(modify).toHaveBeenCalledTimes(1);
    expect(download).not.toHaveBeenCalled();
  });

  it('keeps archive entries in deterministic input order', async () => {
    let archive: Blob | undefined;
    await Toolbox.downloadFiles([fakeFile('b.txt'), fakeFile('a.txt')], {
      save: (_name, blob) => {
        archive = blob;
      },
    });

    expect(archive).toBeDefined();
    const reader = new ZipReader(new BlobReader(archive!));
    const entries = await reader.getEntries();
    await reader.close();
    expect(entries.map((entry) => entry.filename)).toEqual(['b.txt', 'a.txt']);
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
});
