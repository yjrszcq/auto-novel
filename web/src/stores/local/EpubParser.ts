interface EpubParser {
  extractText: (doc: Document) => string[];
  injectTranslation: (
    doc: Document,
    mode: 'zh' | 'jp-zh' | 'zh-jp',
    zhLinesList: string[][],
  ) => Document;
}

export const injectEpubParagraphTranslations = (
  doc: Document,
  mode: 'zh' | 'jp-zh' | 'zh-jp',
  translationsByParagraph: readonly (readonly string[])[],
) => {
  getEpubTextParagraphElements(doc).forEach((element, index) => {
    const translations = translationsByParagraph[index] ?? [];
    if (translations.length === 0) return;
    const translatedElements = translations.map((line) => {
      const paragraph = doc.createElement('p');
      paragraph.appendChild(doc.createTextNode(line));
      return paragraph;
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

export const getEpubTextParagraphElements = (doc: Document) => {
  Array.from(doc.getElementsByTagName('rt')).forEach((node) =>
    node.parentNode!.removeChild(node),
  );
  Array.from(doc.getElementsByTagName('rp')).forEach((node) =>
    node.parentNode!.removeChild(node),
  );
  return Array.from(doc.body.getElementsByTagName('p')).filter(
    (element) => element.innerText.trim().length !== 0,
  );
};

export const EpubParserV1: EpubParser = {
  extractText: (doc: Document) => {
    return getEpubTextParagraphElements(doc).map(
      (element) => element.innerText,
    );
  },
  injectTranslation: (
    doc: Document,
    mode: 'zh' | 'jp-zh' | 'zh-jp',
    zhLinesList: string[][],
  ) => {
    const paragraphCount = getEpubTextParagraphElements(doc).length;
    return injectEpubParagraphTranslations(
      doc,
      mode,
      Array.from({ length: paragraphCount }, (_, index) =>
        zhLinesList.flatMap((lines) =>
          lines[index] === undefined ? [] : [lines[index]],
        ),
      ),
    );
  },
};
