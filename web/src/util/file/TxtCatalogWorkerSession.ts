import type {
  TxtHeadingDraft,
  TxtImportPlan,
  TxtParseMode,
} from '../../model/TxtCatalog';
import { createTxtCatalogWorkerService } from './TxtCatalogWorkerService';
import type {
  TxtCatalogLineWindow,
  TxtCatalogPreviewSnapshot,
  TxtCatalogSearchResult,
  TxtCatalogWorkerRequest,
  TxtCatalogWorkerResponse,
  TxtCatalogWorkerResult,
} from './TxtCatalogWorkerProtocol';

export const TXT_PARSE_MODE_STORAGE_KEY = 'auto-novel:txt-parse-mode';

const isTxtParseMode = (value: string | null): value is TxtParseMode =>
  value === 'strict' || value === 'balanced' || value === 'loose';

export const getStoredTxtParseMode = (): TxtParseMode => {
  if (typeof localStorage === 'undefined') return 'balanced';
  const value = localStorage.getItem(TXT_PARSE_MODE_STORAGE_KEY);
  return isTxtParseMode(value) ? value : 'balanced';
};

export const setStoredTxtParseMode = (mode: TxtParseMode) => {
  if (typeof localStorage !== 'undefined')
    localStorage.setItem(TXT_PARSE_MODE_STORAGE_KEY, mode);
};

export interface TxtCatalogProgress {
  progress: number;
  stage: 'decode' | 'analyze' | 'plan';
  message: string;
}

export interface TxtCatalogSession {
  readonly kind: 'worker' | 'direct';
  onProgress(listener: (progress: TxtCatalogProgress) => void): () => void;
  initialize(
    file: File,
    mode: TxtParseMode,
  ): Promise<TxtCatalogPreviewSnapshot>;
  initializeBuffer(
    fileName: string,
    buffer: ArrayBuffer,
    mode: TxtParseMode,
  ): Promise<TxtCatalogPreviewSnapshot>;
  reparse(mode: TxtParseMode): Promise<TxtCatalogPreviewSnapshot>;
  getLines(startLine: number, count: number): Promise<TxtCatalogLineWindow>;
  search(
    query: string,
    startLine: number,
    limit?: number,
  ): Promise<TxtCatalogSearchResult>;
  buildPlan(headings: TxtHeadingDraft[]): Promise<TxtImportPlan>;
  cancel(reason?: string): void;
  dispose(): void;
}

type ResultForRequest<Request extends TxtCatalogWorkerRequest> =
  Request['type'] extends 'initialize' | 'reparse'
    ? TxtCatalogPreviewSnapshot
    : Request['type'] extends 'get-lines'
      ? TxtCatalogLineWindow
      : Request['type'] extends 'search'
        ? TxtCatalogSearchResult
        : TxtImportPlan;

interface PendingRequest {
  resolve(result: TxtCatalogWorkerResult): void;
  reject(error: Error): void;
}

const cancellationError = (reason = 'TXT 解析已取消') =>
  new DOMException(reason, 'AbortError');

class WorkerTxtCatalogSession implements TxtCatalogSession {
  readonly kind = 'worker' as const;
  private worker: Worker;
  private nextRequestId = 1;
  private disposed = false;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly progressListeners = new Set<
    (progress: TxtCatalogProgress) => void
  >();

  constructor(private readonly createWorker: () => Worker) {
    this.worker = createWorker();
    this.bindWorker();
  }

  private bindWorker() {
    this.worker.addEventListener('message', this.handleMessage);
    this.worker.addEventListener('error', this.handleWorkerError);
  }

  private unbindWorker() {
    this.worker.removeEventListener('message', this.handleMessage);
    this.worker.removeEventListener('error', this.handleWorkerError);
  }

  private readonly handleMessage = (
    event: MessageEvent<TxtCatalogWorkerResponse>,
  ) => {
    const response = event.data;
    if (response.type === 'progress') {
      const progress = {
        progress: response.progress,
        stage: response.stage,
        message: response.message,
      } satisfies TxtCatalogProgress;
      for (const listener of this.progressListeners) listener(progress);
      return;
    }
    const request = this.pending.get(response.requestId);
    if (request === undefined) return;
    this.pending.delete(response.requestId);
    if (response.type === 'error') request.reject(new Error(response.message));
    else request.resolve(response.result);
  };

  private readonly handleWorkerError = (event: ErrorEvent) => {
    const error = new Error(event.message || 'TXT 解析 Worker 异常');
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  };

  private request<Request extends Omit<TxtCatalogWorkerRequest, 'requestId'>>(
    request: Request,
    transfer: Transferable[] = [],
  ) {
    if (this.disposed) return Promise.reject(cancellationError());
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise<ResultForRequest<Request & { requestId: number }>>(
      (resolve, reject) => {
        this.pending.set(requestId, {
          resolve: (result) => resolve(result as never),
          reject,
        });
        this.worker.postMessage({ ...request, requestId }, transfer);
      },
    );
  }

  onProgress(listener: (progress: TxtCatalogProgress) => void) {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  async initialize(file: File, mode: TxtParseMode) {
    return this.initializeBuffer(file.name, await file.arrayBuffer(), mode);
  }

  initializeBuffer(fileName: string, buffer: ArrayBuffer, mode: TxtParseMode) {
    return this.request({ type: 'initialize', fileName, buffer, mode }, [
      buffer,
    ]);
  }

  reparse(mode: TxtParseMode) {
    return this.request({ type: 'reparse', mode });
  }

  getLines(startLine: number, count: number) {
    return this.request({ type: 'get-lines', startLine, count });
  }

  search(query: string, startLine: number, limit = 20) {
    return this.request({ type: 'search', query, startLine, limit });
  }

  buildPlan(headings: TxtHeadingDraft[]) {
    return this.request({ type: 'build-plan', headings });
  }

  cancel(reason?: string) {
    if (this.disposed) return;
    const error = cancellationError(reason);
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
    this.unbindWorker();
    this.worker.terminate();
    this.disposed = true;
  }

  dispose() {
    this.cancel();
    this.progressListeners.clear();
  }
}

class DirectTxtCatalogSession implements TxtCatalogSession {
  readonly kind = 'direct' as const;
  private disposed = false;
  private nextRequestId = 1;
  private readonly progressListeners = new Set<
    (progress: TxtCatalogProgress) => void
  >();
  private readonly service = createTxtCatalogWorkerService((response) => {
    const progress = {
      progress: response.progress,
      stage: response.stage,
      message: response.message,
    } satisfies TxtCatalogProgress;
    for (const listener of this.progressListeners) listener(progress);
  });

  private request<Request extends Omit<TxtCatalogWorkerRequest, 'requestId'>>(
    request: Request,
  ) {
    if (this.disposed) return Promise.reject(cancellationError());
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    try {
      return Promise.resolve(
        this.service.handle({
          ...request,
          requestId,
        } as TxtCatalogWorkerRequest),
      ) as Promise<ResultForRequest<Request & { requestId: number }>>;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  onProgress(listener: (progress: TxtCatalogProgress) => void) {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  async initialize(file: File, mode: TxtParseMode) {
    return this.initializeBuffer(file.name, await file.arrayBuffer(), mode);
  }

  initializeBuffer(fileName: string, buffer: ArrayBuffer, mode: TxtParseMode) {
    return this.request({ type: 'initialize', fileName, buffer, mode });
  }

  reparse(mode: TxtParseMode) {
    return this.request({ type: 'reparse', mode });
  }

  getLines(startLine: number, count: number) {
    return this.request({ type: 'get-lines', startLine, count });
  }

  search(query: string, startLine: number, limit = 20) {
    return this.request({ type: 'search', query, startLine, limit });
  }

  buildPlan(headings: TxtHeadingDraft[]) {
    return this.request({ type: 'build-plan', headings });
  }

  cancel() {
    this.disposed = true;
  }

  dispose() {
    this.cancel();
    this.progressListeners.clear();
  }
}

const defaultWorkerFactory = () =>
  new Worker(new URL('./TxtCatalog.worker.ts', import.meta.url), {
    type: 'module',
  });

export const createTxtCatalogSession = (
  createWorker?: () => Worker,
): TxtCatalogSession => {
  if (createWorker === undefined && typeof Worker === 'undefined')
    return new DirectTxtCatalogSession();
  try {
    return new WorkerTxtCatalogSession(createWorker ?? defaultWorkerFactory);
  } catch {
    return new DirectTxtCatalogSession();
  }
};
