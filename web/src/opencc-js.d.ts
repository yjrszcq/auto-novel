type OpenCcDictionary = string | string[][];
type OpenCcDictionaryGroup = OpenCcDictionary[];

declare module 'opencc-js/core' {
  export function ConverterFactory(
    ...dictionaryGroups: OpenCcDictionaryGroup[]
  ): (text: string) => string;
}

declare module 'opencc-js/from/cn' {
  const dictionaries: OpenCcDictionaryGroup;
  export default dictionaries;
}

declare module 'opencc-js/to/tw' {
  const dictionaries: OpenCcDictionaryGroup;
  export default dictionaries;
}

declare module 'opencc-js/from/tw' {
  const dictionaries: OpenCcDictionaryGroup;
  export default dictionaries;
}

declare module 'opencc-js/to/cn' {
  const dictionaries: OpenCcDictionaryGroup;
  export default dictionaries;
}
