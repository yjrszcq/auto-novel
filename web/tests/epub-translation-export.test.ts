import { describe, expect, it } from 'vitest';

import { collectEpubSourceTranslations } from '../src/stores/local/EpubTranslationExport';

describe('native EPUB translation export', () => {
  it('reassembles chapters split by anchors into the original XHTML', () => {
    const result = collectEpubSourceTranslations([
      {
        sourceRanges: [{ href: 'Text/book.xhtml', start: 0, end: 2 }],
        translations: [['译一', '译二']],
      },
      {
        sourceRanges: [{ href: 'Text/book.xhtml', start: 2, end: 4 }],
        translations: [['译三', '译四']],
      },
    ]);

    expect(result.get('Text/book.xhtml')).toEqual([
      ['译一'],
      ['译二'],
      ['译三'],
      ['译四'],
    ]);
  });

  it('distributes one chapter and parallel translations across documents', () => {
    const result = collectEpubSourceTranslations([
      {
        sourceRanges: [
          { href: 'Text/one.xhtml', start: 1, end: 3 },
          { href: 'Text/two.xhtml', start: 0, end: 2 },
        ],
        translations: [
          ['GPT 一', 'GPT 二', 'GPT 三', 'GPT 四'],
          ['Sakura 一', 'Sakura 二', 'Sakura 三', 'Sakura 四'],
        ],
      },
    ]);

    expect(result.get('Text/one.xhtml')).toEqual([
      [],
      ['GPT 一', 'Sakura 一'],
      ['GPT 二', 'Sakura 二'],
    ]);
    expect(result.get('Text/two.xhtml')).toEqual([
      ['GPT 三', 'Sakura 三'],
      ['GPT 四', 'Sakura 四'],
    ]);
  });

  it('leaves missing translated paragraphs untouched', () => {
    const result = collectEpubSourceTranslations([
      {
        sourceRanges: [{ href: 'Text/book.xhtml', start: 0, end: 3 }],
        translations: [['译一']],
      },
    ]);

    expect(result.get('Text/book.xhtml')).toEqual([['译一'], [], []]);
  });
});
