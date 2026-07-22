import type {
  ReaderBookStyleOverride,
  ReaderRetranslationPolicy,
  ReaderSettingsRecord,
} from '@/model/Reader';

export const defaultReaderSettings: ReaderSettingsRecord = {
  id: 'default',
  defaultMode: 'translated',
  translationPriority: ['gpt', 'sakura', 'youdao', 'baidu'],
  autoTranslationPreloadParagraphs: 60,
  autoTranslationChunkParagraphs: 5,
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

export const normalizeReaderAutoTranslationPreloadParagraphs = (
  value: number | null | undefined,
) =>
  Math.max(
    0,
    Math.min(
      Number.isFinite(value)
        ? Math.floor(value!)
        : defaultReaderSettings.autoTranslationPreloadParagraphs,
      1_000,
    ),
  );

export const normalizeReaderAutoTranslationChunkParagraphs = (
  value: number | null | undefined,
) =>
  Math.max(
    1,
    Math.min(
      Number.isFinite(value)
        ? Math.floor(value!)
        : defaultReaderSettings.autoTranslationChunkParagraphs,
      50,
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

type LegacyReaderSettings = Partial<ReaderSettingsRecord> & {
  autoTranslationPreloadPages?: number;
};

export const normalizeReaderSettings = (
  value: LegacyReaderSettings | undefined,
): ReaderSettingsRecord => {
  const legacyPreloadParagraphs =
    value?.autoTranslationPreloadPages === undefined
      ? undefined
      : value.autoTranslationPreloadPages * 20;
  return {
    ...defaultReaderSettings,
    ...value,
    id: 'default',
    defaultMode: value?.defaultMode ?? defaultReaderSettings.defaultMode,
    autoTranslationPreloadParagraphs:
      normalizeReaderAutoTranslationPreloadParagraphs(
        value?.autoTranslationPreloadParagraphs ?? legacyPreloadParagraphs,
      ),
    autoTranslationChunkParagraphs:
      normalizeReaderAutoTranslationChunkParagraphs(
        value?.autoTranslationChunkParagraphs,
      ),
    retranslationPolicy: normalizeReaderRetranslationPolicy(
      value?.retranslationPolicy,
    ),
    chineseScript: normalizeReaderChineseScript(value?.chineseScript),
    fontSize: Math.max(12, Math.min(value?.fontSize ?? 18, 32)),
    lineHeight: Math.max(1.2, Math.min(value?.lineHeight ?? 1.9, 2.8)),
    contentWidth: Math.max(480, Math.min(value?.contentWidth ?? 840, 1200)),
    horizontalPadding: Math.max(
      12,
      Math.min(value?.horizontalPadding ?? 24, 64),
    ),
    theme: value?.theme ?? 'system',
    flow:
      value?.flow === 'paginated' || value?.flow === 'scrolled'
        ? value.flow
        : 'auto',
  };
};

export const serializeReaderSettings = (
  value: ReaderSettingsRecord,
): ReaderSettingsRecord => {
  const serialized = {
    ...value,
    translationPriority: [...value.translationPriority],
  };
  delete (serialized as LegacyReaderSettings).autoTranslationPreloadPages;
  return serialized;
};

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
