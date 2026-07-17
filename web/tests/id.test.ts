import { afterEach, describe, expect, it, vi } from 'vitest';

import { createId } from '../src/util/id';

describe('createId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not require crypto.randomUUID', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(1),
    });

    expect(createId()).toMatch(/^[\w-]{21}$/);
  });
});
