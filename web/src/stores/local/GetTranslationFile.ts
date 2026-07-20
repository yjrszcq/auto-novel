import { parseFile } from '@/util/file';
import {
  getLocalBookMetadata,
  type LocalDownloadMode,
} from '@/model/LocalVolume';
import { formatCatalogTitleForDownload } from '@/domain/translate/CatalogTitleTranslation';

import { injectEpubParagraphTranslations } from './EpubParser';
import { collectEpubSourceTranslations } from './EpubTranslationExport';
import {
  embedEpubDownloadMetadata,
  getEpubDownloadCover,
} from './EpubDownloadMetadata';
import type { LocalVolumeDao } from './LocalVolumeDao';
import { createTxtEpub } from './TxtEpubExport';

export const getTranslationFile = async (
  dao: LocalVolumeDao,
  {
    id,
    mode,
    translationsMode,
    translations,
    embedMetadata = false,
  }: {
    id: string;
    mode: LocalDownloadMode;
    translationsMode: 'parallel' | 'priority';
    translations: ('sakura' | 'baidu' | 'youdao' | 'gpt')[];
    embedMetadata?: boolean;
  },
) => {
  const filename =
    mode === 'jp'
      ? `jp.${id}`
      : [
          mode,
          (translationsMode === 'parallel' ? 'B' : 'Y') +
            translations.map((it) => it[0]).join(''),
          id,
        ].join('.');

  const metadata = await dao.getMetadata(id);
  if (metadata === undefined) throw Error('小说不存在');

  const getZhLinesList = async (chapterId: string) => {
    const chapter = await dao.getChapter(id, chapterId);
    if (chapter === undefined) throw Error('章节不存在');

    const jpLines = chapter.paragraphs;
    const zhLinesList: Array<Array<string>> = [];

    for (const id of translations) {
      const zhLine = chapter[id]?.paragraphs;
      if (zhLine !== undefined) zhLinesList.push([...zhLine]);
    }

    if (translationsMode === 'priority' && zhLinesList.length > 1) {
      zhLinesList.length = 1;
    }

    return { jpLines, zhLinesList };
  };

  const getDownloadLines = async (chapterId: string, chapterTitle?: string) => {
    const { jpLines, zhLinesList } = await getZhLinesList(chapterId);
    const omitHeading =
      chapterTitle !== undefined && jpLines[0]?.trim() === chapterTitle.trim();
    const originalLines = omitHeading ? jpLines.slice(1) : [...jpLines];
    const translatedLinesList = zhLinesList.map((lines) =>
      omitHeading ? lines.slice(1) : lines,
    );
    if (mode === 'jp') return originalLines;
    if (translatedLinesList.length === 0) return ['// 该分段翻译缺失。'];
    const combinedLinesList = [...translatedLinesList];
    if (mode === 'jp-zh') combinedLinesList.unshift(originalLines);
    else if (mode === 'zh-jp') combinedLinesList.push(originalLines);
    const lines: string[] = [];
    for (let index = 0; index < combinedLinesList[0]!.length; index += 1) {
      combinedLinesList.forEach((values) => lines.push(values[index] ?? ''));
    }
    return lines;
  };

  const file = await dao.getFile(id);
  if (file === undefined) throw Error('原始文件不存在');

  const myFile = await parseFile(file.file);

  if (myFile.type === 'txt') {
    const chapters = [];
    for (const tocItem of metadata.toc) {
      chapters.push({
        id: tocItem.chapterId,
        title: formatCatalogTitleForDownload(tocItem, mode, translations),
        parentChapterId: tocItem.parentChapterId,
        paragraphs: await getDownloadLines(
          tocItem.chapterId,
          metadata.txtDownloadAsEpub ? tocItem.title : undefined,
        ),
      });
    }
    if (metadata.txtDownloadAsEpub) {
      const epubFilename = filename.replace(/\.txt$/i, '') + '.epub';
      return {
        filename: epubFilename,
        blob: await createTxtEpub({
          filename: epubFilename,
          metadata: getLocalBookMetadata(metadata),
          chapters,
          cover: await getEpubDownloadCover(dao, metadata),
        }),
      };
    }
    myFile.text = chapters.flatMap(({ paragraphs }) => paragraphs).join('\n');
  } else if (myFile.type === 'epub') {
    if (mode === 'jp') {
      if (embedMetadata) {
        await embedEpubDownloadMetadata(dao, myFile, metadata);
      }
      return { filename, blob: await myFile.toBlob() };
    }
    const nativeChapters = [];
    for (const tocItem of metadata.toc) {
      const chapter = await dao.getChapter(id, tocItem.chapterId);
      if (chapter === undefined) throw Error('章节不存在');
      if (chapter.sourceRanges?.length) {
        const { zhLinesList } = await getZhLinesList(tocItem.chapterId);
        if (zhLinesList.length > 0) {
          nativeChapters.push({
            sourceRanges: chapter.sourceRanges,
            translations: zhLinesList,
          });
        }
      }
    }
    const sourceTranslations = collectEpubSourceTranslations(nativeChapters);
    for (const item of myFile.iterDocInSpine()) {
      const translations = sourceTranslations.get(
        myFile.getCanonicalHref(item.href),
      );
      if (translations?.some((paragraph) => paragraph.length > 0)) {
        injectEpubParagraphTranslations(item.doc, mode, translations);
      }
    }
    const catalog = metadata.navigation?.length
      ? metadata.navigation
      : metadata.toc;
    myFile.updateNavigationTitles(
      catalog.map((entry) =>
        formatCatalogTitleForDownload(entry, mode, translations),
      ),
    );
    if (embedMetadata) {
      await embedEpubDownloadMetadata(dao, myFile, metadata);
    }
  } else if (myFile.type === 'srt') {
    if (mode === 'jp') return { filename, blob: await myFile.toBlob() };
    const { zhLinesList } = await getZhLinesList('0');
    const newSubtitles: typeof myFile.subtitles = [];
    for (const s of myFile.subtitles) {
      const texts: string[][] = [];
      for (const zhLines of zhLinesList) {
        texts.push(zhLines.slice(0, s.text.length));
        zhLines.splice(0, s.text.length);
      }
      if (mode === 'jp-zh') {
        texts.unshift(s.text);
      } else if (mode === 'zh-jp') {
        texts.push(s.text);
      }

      for (const text of texts) {
        newSubtitles.push({
          id: (newSubtitles.length + 1).toString(),
          time: s.time,
          text,
        });
      }
    }
    myFile.subtitles = newSubtitles;
  }

  return {
    filename,
    blob: await myFile.toBlob(),
  };
};
