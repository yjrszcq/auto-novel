import type {
  ReaderBookStyleOverride,
  ReaderRetranslationPolicy,
  ReaderSettingsRecord,
} from '@/model/Reader';

export const defaultReaderSettings: ReaderSettingsRecord = {
  id: 'default',
  defaultMode: 'translated',
  translationPriority: ['gpt', 'sakura', 'youdao', 'baidu'],
  autoTranslationPreloadPages: 3,
  retranslationPolicy: 'ask',
  chineseScript: 'none',
  fontSize: 18,
  lineHeight: 1.9,
  contentWidth: 840,
  horizontalPadding: 24,
  theme: 'system',
  flow: 'auto',
  updatedAt: 0,
};

export const normalizeReaderAutoTranslationPreloadPages = (
  value: number | null | undefined,
) =>
  Math.max(
    0,
    Math.min(
      Number.isFinite(value)
        ? Math.floor(value!)
        : defaultReaderSettings.autoTranslationPreloadPages,
      20,
    ),
  );

export const normalizeReaderRetranslationPolicy = (
  value: ReaderRetranslationPolicy | undefined,
): ReaderRetranslationPolicy =>
  value === 'replace' || value === 'keep' ? value : 'ask';

export const normalizeReaderChineseScript = (
  value: ReaderSettingsRecord['chineseScript'] | undefined,
): ReaderSettingsRecord['chineseScript'] =>
  value === 'simplified' || value === 'traditional' ? value : 'none';

export const normalizeReaderSettings = (
  value: Partial<ReaderSettingsRecord> | undefined,
): ReaderSettingsRecord => ({
  ...defaultReaderSettings,
  ...value,
  id: 'default',
  defaultMode: value?.defaultMode ?? defaultReaderSettings.defaultMode,
  autoTranslationPreloadPages: normalizeReaderAutoTranslationPreloadPages(
    value?.autoTranslationPreloadPages,
  ),
  retranslationPolicy: normalizeReaderRetranslationPolicy(
    value?.retranslationPolicy,
  ),
  chineseScript: normalizeReaderChineseScript(value?.chineseScript),
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
