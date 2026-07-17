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

import { TranslateTaskDescriptor } from '../src/model/Translator';

describe('workspace task descriptors', () => {
  it('round-trips the current local task format', () => {
    const task = TranslateTaskDescriptor.local('book/a', {
      level: 'all',
      forceMetadata: true,
      startIndex: 2,
      endIndex: 8,
    });

    expect(TranslateTaskDescriptor.parse(task)).toEqual({
      desc: { type: 'local', volumeId: 'book/a' },
      params: {
        level: 'all',
        forceMetadata: true,
        startIndex: 2,
        endIndex: 8,
      },
    });
  });

  it.each(['personal/book', 'personal2/book', 'web/source/book'])(
    'rejects an obsolete task format: %s',
    (task) => {
      expect(() => TranslateTaskDescriptor.parse(task)).toThrow(
        'Unsupported translation task',
      );
    },
  );

  it('rejects a task without a volume id', () => {
    expect(() => TranslateTaskDescriptor.parse('local/')).toThrow(
      'missing a volume id',
    );
  });
});
