import { describe, expect, it, vi } from 'vitest';

import { createVolume } from '../src/stores/local/CreateVolume';
import type { LocalVolumeDao } from '../src/stores/local/LocalVolumeDao';
import { createEpubImportPlan } from '../src/stores/local/EpubChapterPlan';
import { parseFile } from '../src/util/file';

vi.mock('../src/util/file', () => ({
  parseFile: vi.fn(),
  Srt: { cleanFormat: (text: string) => text },
}));
vi.mock('../src/stores/local/EpubChapterPlan', () => ({
  createEpubImportPlan: vi.fn(),
}));

describe('local EPUB import cover', () => {
  it('persists an embedded cover after creating the local volume', async () => {
    const cover = new Blob(['cover'], { type: 'image/jpeg' });
    vi.mocked(parseFile).mockResolvedValue({
      type: 'epub',
      getCover: () => cover,
    } as never);
    vi.mocked(createEpubImportPlan).mockReturnValue({
      chapters: [
        {
          chapterId: 'chapter.xhtml',
          title: '第一章',
          paragraphs: ['第一段'],
          sourceRanges: [{ href: 'chapter.xhtml', start: 0, end: 1 }],
        },
      ],
      navigation: [
        {
          id: 'nav-0',
          title: '第一章',
          level: 0,
          href: 'chapter.xhtml',
          chapterId: 'chapter.xhtml',
        },
      ],
      sources: [
        {
          href: 'chapter.xhtml',
          title: '第一章',
          paragraphs: ['第一段'],
        },
      ],
    });

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
    expect(dao.createChapter).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'book.epub/chapter.xhtml',
        sourceRanges: [{ href: 'chapter.xhtml', start: 0, end: 1 }],
      }),
    );
    expect(dao.createMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceFormat: 'epub',
        contentVersion: 2,
        toc: [{ chapterId: 'chapter.xhtml', title: '第一章' }],
        navigation: [
          expect.objectContaining({
            chapterId: 'chapter.xhtml',
            title: '第一章',
          }),
        ],
      }),
    );
  });
});
