import { describe, expect, it, vi } from 'vitest';

import { Txt } from '../src/util/file';
import type { ParsedFile } from '../src/util/file';
import {
  getToolboxPreview,
  toolboxPreviewCharacterLimit,
  toolboxPreviewLineLimit,
} from '../src/pages/workspace/components/ToolboxPreview';

describe('toolbox file preview', () => {
  it('limits TXT previews by line count', async () => {
    const text = Array.from(
      { length: toolboxPreviewLineLimit + 1 },
      (_, index) => `line-${index + 1}`,
    ).join('\n');
    const file = await Txt.fromText('long.txt', text);

    const preview = await getToolboxPreview(file);

    expect(preview.truncated).toBe(true);
    expect(preview.text.split('\n')).toHaveLength(toolboxPreviewLineLimit);
    expect(preview.text).toContain(`line-${toolboxPreviewLineLimit}`);
    expect(preview.text).not.toContain(`line-${toolboxPreviewLineLimit + 1}`);
  });

  it('limits EPUB previews by character count', async () => {
    const getText = vi.fn(async () =>
      '内'.repeat(toolboxPreviewCharacterLimit + 1),
    );
    const file = {
      name: 'long.epub',
      type: 'epub',
      getText,
    } as unknown as ParsedFile;

    const preview = await getToolboxPreview(file);

    expect(getText).toHaveBeenCalledOnce();
    expect(preview.truncated).toBe(true);
    expect(preview.text).toHaveLength(toolboxPreviewCharacterLimit);
  });

  it('preserves a complete short preview', async () => {
    const file = await Txt.fromText('short.txt', '第一行\n第二行');

    await expect(getToolboxPreview(file)).resolves.toEqual({
      text: '第一行\n第二行',
      truncated: false,
    });
  });
});
