import { describe, expect, it } from 'vitest';

import {
  buildTxtSourceLines,
  decodeTxtBuffer,
  decodeTxtText,
  normalizeTxtHeadingText,
} from '../src/util/file/TxtDecode';

const utf16Bytes = (text: string, littleEndian: boolean) => {
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes[0] = littleEndian ? 0xff : 0xfe;
  bytes[1] = littleEndian ? 0xfe : 0xff;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    const target = 2 + index * 2;
    bytes[target] = littleEndian ? code & 0xff : code >> 8;
    bytes[target + 1] = littleEndian ? code >> 8 : code & 0xff;
  }
  return bytes;
};

describe('TXT decoding', () => {
  it('prefers valid UTF-8 and normalizes line endings without changing lines', () => {
    const bytes = new TextEncoder().encode('第一章\r\n正文\r尾声');
    const decoded = decodeTxtBuffer(bytes);

    expect(decoded.encoding).toBe('utf-8');
    expect(decoded.text).toBe('第一章\n正文\n尾声');
    expect(decoded.lines.map(({ raw }) => raw)).toEqual([
      '第一章',
      '正文',
      '尾声',
    ]);
  });

  it.each([
    ['utf-16le', true],
    ['utf-16be', false],
  ] as const)('honors a %s byte-order mark', (encoding, littleEndian) => {
    const decoded = decodeTxtBuffer(utf16Bytes('第1章\n本文', littleEndian));
    expect(decoded.encoding).toBe(encoding);
    expect(decoded.text).toBe('第1章\n本文');
    expect(decoded.candidates.map((candidate) => candidate.encoding)).toEqual([
      encoding,
    ]);
  });

  it('detects common GB18030 bytes', () => {
    // “第一章 中文” encoded as GB18030.
    const bytes = Uint8Array.from([
      0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2, 0x20, 0xd6, 0xd0, 0xce, 0xc4,
    ]);
    const decoded = decodeTxtBuffer(bytes);
    expect(decoded.encoding).toBe('gb18030');
    expect(decoded.text).toBe('第一章 中文');
  });

  it('detects common Big5 bytes', () => {
    // “第一章 中文” encoded as Big5.
    const bytes = Uint8Array.from([
      0xb2, 0xc4, 0xa4, 0x40, 0xb3, 0xb9, 0x20, 0xa4, 0xa4, 0xa4, 0xe5,
    ]);
    const decoded = decodeTxtBuffer(bytes);
    expect(decoded.encoding).toBe('big5');
    expect(decoded.text).toBe('第一章 中文');
  });

  it('detects common Shift_JIS bytes', () => {
    // “第一章 日本語” encoded as Shift_JIS.
    const bytes = Uint8Array.from([
      0x91, 0xe6, 0x88, 0xea, 0x8f, 0xcd, 0x20, 0x93, 0xfa, 0x96, 0x7b, 0x8c,
      0xea,
    ]);
    const decoded = decodeTxtBuffer(bytes);
    expect(decoded.encoding).toBe('shift_jis');
    expect(decoded.text).toBe('第一章 日本語');
  });

  it('keeps raw lines and derives normalized detection text and offsets', () => {
    const decoded = decodeTxtText('\uFEFF  ＃＃　第１２章\u3000标题  \r\n本文');
    expect(decoded.text).toBe('  ＃＃　第１２章\u3000标题  \n本文');
    expect(decoded.lines).toEqual([
      {
        lineIndex: 0,
        raw: '  ＃＃　第１２章\u3000标题  ',
        normalized: '## 第12章 标题',
        startOffset: 0,
        endOffset: 14,
      },
      {
        lineIndex: 1,
        raw: '本文',
        normalized: '本文',
        startOffset: 15,
        endOffset: 17,
      },
    ]);
  });

  it('keeps a final empty line in the source model', () => {
    expect(buildTxtSourceLines('a\n').map((line) => line.raw)).toEqual([
      'a',
      '',
    ]);
  });

  it('normalizes only the detection copy', () => {
    expect(normalizeTxtHeadingText('　【第１２章】\u200B　')).toBe(
      '【第12章】',
    );
  });
});
