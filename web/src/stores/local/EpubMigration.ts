import type {
  ChapterTranslation,
  LocalVolumeChapter,
  LocalVolumeMetadata,
  LocalVolumeTocEntry,
} from '@/model/LocalVolume';
import { parseFile } from '@/util/file';
import type { Epub } from '@/util/file/epub';

import {
  createEpubImportPlan,
  type EpubChapterPlanItem,
  type EpubImportPlan,
} from './EpubChapterPlan';
import type {
  LocalVolumeDao,
  NativeEpubMigrationCommit,
} from './LocalVolumeDao';

const translatorIds = ['baidu', 'youdao', 'gpt', 'sakura'] as const;

const equalParagraphs = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length &&
  left.every((paragraph, index) => paragraph === right[index]);

const buildTranslation = (
  chapter: EpubChapterPlanItem,
  oldBySource: Map<string, LocalVolumeChapter>,
  translatorId: (typeof translatorIds)[number],
) => {
  let template: Omit<ChapterTranslation, 'paragraphs'> | undefined;
  let templateKey: string | undefined;
  const paragraphs: string[] = [];
  for (const range of chapter.sourceRanges) {
    const oldChapter = oldBySource.get(range.href)!;
    const translation = oldChapter[translatorId];
    if (translation !== undefined) {
      const key = JSON.stringify({
        glossaryId: translation.glossaryId,
        glossary: translation.glossary,
      });
      if (templateKey !== undefined && templateKey !== key) {
        throw new Error('旧译文词表版本不一致');
      }
      templateKey = key;
      template = {
        glossaryId: translation.glossaryId,
        glossary: translation.glossary,
      };
    }
    for (let index = range.start; index < range.end; index += 1) {
      paragraphs.push(translation?.paragraphs[index] ?? '');
    }
  }
  return template === undefined ? undefined : { ...template, paragraphs };
};

export const buildNativeEpubMigrationCommit = ({
  volume,
  oldChapters,
  epub,
  importPlan,
}: {
  volume: LocalVolumeMetadata;
  oldChapters: LocalVolumeChapter[];
  epub: Epub;
  importPlan: EpubImportPlan;
}): NativeEpubMigrationCommit => {
  const sourceByHref = new Map(
    importPlan.sources.map((source) => [source.href, source]),
  );
  const oldById = new Map(oldChapters.map((chapter) => [chapter.id, chapter]));
  const oldBySource = new Map<string, LocalVolumeChapter>();
  const oldChapterIdBySource = new Map<string, string>();
  for (const tocItem of volume.toc) {
    const chapter = oldById.get(`${volume.id}/${tocItem.chapterId}`);
    if (chapter === undefined) throw new Error('旧章节缺失');
    const rawHref = tocItem.chapterId.split('#')[0];
    const sourceHref = sourceByHref.has(rawHref)
      ? rawHref
      : epub.getCanonicalHref(rawHref);
    if (!sourceByHref.has(sourceHref)) continue;
    if (oldBySource.has(sourceHref)) throw new Error('旧章节目标重复');
    oldBySource.set(sourceHref, chapter);
    oldChapterIdBySource.set(sourceHref, tocItem.chapterId);
  }

  const requiredSources = new Set(
    importPlan.chapters.flatMap((chapter) =>
      chapter.sourceRanges.map((range) => range.href),
    ),
  );
  for (const href of requiredSources) {
    const source = sourceByHref.get(href);
    const oldChapter = oldBySource.get(href);
    if (source === undefined || oldChapter === undefined) {
      throw new Error('无法找到旧正文来源');
    }
    if (!equalParagraphs(source.paragraphs, oldChapter.paragraphs)) {
      throw new Error('旧正文与原文件不一致');
    }
    if (oldChapter.segmentIds.length !== oldChapter.paragraphs.length) {
      throw new Error('旧段落标识不完整');
    }
  }

  const usedParagraphs = new Map<string, Set<number>>();
  const oldToNewChapterIds = new Map<string, Set<string>>();
  const segmentChapterMap: Record<string, string> = {};
  const chapters = importPlan.chapters.map((chapterPlan) => {
    const segmentIds: string[] = [];
    for (const range of chapterPlan.sourceRanges) {
      const oldChapter = oldBySource.get(range.href)!;
      const oldChapterId = oldChapterIdBySource.get(range.href)!;
      const targetChapters = oldToNewChapterIds.get(oldChapterId) ?? new Set();
      targetChapters.add(chapterPlan.chapterId);
      oldToNewChapterIds.set(oldChapterId, targetChapters);
      const used = usedParagraphs.get(range.href) ?? new Set<number>();
      for (let index = range.start; index < range.end; index += 1) {
        const segmentId = oldChapter.segmentIds[index];
        if (segmentChapterMap[segmentId] !== undefined) {
          throw new Error('旧段落被重复映射');
        }
        segmentChapterMap[segmentId] = chapterPlan.chapterId;
        segmentIds.push(segmentId);
        used.add(index);
      }
      usedParagraphs.set(range.href, used);
    }
    const chapter: LocalVolumeChapter = {
      id: `${volume.id}/${chapterPlan.chapterId}`,
      volumeId: volume.id,
      paragraphs: [...chapterPlan.paragraphs],
      segmentIds,
      sourceRanges: chapterPlan.sourceRanges.map((range) => ({ ...range })),
    };
    for (const translatorId of translatorIds) {
      const translation = buildTranslation(
        chapterPlan,
        oldBySource,
        translatorId,
      );
      if (translation !== undefined) chapter[translatorId] = translation;
    }
    return chapter;
  });

  for (const tocItem of volume.toc) {
    const oldChapter = oldById.get(`${volume.id}/${tocItem.chapterId}`)!;
    const sourceHref = [...oldChapterIdBySource.entries()].find(
      ([, chapterId]) => chapterId === tocItem.chapterId,
    )?.[0];
    const used =
      sourceHref === undefined ? undefined : usedParagraphs.get(sourceHref);
    for (const translatorId of translatorIds) {
      oldChapter[translatorId]?.paragraphs.forEach((paragraph, index) => {
        if (paragraph && !used?.has(index)) {
          throw new Error('未收录正文仍包含旧译文');
        }
      });
    }
  }

  const chapterMap: Record<string, string> = {};
  for (const [oldChapterId, newChapterIds] of oldToNewChapterIds) {
    if (newChapterIds.size === 1) {
      chapterMap[oldChapterId] = [...newChapterIds][0];
    }
  }
  const toc = importPlan.chapters.map<LocalVolumeTocEntry>((chapterPlan) => {
    const chapter = chapters.find(
      (candidate) => candidate.id === `${volume.id}/${chapterPlan.chapterId}`,
    )!;
    return {
      chapterId: chapterPlan.chapterId,
      title: chapterPlan.title,
      baidu: chapter.baidu?.glossaryId,
      youdao: chapter.youdao?.glossaryId,
      gpt: chapter.gpt?.glossaryId,
      sakura: chapter.sakura?.glossaryId,
    };
  });
  return {
    bookId: volume.id,
    expectedChapters: oldChapters,
    chapters,
    toc,
    navigation: importPlan.navigation,
    chapterMap,
    segmentChapterMap,
  };
};

export type EpubMigrationResult =
  | { status: 'not-needed' }
  | { status: 'migrated'; chapterMap: Record<string, string> }
  | { status: 'failed'; message: string };

export const ensureNativeEpubMigration = async (
  dao: LocalVolumeDao,
  bookId: string,
): Promise<EpubMigrationResult> => {
  const volume = await dao.getMetadata(bookId);
  if (volume === undefined || volume.contentVersion === 2) {
    return { status: 'not-needed' };
  }
  if (
    volume.sourceFormat !== 'epub' &&
    !bookId.toLowerCase().endsWith('.epub')
  ) {
    return { status: 'not-needed' };
  }
  const storedFile = await dao.getFile(bookId);
  if (storedFile === undefined) {
    return { status: 'failed', message: '无法自动迁移，请重新导入' };
  }
  try {
    const parsed = await parseFile(storedFile.file);
    if (parsed.type !== 'epub') return { status: 'not-needed' };
    const importPlan = createEpubImportPlan(parsed);
    const commit = buildNativeEpubMigrationCommit({
      volume,
      oldChapters: await dao.listChapterByVolumeId(bookId),
      epub: parsed,
      importPlan,
    });
    return (await dao.migrateNativeEpub(commit))
      ? { status: 'migrated', chapterMap: commit.chapterMap }
      : { status: 'not-needed' };
  } catch {
    return { status: 'failed', message: '无法自动迁移，请重新导入' };
  }
};
