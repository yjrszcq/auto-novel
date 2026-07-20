import type { LocalBookMetadata } from '@/model/LocalVolume';

export interface TxtEpubExportChapter {
  id: string;
  title: string;
  parentChapterId?: string;
  paragraphs: string[];
}

interface TxtEpubExportOptions {
  filename: string;
  metadata: LocalBookMetadata;
  chapters: TxtEpubExportChapter[];
  cover?: Blob;
}

const EPUB_MIMETYPE = 'application/epub+zip';

const escapeXml = (value: string) =>
  value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const coverExtension = (type: string) =>
  ({
    'image/gif': 'gif',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/svg+xml': 'svg',
    'image/webp': 'webp',
  })[type];

const renderNavigation = (chapters: TxtEpubExportChapter[]) => {
  type NavigationNode = {
    chapter: TxtEpubExportChapter;
    index: number;
    children: NavigationNode[];
  };
  const nodes = chapters.map((chapter, index) => ({
    chapter,
    index,
    children: [],
  }));
  const byId = new Map(nodes.map((node) => [node.chapter.id, node]));
  const roots: NavigationNode[] = [];
  nodes.forEach((node) => {
    const parent = node.chapter.parentChapterId
      ? byId.get(node.chapter.parentChapterId)
      : undefined;
    if (parent === undefined || parent.index >= node.index) roots.push(node);
    else parent.children.push(node);
  });
  const renderNodes = (items: NavigationNode[]): string =>
    `<ol>${items
      .map(
        ({ chapter, index, children }) =>
          `<li><a href="text/chapter-${index + 1}.xhtml">${escapeXml(chapter.title)}</a>${children.length ? renderNodes(children) : ''}</li>`,
      )
      .join('')}</ol>`;
  return renderNodes(roots);
};

export const createTxtEpub = async ({
  filename,
  metadata,
  chapters,
  cover,
}: TxtEpubExportOptions) => {
  if (chapters.length === 0) throw new Error('TXT 书籍没有可导出的章节');
  const title = metadata.title?.trim() || filename.replace(/\.epub$/i, '');
  const languages = metadata.languages?.length ? metadata.languages : ['ja'];
  const primaryLanguage = languages[0] ?? 'ja';
  const coverExt = cover === undefined ? undefined : coverExtension(cover.type);
  if (cover !== undefined && coverExt === undefined)
    throw new Error(`不支持的封面图片格式：${cover.type || '未知'}`);

  const chapterDocuments = chapters.map(
    (chapter) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${escapeXml(primaryLanguage)}">
<head><title>${escapeXml(chapter.title)}</title><link rel="stylesheet" type="text/css" href="../styles.css"/></head>
<body><h1>${escapeXml(chapter.title)}</h1>${chapter.paragraphs
      .map((paragraph) => `<p>${escapeXml(paragraph)}</p>`)
      .join('')}</body>
</html>`,
  );
  const navigation = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(primaryLanguage)}">
<head><title>目录</title></head>
<body><nav epub:type="toc" id="toc"><h1>目录</h1>${renderNavigation(chapters)}</nav></body>
</html>`;
  const coverManifest = coverExt
    ? '<item id="cover-image" href="images/cover.' +
      coverExt +
      `" media-type="${escapeXml(cover!.type)}" properties="cover-image"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>`
    : '';
  const coverMetadata = coverExt
    ? '<meta name="cover" content="cover-image"/>'
    : '';
  const coverSpine = coverExt
    ? '<itemref idref="cover-page" linear="no"/>'
    : '';
  const packageDocument = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="book-id">urn:auto-novel:${escapeXml(filename)}</dc:identifier>
<dc:title>${escapeXml(title)}</dc:title>
${(metadata.authors ?? []).map((author) => `<dc:creator>${escapeXml(author)}</dc:creator>`).join('')}
${metadata.description ? `<dc:description>${escapeXml(metadata.description)}</dc:description>` : ''}
${languages.map((language) => `<dc:language>${escapeXml(language)}</dc:language>`).join('')}
<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</meta>${coverMetadata}
</metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="style" href="styles.css" media-type="text/css"/>${coverManifest}${chapters
    .map(
      (_, index) =>
        `<item id="chapter-${index + 1}" href="text/chapter-${index + 1}.xhtml" media-type="application/xhtml+xml"/>`,
    )
    .join('')}</manifest>
<spine>${coverSpine}${chapters.map((_, index) => `<itemref idref="chapter-${index + 1}"/>`).join('')}</spine>
</package>`;
  const coverDocument = coverExt
    ? `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${escapeXml(primaryLanguage)}">
<head><title>封面</title><style>html,body{margin:0;padding:0;text-align:center}img{max-width:100%;max-height:100vh}</style></head>
<body><img src="images/cover.${coverExt}" alt="封面"/></body>
</html>`
    : undefined;
  const stylesheet = `body{font-family:serif;line-height:1.8;margin:5%;}h1{font-size:1.5em;margin:0 0 1.5em;}p{margin:0 0 .8em;white-space:pre-wrap;overflow-wrap:anywhere;}`;

  const { BlobReader, BlobWriter, TextReader, ZipWriter } =
    await import('@zip.js/zip.js');
  const writer = new ZipWriter(new BlobWriter(EPUB_MIMETYPE));
  await writer.add('mimetype', new TextReader(EPUB_MIMETYPE), { level: 0 });
  await writer.add(
    'META-INF/container.xml',
    new TextReader(`<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`),
  );
  await writer.add('OEBPS/content.opf', new TextReader(packageDocument));
  await writer.add('OEBPS/nav.xhtml', new TextReader(navigation));
  await writer.add('OEBPS/styles.css', new TextReader(stylesheet));
  for (let index = 0; index < chapterDocuments.length; index += 1) {
    await writer.add(
      `OEBPS/text/chapter-${index + 1}.xhtml`,
      new TextReader(chapterDocuments[index]!),
    );
  }
  if (cover !== undefined && coverExt !== undefined) {
    await writer.add('OEBPS/cover.xhtml', new TextReader(coverDocument!));
    await writer.add(`OEBPS/images/cover.${coverExt}`, new BlobReader(cover));
  }
  return writer.close();
};
