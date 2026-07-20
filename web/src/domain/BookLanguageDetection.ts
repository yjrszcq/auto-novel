import { detectAll, toISO2 } from 'tinyld/light';

export type DetectedBookLanguage = string;

const maximumSampledSegments = 500;
const maximumCharactersPerSegment = 2_000;
const pendingSampleTarget = 1_000;
const minimumLanguageCoverage = 0.05;

const compactLength = (text: string) => text.replace(/\s/g, '').length;

const sampleSegments = (textGroups: readonly (readonly string[])[]) => {
  const samples: Array<{ index: number; text: string }> = [];
  let randomState = 0x6d2b79f5;
  let segmentIndex = 0;
  for (const paragraphs of textGroups) {
    for (const text of paragraphs) {
      if (samples.length < maximumSampledSegments) {
        samples.push({ index: segmentIndex, text });
      } else {
        randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
        const replacement = randomState % (segmentIndex + 1);
        if (replacement < maximumSampledSegments) {
          samples[replacement] = { index: segmentIndex, text };
        }
      }
      segmentIndex += 1;
    }
  }
  return samples.sort((left, right) => left.index - right.index);
};

export const detectBookLanguages = (
  textGroups: readonly (readonly string[])[],
  confidencePercent = 95,
): DetectedBookLanguage[] => {
  const threshold = Math.min(100, Math.max(0, confidencePercent)) / 100;
  const evidence = new Map<DetectedBookLanguage, number>();
  let pendingSample = '';
  let totalEvidence = 0;

  const detectSample = (sample: string) => {
    const length = compactLength(sample);
    if (length === 0) return false;
    const result = detectAll(sample)[0];
    if (result === undefined || result.accuracy <= threshold) return false;
    evidence.set(result.lang, (evidence.get(result.lang) ?? 0) + length);
    return true;
  };

  const flushPendingSample = () => {
    detectSample(pendingSample);
    pendingSample = '';
  };

  for (const { text } of sampleSegments(textGroups)) {
    const sample = text.slice(0, maximumCharactersPerSegment);
    const length = compactLength(sample);
    if (length === 0) continue;
    totalEvidence += length;
    if (detectSample(sample)) continue;
    pendingSample += `\n${sample}`;
    if (pendingSample.length >= pendingSampleTarget) flushPendingSample();
  }
  flushPendingSample();

  if (totalEvidence === 0) return [];
  return [...evidence.entries()]
    .filter(([, count]) => count / totalEvidence >= minimumLanguageCoverage)
    .sort((left, right) => right[1] - left[1])
    .map(([language]) => language);
};

const normalizeLanguageFamily = (language: string) => {
  const base = language.trim().toLowerCase().split('-')[0]!;
  if (base === 'chi' || base === 'zho') return 'zh';
  return toISO2(base);
};

export const appendMissingDetectedLanguages = (
  existing: readonly string[],
  detected: readonly DetectedBookLanguage[],
) => {
  const existingFamilies = new Set(existing.map(normalizeLanguageFamily));
  return [
    ...existing,
    ...detected.filter(
      (language) => !existingFamilies.has(normalizeLanguageFamily(language)),
    ),
  ];
};
