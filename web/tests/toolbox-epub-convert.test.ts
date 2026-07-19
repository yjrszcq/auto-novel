import { describe, expect, it } from 'vitest';

import type { StandardNovel } from '../src/util/file';
import { StandardNovel as StandardNovelConverter } from '../src/util/file';

const novel: StandardNovel = {
  id: 'source.epub',
  title: '展示标题',
  description: '书籍简介',
  warnings: ['空章节：第二章'],
  chapters: [
    {
      id: 'chapter-1.xhtml',
      title: '第一章',
      volumeTitles: ['第一卷'],
      content: '正文一\n',
    },
    {
      id: 'chapter-2.xhtml',
      title: '第二章',
      volumeTitles: ['第一卷'],
      content: '',
    },
  ],
};

describe('toolbox EPUB to TXT conversion', () => {
  it('renders selected metadata headings in stable navigation order', () => {
    expect(
      StandardNovelConverter.toText(novel, {
        includeChapterTitles: true,
        includeVolumeTitles: true,
        includeDescription: true,
      }),
    ).toBe(
      [
        '展示标题',
        '',
        '书籍简介',
        '',
        '# 第一卷',
        '',
        '## 第一章',
        '正文一',
        '',
        '## 第二章',
        '',
      ].join('\n'),
    );
  });

  it('omits each optional section independently', () => {
    const text = StandardNovelConverter.toText(novel, {
      includeChapterTitles: false,
      includeVolumeTitles: false,
      includeDescription: false,
    });

    expect(text).toBe('展示标题\n\n正文一\n');
    expect(text).not.toContain('第一卷');
    expect(text).not.toContain('第一章');
    expect(text).not.toContain('书籍简介');
  });

  it('reports missing and out-of-order navigation targets', () => {
    expect(
      StandardNovelConverter.validateNavigationOrder(
        ['chapter-2.xhtml', 'chapter-1.xhtml', 'missing.xhtml'],
        ['chapter-1.xhtml', 'chapter-2.xhtml'],
      ),
    ).toEqual([
      '目录顺序与正文顺序不一致：chapter-1.xhtml',
      '目录条目未出现在正文顺序中：missing.xhtml',
    ]);
  });

  it('uses the source identity for the deterministic output filename', async () => {
    await expect(StandardNovelConverter.toTxt(novel)).resolves.toMatchObject({
      name: 'source.txt',
      type: 'txt',
    });
  });
});
