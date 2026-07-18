import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal(
    'Audio',
    class {
      play = vi.fn();
      pause = vi.fn();
    },
  );
});

import { translate } from '../src/domain/translate/Translate';
import { Translator } from '../src/domain/translate/Translator';

describe('translation task lifecycle', () => {
  it('reports translator setup failure instead of completing an empty task', async () => {
    const create = vi
      .spyOn(Translator, 'create')
      .mockRejectedValueOnce(new Error('invalid worker configuration'));
    const logs: string[] = [];

    const state = await translate(
      { type: 'local', volumeId: 'book' },
      {
        level: 'all',
        forceMetadata: false,
        startIndex: 0,
        endIndex: 1,
      },
      {
        onStart: () => {},
        onChapterSuccess: () => {},
        onChapterFailure: () => {},
        log: (message) => logs.push(message),
      },
      {
        id: 'gpt',
        endpoint: 'http://127.0.0.1:1',
        key: 'invalid',
        model: 'invalid',
      },
    );

    expect(state).toBe('setup-error');
    expect(logs).toEqual([
      expect.stringContaining('invalid worker configuration'),
    ]);
    create.mockRestore();
  });
});
