import type { TxtImportPlan } from '@/model/TxtCatalog';
import type {
  ChapterTranslation,
  LocalVolumeChapter,
  LocalVolumeMetadata,
  LocalVolumeNavigationEntry,
  LocalVolumeTocEntry,
} from '@/model/LocalVolume';
import type { ReaderBookmark, ReaderProgress } from '@/model/Reader';
import type { TranslatorId } from '@/model/Translator';
import { createUuid } from '@/util/uuid';

import { validateReviewedTxtPlan } from './CreateVolume';
import type { LocalVolumeDao } from './LocalVolumeDao';

const translationSources: TranslatorId[] = ['gpt', 'sakura', 'baidu', 'youdao'];

interface StoredSourceLine {
  text: string;
  segmentId: string;
  sourceLine: number;
}

interface OrderedTxtSource {
  lines: StoredSourceLine[];
  chapters: Map<
    string,
    { chapter: LocalVolumeChapter; sourceStartLine: number }
  >;
}

export interface TxtCatalogRebuildResult {
  metadata: LocalVolumeMetadata;
  chapters: LocalVolumeChapter[];
  progress?: ReaderProgress;
  bookmarks: ReaderBookmark[];
  preservedTranslations: TranslatorId[];
  clearedTranslations: TranslatorId[];
  lineCount: number;
}

const getOrderedTxtSource = (
  metadata: LocalVolumeMetadata,
  chapters: readonly LocalVolumeChapter[],
): OrderedTxtSource => {
  if (metadata.sourceFormat !== 'txt')
    throw new Error('只有 TXT 书籍可以重建目录');
  const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  const lines: StoredSourceLine[] = [];
  const orderedChapters = new Map<
    string,
    { chapter: LocalVolumeChapter; sourceStartLine: number }
  >();
  const usedSegmentIds = new Set<string>();
  for (const entry of metadata.toc) {
    const chapter = byId.get(`${metadata.id}/${entry.chapterId}`);
    if (chapter === undefined)
      throw new Error(`章节不存在：${entry.chapterId}`);
    if (chapter.paragraphs.length !== chapter.segmentIds.length)
      throw new Error(`章节段落标识不完整：${entry.chapterId}`);
    const sourceStartLine = lines.length;
    orderedChapters.set(entry.chapterId, { chapter, sourceStartLine });
    chapter.paragraphs.forEach((text, index) => {
      const storedId = chapter.segmentIds[index];
      const segmentId =
        storedId !== undefined &&
        storedId.length > 0 &&
        !usedSegmentIds.has(storedId)
          ? storedId
          : createUuid();
      usedSegmentIds.add(segmentId);
      lines.push({ text, segmentId, sourceLine: lines.length });
    });
  }
  return { lines, chapters: orderedChapters };
};

export const reconstructTxtVolumeText = (
  metadata: LocalVolumeMetadata,
  chapters: readonly LocalVolumeChapter[],
) =>
  getOrderedTxtSource(metadata, chapters)
    .lines.map(({ text }) => text)
    .join('\n');

const validatePlanAgainstSource = (
  plan: TxtImportPlan,
  source: OrderedTxtSource,
) => {
  validateReviewedTxtPlan(plan);
  if (plan.summary.lineCount !== source.lines.length)
    throw new Error('重建计划与当前正文行数不一致');
  plan.chapters.forEach((chapter, chapterIndex) => {
    const plannedLines = chapter.content.split('\n');
    for (let offset = 0; offset < plannedLines.length; offset += 1) {
      const sourceLine = chapter.sourceStartLine + offset;
      if (plannedLines[offset] !== source.lines[sourceLine]?.text)
        throw new Error(`重建计划修改了第 ${sourceLine + 1} 行正文`);
    }
    if (
      chapter.parentChapterIndex !== undefined &&
      (!Number.isInteger(chapter.parentChapterIndex) ||
        chapter.parentChapterIndex < 0 ||
        chapter.parentChapterIndex >= chapterIndex)
    )
      throw new Error('重建计划包含无效目录父级');
  });
};

const getCompleteTranslations = (
  metadata: LocalVolumeMetadata,
  source: OrderedTxtSource,
) => {
  const complete = new Map<TranslatorId, string[]>();
  for (const translatorId of translationSources) {
    const paragraphs: string[] = [];
    const valid = metadata.toc.every((entry) => {
      const chapter = source.chapters.get(entry.chapterId)?.chapter;
      const translation = chapter?.[translatorId];
      if (
        chapter === undefined ||
        entry[translatorId] !== metadata.glossaryId ||
        translation?.glossaryId !== metadata.glossaryId ||
        translation.paragraphs.length !== chapter.paragraphs.length
      )
        return false;
      paragraphs.push(...translation.paragraphs);
      return true;
    });
    if (valid && paragraphs.length === source.lines.length)
      complete.set(translatorId, paragraphs);
  }
  return complete;
};

const resolveSourceLine = (
  value: Pick<ReaderProgress, 'chapterId' | 'segmentId' | 'sourceLine'>,
  source: OrderedTxtSource,
) => {
  if (
    Number.isInteger(value.sourceLine) &&
    value.sourceLine! >= 0 &&
    value.sourceLine! < source.lines.length
  )
    return value.sourceLine!;
  const oldChapter = source.chapters.get(value.chapterId);
  if (oldChapter === undefined) return undefined;
  if (value.segmentId === undefined) return oldChapter.sourceStartLine;
  const segmentIndex = oldChapter.chapter.segmentIds.indexOf(value.segmentId);
  return segmentIndex < 0
    ? oldChapter.sourceStartLine
    : oldChapter.sourceStartLine + segmentIndex;
};

export const prepareTxtCatalogRebuild = ({
  metadata,
  chapters,
  plan,
  progress,
  bookmarks,
}: {
  metadata: LocalVolumeMetadata;
  chapters: readonly LocalVolumeChapter[];
  plan: TxtImportPlan;
  progress?: ReaderProgress;
  bookmarks: readonly ReaderBookmark[];
}): TxtCatalogRebuildResult => {
  const source = getOrderedTxtSource(metadata, chapters);
  validatePlanAgainstSource(plan, source);
  const completeTranslations = getCompleteTranslations(metadata, source);
  const chapterIds = plan.chapters.map(() => createUuid());
  const lineTargets = new Map<
    number,
    { chapterId: string; segmentId: string }
  >();

  const rebuiltChapters = plan.chapters.map<LocalVolumeChapter>(
    (chapter, index) => {
      const chapterId = chapterIds[index]!;
      const sourceLines = Array.from(
        { length: chapter.sourceEndLine - chapter.sourceStartLine + 1 },
        (_, offset) => chapter.sourceStartLine + offset,
      );
      const rebuilt: LocalVolumeChapter = {
        id: `${metadata.id}/${chapterId}`,
        volumeId: metadata.id,
        paragraphs: sourceLines.map((line) => source.lines[line]!.text),
        segmentIds: sourceLines.map((line) => source.lines[line]!.segmentId),
        sourceLines,
        sourceStartLine: chapter.sourceStartLine,
        sourceEndLine: chapter.sourceEndLine,
      };
      sourceLines.forEach((line, lineIndex) =>
        lineTargets.set(line, {
          chapterId,
          segmentId: rebuilt.segmentIds[lineIndex]!,
        }),
      );
      for (const [translatorId, translatedLines] of completeTranslations) {
        rebuilt[translatorId] = {
          glossaryId: metadata.glossaryId,
          glossary: { ...metadata.glossary },
          paragraphs: sourceLines.map((line) => translatedLines[line]!),
        } satisfies ChapterTranslation;
      }
      return rebuilt;
    },
  );

  const rebuiltToc = plan.chapters.map<LocalVolumeTocEntry>(
    (chapter, index) => {
      const entry: LocalVolumeTocEntry = {
        chapterId: chapterIds[index]!,
        title: chapter.title,
        level: chapter.level,
        parentChapterId:
          chapter.parentChapterIndex === undefined
            ? undefined
            : chapterIds[chapter.parentChapterIndex],
        sourceStartLine: chapter.sourceStartLine,
        sourceEndLine: chapter.sourceEndLine,
      };
      for (const translatorId of completeTranslations.keys())
        entry[translatorId] = metadata.glossaryId;
      return entry;
    },
  );
  const navigation = rebuiltToc.map<LocalVolumeNavigationEntry>((entry) => ({
    id: `txt:${entry.chapterId}`,
    title: entry.title ?? '',
    level: entry.level ?? 1,
    chapterId: entry.chapterId,
    parentId:
      entry.parentChapterId === undefined
        ? undefined
        : `txt:${entry.parentChapterId}`,
  }));

  const mapProgress = (value: ReaderProgress | undefined) => {
    if (value === undefined) return undefined;
    const sourceLine = resolveSourceLine(value, source);
    const target =
      sourceLine === undefined ? undefined : lineTargets.get(sourceLine);
    return target === undefined
      ? undefined
      : ({ ...value, ...target, sourceLine } satisfies ReaderProgress);
  };
  const mappedBookmarks = bookmarks.flatMap((bookmark) => {
    const sourceLine = resolveSourceLine(bookmark, source);
    const target =
      sourceLine === undefined ? undefined : lineTargets.get(sourceLine);
    return target === undefined
      ? []
      : [{ ...bookmark, ...target, sourceLine } satisfies ReaderBookmark];
  });
  const preservedTranslations = translationSources.filter((translatorId) =>
    completeTranslations.has(translatorId),
  );

  return {
    metadata: { ...metadata, toc: rebuiltToc, navigation },
    chapters: rebuiltChapters,
    progress: mapProgress(progress),
    bookmarks: mappedBookmarks,
    preservedTranslations,
    clearedTranslations: translationSources.filter(
      (translatorId) => !completeTranslations.has(translatorId),
    ),
    lineCount: source.lines.length,
  };
};

export const rebuildTxtVolume = async (
  dao: LocalVolumeDao,
  bookId: string,
  plan: TxtImportPlan,
) => {
  const [metadata, chapters, progress, bookmarks] = await Promise.all([
    dao.getMetadata(bookId),
    dao.listChapterByVolumeId(bookId),
    dao.getReaderProgress(bookId),
    dao.listReaderBookmarks(bookId),
  ]);
  if (metadata === undefined) throw new Error('小说不存在');
  const result = prepareTxtCatalogRebuild({
    metadata,
    chapters,
    plan,
    progress,
    bookmarks,
  });
  await dao.replaceTxtCatalog({
    bookId,
    expectedChapterIds: metadata.toc.map(({ chapterId }) => chapterId),
    metadata: result.metadata,
    chapters: result.chapters,
    progress: result.progress,
    bookmarks: result.bookmarks,
  });
  return result;
};
