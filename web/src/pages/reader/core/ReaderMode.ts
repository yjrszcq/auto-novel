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

export const readerModeLabels: Record<ReaderMode, string> = {
  ask: '每次询问',
  translated: '中文',
  'translated-original': '中日对照',
  'original-translated': '日中对照',
  original: '原文（日文）',
};

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
