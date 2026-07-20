import type {
  BookReadingCapabilities,
  ReaderBookPreference,
  ReaderMode,
  ReaderSettingsRecord,
} from '@/model/Reader';

export type SelectableReaderMode = ReaderMode;

export const readerModes: SelectableReaderMode[] = [
  'translated',
  'translated-original',
  'original-translated',
  'original',
];

const readerModeShortcuts: Record<string, ReaderMode> = {
  '1': 'translated',
  '2': 'translated-original',
  '3': 'original-translated',
  '4': 'original',
};

export const getReaderModeShortcut = (key: string) => readerModeShortcuts[key];

export const readerModeLabels: Record<ReaderMode, string> = {
  translated: '中文',
  'translated-original': '中日对照',
  'original-translated': '日中对照',
  original: '原文（日文）',
};

const sourceLanguageLabels: Record<string, string> = {
  zh: '中文',
  zho: '中文',
  chi: '中文',
  cmn: '中文',
  yue: '中文',
  ja: '日文',
  en: '英文',
  ko: '韩文',
};

export const getReaderModeLabel = (
  mode: ReaderMode,
  sourceLanguage?: string,
) => {
  if (mode !== 'original' || sourceLanguage === undefined) {
    return readerModeLabels[mode];
  }
  const language =
    sourceLanguageLabels[sourceLanguage.toLowerCase().split('-')[0]] ??
    sourceLanguage;
  return `原文（${language}）`;
};

export const getAvailableReaderModes = (): ReaderMode[] => [...readerModes];

export const getReaderDisplayTitle = (
  entry: { title: string; translatedTitle?: string },
  mode: ReaderMode,
) =>
  mode === 'translated' || mode === 'translated-original'
    ? entry.translatedTitle?.trim() || entry.title
    : entry.title;

export const resolveReaderMode = ({
  temporaryMode,
  preference,
  settings,
}: {
  temporaryMode?: SelectableReaderMode;
  preference?: ReaderBookPreference;
  settings: ReaderSettingsRecord;
  capabilities: BookReadingCapabilities;
}): ReaderMode => {
  return temporaryMode ?? preference?.preferredMode ?? settings.defaultMode;
};
