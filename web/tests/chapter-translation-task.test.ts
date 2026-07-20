import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const storage = new Map<string, string>();

  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
    key: (index: number) => Array.from(storage.keys())[index] ?? null,
    get length() {
      return storage.size;
    },
  };

  vi.stubGlobal('window', {
    localStorage,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });

  vi.stubGlobal(
    'Audio',
    class {
      loop = false;
      pause() {}
      play() {
        return Promise.resolve();
      }
    },
  );
});

import { TranslateTaskDescriptor } from '../src/model/Translator';
import { useLocalVolumeManager } from '../src/pages/workspace/LocalVolumeManager';
import { useGptWorkspaceStore } from '../src/stores/useWorkspaceStore';

describe('current chapter translation task', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('keeps the selected chapter range when it creates one local task', () => {
    const workspace = useGptWorkspaceStore();
    workspace.ref.value.jobs = [];

    const result = useLocalVolumeManager().queueJobToWorkspace('book', {
      level: 'normal',
      type: 'gpt',
      shouldTop: false,
      forceMetadata: true,
      startIndex: 3,
      endIndex: 4,
      taskNumber: 1,
      total: 10,
      formatRetryCount: 5,
    });

    expect(result).toEqual([true]);
    expect(
      TranslateTaskDescriptor.parse(workspace.ref.value.jobs[0].task),
    ).toMatchObject({
      desc: { type: 'local', volumeId: 'book' },
      params: {
        translateMetadata: true,
        forceMetadata: true,
        startIndex: 3,
        endIndex: 4,
        formatRetryCount: 5,
      },
    });
  });

  it('retries only the exact persisted remaining chapter scope', () => {
    const workspace = useGptWorkspaceStore();
    workspace.ref.value.jobs = [];
    workspace.ref.value.jobRecords = [];
    const originalTask = TranslateTaskDescriptor.local('book', {
      level: 'all',
      translateMetadata: true,
      forceMetadata: false,
      startIndex: 0,
      endIndex: 10,
    });
    const resumeTask = TranslateTaskDescriptor.local('book', {
      level: 'all',
      translateMetadata: false,
      forceMetadata: false,
      startIndex: 0,
      endIndex: 10,
      chapterIds: ['chapter-failed', 'chapter-unstarted'],
    });
    const record = {
      task: originalTask,
      resumeTask,
      description: 'exact resume',
      createAt: 1,
      progress: { finished: 1, error: 1, total: 3, elapsedMs: 500 },
    };
    workspace.addJobRecord(record);

    expect(workspace.retryJobRecord(record)).toBe(true);
    expect(workspace.ref.value.jobs[0].task).toBe(resumeTask);
    expect(workspace.ref.value.jobRecords).toHaveLength(0);
  });

  it('assigns whole-book catalog translation to only one split task', () => {
    const workspace = useGptWorkspaceStore();
    workspace.ref.value.jobs = [];

    const result = useLocalVolumeManager().queueJobToWorkspace('split-book', {
      level: 'expire',
      type: 'gpt',
      shouldTop: false,
      forceMetadata: false,
      startIndex: 0,
      endIndex: 9,
      taskNumber: 3,
      total: 9,
    });

    expect(result).toEqual([true, true, true]);
    expect(
      workspace.ref.value.jobs.map(
        (job) =>
          TranslateTaskDescriptor.parse(job.task).params.translateMetadata,
      ),
    ).toEqual([true, false, false]);
  });
});
