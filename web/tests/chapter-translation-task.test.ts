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
      startIndex: 3,
      endIndex: 4,
      taskNumber: 1,
      total: 10,
    });

    expect(result).toEqual([true]);
    expect(
      TranslateTaskDescriptor.parse(workspace.ref.value.jobs[0].task),
    ).toMatchObject({
      desc: { type: 'local', volumeId: 'book' },
      params: { startIndex: 3, endIndex: 4 },
    });
  });
});
