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

  const cover = await getEpubDownloadCover(dao, volume);
  if (cover !== undefined) epub.setCover(cover);
};

export const getEpubDownloadCover = async (
  dao: DownloadMetadataDao,
  volume: LocalVolumeMetadata,
) => {
  const coverUrl = getLocalBookMetadata(volume).coverUrl?.trim();
  if (coverUrl) return fetchCover(coverUrl);
  const cover = await dao.getReaderCover(volume.id);
  return cover?.source === 'custom' ? cover.blob : undefined;
};
