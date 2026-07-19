export const injectEpubParagraphTranslations = (
  doc: Document,
  mode: 'zh' | 'jp-zh' | 'zh-jp',
  translationsByParagraph: readonly (readonly string[])[],
) => {
  const dimOriginal = (element: Element) => {
    const style = element.getAttribute('style')?.trim() ?? '';
    element.setAttribute(
      'style',
      `${style}${style.length > 0 && !style.endsWith(';') ? ';' : ''}opacity:0.4;`,
    );
  };
  getEpubTextBlockElements(doc).forEach((element, index) => {
    const translations = translationsByParagraph[index] ?? [];
    if (translations.length === 0) return;
    const translatedElements = translations.map((line) => {
      const translated = element.cloneNode(false) as Element;
      translated.removeAttribute('id');
      translated.removeAttribute('name');
      translated.removeAttribute('data-reader-segment-id');
      translated.appendChild(doc.createTextNode(line));
      return translated;
    });
    if (mode === 'zh') {
      element.replaceWith(...translatedElements);
    } else if (mode === 'jp-zh') {
      element.after(...translatedElements);
      dimOriginal(element);
    } else {
      element.before(...translatedElements);
      dimOriginal(element);
    }
  });
  return doc;
};

const TEXT_BLOCK_SELECTOR = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'li',
  'dt',
  'dd',
  'figcaption',
  'blockquote',
  'pre',
  'caption',
  'th',
  'td',
  'div',
  'section',
  'article',
  'aside',
].join(',');

export const getEpubTextBlockText = (element: Element) => {
  const clone = element.cloneNode(true) as Element;
  clone
    .querySelectorAll('rt, rp, script, style, template')
    .forEach((node) => node.remove());
  return clone.textContent?.replace(/\s+/g, ' ').trim() ?? '';
};

export const getEpubTextBlockElements = (doc: Document) => {
  const candidates = Array.from(
    doc.body.querySelectorAll(TEXT_BLOCK_SELECTOR),
  ).filter((element) => getEpubTextBlockText(element).length > 0);
  const candidateSet = new Set(candidates);
  const containers = new Set<Element>();
  for (const candidate of candidates) {
    let ancestor = candidate.parentElement;
    while (ancestor !== null && ancestor !== doc.body) {
      if (candidateSet.has(ancestor)) containers.add(ancestor);
      ancestor = ancestor.parentElement;
    }
  }
  return candidates.filter((element) => !containers.has(element));
};

// Kept as an EPUB-export API alias; EPUB text units now include semantic block
// content rather than silently discarding headings, list items, and tables.
export const getEpubTextParagraphElements = getEpubTextBlockElements;
