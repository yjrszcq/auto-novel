import { MD5 } from 'crypto-es';
import type { Options } from 'ky';
import ky from 'ky';

const endpoint = 'https://fanyi-api.baidu.com/api/trans/vip/translate';

export interface BaiduTranslateConfig {
  appId: string;
  secretKey: string;
}

type BaiduTranslateResponse = {
  from?: string;
  to?: string;
  trans_result?: { src: string; dst: string }[];
  error_code?: string;
  error_msg?: string;
};

export const buildBaiduTranslateParams = (
  query: string,
  from: string,
  config: BaiduTranslateConfig,
  salt = Date.now().toString(),
) => ({
  q: query,
  from,
  to: 'zh',
  appid: config.appId,
  salt,
  sign: MD5(`${config.appId}${query}${salt}${config.secretKey}`).toString(),
});

const translate = async (
  query: string,
  from: string,
  config: BaiduTranslateConfig,
  options?: Options,
) => {
  const client = window.Addon
    ? ky.create({ fetch: window.Addon.fetch.bind(window.Addon) })
    : ky;
  const response = await client
    .post(endpoint, {
      body: new URLSearchParams(buildBaiduTranslateParams(query, from, config)),
      retry: 0,
      ...options,
    })
    .json<BaiduTranslateResponse>();
  if (
    response.error_code !== undefined ||
    response.trans_result === undefined
  ) {
    throw new Error(
      `百度翻译错误 ${response.error_code ?? 'unknown'}：${response.error_msg ?? '响应格式错误'}`,
    );
  }
  return response.trans_result.map(({ dst }) => dst);
};

export const BaiduApi = {
  translate,
};
