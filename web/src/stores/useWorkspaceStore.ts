import type {
  GptWorker,
  SakuraWorker,
  TranslateJobRecord,
} from '@/model/Translator';
import { TranslateJob } from '@/model/Translator';
import { lazy, useLocalStorage } from '@/util';

import { LSKey } from './key';

interface Workspace<T> {
  workers: T[];
  jobs: TranslateJob[];
  jobRecords: TranslateJobRecord[];
}

const createWorkspaceStore = <W extends GptWorker | SakuraWorker>(
  id: string,
  workers: W[],
) => {
  const ref = useLocalStorage<Workspace<W>>(id, {
    workers,
    jobs: [],
    jobRecords: [],
  });

  const addWorker = (worker: W) => {
    ref.value.workers.push(worker);
  };
  const deleteWorker = (id: string) => {
    ref.value.workers = ref.value.workers.filter((w) => w.id !== id);
  };

  const addJob = (job: TranslateJob) => {
    const conflictJob = ref.value.jobs.find((it) => it.task === job.task);
    if (conflictJob !== undefined) {
      return false;
    } else {
      ref.value.jobs.push(job);
      return true;
    }
  };
  const deleteJob = (task: string) => {
    ref.value.jobs = ref.value.jobs.filter((j) => j.task !== task);
  };
  const topJob = (job: TranslateJob) => {
    ref.value.jobs.sort((a, b) => {
      return a.task == job.task ? -1 : b.task == job.task ? 1 : 0;
    });
  };
  const bottomJob = (job: TranslateJob) => {
    ref.value.jobs.sort((a, b) => {
      return a.task == job.task ? 1 : b.task == job.task ? -1 : 0;
    });
  };

  const addJobRecord = (job: TranslateJobRecord) => {
    deleteJobRecord(job);
    ref.value.jobRecords.push(job);
  };
  const deleteJobRecord = (job: TranslateJobRecord) => {
    ref.value.jobRecords = ref.value.jobRecords.filter(
      (j) => j.task !== job.task,
    );
  };
  const retryJobRecord = (job: TranslateJobRecord) => {
    const added = addJob({
      task: job.resumeTask ?? job.task,
      description: job.description,
      createAt: Date.now(),
    });
    if (added) deleteJobRecord(job);
    return added;
  };
  const retryAllJobRecords = () => {
    const newArray: TranslateJobRecord[] = [];
    for (const job of ref.value.jobRecords) {
      if (TranslateJob.isFinished(job)) {
        newArray.push(job);
      } else {
        const added = addJob({
          task: job.resumeTask ?? job.task,
          description: job.description,
          createAt: Date.now(),
        });
        if (!added) newArray.push(job);
      }
    }
    ref.value.jobRecords = newArray;
  };
  const deleteAllJobRecords = () => {
    ref.value.jobRecords = [];
  };

  const save = () => {
    ref.save?.();
  };

  return {
    ref,
    save,
    //
    addWorker,
    deleteWorker,
    //
    addJob,
    deleteJob,
    topJob,
    bottomJob,
    //
    addJobRecord,
    deleteJobRecord,
    retryJobRecord,
    retryAllJobRecords,
    deleteAllJobRecords,
  };
};

const createGptWorkspaceStore = () =>
  createWorkspaceStore<GptWorker>(LSKey.WorkspaceGpt, []);

const createSakuraWorkspaceStore = () =>
  createWorkspaceStore<SakuraWorker>(LSKey.WorkspaceSakura, [
    {
      id: '本机',
      endpoint: 'http://127.0.0.1:8080',
      segLength: 500,
      prevSegLength: 500,
      concurrency: 1,
    },
    {
      id: 'AutoDL',
      endpoint: 'http://127.0.0.1:6006',
      segLength: 500,
      prevSegLength: 500,
      concurrency: 1,
    },
  ]);

export const useGptWorkspaceStore = lazy(createGptWorkspaceStore);
export const useSakuraWorkspaceStore = lazy(createSakuraWorkspaceStore);

export function useWorkspaceStore(type: 'gpt' | 'sakura') {
  if (type === 'gpt') {
    return useGptWorkspaceStore();
  } else if (type === 'sakura') {
    return useSakuraWorkspaceStore();
  } else {
    return type satisfies never;
  }
}
