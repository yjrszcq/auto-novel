import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { Setting as AppSetting } from '../src/stores/useSettingStore';

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

  it('migrates settings saved before the embedding switches existed', () => {
    const legacy = structuredClone(Setting.defaultValue) as Partial<AppSetting>;
    delete legacy.embedMetadataInOriginalDownload;
    delete legacy.embedMetadataInTranslatedDownload;

    Setting.migrate(legacy as AppSetting);

    expect(legacy.embedMetadataInOriginalDownload).toBe(false);
    expect(legacy.embedMetadataInTranslatedDownload).toBe(false);
  });
});
