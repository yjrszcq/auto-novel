import { describe, expect, it } from 'vitest';

import { repairOcrText } from '../src/pages/workspace/components/ToolboxOcr';

describe('toolbox OCR line repair', () => {
  it('uses conservative evidence without joining arbitrary CJK lines', () => {
    const result = repairOcrText(
      '这是普通行\n下一行仍是正文\n这里有逗号，\n应当继续',
      'conservative',
    );

    expect(result.text).toBe(
      '这是普通行\n下一行仍是正文\n这里有逗号，应当继续',
    );
    expect(result.changes).toEqual([
      {
        line: 3,
        before: '这里有逗号，\n应当继续',
        after: '这里有逗号，应当继续',
      },
    ]);
  });

  it('joins likely wrapped prose in standard mode', () => {
    const result = repairOcrText(
      '第一行没有句号\n继续这一段\n最后结束。',
      'standard',
    );

    expect(result.text).toBe('第一行没有句号继续这一段最后结束。');
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]?.line).toBe(1);
  });

  it('only aggressive mode joins after colons and semicolons', () => {
    const text = '说明：\n后续内容；\n最后一行。';

    expect(repairOcrText(text, 'standard').text).toBe(text);
    expect(repairOcrText(text, 'aggressive').text).toBe(
      '说明：后续内容；最后一行。',
    );
  });

  it('protects headings, lists, dialogue, and blank boundaries', () => {
    const text = [
      '# 标题',
      '标题后的正文',
      '',
      '- 列表项目',
      '列表后的正文',
      '',
      '「对话没有结束',
      '下一行对话」',
    ].join('\n');

    const result = repairOcrText(text, 'aggressive');

    expect(result.text).toBe(text);
    expect(result.changes).toEqual([]);
  });

  it('keeps a space when joining Latin words', () => {
    const result = repairOcrText(
      'wrapped English\ntext continues.',
      'standard',
    );

    expect(result.text).toBe('wrapped English text continues.');
  });
});
