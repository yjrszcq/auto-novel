import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('Audio', class {});
});

import { Setting } from '../src/stores/useSettingStore';

describe('download metadata settings', () => {
  it('keeps both global EPUB metadata embedding switches disabled by default', () => {
    expect(Setting.defaultValue.embedMetadataInOriginalDownload).toBe(false);
    expect(Setting.defaultValue.embedMetadataInTranslatedDownload).toBe(false);
  });

  it('defaults and normalizes the language detection threshold', () => {
    expect(Setting.defaultValue.languageDetectionConfidencePercent).toBe(95);
    expect(Setting.normalizeLanguageDetectionConfidencePercent(undefined)).toBe(
      95,
    );
    expect(Setting.normalizeLanguageDetectionConfidencePercent(95.4)).toBe(95);
    expect(Setting.normalizeLanguageDetectionConfidencePercent(120)).toBe(100);
  });
});
