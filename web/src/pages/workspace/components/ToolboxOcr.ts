export type OcrRepairMode = 'conservative' | 'standard' | 'aggressive';

export interface OcrRepairChange {
  line: number;
  before: string;
  after: string;
}

export interface OcrRepairResult {
  text: string;
  changes: OcrRepairChange[];
}

const headingPattern =
  /^(?:#{1,6}\s|第.{0,24}[章节卷部篇回]|<图片>|<分割线>|[-=*_]{3,}\s*$)/u;
const listPattern =
  /^(?:[-*+•]\s+|\d+[.)、]\s*|[一二三四五六七八九十]+[、.]\s*)/u;
const dialogueStartPattern = /^[「『“”"']/u;
const dialogueEndPattern = /[」』“”"']$/u;
const standardTerminalPattern = /[。！？!?\.；;：:…—」』”"'）)\]}】]$/u;
const aggressiveTerminalPattern = /[。！？!?\.……」』”"'）)\]}】]$/u;

const isProtectedLine = (line: string) => {
  const value = line.trim();
  return (
    value.length === 0 ||
    headingPattern.test(value) ||
    listPattern.test(value) ||
    dialogueStartPattern.test(value) ||
    dialogueEndPattern.test(value)
  );
};

const shouldJoin = (current: string, next: string, mode: OcrRepairMode) => {
  if (isProtectedLine(current) || isProtectedLine(next)) return false;
  const left = current.trimEnd();
  const right = next.trimStart();
  if (left.length === 0 || right.length === 0) return false;

  if (mode === 'conservative') {
    if (/[,，、]$/u.test(left)) return true;
    return /[A-Za-z0-9]$/u.test(left) && /^[a-z0-9]/u.test(right);
  }

  const terminal =
    mode === 'standard'
      ? standardTerminalPattern.test(left)
      : aggressiveTerminalPattern.test(left);
  if (terminal) return false;
  return mode === 'aggressive' || /[\p{L}\p{N},，、]$/u.test(left);
};

const joinLines = (left: string, right: string) => {
  const before = left.trimEnd();
  const after = right.trim();
  const separator =
    /[A-Za-z0-9]$/u.test(before) && /^[A-Za-z0-9]/u.test(after) ? ' ' : '';
  return `${before}${separator}${after}`;
};

export const repairOcrText = (
  text: string,
  mode: OcrRepairMode,
): OcrRepairResult => {
  const sourceLines = text.split('\n');
  const outputLines: string[] = [];
  const changes: OcrRepairChange[] = [];

  for (let index = 0; index < sourceLines.length; index += 1) {
    const start = index;
    const original = [sourceLines[index] ?? ''];
    let joined = original[0];

    while (
      index + 1 < sourceLines.length &&
      shouldJoin(joined, sourceLines[index + 1] ?? '', mode)
    ) {
      index += 1;
      original.push(sourceLines[index] ?? '');
      joined = joinLines(joined, sourceLines[index] ?? '');
    }

    outputLines.push(joined);
    if (original.length > 1) {
      changes.push({
        line: start + 1,
        before: original.join('\n'),
        after: joined,
      });
    }
  }

  return { text: outputLines.join('\n'), changes };
};
