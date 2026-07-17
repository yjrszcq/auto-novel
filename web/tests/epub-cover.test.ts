import { describe, expect, it } from 'vitest';

import {
  resolveEpubCoverId,
  type EpubCoverManifestItem,
} from '../src/util/file/epub';

const image = (
  id: string,
  href: string,
  properties?: string[],
): EpubCoverManifestItem => ({
  id,
  href,
  mediaType: 'image/jpeg',
  properties,
});

describe('EPUB cover resolution', () => {
  it('prefers the EPUB 3 cover-image manifest property', () => {
    expect(
      resolveEpubCoverId(
        [
          image('illustration', 'images/illustration.jpg'),
          image('cover', 'images/front.jpg', ['cover-image']),
        ],
        'epub2-cover',
      ),
    ).toBe('cover');
  });

  it('uses the EPUB 2 metadata manifest id before a filename fallback', () => {
    expect(
      resolveEpubCoverId(
        [
          image('cover-art', 'images/cover.jpg'),
          image('epub2-cover', 'images/front.jpg'),
        ],
        'epub2-cover',
      ),
    ).toBe('epub2-cover');
  });

  it('uses only a conservative image filename fallback', () => {
    expect(
      resolveEpubCoverId([
        image('chapter-image', 'images/chapter-1.jpg'),
        image('front', 'images/cover.webp'),
      ]),
    ).toBe('front');
    expect(
      resolveEpubCoverId([image('chapter-image', 'images/chapter-1.jpg')]),
    ).toBeUndefined();
  });
});
