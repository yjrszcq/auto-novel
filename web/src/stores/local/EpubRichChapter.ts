import type { LocalVolumeChapter } from '@/model/LocalVolume';
import type {
  ReaderEpubChapterContent,
  ReaderEpubDocumentSlice,
  ReaderEpubLinkTarget,
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

const getDocumentViewport = (doc: Document) => {
  const content = Array.from(doc.head.querySelectorAll('meta[name]'))
    .find((meta) => meta.getAttribute('name')?.toLowerCase() === 'viewport')
    ?.getAttribute('content');
  if (!content) return undefined;
  const values = Object.fromEntries(
    content.split(',').flatMap((entry) => {
      const [key, value] = entry.split('=').map((part) => part.trim());
      return key && value ? [[key.toLowerCase(), Number(value)]] : [];
    }),
  );
  return Number.isFinite(values.width) && Number.isFinite(values.height)
    ? { width: values.width, height: values.height }
    : undefined;
};

const getAnchorBlockIndex = (anchor: Element, blocks: readonly Element[]) => {
  const containing = blocks.findIndex(
    (block) => block === anchor || block.contains(anchor),
  );
  if (containing >= 0) return containing;
  const following = blocks.findIndex(
    (block) =>
      (anchor.compareDocumentPosition(block) &
        Node.DOCUMENT_POSITION_FOLLOWING) !==
      0,
  );
  return following >= 0 ? following : Math.max(0, blocks.length - 1);
};

export const createEpubLinkTargets = (
  epub: Epub,
  chapters: readonly LocalVolumeChapter[],
) => {
  const targets = new Map<string, ReaderEpubLinkTarget>();
  for (const chapter of chapters) {
    const chapterId = chapter.id.startsWith(`${chapter.volumeId}/`)
      ? chapter.id.slice(chapter.volumeId.length + 1)
      : chapter.id;
    let segmentOffset = 0;
    for (const range of chapter.sourceRanges ?? []) {
      const resource = epub.getResourceByPath(range.href);
      if (resource === undefined || !('doc' in resource)) continue;
      const blocks = getEpubTextBlockElements(resource.doc);
      const baseSegmentId = chapter.segmentIds[segmentOffset];
      if (!targets.has(resource.path)) {
        targets.set(resource.path, {
          href: resource.path,
          chapterId,
          ...(baseSegmentId === undefined ? {} : { segmentId: baseSegmentId }),
        });
      }
      const anchors = Array.from(
        resource.doc.body.querySelectorAll<HTMLElement>('[id], a[name]'),
      );
      for (const anchor of anchors) {
        const fragment = anchor.id || anchor.getAttribute('name');
        if (!fragment) continue;
        const blockIndex = getAnchorBlockIndex(anchor, blocks);
        const belongsToRange =
          range.start === range.end
            ? blocks.length === 0
            : blockIndex >= range.start && blockIndex < range.end;
        if (!belongsToRange) continue;
        const href = `${resource.path}#${fragment}`;
        if (targets.has(href)) continue;
        const segmentId =
          chapter.segmentIds[segmentOffset + blockIndex - range.start];
        targets.set(href, {
          href,
          chapterId,
          ...(segmentId === undefined ? {} : { segmentId }),
        });
      }
      segmentOffset += range.end - range.start;
    }
  }
  return Array.from(targets.values());
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
  const viewport = getDocumentViewport(doc);

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
    layout: epub.getRenditionLayout(resource.path),
    ...(viewport === undefined ? {} : { viewport }),
  };
};

export const createEpubRichChapter = (
  epub: Epub,
  chapter: LocalVolumeChapter,
  linkTargets: ReaderEpubLinkTarget[] = [],
): ReaderEpubChapterContent | undefined => {
  if (!chapter.sourceRanges?.length) return undefined;
  const documents: ReaderEpubDocumentSlice[] = [];
  let segmentOffset = 0;
  chapter.sourceRanges.forEach((sourceRange, rangeIndex) => {
    const slice = createDocumentSlice(epub, chapter, rangeIndex, segmentOffset);
    if (slice !== undefined) documents.push(slice);
    segmentOffset += sourceRange.end - sourceRange.start;
  });
  return documents.length > 0
    ? {
        documents,
        resources: Array.from(epub.items.values()).flatMap((resource) =>
          'blob' in resource
            ? [
                {
                  path: resource.path,
                  mediaType: resource.mediaType,
                  blob: resource.blob,
                },
              ]
            : [],
        ),
        linkTargets,
      }
    : undefined;
};
