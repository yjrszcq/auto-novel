import type {
  BookReadingCapabilities,
  ReaderBookPreference,
  ReaderMode,
  ReaderSettingsRecord,
} from '@/model/Reader';

export type SelectableReaderMode = Exclude<ReaderMode, 'ask'>;

export const readerModes: SelectableReaderMode[] = [
  'translated',
  'translated-original',
  'original-translated',
  'original',
];

export const getAvailableReaderModes = (
  capabilities: BookReadingCapabilities,
): ReaderMode[] =>
  capabilities.hasAnyTranslation ? ['ask', ...readerModes] : ['original'];

export const resolveReaderMode = ({
  temporaryMode,
  preference,
  settings,
  capabilities,
}: {
  temporaryMode?: SelectableReaderMode;
  preference?: ReaderBookPreference;
  settings: ReaderSettingsRecord;
  capabilities: BookReadingCapabilities;
}): ReaderMode => {
  if (!capabilities.hasAnyTranslation) {
    return 'original';
  }
  return temporaryMode ?? preference?.preferredMode ?? settings.defaultMode;
};
