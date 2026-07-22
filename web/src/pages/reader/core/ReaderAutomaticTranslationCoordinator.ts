import type {
  ChapterTranslation,
  LocalVolumeChapter,
} from '@/model/LocalVolume';
import { runWithConcurrency } from '@/domain/translate/Concurrency';
import { hasCompleteChapterTranslation } from '@/domain/translate/ChapterTranslationCompletion';
import { estimateTranslationSize } from '@/domain/translate/TranslationBudget';

import type {
  ReaderAutomaticTranslationResult,
  ReaderAutomaticTranslationSelection,
  ReaderAutomaticTranslationSession,
  ReaderAutomaticTranslationTarget,
} from './ReaderAutoTranslation';

export interface ReaderAutomaticTranslationCoordinatorDependencies {
  loadChapter: (chapterId: string) => Promise<LocalVolumeChapter | undefined>;
  translate: (
    selection: ReaderAutomaticTranslationSelection,
    originals: string[],
    glossary: ChapterTranslation['glossary'],
    signal: AbortSignal,
    onTranslated: (
      lines: Array<{ index: number; translated: string }>,
    ) => Promise<void>,
  ) => Promise<string[]>;
  commit: (
    selection: ReaderAutomaticTranslationSelection,
    chapterId: string,
    translation: ChapterTranslation,
  ) => Promise<void>;
  persistDraft?: (
    selection: ReaderAutomaticTranslationSelection,
    chapter: LocalVolumeChapter,
    values: ReaderAutomaticTranslationResult[],
  ) => Promise<boolean | void>;
  onChapterAlreadyComplete?: (
    selection: ReaderAutomaticTranslationSelection,
    chapterId: string,
  ) => Promise<void> | void;
  onDraft?: (
    selection: ReaderAutomaticTranslationSelection,
    values: ReaderAutomaticTranslationResult[],
  ) => void;
  onCommitted?: (
    selection: ReaderAutomaticTranslationSelection,
    chapterId: string,
  ) => void;
  onRetranslationComplete?: (
    selection: ReaderAutomaticTranslationSelection,
    chapterId: string,
    translation: ChapterTranslation,
  ) => Promise<void> | void;
}

const hasSourceText = (value: string) => value.trim().length > 0;
const hasTranslation = (value: string | undefined) =>
  (value?.trim().length ?? 0) > 0;

export const splitReaderAutomaticTranslationTargets = ({
  targets,
  maximumParagraphs,
  maximumCharacters,
  paragraphOverhead = 0,
}: {
  targets: ReaderAutomaticTranslationTarget[];
  maximumParagraphs: number;
  maximumCharacters: number;
  paragraphOverhead?: number;
}) => {
  const paragraphLimit = Number.isFinite(maximumParagraphs)
    ? Math.max(1, Math.floor(maximumParagraphs))
    : 1;
  const characterLimit = Number.isFinite(maximumCharacters)
    ? Math.max(1, maximumCharacters)
    : 1;
  const overhead = Number.isFinite(paragraphOverhead)
    ? Math.max(0, paragraphOverhead)
    : 0;
  const groups = new Map<string, ReaderAutomaticTranslationTarget[]>();
  targets.forEach((target) => {
    const group = groups.get(target.chapterId) ?? [];
    group.push(target);
    groups.set(target.chapterId, group);
  });
  return [...groups.entries()].flatMap(([chapterId, values]) => {
    const chunks: Array<{
      chapterId: string;
      targets: ReaderAutomaticTranslationTarget[];
    }> = [];
    let chunk: ReaderAutomaticTranslationTarget[] = [];
    let chunkSize = 0;
    const flush = () => {
      if (chunk.length === 0) return;
      chunks.push({ chapterId, targets: chunk });
      chunk = [];
      chunkSize = 0;
    };
    values
      .sort((left, right) => left.segmentIndex - right.segmentIndex)
      .forEach((target) => {
        const targetSize = estimateTranslationSize(target.original) + overhead;
        if (
          chunk.length >= paragraphLimit ||
          (chunk.length > 0 && chunkSize + targetSize > characterLimit)
        ) {
          flush();
        }
        chunk.push(target);
        chunkSize += targetSize;
      });
    flush();
    return chunks;
  });
};

const reusableParagraphs = (
  chapter: LocalVolumeChapter,
  selection: ReaderAutomaticTranslationSelection,
) => {
  if ((selection.purpose ?? 'automatic') === 'retranslate') return undefined;
  const persisted = chapter[selection.source];
  return persisted?.glossaryId === selection.glossaryId
    ? persisted.paragraphs
    : undefined;
};

export const buildCompleteReaderChapterTranslation = ({
  chapter,
  chapterId,
  selection,
  session,
}: {
  chapter: LocalVolumeChapter;
  chapterId: string;
  selection: ReaderAutomaticTranslationSelection;
  session: ReaderAutomaticTranslationSession;
}): ChapterTranslation | undefined => {
  const persisted = reusableParagraphs(chapter, selection);
  const paragraphs = chapter.paragraphs.map((original, index) => {
    if (!hasSourceText(original)) return '';
    const cached = session.get(
      selection,
      chapterId,
      chapter.segmentIds[index]!,
    );
    return cached ?? persisted?.[index];
  });
  if (
    paragraphs.some(
      (translated, index) =>
        hasSourceText(chapter.paragraphs[index]!) &&
        !hasTranslation(translated),
    )
  ) {
    return undefined;
  }
  return {
    glossaryId: selection.glossaryId,
    glossary: {},
    paragraphs,
  };
};

export class ReaderAutomaticTranslationCoordinator {
  private readonly completingChapters = new Set<string>();

  constructor(
    private readonly session: ReaderAutomaticTranslationSession,
    private readonly dependencies: ReaderAutomaticTranslationCoordinatorDependencies,
  ) {}

  async translateTargets({
    generation,
    selection,
    targets,
    glossary,
    concurrency,
    maximumChunkParagraphs = Number.MAX_SAFE_INTEGER,
    maximumChunkCharacters = Number.MAX_SAFE_INTEGER,
    chunkParagraphOverhead = 0,
    signal,
  }: {
    generation: number;
    selection: ReaderAutomaticTranslationSelection;
    targets: ReaderAutomaticTranslationTarget[];
    glossary: ChapterTranslation['glossary'];
    concurrency: number;
    maximumChunkParagraphs?: number;
    maximumChunkCharacters?: number;
    chunkParagraphOverhead?: number;
    signal: AbortSignal;
  }) {
    const groups = splitReaderAutomaticTranslationTargets({
      targets,
      maximumParagraphs: maximumChunkParagraphs,
      maximumCharacters: maximumChunkCharacters,
      paragraphOverhead: chunkParagraphOverhead,
    });
    await runWithConcurrency(
      groups,
      Math.max(1, concurrency),
      async ({ chapterId, targets: chapterTargets }, _index, workerSignal) => {
        const chapter = await this.dependencies.loadChapter(chapterId);
        if (chapter === undefined) throw new Error('章节不存在');
        if (
          (selection.purpose ?? 'automatic') === 'automatic' &&
          hasCompleteChapterTranslation(chapter)
        ) {
          this.session.clearChapter(selection, chapterId);
          await this.dependencies.onChapterAlreadyComplete?.(
            selection,
            chapterId,
          );
          return;
        }
        if (
          chapterTargets.some(
            ({ segmentId, segmentIndex, original }) =>
              chapter.segmentIds[segmentIndex] !== segmentId ||
              chapter.paragraphs[segmentIndex] !== original,
          )
        ) {
          throw new Error('阅读内容已更新，请重新规划自动翻译');
        }
        const persisted = reusableParagraphs(chapter, selection);
        const missingTargets = chapterTargets.filter(
          ({ segmentIndex }) => !hasTranslation(persisted?.[segmentIndex]),
        );
        const claimed = this.session.claim(generation, missingTargets);
        if (claimed.length === 0) {
          const complete = buildCompleteReaderChapterTranslation({
            chapter,
            chapterId,
            selection,
            session: this.session,
          });
          if (
            complete === undefined ||
            !this.session.accepts(generation) ||
            workerSignal.aborted
          ) {
            return;
          }
          complete.glossary = { ...glossary };
          if (this.completingChapters.has(chapterId)) return;
          this.completingChapters.add(chapterId);
          if ((selection.purpose ?? 'automatic') === 'retranslate') {
            await this.dependencies.onRetranslationComplete?.(
              selection,
              chapterId,
              complete,
            );
            return;
          }
          await this.dependencies.commit(selection, chapterId, complete);
          this.dependencies.onCommitted?.(selection, chapterId);
          return;
        }
        try {
          const acceptedIndexes = new Set<number>();
          let completedExternally = false;
          const acceptTranslated = async (
            lines: Array<{ index: number; translated: string }>,
          ) => {
            if (completedExternally || lines.length === 0) return;
            const indexes = new Set<number>();
            const values = lines.map(({ index, translated }) => {
              const target = claimed[index];
              if (
                target === undefined ||
                indexes.has(index) ||
                acceptedIndexes.has(index)
              ) {
                throw new Error('翻译结果段落索引不匹配');
              }
              if (!hasTranslation(translated)) {
                throw new Error('翻译结果包含空白内容');
              }
              indexes.add(index);
              return {
                chapterId: target.chapterId,
                segmentId: target.segmentId,
                translated,
              };
            });
            if (!this.session.accepts(generation) || workerSignal.aborted) {
              return;
            }
            const persisted = await this.dependencies.persistDraft?.(
              selection,
              chapter,
              values,
            );
            if (persisted === false) {
              completedExternally = true;
              this.session.release(generation, claimed);
              await this.dependencies.onChapterAlreadyComplete?.(
                selection,
                chapterId,
              );
              return;
            }
            if (
              !this.session.store(generation, values) ||
              workerSignal.aborted
            ) {
              return;
            }
            indexes.forEach((index) => acceptedIndexes.add(index));
            this.dependencies.onDraft?.(selection, values);
          };
          const translated = await this.dependencies.translate(
            selection,
            claimed.map(({ original }) => original),
            glossary,
            workerSignal,
            acceptTranslated,
          );
          if (translated.length !== claimed.length) {
            throw new Error('翻译结果行数不匹配');
          }
          if (translated.some((value) => !hasTranslation(value))) {
            throw new Error('翻译结果包含空白内容');
          }
          await acceptTranslated(
            translated.flatMap((value, index) =>
              acceptedIndexes.has(index) ? [] : [{ index, translated: value }],
            ),
          );
          if (completedExternally) return;
          if (!this.session.accepts(generation) || workerSignal.aborted) {
            this.session.release(generation, claimed);
            return;
          }
          const complete = buildCompleteReaderChapterTranslation({
            chapter,
            chapterId,
            selection,
            session: this.session,
          });
          if (
            complete === undefined ||
            !this.session.accepts(generation) ||
            workerSignal.aborted
          ) {
            return;
          }
          complete.glossary = { ...glossary };
          if (this.completingChapters.has(chapterId)) return;
          this.completingChapters.add(chapterId);
          if ((selection.purpose ?? 'automatic') === 'retranslate') {
            await this.dependencies.onRetranslationComplete?.(
              selection,
              chapterId,
              complete,
            );
            return;
          }
          await this.dependencies.commit(selection, chapterId, complete);
          this.dependencies.onCommitted?.(selection, chapterId);
        } catch (cause) {
          this.session.release(generation, claimed);
          throw cause;
        }
      },
      signal,
    );
  }
}
