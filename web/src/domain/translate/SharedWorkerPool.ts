type WorkerRegistration<TWorker> = {
  id: string;
  worker: TWorker;
  concurrency: number;
};

export type SharedWorkerSnapshot<TAssignment> = {
  outstanding: number;
  queued: number;
  waitingProducers: number;
  aggregateActive: number;
  aggregateMaximum: number;
  workers: Array<{
    id: string;
    active: number;
    maximum: number;
    errors: number;
    assignments: TAssignment[];
  }>;
};

export type SharedWorkHandle<T> = {
  result: Promise<T>;
};

type SharedWorkerPoolOptions<TAssignment> = {
  highWaterMark?: number;
  onSnapshot?: (snapshot: SharedWorkerSnapshot<TAssignment>) => void;
};

type Work<TWorker, TAssignment, TResult> = {
  assignment: TAssignment;
  execute: (worker: TWorker, signal: AbortSignal) => Promise<TResult>;
  signal?: AbortSignal;
  onAbort?: () => void;
  settled: boolean;
  attempt?: symbol;
  resolve: (value: TResult) => void;
  reject: (reason: unknown) => void;
};

type AnyWork<TWorker, TAssignment> = Work<TWorker, TAssignment, unknown>;

type ActiveWork<TWorker, TAssignment> = {
  work: AnyWork<TWorker, TAssignment>;
  controller: AbortController;
  token: symbol;
};

type WorkerState<TWorker, TAssignment> = WorkerRegistration<TWorker> & {
  active: Map<symbol, ActiveWork<TWorker, TAssignment>>;
  errors: number;
};

type CapacityWaiter = {
  resolve: () => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

const abortReason = (signal?: AbortSignal) =>
  signal?.reason ?? new DOMException('Aborted', 'AbortError');

const normalizePositiveInteger = (
  value: number | undefined,
  fallback: number,
) => (Number.isFinite(value) ? Math.max(1, Math.floor(value!)) : fallback);

/**
 * A bounded FIFO queue consumed by independently configurable worker lanes.
 *
 * `enqueue` resolves when work has entered the bounded queue, not when it has
 * completed. Producers that await each enqueue therefore apply real
 * backpressure instead of creating an unbounded list of pending work promises.
 */
export class SharedWorkerPool<TWorker, TAssignment> {
  private readonly highWaterMark: number;
  private readonly onSnapshot?: SharedWorkerPoolOptions<TAssignment>['onSnapshot'];
  private readonly workers = new Map<
    string,
    WorkerState<TWorker, TAssignment>
  >();
  private readonly queue = new Set<AnyWork<TWorker, TAssignment>>();
  private readonly capacityWaiters = new Set<CapacityWaiter>();
  private outstanding = 0;
  private closedReason: unknown;

  constructor(options: SharedWorkerPoolOptions<TAssignment> = {}) {
    this.highWaterMark = normalizePositiveInteger(options.highWaterMark, 100);
    this.onSnapshot = options.onSnapshot;
  }

  register(registration: WorkerRegistration<TWorker>) {
    if (this.closedReason !== undefined) {
      throw this.closedReason;
    }
    if (this.workers.has(registration.id)) {
      throw new Error(`Worker already registered: ${registration.id}`);
    }
    this.workers.set(registration.id, {
      ...registration,
      concurrency: normalizePositiveInteger(registration.concurrency, 1),
      active: new Map(),
      errors: 0,
    });
    this.drain();
    this.emitSnapshot();
  }

  unregister(workerId: string) {
    const worker = this.workers.get(workerId);
    if (worker === undefined) return;

    this.workers.delete(workerId);
    for (const active of worker.active.values()) {
      active.work.attempt = undefined;
      active.controller.abort(new DOMException('Worker stopped', 'AbortError'));
      if (!active.work.settled && !active.work.signal?.aborted) {
        this.queue.add(active.work);
      }
    }
    worker.active.clear();
    this.drain();
    this.emitSnapshot();
  }

  async enqueue<TResult>(
    assignment: TAssignment,
    execute: (worker: TWorker, signal: AbortSignal) => Promise<TResult>,
    signal?: AbortSignal,
  ): Promise<SharedWorkHandle<TResult>> {
    if (signal?.aborted) throw abortReason(signal);
    this.throwIfClosed();
    await this.waitForCapacity(signal);
    if (signal?.aborted) throw abortReason(signal);
    this.throwIfClosed();

    let resolveResult: (value: TResult) => void = () => {};
    let rejectResult: (reason: unknown) => void = () => {};
    const result = new Promise<TResult>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    const work: Work<TWorker, TAssignment, TResult> = {
      assignment,
      execute,
      signal,
      settled: false,
      resolve: resolveResult,
      reject: rejectResult,
    };
    work.onAbort = () => this.cancelWork(work as AnyWork<TWorker, TAssignment>);
    signal?.addEventListener('abort', work.onAbort, { once: true });
    this.queue.add(work as AnyWork<TWorker, TAssignment>);
    this.outstanding += 1;
    this.drain();
    this.emitSnapshot();
    return { result };
  }

  snapshot(): SharedWorkerSnapshot<TAssignment> {
    const workers = [...this.workers.values()].map((worker) => ({
      id: worker.id,
      active: worker.active.size,
      maximum: worker.concurrency,
      errors: worker.errors,
      assignments: [...worker.active.values()].map(
        ({ work }) => work.assignment,
      ),
    }));
    return {
      outstanding: this.outstanding,
      queued: this.queue.size,
      waitingProducers: this.capacityWaiters.size,
      aggregateActive: workers.reduce((sum, worker) => sum + worker.active, 0),
      aggregateMaximum: workers.reduce(
        (sum, worker) => sum + worker.maximum,
        0,
      ),
      workers,
    };
  }

  close(reason: unknown = new DOMException('Pool closed', 'AbortError')) {
    if (this.closedReason !== undefined) return;
    this.closedReason = reason;
    for (const workerId of [...this.workers.keys()]) {
      const worker = this.workers.get(workerId)!;
      this.workers.delete(workerId);
      for (const active of worker.active.values()) {
        active.work.attempt = undefined;
        active.controller.abort(reason);
        this.settle(active.work, 'reject', reason);
      }
    }
    for (const work of this.queue) {
      this.settle(work, 'reject', reason);
    }
    this.queue.clear();
    for (const waiter of this.capacityWaiters) {
      this.removeCapacityWaiter(waiter);
      waiter.reject(reason);
    }
    this.emitSnapshot();
  }

  private throwIfClosed() {
    if (this.closedReason !== undefined) throw this.closedReason;
  }

  private async waitForCapacity(signal?: AbortSignal) {
    while (this.outstanding >= this.highWaterMark) {
      await new Promise<void>((resolve, reject) => {
        const waiter: CapacityWaiter = { resolve, reject, signal };
        waiter.onAbort = () => {
          if (!this.capacityWaiters.delete(waiter)) return;
          reject(abortReason(signal));
          this.emitSnapshot();
        };
        signal?.addEventListener('abort', waiter.onAbort, { once: true });
        this.capacityWaiters.add(waiter);
        this.emitSnapshot();
      });
      this.throwIfClosed();
    }
  }

  private releaseCapacity() {
    const waiter = this.capacityWaiters.values().next().value;
    if (waiter === undefined) return;
    this.removeCapacityWaiter(waiter);
    waiter.resolve();
  }

  private removeCapacityWaiter(waiter: CapacityWaiter) {
    this.capacityWaiters.delete(waiter);
    if (waiter.onAbort) {
      waiter.signal?.removeEventListener('abort', waiter.onAbort);
    }
  }

  private drain() {
    if (this.closedReason !== undefined) return;
    for (const worker of this.workers.values()) {
      while (worker.active.size < worker.concurrency && this.queue.size > 0) {
        const work = this.queue.values().next().value!;
        this.queue.delete(work);
        if (work.signal?.aborted) {
          this.settle(work, 'reject', abortReason(work.signal));
          continue;
        }
        this.start(worker, work);
      }
    }
  }

  private start(
    worker: WorkerState<TWorker, TAssignment>,
    work: AnyWork<TWorker, TAssignment>,
  ) {
    const controller = new AbortController();
    const token = Symbol('shared-worker-attempt');
    const signal = work.signal
      ? AbortSignal.any([work.signal, controller.signal])
      : controller.signal;
    const active: ActiveWork<TWorker, TAssignment> = {
      work,
      controller,
      token,
    };
    work.attempt = token;
    worker.active.set(token, active);

    void Promise.resolve()
      .then(() => work.execute(worker.worker, signal))
      .then(
        (value) => {
          if (work.attempt !== token) return;
          this.settle(work, 'resolve', value);
        },
        (reason) => {
          if (work.attempt !== token) return;
          if (!signal.aborted) worker.errors += 1;
          this.settle(work, 'reject', reason);
        },
      )
      .finally(() => {
        worker.active.delete(token);
        this.drain();
        this.emitSnapshot();
      });
  }

  private cancelWork(work: AnyWork<TWorker, TAssignment>) {
    if (work.settled) return;
    this.queue.delete(work);
    for (const worker of this.workers.values()) {
      for (const [token, active] of worker.active) {
        if (active.work !== work) continue;
        work.attempt = undefined;
        worker.active.delete(token);
        active.controller.abort(abortReason(work.signal));
      }
    }
    this.settle(work, 'reject', abortReason(work.signal));
    this.drain();
    this.emitSnapshot();
  }

  private settle(
    work: AnyWork<TWorker, TAssignment>,
    outcome: 'resolve' | 'reject',
    value: unknown,
  ) {
    if (work.settled) return;
    work.settled = true;
    this.outstanding -= 1;
    this.releaseCapacity();
    work.attempt = undefined;
    if (work.onAbort) {
      work.signal?.removeEventListener('abort', work.onAbort);
    }
    if (outcome === 'resolve') work.resolve(value);
    else work.reject(value);
  }

  private emitSnapshot() {
    this.onSnapshot?.(this.snapshot());
  }
}
