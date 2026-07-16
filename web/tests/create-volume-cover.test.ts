import { describe, expect, it, vi } from 'vitest';

import { createVolume } from '../src/stores/local/CreateVolume';
import type { LocalVolumeDao } from '../src/stores/local/LocalVolumeDao';
import { EpubParserV1 } from '../src/stores/local/EpubParser';
import { parseFile } from '../src/util/file';

vi.mock('../src/util/file', () => ({
  parseFile: vi.fn(),
  Srt: { cleanFormat: (text: string) => text },
}));
vi.mock('../src/stores/local/EpubParser', () => ({
  EpubParserV1: { extractText: vi.fn() },
}));

describe('local EPUB import cover', () => {
  it('persists an embedded cover after creating the local volume', async () => {
    const cover = new Blob(['cover'], { type: 'image/jpeg' });
    vi.mocked(parseFile).mockResolvedValue({
      type: 'epub',
      getCover: () => cover,
      iterDoc: async function* () {
        yield { href: 'chapter.xhtml', doc: {} };
      },
    } as never);
    vi.mocked(EpubParserV1.extractText).mockReturnValue(['第一段']);

    const dao = {
      getMetadata: vi.fn().mockResolvedValue(undefined),
      createChapter: vi.fn().mockResolvedValue(undefined),
      createMetadata: vi.fn().mockResolvedValue(undefined),
      createFile: vi.fn().mockResolvedValue(undefined),
      putReaderCover: vi.fn().mockResolvedValue(undefined),
    } as unknown as LocalVolumeDao;

    await createVolume(
      dao,
      new File(['epub'], 'book.epub', { type: 'application/epub+zip' }),
      'default',
    );

    expect(dao.putReaderCover).toHaveBeenCalledWith({
      bookId: 'book.epub',
      blob: cover,
      source: 'embedded',
      updatedAt: expect.any(Number),
    });
  });
});
