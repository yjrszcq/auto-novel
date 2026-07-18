import type {
  LocalTranslateTaskDesc,
  TranslateTaskCallback,
  TranslateTaskParams,
} from '@/model/Translator';
import { normalizeTranslationConcurrency } from '@/model/Translator';

import { SharedWorkerPool } from './SharedWorkerPool';
import { translateLocal } from './TranslateLocal';
import type {
  SegmentDispatcher,
  SegmentProgressInfo,
  TranslationSegmentAssignment,
  Translator,
} from './Translator';

type GptWorkerLane = {
  id: string;
  translator: Translator;
};

export type GptWorkerPipelineSnapshot = ReturnType<
  SharedWorkerPool<GptWorkerLane, TranslationSegmentAssignment>['snapshot']
>;

export class GptWorkerPipeline {
  private readonly workers = new Map<string, Translator>();
  private readonly pool: SharedWorkerPool<
    GptWorkerLane,
    TranslationSegmentAssignment
  >;

  constructor(options?: {
    highWaterMark?: number;
    onSnapshot?: (snapshot: GptWorkerPipelineSnapshot) => void;
  }) {
    this.pool = new SharedWorkerPool({
      highWaterMark: options?.highWaterMark,
      onSnapshot: options?.onSnapshot,
    });
  }

  register({
    id,
    translator,
    concurrency,
  }: {
    id: string;
    translator: Translator;
    concurrency: number;
  }) {
    if (translator.id !== 'gpt') {
      throw new Error('共享工作池仅支持 GPT 翻译器');
    }
    this.pool.register({
      id,
      worker: { id, translator },
      concurrency: normalizeTranslationConcurrency(concurrency),
    });
    this.workers.set(id, translator);
  }

  unregister(workerId: string) {
    this.pool.unregister(workerId);
    this.workers.delete(workerId);
  }

  snapshot() {
    return this.pool.snapshot();
  }

  async translateLocal(
    desc: LocalTranslateTaskDesc,
    params: TranslateTaskParams,
    callback: TranslateTaskCallback,
    signal?: AbortSignal,
    options?: {
      onSegmentProgress?: (info: SegmentProgressInfo) => void;
    },
  ) {
    const planner = this.workers.values().next().value;
    if (planner === undefined) {
      throw new Error('没有正在运行的 GPT 翻译器');
    }
    return translateLocal(desc, params, callback, planner, signal, {
      concurrency: this.snapshot().aggregateMaximum,
      segmentDispatcher: this.dispatchSegment,
      onSegmentProgress: options?.onSegmentProgress,
    });
  }

  close(reason?: unknown) {
    this.workers.clear();
    this.pool.close(reason);
  }

  private readonly dispatchSegment: SegmentDispatcher = async (request) => {
    const handle = await this.pool.enqueue(
      request.assignment,
      async (worker, signal) => ({
        output: await request.execute(worker.translator, signal),
        workerId: worker.id,
      }),
      request.signal,
    );
    return handle.result;
  };
}
