import type { TranslatorId } from '@/model/Translator';
import { useLocalStorage } from '@/util';
import { LSKey } from './key';

export interface Setting {
  theme: 'light' | 'dark' | 'system';
  autoTopJobWhenAddTask: boolean;
  menuCollapsed: boolean;
  downloadFormat: {
    mode: 'zh' | 'zh-jp' | 'jp-zh';
    translationsMode: 'parallel' | 'priority';
    translations: TranslatorId[];
  };
  workspaceSound: boolean;
  localVolumeOrder: {
    value: 'byCreateAt' | 'byId';
    desc: boolean;
  };
  homeDownloadMode: 'zh' | 'zh-jp' | 'jp-zh';
  homeDownloadPriority: 'gpt' | 'sakura';
  embedMetadataInOriginalDownload: boolean;
  embedMetadataInTranslatedDownload: boolean;
}

export namespace Setting {
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
    embedMetadataInOriginalDownload: false,
    embedMetadataInTranslatedDownload: false,
  };

  export const downloadModeOptions = [
    { label: '中文', value: 'zh' },
    { label: '中日', value: 'zh-jp' },
    { label: '日中', value: 'jp-zh' },
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
}

export const useSettingStore = defineStore(LSKey.Setting, () => {
  const setting = useLocalStorage<Setting>(LSKey.Setting, Setting.defaultValue);

  return { setting };
});
