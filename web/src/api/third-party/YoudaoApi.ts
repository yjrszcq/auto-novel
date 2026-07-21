import { SHA256 } from 'crypto-es';
import type { Options } from 'ky';
import ky from 'ky';

const endpoint = 'https://openapi.youdao.com/api';

export interface YoudaoTranslateConfig {
  appKey: string;
  appSecret: string;
}

type YoudaoTranslateResponse = {
  errorCode?: string;
  translation?: string[];
};

const truncateForSign = (query: string) =>
  query.length <= 20
    ? query
    : `${query.slice(0, 10)}${query.length}${query.slice(-10)}`;

export const buildYoudaoTranslateParams = (
  query: string,
  from: string,
  config: YoudaoTranslateConfig,
  salt = crypto.randomUUID(),
  curtime = Math.floor(Date.now() / 1000).toString(),
) => ({
  q: query,
  from,
  to: 'zh-CHS',
  appKey: config.appKey,
  salt,
  sign: SHA256(
    `${config.appKey}${truncateForSign(query)}${salt}${curtime}${config.appSecret}`,
  ).toString(),
  signType: 'v3',
  curtime,
});

const translate = async (
  query: string,
  from: string,
  config: YoudaoTranslateConfig,
  options?: Options,
) => {
  const client = window.Addon
    ? ky.create({ fetch: window.Addon.fetch.bind(window.Addon) })
    : ky;
  const response = await client
    .post(endpoint, {
      body: new URLSearchParams(
        buildYoudaoTranslateParams(query, from, config),
      ),
      retry: 0,
      ...options,
    })
    .json<YoudaoTranslateResponse>();
  if (response.errorCode !== '0' || response.translation === undefined) {
    throw new Error(`有道翻译错误 ${response.errorCode ?? 'unknown'}`);
  }
  return response.translation;
};

export const YoudaoApi = {
  translate,
};
