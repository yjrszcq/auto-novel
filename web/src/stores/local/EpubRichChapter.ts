import type { LocalVolumeChapter } from '@/model/LocalVolume';
import type {
  ReaderEpubChapterContent,
  ReaderEpubDocumentSlice,
} from '@/model/Reader';
import type { Epub } from '@/util/file/epub';

import { getEpubTextBlockElements } from './EpubParser';

const attributesToRecord = (element: Element) =>
  Object.fromEntries(
    Array.from(element.attributes).map((attribute) => [
      attribute.name,
      attribute.value,
    ]),
  );

const decodeFragment = (fragment: string) => {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
};

const findFragmentTarget = (doc: Document, fragment: string | undefined) => {
  if (!fragment) return undefined;
  const decoded = decodeFragment(fragment);
  return (
    doc.getElementById(decoded) ??
    Array.from(doc.getElementsByTagName('a')).find(
      (element) => element.getAttribute('name') === decoded,
    )
  );
};

const setRangeStart = (
  range: Range,
  doc: Document,
  blocks: readonly Element[],
  start: number,
  fragment: string | undefined,
) => {
  const target = findFragmentTarget(doc, fragment);
  if (target !== undefined) range.setStartBefore(target);
  else if (start > 0 && blocks[start] !== undefined)
    range.setStartBefore(blocks[start]);
  else range.setStart(doc.body, 0);
};

const setRangeEnd = (
  range: Range,
  doc: Document,
  blocks: readonly Element[],
  end: number,
  fragment: string | undefined,
) => {
  const target = findFragmentTarget(doc, fragment);
  if (target !== undefined) range.setEndBefore(target);
  else if (end < blocks.length && blocks[end] !== undefined)
    range.setEndBefore(blocks[end]);
  else range.setEnd(doc.body, doc.body.childNodes.length);
};

const serializeFragment = (fragment: DocumentFragment) => {
  const serializer = new XMLSerializer();
  return Array.from(fragment.childNodes)
    .map((node) => serializer.serializeToString(node))
    .join('');
};

const createDocumentSlice = (
  epub: Epub,
  chapter: LocalVolumeChapter,
  rangeIndex: number,
  segmentOffset: number,
): ReaderEpubDocumentSlice | undefined => {
  const sourceRange = chapter.sourceRanges?.[rangeIndex];
  if (sourceRange === undefined) return undefined;
  const resource = epub.getResourceByPath(sourceRange.href);
  if (resource === undefined || !('doc' in resource)) return undefined;

  const doc = resource.doc.cloneNode(true) as Document;
  const blocks = getEpubTextBlockElements(doc);
  for (let index = sourceRange.start; index < sourceRange.end; index += 1) {
    const segmentId =
      chapter.segmentIds[segmentOffset + index - sourceRange.start];
    if (segmentId !== undefined) {
      blocks[index]?.setAttribute('data-reader-segment-id', segmentId);
    }
  }

  const selection = doc.createRange();
  setRangeStart(
    selection,
    doc,
    blocks,
    sourceRange.start,
    sourceRange.startFragment,
  );
  setRangeEnd(selection, doc, blocks, sourceRange.end, sourceRange.endFragment);

  return {
    sourcePath: resource.path,
    content: serializeFragment(selection.cloneContents()),
    inlineStyles: Array.from(doc.head.querySelectorAll('style'))
      .map((element) => element.textContent ?? '')
      .filter(Boolean),
    stylesheetHrefs: Array.from(
      doc.head.querySelectorAll<HTMLLinkElement>('link[href]'),
    )
      .filter((element) =>
        element.rel
          .split(/\s+/)
          .some((value) => value.toLowerCase() === 'stylesheet'),
      )
      .map((element) => element.getAttribute('href')!)
      .filter(Boolean),
    documentAttributes: attributesToRecord(doc.documentElement),
    bodyAttributes: attributesToRecord(doc.body),
  };
};

export const createEpubRichChapter = (
  epub: Epub,
  chapter: LocalVolumeChapter,
): ReaderEpubChapterContent | undefined => {
  if (!chapter.sourceRanges?.length) return undefined;
  const documents: ReaderEpubDocumentSlice[] = [];
  let segmentOffset = 0;
  chapter.sourceRanges.forEach((sourceRange, rangeIndex) => {
    const slice = createDocumentSlice(epub, chapter, rangeIndex, segmentOffset);
    if (slice !== undefined) documents.push(slice);
    segmentOffset += sourceRange.end - sourceRange.start;
  });
  return documents.length > 0 ? { documents } : undefined;
};
