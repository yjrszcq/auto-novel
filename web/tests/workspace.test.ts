import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
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

import { removeRemoteTasks } from '../src/stores/useWorkspaceStore';

describe('workspace migration', () => {
  it('removes remote tasks while preserving local task formats', () => {
    const workspace = {
      jobs: [
        { task: 'local/book-a', description: 'local', createAt: 1 },
        { task: 'personal/book-b', description: 'legacy', createAt: 2 },
        { task: 'web/kakuyomu/123', description: 'remote', createAt: 3 },
      ],
      uncompletedJobs: [
        { task: 'personal2/book-c', description: 'legacy', createAt: 4 },
        { task: 'wenku/123/456', description: 'remote', createAt: 5 },
      ],
    };

    removeRemoteTasks(workspace);

    expect(workspace.jobs.map((job) => job.task)).toEqual([
      'local/book-a',
      'personal/book-b',
    ]);
    expect(workspace.uncompletedJobs.map((job) => job.task)).toEqual([
      'personal2/book-c',
    ]);
  });
});
