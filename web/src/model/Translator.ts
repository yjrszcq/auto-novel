export type TranslatorId = 'sakura' | 'baidu' | 'youdao' | 'gpt';

export const translationConcurrencyBounds = { minimum: 1, maximum: 16 };
export const gptFormatRetryBounds = { minimum: 0, maximum: 10 };
export const sakuraSegmentLengthBounds = { minimum: 100, maximum: 8_000 };
export const sakuraContextLengthBounds = { minimum: 0, maximum: 8_000 };

const normalizeBoundedInteger = (
  value: number | undefined,
  fallback: number,
  { minimum, maximum }: { minimum: number; maximum: number },
) =>
  Math.min(
    maximum,
    Math.max(minimum, Number.isFinite(value) ? Math.floor(value!) : fallback),
  );

export const normalizeTranslationConcurrency = (value?: number) =>
  normalizeBoundedInteger(value, 1, translationConcurrencyBounds);

export const normalizeGptFormatRetryCount = (value?: number) =>
  normalizeBoundedInteger(value, 3, gptFormatRetryBounds);

export const normalizeSakuraSegmentLength = (value?: number) =>
  normalizeBoundedInteger(value, 500, sakuraSegmentLengthBounds);

export const normalizeSakuraContextLength = (value?: number) =>
  normalizeBoundedInteger(value, 500, sakuraContextLengthBounds);

export interface GptWorker {
  id: string;
  endpoint: string;
  model: string;
  key: string;
  concurrency: number;
}

export interface SakuraWorker {
  id: string;
  endpoint: string;
  segLength: number;
  prevSegLength: number;
  concurrency: number;
}

export interface TranslateJob {
  task: string;
  resumeTask?: string;
  description: string;
  createAt: number;
  finishAt?: number;
}

export type TranslateJobRecord = TranslateJob & {
  progress?: {
    finished: number;
    error: number;
    total: number;
    elapsedMs: number;
  };
};

export namespace TranslateJob {
  export const isFinished = (job: TranslateJobRecord) =>
    job.progress !== undefined && job.progress.finished >= job.progress.total;
}

export type LocalTranslateTaskDesc = {
  type: 'local';
  volumeId: string;
};

export type TranslateTaskDesc = LocalTranslateTaskDesc;

export type TranslateTaskParams = {
  level: 'normal' | 'expire' | 'all' | 'sync'; // 翻译等级
  forceMetadata: boolean; // 强制重翻元数据
  startIndex: number;
  endIndex: number;
  gptFormatRetryCount: number;
  chapterIds?: string[];
};

export type TranslateTaskCallback = {
  onStart: (total: number, chapterIds: string[]) => void;
  onChapterSuccess: (state: {
    chapterId: string;
    jp?: number;
    zh?: number;
  }) => void;
  onChapterFailure: (chapterId: string) => void;
  log: (message: string, detail?: string[]) => void;
};

type TranslateTaskDescriptor = string;

export namespace TranslateTaskDescriptor {
  const buildTaskQueryString = ({
    level,
    forceMetadata,
    startIndex,
    endIndex,
    gptFormatRetryCount,
    chapterIds,
  }: TranslateTaskParams) => {
    const searchParamsInit: { [key: string]: string } = {
      level,
      forceMetadata: forceMetadata.toString(),
      startIndex: startIndex.toString(),
      endIndex: endIndex.toString(),
      gptFormatRetryCount:
        normalizeGptFormatRetryCount(gptFormatRetryCount).toString(),
    };
    if (chapterIds !== undefined) {
      searchParamsInit.chapterIds = JSON.stringify(chapterIds);
    }
    const searchParams = new URLSearchParams(searchParamsInit).toString();
    return searchParams ? `?${searchParams}` : '';
  };

  export const local = (volumeId: string, params: TranslateTaskParams) =>
    `local/${encodeURIComponent(volumeId)}` + buildTaskQueryString(params);

  export const parse = (task: string) => {
    const [taskString, queryString] = task.split('?');

    if (!taskString.startsWith('local/')) {
      throw new Error(`Unsupported translation task: ${taskString}`);
    }
    const volumeId = taskString.slice('local/'.length);
    if (volumeId.length === 0) {
      throw new Error('Translation task is missing a volume id');
    }
    const desc: TranslateTaskDesc = {
      type: 'local',
      volumeId: decodeURIComponent(volumeId),
    };

    const query = new URLSearchParams(queryString);

    const queryBoolean = (name: string) => {
      return query.get(name) === 'true';
    };

    const queryInt = (name: string, defaultValue: number) => {
      const num = parseInt(query.get(name)!, 10);
      return isNaN(num) ? defaultValue : num;
    };

    const params: TranslateTaskParams = {
      level: query.get('level') as 'normal' | 'expire' | 'all' | 'sync',
      forceMetadata: queryBoolean('forceMetadata'),
      startIndex: queryInt('startIndex', 0),
      endIndex: queryInt('endIndex', 65535),
      gptFormatRetryCount: normalizeGptFormatRetryCount(
        queryInt('gptFormatRetryCount', 3),
      ),
    };
    const chapterIds = parseChapterIds(query.get('chapterIds'));
    if (chapterIds !== undefined) params.chapterIds = chapterIds;

    return { desc, params };
  };

  const parseChapterIds = (value: string | null) => {
    if (value === null) return undefined;
    try {
      const parsed: unknown = JSON.parse(value);
      if (
        Array.isArray(parsed) &&
        parsed.every((chapterId) => typeof chapterId === 'string')
      ) {
        return parsed;
      }
    } catch {
      // Report one consistent descriptor error below.
    }
    throw new Error('Translation task has invalid chapter ids');
  };
}
