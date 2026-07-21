import type { LocalDownloadMode } from '@/model/LocalVolume';
import type { TranslatorId } from '@/model/Translator';
import type { TranslatorConfig } from '@/domain/translate';
import { useLocalStorage } from '@/util';
import { LSKey } from './key';

export interface Setting {
  theme: 'light' | 'dark' | 'system';
  autoTopJobWhenAddTask: boolean;
  menuCollapsed: boolean;
  downloadFormat: {
    mode: LocalDownloadMode;
    translationsMode: 'parallel' | 'priority';
    translations: TranslatorId[];
  };
  workspaceSound: boolean;
  localVolumeOrder: {
    value: 'byCreateAt' | 'byId';
    desc: boolean;
  };
  homeDownloadMode: LocalDownloadMode;
  homeDownloadPriority: 'gpt' | 'sakura';
  languageDetectionConfidencePercent?: number;
  embedMetadataInOriginalDownload: boolean;
  embedMetadataInTranslatedDownload: boolean;
  translationApi: {
    baidu: {
      appId: string;
      secretKey: string;
    };
    youdao: {
      appKey: string;
      appSecret: string;
    };
  };
}

export namespace Setting {
  export const defaultLanguageDetectionConfidencePercent = 95;
  export const defaultValue: Setting = {
    theme: 'system',
    autoTopJobWhenAddTask: false,
    menuCollapsed: false,
    downloadFormat: {
      mode: 'zh-jp',
      translationsMode: 'priority',
      translations: ['sakura', 'gpt', 'youdao', 'baidu'],
    },
    workspaceSound: false,
    localVolumeOrder: {
      value: 'byCreateAt',
      desc: true,
    },
    homeDownloadMode: 'zh',
    homeDownloadPriority: 'gpt',
    languageDetectionConfidencePercent:
      defaultLanguageDetectionConfidencePercent,
    embedMetadataInOriginalDownload: false,
    embedMetadataInTranslatedDownload: false,
    translationApi: {
      baidu: {
        appId: '',
        secretKey: '',
      },
      youdao: {
        appKey: '',
        appSecret: '',
      },
    },
  };

  export const downloadModeOptions = [
    { label: '中文', value: 'zh' },
    { label: '中日', value: 'zh-jp' },
    { label: '日中', value: 'jp-zh' },
    { label: '原文', value: 'jp' },
  ];
  export const themeOptions = [
    { label: '亮色主题', value: 'light' },
    { label: '暗色主题', value: 'dark' },
    { label: '跟随系统', value: 'system' },
  ];
  export const localVolumeOrderOptions = [
    { value: 'byCreateAt', label: '添加时间' },
    { value: 'byId', label: '标题' },
  ];
  export const homeDownloadPriorityOptions = [
    { label: 'GPT', value: 'gpt' },
    { label: 'Sakura', value: 'sakura' },
  ];
  export const normalizeLanguageDetectionConfidencePercent = (
    value: number | null | undefined,
  ) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.min(100, Math.max(0, Math.round(value)))
      : defaultLanguageDetectionConfidencePercent;

  export const normalize = (value: Partial<Setting>): Setting => ({
    ...defaultValue,
    ...value,
    downloadFormat: {
      ...defaultValue.downloadFormat,
      ...value.downloadFormat,
    },
    localVolumeOrder: {
      ...defaultValue.localVolumeOrder,
      ...value.localVolumeOrder,
    },
    translationApi: {
      baidu: {
        ...defaultValue.translationApi.baidu,
        ...value.translationApi?.baidu,
      },
      youdao: {
        ...defaultValue.translationApi.youdao,
        ...value.translationApi?.youdao,
      },
    },
  });

  export const translatorConfig = (
    setting: Setting,
    id: 'baidu' | 'youdao',
  ): TranslatorConfig | undefined => {
    if (id === 'baidu') {
      const appId = setting.translationApi.baidu.appId.trim();
      const secretKey = setting.translationApi.baidu.secretKey.trim();
      return appId && secretKey ? { id, appId, secretKey } : undefined;
    }
    const appKey = setting.translationApi.youdao.appKey.trim();
    const appSecret = setting.translationApi.youdao.appSecret.trim();
    return appKey && appSecret ? { id, appKey, appSecret } : undefined;
  };
}

export const useSettingStore = defineStore(LSKey.Setting, () => {
  const setting = useLocalStorage<Setting>(LSKey.Setting, Setting.defaultValue);
  setting.value = Setting.normalize(setting.value);

  return { setting };
});
