import type {
  TxtCatalogAnalysis,
  TxtCatalogNode,
  TxtDecodedDocument,
  TxtHeadingDraft,
  TxtImportPlan,
  TxtParseMode,
  TxtParseSummary,
  TxtPlannedChapter,
  TxtSourceLine,
} from '../../model/TxtCatalog';
import {
  collectExplicitTxtHeadingMatches,
  stripTxtHeadingDecoration,
  type TxtHeadingKind,
  type TxtHeadingRuleMatch,
} from './TxtHeadingRules';

interface ScoredCandidate extends TxtHeadingDraft {
  kind: TxtHeadingKind | 'learned';
  signature: string;
  numberValue?: number;
  explicit: boolean;
  learned: boolean;
  proseLike: boolean;
}

interface WeakCandidate {
  lineIndex: number;
  title: string;
  signature: string;
  structuralScore: number;
  reasons: string[];
}

interface FormatEvidence {
  count: number;
  lastLineIndex: number;
  gapTotal: number;
  gapSquaredTotal: number;
}

export interface ParseTxtCatalogOptions {
  mode?: TxtParseMode;
}

const MODE_THRESHOLD: Readonly<Record<TxtParseMode, number>> = {
  strict: 0.72,
  balanced: 0.62,
  loose: 0.5,
};

const clampConfidence = (value: number) =>
  Math.round(Math.min(Math.max(value, 0), 1) * 1_000) / 1_000;

const isBlank = (line: TxtSourceLine | undefined) =>
  line === undefined || line.normalized.length === 0;

const hasSentenceEnding = (text: string) => /[。！？!?；;.]$/.test(text);
const hasDialogueShape = (text: string) =>
  /^(?:[「『“‘（(]|[-—]{1,2}\s)/.test(text) || /(?:[」』”’）)])$/.test(text);

const hasProsePunctuation = (text: string) =>
  /[，,；;。！？!?]/.test(text) || /\.{3,}/.test(text);

const hasProseGrammar = (text: string) =>
  /^(?:第?\s*[〇零一二两兩三四五六七八九十百千万萬0-9]+\s*(?:章|节|節|回|話|话|幕))\s*(?:的内容|中|里|内|では|には|告诉|说道|写道|提到)/.test(
    text,
  ) ||
  /^(?:Chapter|Ch\.?|Section|Episode|Ep\.?)\s+.{1,24}\s+(?:is|was|means|contains|describes)\b/i.test(
    text,
  );

const wordCount = (text: string) =>
  text.split(/\s+/).filter((word) => word.length > 0).length;

const getDecorationSignature = (text: string) => {
  const match = text.match(
    /^([=*_~～—–-]{2,}|[★☆◆◇■□●○◎]{1,})\s*(.+?)\s*([=*_~～—–-]{2,}|[★☆◆◇■□●○◎]{1,})$/,
  );
  if (match === null) return undefined;
  const left = match[1]?.[0];
  const right = match[3]?.[0];
  if (left === undefined || right === undefined || left !== right)
    return undefined;
  return `decorated:${left}`;
};

const isEnglishTitleCase = (text: string) => {
  const words = text.split(/\s+/);
  if (words.length === 0 || words.length > 12) return false;
  const ignored = new Set([
    'a',
    'an',
    'and',
    'as',
    'at',
    'by',
    'for',
    'in',
    'of',
    'on',
    'or',
    'the',
    'to',
  ]);
  return words.every((word, index) => {
    const cleaned = word.replaceAll(/^["'([{]+|["')\]}]+$/g, '');
    if (!/^[A-Za-z][A-Za-z'-]*$/.test(cleaned)) return false;
    if (index > 0 && ignored.has(cleaned.toLowerCase())) return true;
    return /^[A-Z]/.test(cleaned) || cleaned === cleaned.toUpperCase();
  });
};

const scriptSignature = (text: string) => {
  if (/[\u3040-\u30FF]/.test(text)) return 'ja';
  if (/\p{Script=Han}/u.test(text)) return 'cjk';
  if (/[A-Za-z]/.test(text)) return 'en';
  return 'other';
};

const collectWeakCandidates = (
  lines: readonly TxtSourceLine[],
  explicitLines: ReadonlySet<number>,
) => {
  const candidates: WeakCandidate[] = [];
  for (const line of lines) {
    if (explicitLines.has(line.lineIndex)) continue;
    const normalized = line.normalized;
    const title = stripTxtHeadingDecoration(normalized);
    if (
      title.length < 2 ||
      title.length > 80 ||
      wordCount(title) > 12 ||
      hasSentenceEnding(title) ||
      hasDialogueShape(title) ||
      hasProsePunctuation(title)
    ) {
      continue;
    }
    const blankBefore = isBlank(lines[line.lineIndex - 1]);
    const blankAfter = isBlank(lines[line.lineIndex + 1]);
    const decoration = getDecorationSignature(normalized);
    const englishTitle = isEnglishTitleCase(title);
    const script = scriptSignature(title);
    if (
      (decoration === undefined &&
        !englishTitle &&
        !(blankBefore && blankAfter)) ||
      (script === 'en' && decoration === undefined && !englishTitle) ||
      (script === 'cjk' && title.length < 3 && decoration === undefined)
    )
      continue;

    let structuralScore = 0.3;
    const reasons: string[] = ['短独立文本'];
    if (blankBefore) {
      structuralScore += 0.11;
      reasons.push('前方空行');
    }
    if (blankAfter) {
      structuralScore += 0.11;
      reasons.push('后方空行');
    }
    if (decoration !== undefined) {
      structuralScore += 0.16;
      reasons.push('成对装饰符');
    }
    if (englishTitle) {
      structuralScore += 0.13;
      reasons.push('英文标题格式');
    }
    const lengthBucket = Math.min(Math.floor(title.length / 12), 4);
    const signature = decoration
      ? `learned:${decoration}:${script}`
      : englishTitle
        ? 'learned:title-case:en'
        : `learned:isolated:${script}:l${lengthBucket}`;
    candidates.push({
      lineIndex: line.lineIndex,
      title,
      signature,
      structuralScore,
      reasons,
    });
  }
  return candidates;
};

const collectFormatEvidence = (
  candidates: readonly { lineIndex: number; signature: string }[],
) => {
  const evidence = new Map<string, FormatEvidence>();
  for (const candidate of candidates) {
    const current = evidence.get(candidate.signature);
    if (current === undefined) {
      evidence.set(candidate.signature, {
        count: 1,
        lastLineIndex: candidate.lineIndex,
        gapTotal: 0,
        gapSquaredTotal: 0,
      });
      continue;
    }
    const gap = candidate.lineIndex - current.lastLineIndex;
    current.count += 1;
    current.lastLineIndex = candidate.lineIndex;
    current.gapTotal += gap;
    current.gapSquaredTotal += gap * gap;
  }
  return evidence;
};

const isRepeatedFormat = (evidence: FormatEvidence | undefined) => {
  if (evidence === undefined || evidence.count < 3) return false;
  if (evidence.count === 3) return true;
  const gapCount = evidence.count - 1;
  const mean = evidence.gapTotal / gapCount;
  const variance = evidence.gapSquaredTotal / gapCount - mean * mean;
  return mean >= 2 && variance <= Math.max(mean * mean * 2.5, 16);
};

const scoreExplicitCandidate = (
  candidate: TxtHeadingRuleMatch,
  lines: readonly TxtSourceLine[],
  repeated: boolean,
): ScoredCandidate => {
  const line = lines[candidate.lineIndex];
  const text = line?.normalized ?? candidate.title;
  let confidence = candidate.confidence;
  const proseLike = hasProseGrammar(text);
  const reasons = [`命中${candidate.rule}`];
  if (isBlank(lines[candidate.lineIndex - 1])) {
    confidence += 0.05;
    reasons.push('前方空行');
  }
  if (isBlank(lines[candidate.lineIndex + 1])) {
    confidence += 0.05;
    reasons.push('后方空行');
  }
  if (text.length <= 48) {
    confidence += 0.03;
    reasons.push('标题长度合理');
  } else if (text.length > 100) {
    confidence -= 0.24;
    reasons.push('文本过长');
  }
  if (hasSentenceEnding(text)) {
    confidence -= 0.26;
    reasons.push('句末标点');
  }
  if (hasDialogueShape(text)) {
    confidence -= 0.18;
    reasons.push('对话形态');
  }
  if (proseLike) {
    confidence -= 0.48;
    reasons.push('正文语法');
  }
  if (repeated && !proseLike) {
    confidence += 0.06;
    reasons.push('同格式重复');
  }
  return {
    lineIndex: candidate.lineIndex,
    title: candidate.title,
    level: candidate.level,
    rule: candidate.rule,
    confidence,
    isManual: false,
    reasons,
    kind: candidate.kind,
    signature: candidate.signature,
    numberValue: candidate.numberValue,
    explicit: true,
    learned: false,
    proseLike,
  };
};

const scoreLearnedCandidate = (
  candidate: WeakCandidate,
  repeated: boolean,
): ScoredCandidate => ({
  lineIndex: candidate.lineIndex,
  title: candidate.title,
  level: 1,
  rule: repeated ? 'learned-repeated-format' : 'loose-title-shape',
  confidence: candidate.structuralScore + (repeated ? 0.16 : 0),
  isManual: false,
  reasons: [
    ...candidate.reasons,
    ...(repeated ? ['全书同格式至少出现三次'] : []),
  ],
  kind: 'learned',
  signature: candidate.signature,
  explicit: false,
  learned: repeated,
  proseLike: false,
});

const applyNumberSequenceEvidence = (candidates: ScoredCandidate[]) => {
  const previousBySignature = new Map<string, number>();
  for (const candidate of candidates) {
    const numberValue = candidate.numberValue;
    if (numberValue === undefined || candidate.proseLike) continue;
    const previous = previousBySignature.get(candidate.signature);
    if (previous !== undefined) {
      const difference = numberValue - previous;
      if (difference === 1) {
        candidate.confidence += 0.07;
        candidate.reasons?.push('编号连续');
      } else if (difference > 1 && difference <= 20) {
        candidate.confidence += 0.01;
        candidate.reasons?.push('编号向前跳跃');
      } else if (difference <= 0) {
        candidate.confidence -= 0.09;
        candidate.reasons?.push('编号倒退或重复');
      }
    }
    previousBySignature.set(candidate.signature, numberValue);
  }
};

const inferHeadingLevels = (headings: ScoredCandidate[]) => {
  const hasVolumes = headings.some((heading) => heading.kind === 'volume');
  let seenVolume = false;
  return headings.map<TxtHeadingDraft>((heading) => {
    let level = heading.level;
    if (heading.kind === 'volume') {
      level = 1;
      seenVolume = true;
    } else if (heading.kind === 'chapter') {
      level = hasVolumes ? 2 : 1;
    } else if (heading.kind === 'section') {
      level = hasVolumes ? 3 : 2;
    } else if (heading.kind === 'special') {
      level = hasVolumes && seenVolume ? 2 : 1;
    } else if (heading.kind === 'learned') {
      level = hasVolumes && seenVolume ? 2 : 1;
    }
    return {
      lineIndex: heading.lineIndex,
      title: heading.title,
      level: Math.min(Math.max(level, 1), 6),
      rule: heading.rule,
      confidence: clampConfidence(heading.confidence),
      isManual: heading.isManual,
      reasons: heading.reasons,
    };
  });
};

const selectHeadings = (document: TxtDecodedDocument, mode: TxtParseMode) => {
  const explicit = collectExplicitTxtHeadingMatches(document.lines);
  const explicitEvidence = collectFormatEvidence(explicit);
  const explicitLines = new Set(explicit.map(({ lineIndex }) => lineIndex));
  const weak = collectWeakCandidates(document.lines, explicitLines);
  const weakEvidence = collectFormatEvidence(weak);

  const scoredByLine = new Map<number, ScoredCandidate>();
  for (const candidate of explicit) {
    scoredByLine.set(
      candidate.lineIndex,
      scoreExplicitCandidate(
        candidate,
        document.lines,
        isRepeatedFormat(explicitEvidence.get(candidate.signature)),
      ),
    );
  }
  if (mode !== 'strict') {
    for (const candidate of weak) {
      const repeated = isRepeatedFormat(weakEvidence.get(candidate.signature));
      if (mode === 'balanced' && !repeated) continue;
      scoredByLine.set(
        candidate.lineIndex,
        scoreLearnedCandidate(candidate, repeated),
      );
    }
  }
  const scored = document.lines.flatMap(
    ({ lineIndex }) => scoredByLine.get(lineIndex) ?? [],
  );
  applyNumberSequenceEvidence(scored);

  const selected = scored.filter((candidate) => {
    if (mode === 'strict' && !candidate.explicit) return false;
    if (mode === 'balanced' && !candidate.explicit && !candidate.learned)
      return false;
    return candidate.confidence >= MODE_THRESHOLD[mode];
  });
  return {
    headings: inferHeadingLevels(selected),
    candidateCount: explicit.length + weak.length,
    rejectedCount: explicit.length + weak.length - selected.length,
    learnedFormatCount: new Set(
      selected
        .filter(({ learned }) => learned)
        .map(({ signature }) => signature),
    ).size,
  };
};

const buildNavigation = (chapters: TxtPlannedChapter[]) => {
  const roots: TxtCatalogNode[] = [];
  const stack: TxtCatalogNode[] = [];
  chapters.forEach((chapter, chapterIndex) => {
    const node: TxtCatalogNode = {
      chapterIndex,
      title: chapter.title,
      level: chapter.level,
      children: [],
    };
    while ((stack.at(-1)?.level ?? 0) >= node.level) stack.pop();
    const parent = stack.at(-1);
    chapter.parentChapterIndex = parent?.chapterIndex;
    if (parent === undefined) roots.push(node);
    else parent.children.push(node);
    stack.push(node);
  });
  return roots;
};

const chapterContent = (
  lines: readonly TxtSourceLine[],
  startLine: number,
  endLine: number,
) =>
  lines
    .slice(startLine, endLine + 1)
    .map(({ raw }) => raw)
    .join('\n');

const buildFallbackChapters = (lines: readonly TxtSourceLine[]) => {
  const chapters: TxtPlannedChapter[] = [];
  for (let startLine = 0; startLine < lines.length; startLine += 1_000) {
    const endLine = Math.min(startLine + 999, lines.length - 1);
    chapters.push({
      planId: `fallback:${startLine}`,
      title: `第 ${chapters.length + 1} 段`,
      level: 1,
      sourceStartLine: startLine,
      sourceEndLine: endLine,
      content: chapterContent(lines, startLine, endLine),
      isFallback: true,
    });
  }
  return chapters;
};

export const createTxtImportPlan = (
  document: TxtDecodedDocument,
  headings: readonly TxtHeadingDraft[],
  summary: Omit<
    TxtParseSummary,
    | 'encoding'
    | 'lineCount'
    | 'headingCount'
    | 'averageConfidence'
    | 'usedFallback'
  >,
): TxtImportPlan => {
  const orderedHeadings = [...headings]
    .filter(
      (heading) =>
        Number.isInteger(heading.lineIndex) &&
        heading.lineIndex >= 0 &&
        heading.lineIndex < document.lines.length,
    )
    .sort((left, right) => left.lineIndex - right.lineIndex)
    .filter(
      (heading, index, array) =>
        index === 0 || heading.lineIndex !== array[index - 1]?.lineIndex,
    )
    .map((heading) => ({
      ...heading,
      title: heading.title.trim(),
      level: Math.min(Math.max(Math.round(heading.level), 1), 6),
    }))
    .filter(({ title }) => title.length > 0);

  let chapters: TxtPlannedChapter[];
  if (orderedHeadings.length === 0) {
    chapters = buildFallbackChapters(document.lines);
  } else {
    chapters = [];
    const firstHeading = orderedHeadings[0]!;
    if (firstHeading.lineIndex > 0) {
      chapters.push({
        planId: 'preamble:0',
        title: '正文前言',
        level: 1,
        sourceStartLine: 0,
        sourceEndLine: firstHeading.lineIndex - 1,
        content: chapterContent(document.lines, 0, firstHeading.lineIndex - 1),
        isPreamble: true,
      });
    }
    orderedHeadings.forEach((heading, headingIndex) => {
      const nextHeading = orderedHeadings[headingIndex + 1];
      const endLine = (nextHeading?.lineIndex ?? document.lines.length) - 1;
      chapters.push({
        planId: `heading:${heading.lineIndex}`,
        title: heading.title,
        level: heading.level,
        headingLineIndex: heading.lineIndex,
        sourceStartLine: heading.lineIndex,
        sourceEndLine: endLine,
        content: chapterContent(document.lines, heading.lineIndex, endLine),
      });
    });
  }

  const averageConfidence =
    orderedHeadings.length === 0
      ? 0
      : orderedHeadings.reduce(
          (total, heading) => total + heading.confidence,
          0,
        ) / orderedHeadings.length;
  return {
    encoding: document.encoding,
    mode: summary.mode,
    chapters,
    navigation: buildNavigation(chapters),
    headings: orderedHeadings,
    summary: {
      ...summary,
      encoding: document.encoding,
      lineCount: document.lines.length,
      headingCount: orderedHeadings.length,
      usedFallback: orderedHeadings.length === 0,
      averageConfidence: clampConfidence(averageConfidence),
    },
  };
};

export const parseTxtCatalog = (
  document: TxtDecodedDocument,
  options: ParseTxtCatalogOptions = {},
) => {
  const analysis = analyzeTxtCatalog(document, options);
  return createTxtImportPlan(document, analysis.headings, {
    mode: analysis.summary.mode,
    candidateCount: analysis.summary.candidateCount,
    rejectedCount: analysis.summary.rejectedCount,
    learnedFormatCount: analysis.summary.learnedFormatCount,
  });
};

export const analyzeTxtCatalog = (
  document: TxtDecodedDocument,
  options: ParseTxtCatalogOptions = {},
): TxtCatalogAnalysis => {
  const mode = options.mode ?? 'balanced';
  const selection = selectHeadings(document, mode);
  const averageConfidence =
    selection.headings.length === 0
      ? 0
      : selection.headings.reduce(
          (total, heading) => total + heading.confidence,
          0,
        ) / selection.headings.length;
  return {
    headings: selection.headings,
    summary: {
      encoding: document.encoding,
      mode,
      lineCount: document.lines.length,
      candidateCount: selection.candidateCount,
      headingCount: selection.headings.length,
      rejectedCount: selection.rejectedCount,
      learnedFormatCount: selection.learnedFormatCount,
      usedFallback: selection.headings.length === 0,
      averageConfidence: clampConfidence(averageConfidence),
    },
  };
};

export const reconstructTxtImportPlan = (plan: TxtImportPlan) =>
  plan.chapters.map(({ content }) => content).join('\n');
