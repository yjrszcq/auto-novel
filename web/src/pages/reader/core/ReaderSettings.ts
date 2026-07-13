import type { ReaderSettingsRecord } from '@/model/Reader';

export const defaultReaderSettings: ReaderSettingsRecord = {
  id: 'default',
  defaultMode: 'ask',
  translationPriority: ['gpt', 'sakura', 'youdao', 'baidu'],
  fontSize: 18,
  lineHeight: 1.9,
  contentWidth: 840,
  horizontalPadding: 24,
  theme: 'system',
  updatedAt: 0,
};

export const normalizeReaderSettings = (
  value: Partial<ReaderSettingsRecord> | undefined,
): ReaderSettingsRecord => ({
  ...defaultReaderSettings,
  ...value,
  id: 'default',
  fontSize: Math.max(12, Math.min(value?.fontSize ?? 18, 32)),
  lineHeight: Math.max(1.2, Math.min(value?.lineHeight ?? 1.9, 2.8)),
  contentWidth: Math.max(480, Math.min(value?.contentWidth ?? 840, 1200)),
  horizontalPadding: Math.max(12, Math.min(value?.horizontalPadding ?? 24, 64)),
  theme: value?.theme ?? 'system',
});
