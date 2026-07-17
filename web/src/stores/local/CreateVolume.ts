import { parseFile, Srt } from '@/util/file';
import { createUuid } from '@/util/uuid';

import type {
  LocalVolumeChapterSourceRange,
  LocalBookMetadata,
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
  sourceRanges?: LocalVolumeChapterSourceRange[];
};

export const createVolume = async (
  dao: LocalVolumeDao,
  file: File,
  favoredId: string,
) => {
  const id = file.name;
  if ((await dao.getMetadata(id)) !== undefined) {
    throw Error('小说已经存在');
  }

  const chapters: ImportedChapter[] = [];
  let navigation: LocalVolumeNavigationEntry[] | undefined;

  const myFile = await parseFile(file);
  const embeddedCover = myFile.type === 'epub' ? myFile.getCover() : undefined;
  const sourceBookMetadata: LocalBookMetadata =
    myFile.type === 'epub'
      ? myFile.getBookMetadata()
      : {
          title: file.name.replace(/\.[^.]+$/, ''),
          authors: [],
          languages: ['ja'],
        };

  if (myFile.type === 'txt') {
    const lines = myFile.text.split('\n');
    const chunkSize = 1000;
    for (let i = 0; i < lines.length; i += chunkSize) {
      const paragraphs = lines.slice(i, i + chunkSize);
      chapters.push({
        chapterId: i.toString(),
        title: `第 ${i / chunkSize + 1} 段`,
        paragraphs,
      });
    }
  } else if (myFile.type === 'epub') {
    const plan = createEpubImportPlan(myFile);
    chapters.push(...plan.chapters);
    navigation = plan.navigation;
  } else if (myFile.type === 'srt') {
    const lines = myFile.subtitles
      .flatMap((it) => it.text)
      .map((it) => Srt.cleanFormat(it));
    chapters.push({ chapterId: '0', title: '字幕', paragraphs: lines });
  }

  for (const { chapterId, paragraphs, sourceRanges } of chapters) {
    await dao.createChapter({
      id: `${id}/${chapterId}`,
      volumeId: id,
      paragraphs,
      segmentIds: paragraphs.map(() => createUuid()),
      sourceRanges,
    });
  }
  await dao.createMetadata({
    id,
    createAt: Date.now(),
    toc: chapters.map<LocalVolumeTocEntry>((it) => ({
      chapterId: it.chapterId,
      title: it.title,
      level: it.level,
      parentChapterId: it.parentChapterId,
    })),
    navigation,
    sourceFormat: myFile.type,
    glossaryId: createUuid(),
    glossary: {},
    favoredId,
    sourceBookMetadata,
  });
  await dao.createFile(id, file);
  if (embeddedCover !== undefined) {
    await dao.putReaderCover({
      bookId: id,
      blob: embeddedCover,
      source: 'embedded',
      updatedAt: Date.now(),
    });
  }
};
