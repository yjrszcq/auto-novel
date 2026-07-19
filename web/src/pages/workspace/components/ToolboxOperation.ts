import { inject, markRaw, reactive, readonly } from 'vue';
import type { InjectionKey } from 'vue';

import type { ParsedFile } from '@/util/file';

import type { Toolbox } from './Toolbox';

export type ToolboxOperationStatus =
  'idle' | 'running' | 'cancelling' | Toolbox.BatchStatus;

export interface ToolboxOperationState {
  status: ToolboxOperationStatus;
  label: string;
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  currentName: string;
  outputs: Toolbox.BatchOutput[];
  failures: Toolbox.BatchFailure[];
  busy: boolean;
}

type ToolboxTask = (
  options: Toolbox.BatchOptions,
) => Promise<Toolbox.BatchResult<ParsedFile>>;

export interface ToolboxOperationController {
  state: Readonly<ToolboxOperationState>;
  run: (label: string, total: number, task: ToolboxTask) => Promise<void>;
  cancel: () => void;
  setOutputs: (outputs: Toolbox.BatchOutput[]) => void;
  dispose: () => void;
}

export const toolboxOperationKey: InjectionKey<ToolboxOperationController> =
  Symbol('toolbox-operation');

export const createToolboxOperation = (): ToolboxOperationController => {
  const retainOutputFiles = (outputs: Toolbox.BatchOutput[]) =>
    outputs.map((output) => ({
      sourceName: output.sourceName,
      file: markRaw(output.file),
    }));

  const state = reactive<ToolboxOperationState>({
    status: 'idle',
    label: '',
    total: 0,
    completed: 0,
    succeeded: 0,
    failed: 0,
    currentName: '',
    outputs: [],
    failures: [],
    busy: false,
  });
  let activeController: AbortController | undefined;
  let disposed = false;

  const run = async (label: string, total: number, task: ToolboxTask) => {
    if (activeController !== undefined || disposed) return;
    const controller = new AbortController();
    activeController = controller;
    Object.assign(state, {
      status: 'running',
      label,
      total,
      completed: 0,
      succeeded: 0,
      failed: 0,
      currentName: '',
      outputs: [],
      failures: [],
      busy: true,
    });

    try {
      const result = await task({
        signal: controller.signal,
        onProgress: (progress) => {
          if (activeController !== controller || controller.signal.aborted)
            return;
          Object.assign(state, progress);
        },
      });
      if (disposed || activeController !== controller) return;
      Object.assign(state, {
        status: result.status,
        total: result.total,
        completed: result.completed,
        succeeded: result.outputs.length,
        failed: result.failures.length,
        outputs: retainOutputFiles(result.outputs),
        failures: result.failures,
      });
    } catch (error) {
      if (disposed || activeController !== controller) return;
      Object.assign(state, {
        status: controller.signal.aborted ? 'cancelled' : 'failed',
        failed: controller.signal.aborted ? state.failed : state.failed + 1,
        failures: controller.signal.aborted
          ? state.failures
          : [{ name: label, error }],
      });
    } finally {
      if (activeController === controller) {
        activeController = undefined;
        state.busy = false;
      }
    }
  };

  const cancel = () => {
    if (activeController === undefined) return;
    state.status = 'cancelling';
    activeController.abort(new DOMException('操作已取消', 'AbortError'));
  };

  const setOutputs = (outputs: Toolbox.BatchOutput[]) => {
    state.outputs = retainOutputFiles(outputs);
  };

  const dispose = () => {
    disposed = true;
    activeController?.abort(new DOMException('页面已关闭', 'AbortError'));
    activeController = undefined;
  };

  return { state: readonly(state), run, cancel, setOutputs, dispose };
};

export const useToolboxOperation = () => {
  const operation = inject(toolboxOperationKey);
  if (operation === undefined) throw new Error('缺少工具箱运行状态');
  return operation;
};
