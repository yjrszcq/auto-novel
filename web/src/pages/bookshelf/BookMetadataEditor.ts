import type {
  DownloadMetadataPolicy,
  LocalBookMetadata,
  LocalVolumeMetadata,
} from '@/model/LocalVolume';
import { getLocalBookMetadata } from '@/model/LocalVolume';

export interface BookMetadataFormValue {
  title: string;
  authors: string[];
  description: string;
  coverUrl: string;
  languages: string[];
  originalDownload: DownloadMetadataPolicy;
  translatedDownload: DownloadMetadataPolicy;
}

const formMetadata = (metadata: LocalBookMetadata): BookMetadataFormValue => ({
  title: metadata.title ?? '',
  authors: [...(metadata.authors ?? [])],
  description: metadata.description ?? '',
  coverUrl: metadata.coverUrl ?? '',
  languages: [...(metadata.languages ?? [])],
  originalDownload: 'global',
  translatedDownload: 'global',
});

export const createBookMetadataForm = (
  volume: LocalVolumeMetadata,
): BookMetadataFormValue => ({
  ...formMetadata(getLocalBookMetadata(volume)),
  originalDownload: volume.downloadMetadataPreference?.original ?? 'global',
  translatedDownload: volume.downloadMetadataPreference?.translated ?? 'global',
});

export const restoreSourceMetadata = (
  form: BookMetadataFormValue,
  volume: LocalVolumeMetadata,
): BookMetadataFormValue => ({
  ...formMetadata(volume.sourceBookMetadata ?? {}),
  originalDownload: form.originalDownload,
  translatedDownload: form.translatedDownload,
});

export const toBookMetadata = (
  form: BookMetadataFormValue,
): LocalBookMetadata => ({
  title: form.title.trim(),
  authors: form.authors.map((author) => author.trim()).filter(Boolean),
  description: form.description.trim(),
  coverUrl: form.coverUrl.trim(),
  languages: form.languages.map((language) => language.trim()).filter(Boolean),
});

export const isValidLanguageTag = (value: string) => {
  try {
    return Intl.getCanonicalLocales(value.trim()).length === 1;
  } catch {
    return false;
  }
};
