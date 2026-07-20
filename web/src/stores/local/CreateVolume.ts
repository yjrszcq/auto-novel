import type { TxtImportPlan } from '@/model/TxtCatalog';
import { parseFile, Srt } from '@/util/file';
import { createUuid } from '@/util/uuid';

import type {
  LocalBookMetadata,
  LocalVolumeChapter,
  LocalVolumeChapterSourceRange,
  LocalVolumeMetadata,
  LocalVolumeNavigationEntry,
  LocalVolumeTocEntry,
} from '@/model/LocalVolume';

import { createEpubImportPlan } from './EpubChapterPlan';
import type { LocalVolumeDao } from './LocalVolumeDao';

type ImportedChapter = {
  chapterId: string;
  title: string;
  level?: number;
  parentChapterId?: string;
  paragraphs: string[];
  sourceLines?: number[];
  sourceStartLine?: number;
  sourceEndLine?: number;
  sourceRanges?: LocalVolumeChapterSourceRange[];
};

const persistVolume = async (
  dao: LocalVolumeDao,
  {
    id,
    file,
    favoredId,
    chapters,
    navigation,
    sourceFormat,
    sourceBookMetadata,
    importDiagnostics,
    embeddedCover,
  }: {
    id: string;
    file: File;
    favoredId: string;
    chapters: ImportedChapter[];
    navigation?: LocalVolumeNavigationEntry[];
    sourceFormat: LocalVolumeMetadata['sourceFormat'];
    sourceBookMetadata: LocalBookMetadata;
    importDiagnostics?: LocalVolumeMetadata['importDiagnostics'];
    embeddedCover?: Blob;
  },
) => {
  const storedChapters = chapters.map<LocalVolumeChapter>(
    ({
      chapterId,
      paragraphs,
      sourceRanges,
      sourceLines,
      sourceStartLine,
      sourceEndLine,
    }) => ({
      id: `${id}/${chapterId}`,
      volumeId: id,
      paragraphs,
      segmentIds: paragraphs.map(() => createUuid()),
      sourceLines,
      sourceRanges,
      sourceStartLine,
      sourceEndLine,
    }),
  );
  const metadata: LocalVolumeMetadata = {
    id,
    createAt: Date.now(),
    toc: chapters.map<LocalVolumeTocEntry>((chapter) => ({
      chapterId: chapter.chapterId,
      title: chapter.title,
      level: chapter.level,
      parentChapterId: chapter.parentChapterId,
      sourceStartLine: chapter.sourceStartLine,
      sourceEndLine: chapter.sourceEndLine,
    })),
    navigation,
    sourceFormat,
    glossaryId: createUuid(),
    glossary: {},
    favoredId,
    sourceBookMetadata,
    ...(importDiagnostics?.length ? { importDiagnostics } : {}),
  };
  await dao.createVolume({
    metadata,
    file,
    chapters: storedChapters,
    cover:
      embeddedCover === undefined
        ? undefined
        : {
            bookId: id,
            blob: embeddedCover,
            source: 'embedded',
            updatedAt: Date.now(),
          },
  });
  return { diagnostics: importDiagnostics ?? [] };
};

export const validateReviewedTxtPlan = (plan: TxtImportPlan) => {
  if (plan.chapters.length === 0) throw new Error('TXT 导入计划没有章节');
  let expectedStartLine = 0;
  plan.chapters.forEach((chapter, chapterIndex) => {
    if (chapter.sourceStartLine !== expectedStartLine)
      throw new Error('TXT 导入计划的原文行范围不连续');
    if (chapter.sourceEndLine < chapter.sourceStartLine)
      throw new Error('TXT 导入计划包含无效的原文行范围');
    if (
      chapter.content.split('\n').length !==
      chapter.sourceEndLine - chapter.sourceStartLine + 1
    )
      throw new Error('TXT 导入计划的正文与原文行范围不一致');
    if (chapter.title.trim().length === 0)
      throw new Error('TXT 导入计划包含空目录标题');
    if (
      !Number.isInteger(chapter.level) ||
      chapter.level < 1 ||
      chapter.level > 6
    )
      throw new Error('TXT 导入计划包含无效目录层级');
    if (
      chapter.parentChapterIndex !== undefined &&
      (!Number.isInteger(chapter.parentChapterIndex) ||
        chapter.parentChapterIndex < 0 ||
        chapter.parentChapterIndex >= chapterIndex)
    )
      throw new Error('TXT 导入计划包含无效目录父级');
    expectedStartLine = chapter.sourceEndLine + 1;
  });
  if (expectedStartLine !== plan.summary.lineCount)
    throw new Error('TXT 导入计划没有覆盖完整正文');
};

export const createReviewedTxtVolume = async (
  dao: LocalVolumeDao,
  file: File,
  favoredId: string,
  plan: TxtImportPlan,
) => {
  const id = file.name;
  if ((await dao.getMetadata(id)) !== undefined) throw Error('小说已经存在');
  validateReviewedTxtPlan(plan);

  const chapterIds = plan.chapters.map(() => createUuid());
  const chapters = plan.chapters.map<ImportedChapter>((chapter, index) => ({
    chapterId: chapterIds[index]!,
    title: chapter.title,
    level: chapter.level,
    parentChapterId:
      chapter.parentChapterIndex === undefined
        ? undefined
        : chapterIds[chapter.parentChapterIndex],
    paragraphs: chapter.content.split('\n'),
    sourceLines: Array.from(
      { length: chapter.sourceEndLine - chapter.sourceStartLine + 1 },
      (_, offset) => chapter.sourceStartLine + offset,
    ),
    sourceStartLine: chapter.sourceStartLine,
    sourceEndLine: chapter.sourceEndLine,
  }));
  const navigation = chapters.map<LocalVolumeNavigationEntry>((chapter) => ({
    id: `txt:${chapter.chapterId}`,
    title: chapter.title,
    level: chapter.level ?? 1,
    chapterId: chapter.chapterId,
    parentId:
      chapter.parentChapterId === undefined
        ? undefined
        : `txt:${chapter.parentChapterId}`,
  }));

  return persistVolume(dao, {
    id,
    file,
    favoredId,
    chapters,
    navigation,
    sourceFormat: 'txt',
    sourceBookMetadata: {
      title: file.name.replace(/\.[^.]+$/, ''),
      authors: [],
      languages: ['ja'],
    },
  });
};

export const createVolume = async (
  dao: LocalVolumeDao,
  file: File,
  favoredId: string,
) => {
  const id = file.name;
  if ((await dao.getMetadata(id)) !== undefined) throw Error('小说已经存在');
  if (file.name.toLowerCase().endsWith('.txt'))
    throw new Error('TXT 文件必须先预览并确认目录');

  const chapters: ImportedChapter[] = [];
  let navigation: LocalVolumeNavigationEntry[] | undefined;
  const parsedFile = await parseFile(file);
  const importDiagnostics =
    parsedFile.type === 'epub' ? parsedFile.diagnostics : undefined;
  const embeddedCover =
    parsedFile.type === 'epub' ? parsedFile.getCover() : undefined;
  const sourceBookMetadata: LocalBookMetadata =
    parsedFile.type === 'epub'
      ? parsedFile.getBookMetadata()
      : {
          title: file.name.replace(/\.[^.]+$/, ''),
          authors: [],
          languages: ['ja'],
        };

  if (parsedFile.type === 'epub') {
    const plan = createEpubImportPlan(parsedFile);
    chapters.push(...plan.chapters);
    navigation = plan.navigation;
  } else if (parsedFile.type === 'srt') {
    const lines = parsedFile.subtitles
      .flatMap((subtitle) => subtitle.text)
      .map((text) => Srt.cleanFormat(text));
    chapters.push({
      chapterId: '0',
      title: '字幕',
      paragraphs: lines,
    });
  } else {
    throw new Error('TXT 文件必须先预览并确认目录');
  }

  return persistVolume(dao, {
    id,
    file,
    favoredId,
    chapters,
    navigation,
    sourceFormat: parsedFile.type,
    sourceBookMetadata,
    importDiagnostics,
    embeddedCover,
  });
};
