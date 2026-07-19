import type { Epub } from './epub';
import { Txt } from './txt';

namespace NovelMark {
  export const fromXhtml = (node: Node): string => {
    let text = '';
    const ensureNewLine = () => {
      if (!text.endsWith('\n')) text += '\n';
    };
    const xhtmlToTextInner = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent?.replaceAll(/^[ \n]+|[ \n]+$/g, '') || '';
      } else if (node instanceof Element) {
        const tagName = node.tagName.toLowerCase();
        const blockTag = ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br'];
        const skipTag = ['rp', 'rt'];
        const imageTag = 'img';

        if (tagName === imageTag) {
          const src = node.getAttribute('src')?.trim();
          if (!src) return;
          ensureNewLine();
          text += `<图片>${src}\n`;
        } else if (skipTag.includes(tagName)) {
          return;
        } else {
          if (blockTag.includes(tagName)) ensureNewLine();
          node.childNodes.forEach((child) => {
            xhtmlToTextInner(child);
          });
          if (blockTag.includes(tagName)) ensureNewLine();
        }
      }
    };
    xhtmlToTextInner(node);
    ensureNewLine();
    return text;
  };

  export const toXhtml = (doc: Document, mark: string): Element[] => {
    const elements: Element[] = [];
    for (const line of mark.split('\n')) {
      if (line.startsWith('<图片>')) {
        const el = doc.createElement('img');
        el.setAttribute('src', line.slice('<图片>'.length));
        elements.push(el);
      } else if (line.startsWith('<分割线>')) {
        const el = doc.createElement('hr');
        elements.push(el);
      } else {
        const el = document.createElement('p');
        const text = document.createTextNode(line);
        el.appendChild(text);
        elements.push(el);
      }
    }
    return elements;
  };

  export const fromText = (text: string): string => {
    const buf: string[] = [];
    for (const line of text.split('\n')) {
      if (line === '--------') {
        buf.push('<分割线>');
      } else {
        buf.push(line);
      }
    }
    return buf.join('\n');
  };

  export const toText = (nml: string): string => {
    const buf: string[] = [];
    for (const line of nml.split('\n')) {
      if (line.startsWith('<分割线>')) {
        buf.push('--------');
      } else {
        buf.push(line);
      }
    }
    return buf.join('\n');
  };
}

export interface StandardChapter {
  id: string;
  title: string;
  volumeTitles: string[];
  content: string;
}

export interface StandardNovel {
  id: string;
  title: string;
  description?: string;
  chapters: StandardChapter[];
  warnings: string[];
}

export interface StandardTxtOptions {
  includeChapterTitles: boolean;
  includeVolumeTitles: boolean;
  includeDescription: boolean;
}

export namespace StandardNovel {
  const removeExt = (str: string, ext: string) => {
    if (str.toLowerCase().endsWith(ext)) {
      return str.slice(0, -ext.length);
    }
    return str;
  };

  const contentPath = (href: string) => href.split('#', 1)[0] ?? href;

  export const validateNavigationOrder = (
    chapterPaths: string[],
    spinePaths: string[],
  ) => {
    const warnings: string[] = [];
    const spineIndexes = new Map(
      spinePaths.map((path, index) => [contentPath(path), index]),
    );
    let previousIndex = -1;
    for (const path of chapterPaths) {
      const index = spineIndexes.get(contentPath(path));
      if (index === undefined) {
        warnings.push(`目录条目未出现在正文顺序中：${path}`);
      } else if (index < previousIndex) {
        warnings.push(`目录顺序与正文顺序不一致：${path}`);
      } else {
        previousIndex = index;
      }
    }
    return warnings;
  };

  export const fromEpub = (epub: Epub): StandardNovel => {
    const chapters: StandardChapter[] = [];
    const warnings: string[] = [];
    const chapterPaths = new Set<string>();

    const traverseToc = (
      navItems: typeof epub.navItems,
      volumeTitles: string[] = [],
    ) => {
      for (const item of navItems) {
        if (item.children.length === 0 && item.href) {
          const id = contentPath(item.href);
          if (chapterPaths.has(id)) {
            warnings.push(`目录包含重复正文条目：${item.href}`);
          } else {
            chapterPaths.add(id);
            chapters.push({
              id,
              title: item.text,
              volumeTitles,
              content: '',
            });
          }
        }
        if (item.children.length > 0) {
          traverseToc(item.children, [...volumeTitles, item.text]);
        } else if (!item.href) {
          warnings.push(`目录条目缺少正文链接：${item.text}`);
        }
      }
    };
    traverseToc(epub.navItems);

    const spineDocs = epub.iterDocInSpine();
    const spinePaths = spineDocs.map((item) =>
      contentPath(epub.getCanonicalHref(item.href)),
    );
    warnings.push(
      ...validateNavigationOrder(
        chapters.map(({ id }) => id),
        spinePaths,
      ),
    );

    const chapterIndexes = new Map(
      chapters.map(({ id }, index) => [contentPath(id), index]),
    );
    let chapterIndex = -1;
    for (const item of spineDocs) {
      const matchedIndex = chapterIndexes.get(
        contentPath(epub.getCanonicalHref(item.href)),
      );
      if (matchedIndex !== undefined) chapterIndex = matchedIndex;
      if (chapterIndex >= 0) {
        const chapter = chapters[chapterIndex];
        if (chapter !== undefined) {
          chapter.content += NovelMark.fromXhtml(item.doc.body);
        }
      }
    }

    if (chapters.length === 0) warnings.push('EPUB 目录中没有可转换的章节');
    for (const chapter of chapters) {
      if (NovelMark.toText(chapter.content).trim().length === 0) {
        warnings.push(`空章节：${chapter.title}`);
      }
    }

    const metadata = epub.getBookMetadata();
    return {
      id: epub.name,
      title: metadata.title || removeExt(epub.name, '.epub'),
      description: metadata.description,
      chapters,
      warnings,
    };
  };

  export const toText = (
    novel: StandardNovel,
    options: StandardTxtOptions = {
      includeChapterTitles: true,
      includeVolumeTitles: true,
      includeDescription: false,
    },
  ) => {
    const lines: string[] = [novel.title, ''];
    if (options.includeDescription && novel.description?.trim()) {
      lines.push(novel.description.trim(), '');
    }

    let previousVolumes: string[] = [];
    for (const chapter of novel.chapters) {
      if (options.includeVolumeTitles) {
        const sharedLength = previousVolumes.findIndex(
          (title, index) => title !== chapter.volumeTitles[index],
        );
        const start = sharedLength < 0 ? previousVolumes.length : sharedLength;
        chapter.volumeTitles.slice(start).forEach((title) => {
          lines.push(`# ${title}`, '');
        });
        previousVolumes = chapter.volumeTitles;
      }
      if (options.includeChapterTitles) {
        lines.push(
          `${options.includeVolumeTitles && chapter.volumeTitles.length > 0 ? '##' : '#'} ${chapter.title}`,
        );
      }
      lines.push(NovelMark.toText(chapter.content).trimEnd(), '');
    }
    return lines.join('\n').trimEnd() + '\n';
  };

  export const toTxt = async (
    novel: StandardNovel,
    options?: StandardTxtOptions,
  ): Promise<Txt> => {
    return Txt.fromText(
      removeExt(novel.id, '.epub') + '.txt',
      toText(novel, options),
    );
  };
}
