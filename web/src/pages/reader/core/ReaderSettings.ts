import type {
  ReaderBookStyleOverride,
  ReaderSettingsRecord,
} from '@/model/Reader';

export const defaultReaderSettings: ReaderSettingsRecord = {
  id: 'default',
  defaultMode: 'translated',
  translationPriority: ['gpt', 'sakura', 'youdao', 'baidu'],
  fontSize: 18,
  lineHeight: 1.9,
  contentWidth: 840,
  horizontalPadding: 24,
  theme: 'system',
  flow: 'auto',
  updatedAt: 0,
};

export const normalizeReaderSettings = (
  value: Partial<ReaderSettingsRecord> | undefined,
): ReaderSettingsRecord => ({
  ...defaultReaderSettings,
  ...value,
  id: 'default',
  defaultMode:
    value?.defaultMode === 'ask'
      ? defaultReaderSettings.defaultMode
      : value?.defaultMode ?? defaultReaderSettings.defaultMode,
  fontSize: Math.max(12, Math.min(value?.fontSize ?? 18, 32)),
  lineHeight: Math.max(1.2, Math.min(value?.lineHeight ?? 1.9, 2.8)),
  contentWidth: Math.max(480, Math.min(value?.contentWidth ?? 840, 1200)),
  horizontalPadding: Math.max(12, Math.min(value?.horizontalPadding ?? 24, 64)),
  theme: value?.theme ?? 'system',
  flow:
    value?.flow === 'paginated' || value?.flow === 'scrolled'
      ? value.flow
      : 'auto',
});

export const serializeReaderSettings = (
  value: ReaderSettingsRecord,
): ReaderSettingsRecord => ({
  ...value,
  translationPriority: [...value.translationPriority],
});

export const applyReaderStyleOverride = (
  settings: ReaderSettingsRecord,
  override: ReaderBookStyleOverride | undefined,
): ReaderSettingsRecord => ({
  ...settings,
  fontSize: override?.fontSize ?? settings.fontSize,
  lineHeight: override?.lineHeight ?? settings.lineHeight,
  contentWidth: override?.contentWidth ?? settings.contentWidth,
  horizontalPadding: override?.horizontalPadding ?? settings.horizontalPadding,
  theme: override?.theme ?? settings.theme,
});
