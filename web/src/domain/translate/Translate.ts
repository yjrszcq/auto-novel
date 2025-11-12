import type {
  TranslateTaskCallback,
  TranslateTaskDesc,
  TranslateTaskParams,
} from '@/model/Translator';

import { translateLocal } from './TranslateLocal';
import type { TranslatorConfig } from './Translator';
import { Translator } from './Translator';

type TranslateRunOptions = {
  concurrency?: number;
  onSegmentProgress?: (info: {
    chapter?: { index?: number; total?: number; id?: string };
    segmentIndex: number;
    segmentTotal: number;
    status: 'start' | 'success' | 'complete' | 'failed';
  }) => void;
};

export const translate = async (
  taskDesc: TranslateTaskDesc,
  taskParams: TranslateTaskParams,
  taskCallback: TranslateTaskCallback,
  translatorConfig: TranslatorConfig,
  signal?: AbortSignal,
  options?: TranslateRunOptions,
) => {
  let translator: Translator;
  try {
    translator = await Translator.create(
      translatorConfig,
      true,
      (message, detail) => taskCallback.log(message, detail),
    );
  } catch (e: unknown) {
    taskCallback.log(`发生错误，无法创建翻译器：${e}`);
    return;
  }

  if (taskDesc.type !== 'local') {
    taskCallback.log('远程翻译功能已移除，任务自动跳过');
    return 'uncomplete';
  }

  return translateLocal(
    taskDesc,
    taskParams,
    taskCallback,
    translator,
    signal,
    options,
  );
};
