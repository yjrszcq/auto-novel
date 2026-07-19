import { downloadFile } from '@/util';
import type { ParsedFile } from '@/util/file';

export namespace Toolbox {
  export type BatchStatus =
    'empty' | 'success' | 'partial' | 'failed' | 'cancelled';

  export interface BatchFailure {
    name: string;
    error: unknown;
  }

  export interface BatchProgress {
    total: number;
    completed: number;
    succeeded: number;
    failed: number;
    currentName: string;
  }

  export interface BatchResult<T extends ParsedFile> {
    status: BatchStatus;
    total: number;
    completed: number;
    outputs: T[];
    failures: BatchFailure[];
  }

  export interface DownloadOptions {
    signal?: AbortSignal;
    save?: (filename: string, blob: Blob) => void | Promise<void>;
  }

  export interface BatchOptions {
    signal?: AbortSignal;
    onProgress?: (progress: BatchProgress) => void;
    download?: (files: ParsedFile[], signal?: AbortSignal) => Promise<void>;
  }

  type ModifyFn<T extends ParsedFile> = (
    file: T,
    signal?: AbortSignal,
  ) => Promise<void>;
  type ConvertFn<T extends ParsedFile> = (
    file: T,
    signal?: AbortSignal,
  ) => Promise<ParsedFile>;

  const abortError = () => new DOMException('操作已取消', 'AbortError');

  const throwIfAborted = (signal?: AbortSignal) => {
    if (signal?.aborted) throw signal.reason ?? abortError();
  };

  export const downloadFiles = async (
    files: ParsedFile[],
    options: DownloadOptions = {},
  ) => {
    if (files.length === 0) throw new Error('没有可下载的文件');
    const save = options.save ?? downloadFile;
    throwIfAborted(options.signal);

    if (files.length === 1) {
      const file = files[0];
      const blob = await file.toBlob();
      throwIfAborted(options.signal);
      await save(file.name, blob);
      return;
    }

    const { BlobReader, BlobWriter, ZipWriter } =
      await import('@zip.js/zip.js');
    const zipBlobWriter = new BlobWriter('application/zip');
    const writer = new ZipWriter(zipBlobWriter);
    let closed = false;
    try {
      for (const file of files) {
        throwIfAborted(options.signal);
        const blob = await file.toBlob();
        throwIfAborted(options.signal);
        await writer.add(file.name, new BlobReader(blob));
      }
      await writer.close();
      closed = true;
      throwIfAborted(options.signal);
      await save(
        `工具箱打包下载[${files.length}].zip`,
        await zipBlobWriter.getData(),
      );
    } finally {
      if (!closed) await writer.close().catch(() => undefined);
    }
  };

  const statusFor = <T extends ParsedFile>(
    total: number,
    outputs: T[],
    failures: BatchFailure[],
  ): BatchStatus => {
    if (total === 0) return 'empty';
    if (outputs.length === 0) return 'failed';
    return failures.length === 0 ? 'success' : 'partial';
  };

  const cancelledResult = <T extends ParsedFile>(
    total: number,
    completed: number,
    outputs: T[],
    failures: BatchFailure[],
  ): BatchResult<T> => ({
    status: 'cancelled',
    total,
    completed,
    outputs,
    failures,
  });

  const processFiles = async <T extends ParsedFile>(
    files: T[],
    process: (file: T, signal?: AbortSignal) => Promise<ParsedFile>,
    options: BatchOptions,
  ): Promise<BatchResult<ParsedFile>> => {
    const outputs: ParsedFile[] = [];
    const failures: BatchFailure[] = [];
    let completed = 0;

    for (const file of files) {
      if (options.signal?.aborted) {
        return cancelledResult(files.length, completed, outputs, failures);
      }
      options.onProgress?.({
        total: files.length,
        completed,
        succeeded: outputs.length,
        failed: failures.length,
        currentName: file.name,
      });
      try {
        const output = await process(file, options.signal);
        if (options.signal?.aborted) {
          return cancelledResult(files.length, completed, outputs, failures);
        }
        outputs.push(output);
      } catch (error) {
        if (options.signal?.aborted) {
          return cancelledResult(files.length, completed, outputs, failures);
        }
        failures.push({ name: file.name, error });
      }
      completed += 1;
      options.onProgress?.({
        total: files.length,
        completed,
        succeeded: outputs.length,
        failed: failures.length,
        currentName: file.name,
      });
    }

    return {
      status: statusFor(files.length, outputs, failures),
      total: files.length,
      completed,
      outputs,
      failures,
    };
  };

  const downloadSuccessful = async <T extends ParsedFile>(
    result: BatchResult<T>,
    options: BatchOptions,
  ): Promise<BatchResult<T>> => {
    if (result.status !== 'success' && result.status !== 'partial') {
      return result;
    }
    try {
      const download =
        options.download ??
        ((files, signal) => downloadFiles(files, { signal }));
      await download(result.outputs, options.signal);
      if (!options.signal?.aborted) return result;
    } catch (error) {
      if (!options.signal?.aborted) throw error;
    }
    return cancelledResult(
      result.total,
      result.completed,
      result.outputs,
      result.failures,
    );
  };

  export const modifyFiles = async <T extends ParsedFile>(
    files: T[],
    modify: ModifyFn<T>,
    options: BatchOptions = {},
  ) => {
    const result = await processFiles(
      files,
      async (file, signal) => {
        const newFile = (await file.clone()) as T;
        throwIfAborted(signal);
        await modify(newFile, signal);
        return newFile;
      },
      options,
    );
    return downloadSuccessful(result, options);
  };

  export const convertFiles = async <T extends ParsedFile>(
    files: T[],
    convert: ConvertFn<T>,
    options: BatchOptions = {},
  ) => {
    const result = await processFiles(
      files,
      async (file, signal) => {
        const newFile = (await file.clone()) as T;
        throwIfAborted(signal);
        return convert(newFile, signal);
      },
      options,
    );
    return downloadSuccessful(result, options);
  };
}
