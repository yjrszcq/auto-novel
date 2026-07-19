import type { ParsedFile } from '@/util/file';

export const toolboxPreviewLineLimit = 100;
export const toolboxPreviewCharacterLimit = 20_000;

export interface ToolboxPreview {
  text: string;
  truncated: boolean;
}

export const getToolboxPreview = async (
  file: ParsedFile,
): Promise<ToolboxPreview> => {
  const content = file.type === 'txt' ? file.text : await file.getText();
  const lines = content.split('\n');
  const lineLimited = lines.slice(0, toolboxPreviewLineLimit).join('\n');
  const text = lineLimited.slice(0, toolboxPreviewCharacterLimit);
  return {
    text,
    truncated:
      lines.length > toolboxPreviewLineLimit ||
      lineLimited.length > toolboxPreviewCharacterLimit,
  };
};
