import { getLocalBookMetadata } from '@/model/LocalVolume';
import type { LocalVolumeMetadata } from '@/model/LocalVolume';
import type { Epub } from '@/util/file';

import type { LocalVolumeDao } from './LocalVolumeDao';

type DownloadMetadataDao = Pick<LocalVolumeDao, 'getReaderCover'>;

const fetchCover = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`封面下载失败（HTTP ${response.status}）`);
  }
  return response.blob();
};

export const embedEpubDownloadMetadata = async (
  dao: DownloadMetadataDao,
  epub: Epub,
  volume: LocalVolumeMetadata,
) => {
  const metadata = getLocalBookMetadata(volume);
  epub.updateBookMetadata({
    title: metadata.title,
    authors: metadata.authors ?? [],
    description: metadata.description,
    languages: metadata.languages ?? [],
  });

  const coverUrl = metadata.coverUrl?.trim();
  if (coverUrl) {
    epub.setCover(await fetchCover(coverUrl));
    return;
  }
  const cover = await dao.getReaderCover(volume.id);
  if (cover?.source === 'custom') epub.setCover(cover.blob);
};
