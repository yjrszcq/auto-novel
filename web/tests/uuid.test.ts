import { afterEach, describe, expect, it, vi } from 'vitest';

import { createUuid } from '../src/util/uuid';

describe('createUuid', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a UUID v4 without crypto.randomUUID', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(1),
    });

    expect(createUuid()).toBe('01010101-0101-4101-8101-010101010101');
  });
});
