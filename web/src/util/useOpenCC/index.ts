type Locale = 'zh-cn' | 'zh-tw';

type Converter = {
  toView: (text: string) => string;
  toData: (text: string) => string;
};

export const defaultConverter: Converter = {
  toView: (text: string) => text,
  toData: (text: string) => text,
};

export async function useOpenCC(locale: Locale) {
  if (locale === 'zh-cn') {
    return defaultConverter;
  } else if (locale === 'zh-tw') {
    const [opencc, fromCn, toTw, fromTw, toCn] = await Promise.all([
      import('opencc-js/core'),
      import('opencc-js/from/cn'),
      import('opencc-js/to/tw'),
      import('opencc-js/from/tw'),
      import('opencc-js/to/cn'),
    ]);
    const customDict = [
      ['託', '托'],
      ['孃', '娘'],
    ];
    return {
      toView: opencc.ConverterFactory(fromCn.default, toTw.default, [
        customDict,
      ]),
      toData: opencc.ConverterFactory(fromTw.default, toCn.default),
    };
  }
  return locale satisfies never;
}
