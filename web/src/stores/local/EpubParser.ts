export const injectEpubParagraphTranslations = (
  doc: Document,
  mode: 'zh' | 'jp-zh' | 'zh-jp',
  translationsByParagraph: readonly (readonly string[])[],
) => {
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
      element.setAttribute('style', 'opacity:0.4;');
    } else {
      element.before(...translatedElements);
      element.setAttribute('style', 'opacity:0.4;');
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

export const getEpubTextBlockElements = (doc: Document) =>
  Array.from(doc.body.querySelectorAll(TEXT_BLOCK_SELECTOR)).filter(
    (element) =>
      getEpubTextBlockText(element).length > 0 &&
      !Array.from(element.querySelectorAll(TEXT_BLOCK_SELECTOR)).some(
        (child) => child !== element && getEpubTextBlockText(child).length > 0,
      ),
  );

// Kept as an EPUB-export API alias; EPUB text units now include semantic block
// content rather than silently discarding headings, list items, and tables.
export const getEpubTextParagraphElements = getEpubTextBlockElements;
