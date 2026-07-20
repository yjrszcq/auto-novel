import type { TxtSourceLine } from '../../model/TxtCatalog';

export type TxtHeadingKind =
  'volume' | 'chapter' | 'section' | 'special' | 'markdown';

export interface TxtHeadingRuleMatch {
  lineIndex: number;
  title: string;
  kind: TxtHeadingKind;
  level: number;
  rule: string;
  locale: 'zh' | 'ja' | 'en' | 'markdown';
  confidence: number;
  signature: string;
  numberToken?: string;
  numberValue?: number;
}

const OUTER_DECORATION =
  /^[\s\[\]【】「」『』《》〈〉（）()〔〕〖〗〘〙〚〛★☆◆◇■□●○◎*_=~～·•・―—–-]+|[\s\[\]【】「」『』《》〈〉（）()〔〕〖〗〘〙〚〛★☆◆◇■□●○◎*_=~～·•・―—–-]+$/g;

export const stripTxtHeadingDecoration = (text: string) =>
  text.replaceAll(OUTER_DECORATION, '').trim();

const CJK_DIGIT =
  '[〇零一二两兩三四五六七八九十百千万萬壹贰貳叁參肆伍陆陸柒捌玖拾佰仟]+';
const ARABIC_DIGIT = '[0-9]+';
const ROMAN_DIGIT = '[IVXLCDMivxlcdm]+';
const ENGLISH_NUMBER_WORD =
  '(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth|fortieth|fiftieth|sixtieth|seventieth|eightieth|ninetieth)';
const NUMBER_TOKEN = `(?:${ARABIC_DIGIT}|${CJK_DIGIT}|${ROMAN_DIGIT}|${ENGLISH_NUMBER_WORD}(?:[- ]${ENGLISH_NUMBER_WORD})*)`;

const CJK_VALUES: Readonly<Record<string, number>> = {
  零: 0,
  〇: 0,
  一: 1,
  壹: 1,
  二: 2,
  两: 2,
  兩: 2,
  贰: 2,
  貳: 2,
  三: 3,
  叁: 3,
  參: 3,
  四: 4,
  肆: 4,
  五: 5,
  伍: 5,
  六: 6,
  陆: 6,
  陸: 6,
  七: 7,
  柒: 7,
  八: 8,
  捌: 8,
  九: 9,
  玖: 9,
};

const CJK_UNITS: Readonly<Record<string, number>> = {
  十: 10,
  拾: 10,
  百: 100,
  佰: 100,
  千: 1_000,
  仟: 1_000,
  万: 10_000,
  萬: 10_000,
};

const ENGLISH_VALUES: Readonly<Record<string, number>> = {
  zero: 0,
  one: 1,
  first: 1,
  two: 2,
  second: 2,
  three: 3,
  third: 3,
  four: 4,
  fourth: 4,
  five: 5,
  fifth: 5,
  six: 6,
  sixth: 6,
  seven: 7,
  seventh: 7,
  eight: 8,
  eighth: 8,
  nine: 9,
  ninth: 9,
  ten: 10,
  tenth: 10,
  eleven: 11,
  eleventh: 11,
  twelve: 12,
  twelfth: 12,
  thirteen: 13,
  thirteenth: 13,
  fourteen: 14,
  fourteenth: 14,
  fifteen: 15,
  fifteenth: 15,
  sixteen: 16,
  sixteenth: 16,
  seventeen: 17,
  seventeenth: 17,
  eighteen: 18,
  eighteenth: 18,
  nineteen: 19,
  nineteenth: 19,
  twenty: 20,
  twentieth: 20,
  thirty: 30,
  thirtieth: 30,
  forty: 40,
  fortieth: 40,
  fifty: 50,
  fiftieth: 50,
  sixty: 60,
  sixtieth: 60,
  seventy: 70,
  seventieth: 70,
  eighty: 80,
  eightieth: 80,
  ninety: 90,
  ninetieth: 90,
};

const parseCjkNumber = (token: string) => {
  if (!Object.keys(CJK_UNITS).some((unit) => token.includes(unit))) {
    let digits = '';
    for (const character of token) {
      const value = CJK_VALUES[character];
      if (value === undefined) return undefined;
      digits += String(value);
    }
    return digits.length > 0 ? Number(digits) : undefined;
  }
  let total = 0;
  let section = 0;
  let digit = 0;
  for (const character of token) {
    const value = CJK_VALUES[character];
    if (value !== undefined) {
      digit = value;
      continue;
    }
    const unit = CJK_UNITS[character];
    if (unit === undefined) return undefined;
    if (unit === 10_000) {
      section = (section + digit) * unit;
      total += section;
      section = 0;
    } else {
      section += (digit || 1) * unit;
    }
    digit = 0;
  }
  return total + section + digit;
};

const parseRomanNumber = (token: string) => {
  if (!/^[IVXLCDM]+$/i.test(token)) return undefined;
  const values: Readonly<Record<string, number>> = {
    I: 1,
    V: 5,
    X: 10,
    L: 50,
    C: 100,
    D: 500,
    M: 1_000,
  };
  let total = 0;
  let previous = 0;
  for (const character of [...token.toUpperCase()].reverse()) {
    const value = values[character];
    if (value === undefined) return undefined;
    if (value < previous) total -= value;
    else {
      total += value;
      previous = value;
    }
  }
  const canonical = (value: number) => {
    const table: readonly [number, string][] = [
      [1_000, 'M'],
      [900, 'CM'],
      [500, 'D'],
      [400, 'CD'],
      [100, 'C'],
      [90, 'XC'],
      [50, 'L'],
      [40, 'XL'],
      [10, 'X'],
      [9, 'IX'],
      [5, 'V'],
      [4, 'IV'],
      [1, 'I'],
    ];
    let remaining = value;
    let result = '';
    for (const [amount, symbol] of table) {
      while (remaining >= amount) {
        result += symbol;
        remaining -= amount;
      }
    }
    return result;
  };
  return total > 0 && total <= 3_999 && canonical(total) === token.toUpperCase()
    ? total
    : undefined;
};

const parseEnglishNumber = (token: string) => {
  const words = token.toLowerCase().split(/[- ]+/);
  let total = 0;
  let current = 0;
  for (const word of words) {
    if (word === 'hundred') {
      current = Math.max(current, 1) * 100;
    } else if (word === 'thousand') {
      total += Math.max(current, 1) * 1_000;
      current = 0;
    } else {
      const value = ENGLISH_VALUES[word];
      if (value === undefined) return undefined;
      current += value;
    }
  }
  return total + current;
};

export const parseTxtHeadingNumber = (token: string) => {
  if (/^[0-9]+$/.test(token)) return Number(token);
  if (new RegExp(`^${CJK_DIGIT}$`).test(token)) return parseCjkNumber(token);
  return parseRomanNumber(token) ?? parseEnglishNumber(token);
};

const match = (
  line: TxtSourceLine,
  pattern: RegExp,
  options: {
    kind: TxtHeadingKind;
    level: number;
    rule: string;
    locale: TxtHeadingRuleMatch['locale'];
    unitGroup?: number;
    numberGroup?: number;
    confidence?: number;
  },
): TxtHeadingRuleMatch | undefined => {
  const cleaned = stripTxtHeadingDecoration(line.normalized);
  const result = cleaned.match(pattern);
  if (result === null) return undefined;
  const numberToken =
    options.numberGroup === undefined ? undefined : result[options.numberGroup];
  const unit =
    options.unitGroup === undefined ? options.kind : result[options.unitGroup];
  return {
    lineIndex: line.lineIndex,
    title: cleaned,
    kind: options.kind,
    level: options.level,
    rule: options.rule,
    locale: options.locale,
    confidence: options.confidence ?? 0.88,
    signature: `${options.locale}:${options.kind}:${String(unit).toLowerCase()}`,
    numberToken,
    numberValue:
      numberToken === undefined
        ? undefined
        : parseTxtHeadingNumber(numberToken),
  };
};

const MARKDOWN_PATTERN = /^(#{1,6})\s+(.+)$/;
const CHINESE_PATTERN = new RegExp(
  `^第?\\s*(${NUMBER_TOKEN})\\s*(卷|部|篇|集|章|回|节|話|话|幕)(?:\\s*[:：.、·_~～—-]?\\s*(.*))?$`,
  'i',
);
const CHINESE_REVERSED_PATTERN = new RegExp(
  `^(卷|部|篇|集|章|回|节|話|话|幕)\\s*(${NUMBER_TOKEN})(?:\\s*[:：.、·_~～—-]?\\s*(.*))?$`,
  'i',
);
const JAPANESE_PATTERN = new RegExp(
  `^第?\\s*(${NUMBER_TOKEN})\\s*(巻|部|章|話|节|節|幕)(?:\\s*[:：.、·_~～—-]?\\s*(.*))?$`,
  'i',
);
const ENGLISH_PATTERN = new RegExp(
  `^(Book|Volume|Vol\\.?|Part|Chapter|Ch\\.?|Section|Episode|Ep\\.?|Act)\\s+(${NUMBER_TOKEN})(?=\\s|[:：.、·_~～—-]|$)(?:\\s*[:：.、·_~～—-]?\\s*(.*))?$`,
  'i',
);
const CHINESE_SPECIAL_PATTERN =
  /^(序章|序言|前言|楔子|引子|番外|外传|终章|終章|尾声|尾聲|后记|後記|附录|附錄)(?:\s+.*|\s*[:：.、·_~～—-]\s*.*)?$/;
const JAPANESE_SPECIAL_PATTERN =
  /^(プロローグ|エピローグ|幕間|閑話|前書き|後書き|序章|終章)(?:\s+.*|\s*[:：.、·_~～—-]\s*.*)?$/i;
const ENGLISH_SPECIAL_PATTERN =
  /^(Prologue|Epilogue|Interlude|Side\s+Story|Afterword|Foreword|Preface|Appendix)(?:\s*[:：.、·_~～—-]\s*.*)?$/i;

const levelForUnit = (unit: string) => {
  const normalized = unit.toLowerCase().replace('.', '');
  if (
    ['卷', '部', '篇', '集', '巻', 'book', 'volume', 'vol', 'part'].includes(
      normalized,
    )
  ) {
    return { kind: 'volume' as const, level: 1 };
  }
  if (['节', '節', 'section'].includes(normalized)) {
    return { kind: 'section' as const, level: 3 };
  }
  return { kind: 'chapter' as const, level: 2 };
};

export const matchTxtHeadingRule = (
  line: TxtSourceLine,
): TxtHeadingRuleMatch | undefined => {
  if (line.normalized.length === 0) return undefined;

  const markdown = line.normalized.match(MARKDOWN_PATTERN);
  if (markdown !== null) {
    const hashes = markdown[1] ?? '#';
    return {
      lineIndex: line.lineIndex,
      title: markdown[2]?.trim() ?? line.normalized,
      kind: 'markdown',
      level: hashes.length,
      rule: 'markdown-heading',
      locale: 'markdown',
      confidence: 0.98,
      signature: `markdown:h${hashes.length}`,
    };
  }

  const cleaned = stripTxtHeadingDecoration(line.normalized);
  const numberedPatterns = [
    {
      pattern: CHINESE_PATTERN,
      locale: 'zh' as const,
      rule: 'zh-numbered-heading',
      unitGroup: 2,
      numberGroup: 1,
    },
    {
      pattern: CHINESE_REVERSED_PATTERN,
      locale: 'zh' as const,
      rule: 'zh-reversed-numbered-heading',
      unitGroup: 1,
      numberGroup: 2,
    },
    {
      pattern: JAPANESE_PATTERN,
      locale: 'ja' as const,
      rule: 'ja-numbered-heading',
      unitGroup: 2,
      numberGroup: 1,
    },
    {
      pattern: ENGLISH_PATTERN,
      locale: 'en' as const,
      rule: 'en-numbered-heading',
      unitGroup: 1,
      numberGroup: 2,
    },
  ];
  for (const definition of numberedPatterns) {
    const result = cleaned.match(definition.pattern);
    const unit = result?.[definition.unitGroup];
    if (unit === undefined) continue;
    const hierarchy = levelForUnit(unit);
    return match(line, definition.pattern, {
      ...definition,
      ...hierarchy,
      confidence: 0.94,
    });
  }

  const specialPatterns = [
    {
      pattern: CHINESE_SPECIAL_PATTERN,
      locale: 'zh' as const,
      rule: 'zh-special-heading',
    },
    {
      pattern: JAPANESE_SPECIAL_PATTERN,
      locale: 'ja' as const,
      rule: 'ja-special-heading',
    },
    {
      pattern: ENGLISH_SPECIAL_PATTERN,
      locale: 'en' as const,
      rule: 'en-special-heading',
    },
  ];
  for (const definition of specialPatterns) {
    const result = match(line, definition.pattern, {
      ...definition,
      kind: 'special',
      level: 2,
      confidence: 0.92,
    });
    if (result !== undefined) return result;
  }
  return undefined;
};

export const collectExplicitTxtHeadingMatches = (
  lines: readonly TxtSourceLine[],
) => lines.flatMap((line) => matchTxtHeadingRule(line) ?? []);
