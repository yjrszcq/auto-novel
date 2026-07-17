import type { TranslatorId } from '@/model/Translator';
import { useLocalStorage } from '@/util';
import { LSKey } from './key';

export interface Setting {
  theme: 'light' | 'dark' | 'system';
  enabledTranslator: TranslatorId[];
  tocSortReverse: boolean;
  //
  tocCollapseInNarrowScreen: boolean;
  tocExpandAll: boolean;
  hideCommmentWebNovel: boolean;
  hideCommmentWenkuNovel: boolean;
  showTagInWebFavored: boolean;
  favoriteCreateTimeFirst: boolean;
  //
  autoTopJobWhenAddTask: boolean;
  //
  menuCollapsed: boolean;
  //
  downloadFilenameType: 'jp' | 'zh';
  downloadFormat: {
    mode: 'zh' | 'zh-jp' | 'jp-zh';
    translationsMode: 'parallel' | 'priority';
    translations: TranslatorId[];
    type: 'epub' | 'txt';
  };
  workspaceSound: boolean;
  paginationMode: 'pagination' | 'scroll';
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
    enabledTranslator: ['baidu', 'youdao', 'gpt', 'sakura'],
    tocSortReverse: false,
    //
    tocCollapseInNarrowScreen: true,
    tocExpandAll: true,
    hideCommmentWebNovel: false,
    hideCommmentWenkuNovel: false,
    showTagInWebFavored: false,
    favoriteCreateTimeFirst: false,
    //
    autoTopJobWhenAddTask: false,
    //
    menuCollapsed: false,
    //
    downloadFilenameType: 'zh',
    downloadFormat: {
      mode: 'zh-jp',
      translationsMode: 'priority',
      translations: ['sakura', 'gpt', 'youdao', 'baidu'],
      type: 'epub',
    },
    workspaceSound: false,
    paginationMode: 'pagination',
    localVolumeOrder: {
      value: 'byCreateAt',
      desc: true,
    },
    homeDownloadMode: 'zh',
    homeDownloadPriority: 'gpt',
    embedMetadataInOriginalDownload: false,
    embedMetadataInTranslatedDownload: false,
  };

  export const migrate = (setting: Setting) => {
    if ('isDark' in setting && typeof setting.isDark !== undefined) {
      if (setting.isDark === true) {
        setting.theme = 'dark';
      }
      delete setting.isDark;
    }
    if (setting.enabledTranslator === undefined) {
      setting.enabledTranslator = ['baidu', 'youdao', 'gpt', 'sakura'];
    }
    if ((setting.downloadFormat.mode as string) === 'mix') {
      setting.downloadFormat.mode = 'zh-jp';
    } else if ((setting.downloadFormat.mode as string) === 'mix-reverse') {
      setting.downloadFormat.mode = 'jp-zh';
    } else if ((setting.downloadFormat.mode as string) === 'jp') {
      setting.downloadFormat.mode = 'zh';
    }
    // 2024-03-05
    if (setting.workspaceSound === undefined) {
      setting.workspaceSound = false;
    }
    // 2024-05-28
    if ((setting.paginationMode as unknown) === 'auto') {
      setting.paginationMode = 'pagination';
    }
    if (setting.homeDownloadMode === undefined) {
      setting.homeDownloadMode = 'zh';
    }
    if (setting.homeDownloadPriority === undefined) {
      setting.homeDownloadPriority = 'gpt';
    }
    if (setting.embedMetadataInOriginalDownload === undefined) {
      setting.embedMetadataInOriginalDownload = false;
    }
    if (setting.embedMetadataInTranslatedDownload === undefined) {
      setting.embedMetadataInTranslatedDownload = false;
    }
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
  Setting.migrate(setting.value);

  return { setting };
});
