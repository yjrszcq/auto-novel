import { beforeAll, describe, expect, it, vi } from 'vitest';

let Setting: typeof import('../src/stores/useSettingStore').Setting;

beforeAll(async () => {
  vi.stubGlobal('Audio', class {});
  Setting = (await import('../src/stores/useSettingStore')).Setting;
});

describe('download metadata settings', () => {
  it('keeps both global EPUB metadata embedding switches disabled by default', () => {
    expect(Setting.defaultValue.embedMetadataInOriginalDownload).toBe(false);
    expect(Setting.defaultValue.embedMetadataInTranslatedDownload).toBe(false);
  });
});
