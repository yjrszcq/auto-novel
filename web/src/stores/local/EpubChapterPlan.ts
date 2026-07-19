import type { EpubNavigationItem } from '@/util/file/epub';
import type { Epub } from '@/util/file/epub';

import { getEpubTextBlockElements, getEpubTextBlockText } from './EpubParser';

interface EpubChapterSourceRange {
  href: string;
  start: number;
  end: number;
  startFragment?: string;
  endFragment?: string;
}

export interface EpubChapterPlanItem {
  chapterId: string;
  title: string;
  paragraphs: string[];
  sourceRanges: EpubChapterSourceRange[];
}

export interface EpubChapterPlanSource {
  href: string;
  title?: string;
  paragraphs: string[];
  anchors?: Record<string, number>;
  hasContent?: boolean;
}

export interface EpubNavigationPlanItem {
  id: string;
  title: string;
  level: number;
  href?: string;
  chapterId?: string;
  parentId?: string;
}

export interface EpubImportPlan {
  chapters: EpubChapterPlanItem[];
  navigation: EpubNavigationPlanItem[];
  sources: EpubChapterPlanSource[];
}

type EpubNavigationTarget = {
  href: string;
  text: string;
};

type EpubChapterLocation = EpubNavigationTarget & {
  sourceIndex: number;
  paragraphIndex: number;
  fragment?: string;
};

const splitHref = (href: string) => {
  const separator = href.indexOf('#');
  return separator < 0
    ? { href, fragment: undefined }
    : {
        href: href.slice(0, separator),
        fragment: href.slice(separator + 1),
      };
};

const collectNavigationTargets = (
  nodes: readonly EpubNavigationItem[],
  targets: EpubNavigationTarget[] = [],
  seen = new Set<string>(),
) => {
  for (const node of nodes) {
    if (node.href !== undefined && !seen.has(node.href)) {
      seen.add(node.href);
      targets.push({ href: node.href, text: node.text });
    }
    collectNavigationTargets(node.children, targets, seen);
  }
  return targets;
};

const createFallbackPlan = (
  sources: readonly EpubChapterPlanSource[],
): EpubChapterPlanItem[] => {
  const hrefOccurrences = new Map<string, number>();
  return sources
    .filter((source) => source.paragraphs.length > 0 || source.hasContent)
    .map((source, index) => ({
      chapterId: (() => {
        const occurrence = hrefOccurrences.get(source.href) ?? 0;
        hrefOccurrences.set(source.href, occurrence + 1);
        return occurrence === 0
          ? source.href
          : `${source.href}::spine-${index}`;
      })(),
      title: source.title?.trim() || `第 ${index + 1} 章`,
      paragraphs: [...source.paragraphs],
      sourceRanges: [
        {
          href: source.href,
          start: 0,
          end: source.paragraphs.length,
        },
      ],
    }));
};

const getChapterLocations = (
  navigation: readonly EpubNavigationItem[],
  sources: readonly EpubChapterPlanSource[],
) => {
  const sourceIndexByHref = new Map<string, number>();
  sources.forEach((source, index) => {
    if (!sourceIndexByHref.has(source.href)) {
      sourceIndexByHref.set(source.href, index);
    }
  });
  const locations: EpubChapterLocation[] = [];
  for (const target of collectNavigationTargets(navigation)) {
    const { href, fragment } = splitHref(target.href);
    const sourceIndex = sourceIndexByHref.get(href);
    if (sourceIndex === undefined) continue;
    const paragraphIndex = fragment
      ? (sources[sourceIndex].anchors?.[fragment] ?? 0)
      : 0;
    locations.push({ ...target, sourceIndex, paragraphIndex, fragment });
  }
  return locations;
};

const isMonotonic = (locations: readonly EpubChapterLocation[]) =>
  locations.every(
    (location, index) =>
      index === 0 ||
      location.sourceIndex > locations[index - 1].sourceIndex ||
      (location.sourceIndex === locations[index - 1].sourceIndex &&
        location.paragraphIndex >= locations[index - 1].paragraphIndex),
  );

const buildRanges = (
  location: EpubChapterLocation,
  nextLocation: EpubChapterLocation | undefined,
  sources: readonly EpubChapterPlanSource[],
) => {
  const lastSourceIndex = nextLocation?.sourceIndex ?? sources.length - 1;
  const ranges: EpubChapterSourceRange[] = [];
  for (
    let sourceIndex = location.sourceIndex;
    sourceIndex <= lastSourceIndex;
    sourceIndex += 1
  ) {
    const source = sources[sourceIndex];
    const start =
      sourceIndex === location.sourceIndex ? location.paragraphIndex : 0;
    const end =
      sourceIndex === nextLocation?.sourceIndex
        ? nextLocation.paragraphIndex
        : source.paragraphs.length;
    const endsAtNextLocation = sourceIndex === nextLocation?.sourceIndex;
    if (end > start || (source.hasContent && !endsAtNextLocation)) {
      ranges.push({
        href: source.href,
        start,
        end,
        ...(sourceIndex === location.sourceIndex && location.fragment
          ? { startFragment: location.fragment }
          : {}),
        ...(endsAtNextLocation && nextLocation?.fragment
          ? { endFragment: nextLocation.fragment }
          : {}),
      });
    }
  }
  return ranges;
};

export const buildEpubChapterPlan = (
  navigation: readonly EpubNavigationItem[],
  sources: readonly EpubChapterPlanSource[],
): EpubChapterPlanItem[] => {
  const locations = getChapterLocations(navigation, sources);
  if (locations.length === 0 || !isMonotonic(locations)) {
    return createFallbackPlan(sources);
  }
  const chapters = locations
    .map((location, index) => {
      const sourceRanges = buildRanges(location, locations[index + 1], sources);
      return {
        chapterId: location.href,
        title: location.text.trim() || `第 ${index + 1} 章`,
        paragraphs: sourceRanges.flatMap((range) => {
          const source = sources.find((item) => item.href === range.href)!;
          return source.paragraphs.slice(range.start, range.end);
        }),
        sourceRanges,
      };
    })
    .filter((chapter) => chapter.sourceRanges.length > 0);
  return chapters.length > 0 ? chapters : createFallbackPlan(sources);
};

export const buildEpubNavigationPlan = (
  navigation: readonly EpubNavigationItem[],
  chapters: readonly EpubChapterPlanItem[],
): EpubNavigationPlanItem[] => {
  const knownChapterIds = new Set(chapters.map((chapter) => chapter.chapterId));
  const result: EpubNavigationPlanItem[] = [];
  let nextId = 0;
  const visit = (
    nodes: readonly EpubNavigationItem[],
    level: number,
    parentId?: string,
  ) => {
    for (const node of nodes) {
      const id = `nav-${nextId}`;
      nextId += 1;
      result.push({
        id,
        title: node.text.trim() || '未命名章节',
        level,
        href: node.href,
        chapterId:
          node.href !== undefined && knownChapterIds.has(node.href)
            ? node.href
            : undefined,
        parentId,
      });
      visit(node.children, level + 1, id);
    }
  };
  visit(navigation, 0);
  return result.some((item) => item.chapterId !== undefined)
    ? result
    : chapters.map((chapter, index) => ({
        id: `nav-${index}`,
        title: chapter.title,
        level: 0,
        href: chapter.chapterId,
        chapterId: chapter.chapterId,
      }));
};

const createAnchors = (doc: Document, paragraphs: readonly Element[]) => {
  const elements = Array.from(doc.body.getElementsByTagName('*'));
  const paragraphIndexes = new Map(
    paragraphs.map((paragraph, index) => [paragraph, index]),
  );
  const anchors: Record<string, number> = {};
  for (const element of elements) {
    const id = element.getAttribute('id');
    if (!id) continue;
    const paragraphIndex = paragraphIndexes.get(element);
    if (paragraphIndex !== undefined) {
      anchors[id] = paragraphIndex;
      continue;
    }
    const elementIndex = elements.indexOf(element);
    const nextParagraph = paragraphs.find(
      (paragraph) => elements.indexOf(paragraph) >= elementIndex,
    );
    if (nextParagraph !== undefined) {
      anchors[id] = paragraphIndexes.get(nextParagraph)!;
    }
  }
  return anchors;
};

const collectNavigationDocumentPaths = (
  epub: Epub,
  nodes = epub.navItems,
  result: string[] = [],
) => {
  for (const node of nodes) {
    if (node.href !== undefined) {
      const path = splitHref(node.href).href;
      if (!result.includes(path)) result.push(path);
    }
    collectNavigationDocumentPaths(epub, node.children, result);
  }
  return result;
};

const createSource = (href: string, doc: Document) => {
  const paragraphElements = getEpubTextBlockElements(doc);
  return {
    href,
    title:
      doc.title.trim() ||
      doc.querySelector('h1, h2, h3, h4, h5, h6')?.textContent ||
      undefined,
    paragraphs: paragraphElements.map(getEpubTextBlockText),
    anchors: createAnchors(doc, paragraphElements),
    hasContent: doc.body.childNodes.length > 0,
  } satisfies EpubChapterPlanSource;
};

const createEpubChapterPlanSources = (epub: Epub) => {
  const sources = epub.iterDocInSpine().map((item) => {
    return {
      ...createSource(item.path, item.doc),
    };
  });
  const spinePaths = new Set(sources.map((source) => source.href));
  for (const path of collectNavigationDocumentPaths(epub)) {
    if (spinePaths.has(path)) continue;
    const resource = epub.getResourceByPath(path);
    if (resource === undefined || !('doc' in resource)) continue;
    sources.push(createSource(resource.path, resource.doc));
    spinePaths.add(path);
  }
  return sources;
};

export const createEpubImportPlan = (epub: Epub): EpubImportPlan => {
  const sources = createEpubChapterPlanSources(epub);
  const chapters = buildEpubChapterPlan(epub.navItems, sources);
  return {
    chapters,
    navigation: buildEpubNavigationPlan(epub.navItems, chapters),
    sources,
  };
};
