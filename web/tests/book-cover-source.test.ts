import { describe, expect, it } from 'vitest';

import { resolveBookCoverSource } from '../src/pages/bookshelf/components/BookCoverSource';

describe('book cover source', () => {
  it('uses an external URL without consulting lower-priority sources', () => {
    expect(
      resolveBookCoverSource({
        externalUrl: ' https://example.com/cover.webp ',
        localUrl: 'blob:custom',
        defaultUrl: '/config/images/default.webp',
      }),
    ).toEqual({
      kind: 'external',
      url: 'https://example.com/cover.webp',
    });
  });

  it('falls through local, configured default, and text sources in order', () => {
    expect(
      resolveBookCoverSource({
        localUrl: 'blob:embedded',
        defaultUrl: '/config/images/default.webp',
      }),
    ).toEqual({ kind: 'local', url: 'blob:embedded' });
    expect(
      resolveBookCoverSource({ defaultUrl: '/config/images/default.webp' }),
    ).toEqual({ kind: 'default', url: '/config/images/default.webp' });
    expect(resolveBookCoverSource({})).toEqual({ kind: 'text' });
  });
});
