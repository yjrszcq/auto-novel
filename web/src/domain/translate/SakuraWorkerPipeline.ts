import type {
  LocalTranslateTaskDesc,
  TranslateTaskCallback,
  TranslateTaskParams,
} from '@/model/Translator';
import { normalizeTranslationConcurrency } from '@/model/Translator';

import { normalizeConcurrencyLimit } from './Concurrency';
import { SharedWorkerPool } from './SharedWorkerPool';
import { translateLocal } from './TranslateLocal';
import type { SakuraTranslator } from './TranslatorSakura';
import type {
  SegmentDispatcher,
  SegmentProgressInfo,
  TranslationSegmentAssignment,
  Translator,
} from './Translator';

type SakuraWorkerLane = {
  id: string;
  translator: Translator;
};

export type SakuraWorkerPipelineSnapshot = ReturnType<
  SharedWorkerPool<SakuraWorkerLane, TranslationSegmentAssignment>['snapshot']
>;

const profileKey = (profile: SakuraTranslator.Profile) =>
  JSON.stringify(profile);

/**
 * Shares ready Sakura segments across compatible local-model deployments.
 *
 * A Sakura chapter still produces one segment at a time because each request
 * includes the completed translation immediately before it. `translateLocal`
 * can, however, advance independent chapters concurrently, which gives this
 * pool enough ready work to combine multiple deployments safely.
 */
export class SakuraWorkerPipeline {
  private readonly producerConcurrency: number;
  private readonly workers = new Map<string, Translator>();
  private readonly pool: SharedWorkerPool<
    SakuraWorkerLane,
    TranslationSegmentAssignment
  >;
  private activeProfile?: SakuraTranslator.Profile;

  constructor(options?: {
    highWaterMark?: number;
    onSnapshot?: (snapshot: SakuraWorkerPipelineSnapshot) => void;
  }) {
    this.producerConcurrency = normalizeConcurrencyLimit(
      options?.highWaterMark,
      100,
    );
    this.pool = new SharedWorkerPool({
      highWaterMark: this.producerConcurrency,
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
    const profile = translator.sakuraProfile();
    if (translator.id !== 'sakura' || profile === undefined) {
      throw new Error('Sakura 共享池仅支持 Sakura 翻译器');
    }
    if (
      this.activeProfile !== undefined &&
      profileKey(this.activeProfile) !== profileKey(profile)
    ) {
      throw new Error(
        'Sakura 翻译器配置不兼容：模型版本、分段长度和前文长度必须一致',
      );
    }

    this.pool.register({
      id,
      worker: { id, translator },
      concurrency: normalizeTranslationConcurrency(concurrency),
    });
    this.workers.set(id, translator);
    this.activeProfile ??= profile;
  }

  unregister(workerId: string) {
    this.pool.unregister(workerId);
    this.workers.delete(workerId);
    if (this.workers.size === 0 && this.pool.snapshot().outstanding === 0) {
      this.activeProfile = undefined;
    }
  }

  profile() {
    return this.activeProfile;
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
      throw new Error('没有正在运行的 Sakura 翻译器');
    }
    return translateLocal(desc, params, callback, planner, signal, {
      concurrency: this.producerConcurrency,
      segmentDispatcher: this.dispatchSegment,
      onSegmentProgress: options?.onSegmentProgress,
    });
  }

  close(reason?: unknown) {
    this.workers.clear();
    this.activeProfile = undefined;
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
