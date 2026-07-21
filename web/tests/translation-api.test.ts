import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('Audio', class {});
});

import {
  buildBaiduTranslateParams,
  buildYoudaoTranslateParams,
} from '../src/api';
import { Setting } from '../src/stores/useSettingStore';

describe('translation API settings', () => {
  it('migrates settings saved before translation credentials existed', () => {
    const normalized = Setting.normalize({ theme: 'dark' });

    expect(normalized.theme).toBe('dark');
    expect(normalized.translationApi).toEqual({
      baidu: { appId: '', secretKey: '' },
      youdao: { appKey: '', appSecret: '' },
    });
  });

  it('only creates provider configs when both credentials are present', () => {
    const setting = Setting.normalize({
      translationApi: {
        baidu: { appId: ' app-id ', secretKey: ' secret-key ' },
        youdao: { appKey: '', appSecret: 'secret' },
      },
    });

    expect(Setting.translatorConfig(setting, 'baidu')).toEqual({
      id: 'baidu',
      appId: 'app-id',
      secretKey: 'secret-key',
    });
    expect(Setting.translatorConfig(setting, 'youdao')).toBeUndefined();
  });

  it('builds the Baidu official API signature', () => {
    expect(
      buildBaiduTranslateParams(
        '测试文本',
        'jp',
        { appId: 'app123', secretKey: 'secret789' },
        'salt456',
      ),
    ).toEqual({
      q: '测试文本',
      from: 'jp',
      to: 'zh',
      appid: 'app123',
      salt: 'salt456',
      sign: 'e5a5cc897df44d528626dccb12d51e3a',
    });
  });

  it('builds the Youdao v3 signature with long-query truncation', () => {
    expect(
      buildYoudaoTranslateParams(
        '这是一个超过二十个字符的测试文本内容用于验证签名截断规则',
        'ja',
        { appKey: 'key123', appSecret: 'secret789' },
        'salt456',
        '1700000000',
      ),
    ).toEqual({
      q: '这是一个超过二十个字符的测试文本内容用于验证签名截断规则',
      from: 'ja',
      to: 'zh-CHS',
      appKey: 'key123',
      salt: 'salt456',
      sign: '7454b27051ecbe7259464eeab922709ad6a7cee4edaf32d4341578ae5e9538b2',
      signType: 'v3',
      curtime: '1700000000',
    });
  });
});
