import { BaseFile } from './base';
import { StandardNovel } from './standard';

const MIMETYPE_PATH = 'mimetype';
const MIMETYPE_TEMPLATE = 'application/epub+zip';
const DUBLIN_CORE_NAMESPACE = 'http://purl.org/dc/elements/1.1/';

const CONTAINER_PATH = 'META-INF/container.xml';
const CONTAINER_TEMPLATE = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const getEl = (doc: Document, tagName: string) =>
  doc.getElementsByTagName(tagName).item(0);

const MIME = {
  IMAGE: [
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/svg+xml',
    'image/webp',
  ],
  CSS: ['text/css'],
};

const imageExtension = (mime: string) =>
  ({
    'image/gif': 'gif',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/svg+xml': 'svg',
    'image/webp': 'webp',
  })[mime];

type EpubItemBase = {
  id: string;
  href: string;
  mediaType: string;
  overlay: string | null;
  properties: string[] | null;
  fallback: string | null;
};
type EpubItemDoc = EpubItemBase & { doc: Document };
type EpubItemBlob = EpubItemBase & { blob: Blob };
type EpubItem = EpubItemDoc | EpubItemBlob;

export interface EpubCoverManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties?: string[] | null;
}

export interface EpubBookMetadata {
  title?: string;
  authors: string[];
  description?: string;
  languages: string[];
}

const isImage = (item: EpubCoverManifestItem) =>
  MIME.IMAGE.includes(item.mediaType);

export const resolveEpubCoverId = (
  items: Iterable<EpubCoverManifestItem>,
  legacyCoverId?: string,
) => {
  const images = [...items].filter(isImage);
  return (
    images.find((item) => item.properties?.includes('cover-image'))?.id ??
    images.find((item) => item.id === legacyCoverId)?.id ??
    images.find((item) =>
      /(^|[._/-])cover([._/-]|$)|front[-_]?cover|titlepage/i.test(
        item.id + '/' + item.href,
      ),
    )?.id
  );
};

interface EpubItemref {
  idref: string;
  linear: string | null;
  properties: string[] | null;
}

export interface EpubNavigationItem {
  text: string;
  href?: string;
  children: EpubNavigationItem[];
}

export interface EpubSpineNavigationSource {
  href: string;
  title?: string;
}

export interface EpubNavigationSourceItem {
  text: string;
  href?: string | null;
  children: EpubNavigationSourceItem[];
}

export const normalizeEpubNavigationHref = (
  sourcePath: string,
  href: string | null | undefined,
) => {
  if (href === undefined || href === null || href.trim().length === 0) {
    return undefined;
  }
  const sourceUrl = new URL(sourcePath, 'file://book/');
  const targetUrl = new URL(href, sourceUrl);
  if (targetUrl.protocol !== 'file:' || targetUrl.hostname !== 'book') {
    return undefined;
  }
  return targetUrl.pathname.substring(1) + targetUrl.hash;
};

export const createSpineFallbackNavigation = (
  sources: readonly EpubSpineNavigationSource[],
): EpubNavigationItem[] =>
  sources.map((source, index) => ({
    text: source.title?.trim() || `第 ${index + 1} 章`,
    href: source.href,
    children: [],
  }));

export const normalizeEpubNavigationItems = (
  sourcePath: string,
  items: readonly EpubNavigationSourceItem[],
): EpubNavigationItem[] =>
  items.map((item) => ({
    text: item.text.trim(),
    href: normalizeEpubNavigationHref(sourcePath, item.href),
    children: normalizeEpubNavigationItems(sourcePath, item.children),
  }));

export class Epub extends BaseFile {
  type = 'epub' as const;
  packagePath: string = '';
  navigationPath: string | undefined;
  ncxPath: string | undefined;
  packageDoc!: Document;
  items = new Map<string, EpubItem>();
  itemrefs: EpubItemref[] = [];
  navItems: EpubNavigationItem[] = [];
  private legacyCoverId: string | undefined;

  private resolve(root: string, rpath: string) {
    const rootUrl = new URL(root, 'file://book/');
    const newURL = new URL(rpath, rootUrl);
    return newURL.pathname.substring(1);
  }

  getCanonicalHref(href: string) {
    return this.resolve(this.packagePath, href);
  }

  private updateHref(oldHref: string, newHref: string) {
    // TODO
  }

  // ==============================
  // 读取文件内容
  // ==============================

  private parseProperties(attr: string | null) {
    if (!attr) return null;
    return attr.split(' ').filter((prop) => prop);
  }

  private parseContainer(doc: Document) {
    const rootfile = getEl(doc, 'rootfile');
    if (!rootfile) throw new Error('Container does not have rootfile');
    const packagePath = rootfile.getAttribute('full-path');
    if (!packagePath) throw new Error('Container does not have package path');
    this.packagePath = packagePath;
  }

  private parsePackage(doc: Document) {
    const metadata = getEl(doc, 'metadata');
    if (!metadata) throw new Error('Package does not have metadata');
    const manifest = getEl(doc, 'manifest');
    if (!manifest) throw new Error('Package does not have manifest');
    const spine = getEl(doc, 'spine');
    if (!spine) throw new Error('Package does not have spine');

    this.packageDoc = doc;
    this.legacyCoverId =
      Array.from(metadata.getElementsByTagName('meta'))
        .find((meta) => meta.getAttribute('name')?.toLowerCase() === 'cover')
        ?.getAttribute('content') ?? undefined;
    this.parseManifest(manifest);
    this.parseSpine(spine);
  }

  private parseManifest(el: Element) {
    for (const itemEl of Array.from(el.getElementsByTagName('item'))) {
      const id = itemEl.getAttribute('id');
      if (!id) throw new Error('Manifest item does not have id');
      const href = itemEl.getAttribute('href');
      if (!href) throw new Error('Manifest item does not have href');
      const mediaType = itemEl.getAttribute('media-type');
      if (!mediaType) throw new Error('Manifest item does not have media type');
      const overlay = itemEl.getAttribute('media-overlay');
      const properties = itemEl.getAttribute('properties');
      const fallback = itemEl.getAttribute('fallback');

      const itemBase: EpubItemBase = {
        id,
        href,
        mediaType,
        overlay,
        properties: this.parseProperties(properties),
        fallback,
      };
      this.items.set(id, itemBase as EpubItem);
    }

    const navHref = Array.from(this.items.values()).find(({ properties }) =>
      properties?.includes('nav'),
    )?.href;
    this.navigationPath = navHref && this.resolve(this.packagePath, navHref);
  }

  private parseSpine(el: Element) {
    for (const itemEl of Array.from(el.getElementsByTagName('itemref'))) {
      const idref = itemEl.getAttribute('idref');
      if (!idref) throw new Error('Spine itemref does not have idref');
      if (!this.items.has(idref))
        throw new Error('Spine itemref idref not in manifest');
      const linear = itemEl.getAttribute('linear');
      const properties = itemEl.getAttribute('properties');

      const itemref: EpubItemref = {
        idref,
        linear,
        properties: this.parseProperties(properties),
      };
      this.itemrefs.push(itemref);
    }
    const tocIdref = el.getAttribute('toc');
    if (tocIdref) {
      const tocItem = this.items.get(tocIdref);
      const tocItemHref = tocItem?.href;
      this.ncxPath = tocItemHref && this.resolve(this.packagePath, tocItemHref);
    }
  }

  private parseNavigationDocument(doc: Document) {
    if (this.navigationPath === undefined) {
      throw new Error('Navigation document path is missing');
    }
    const parseTocList = (olEl: Element): EpubNavigationSourceItem[] => {
      const items: EpubNavigationSourceItem[] = [];

      olEl.querySelectorAll(':scope > li').forEach((liEl) => {
        const linkEl = liEl.querySelector(':scope > a, :scope > span');
        if (!linkEl) throw new Error('Nav toc item does not have link');

        const item: EpubNavigationSourceItem = {
          text: linkEl.textContent?.trim() || '',
          href: linkEl.getAttribute('href'),
          children: [],
        };
        const childOlEl = liEl.querySelector(':scope > ol');
        if (childOlEl) item.children = parseTocList(childOlEl);
        items.push(item);
      });
      return items;
    };
    const navEls = Array.from(doc.getElementsByTagName('nav'));
    const tocNavEl =
      navEls.find(
        (navEl) =>
          navEl.getAttribute('epub:type') === 'toc' ||
          navEl.getAttribute('type') === 'toc',
      ) ?? navEls.find((navEl) => navEl.id === 'toc'); // 为了兼容不标准的epub
    const tocOlEl = tocNavEl?.querySelector(':scope > ol');
    if (!tocOlEl) throw new Error('Nav toc not exist');
    this.navItems = normalizeEpubNavigationItems(
      this.navigationPath,
      parseTocList(tocOlEl),
    );
  }

  private parseNcx(doc: Document) {
    if (this.ncxPath === undefined) {
      throw new Error('NCX path is missing');
    }
    const parseNavPoints = (parent: Element): EpubNavigationSourceItem[] =>
      Array.from(parent.children)
        .filter((element) => element.localName === 'navPoint')
        .map((navPointEl) => {
          const navLabel = Array.from(navPointEl.children).find(
            (element) => element.localName === 'navLabel',
          );
          if (!navLabel) throw new Error('Nav point does not have label');
          const content = Array.from(navPointEl.children).find(
            (element) => element.localName === 'content',
          );
          if (!content) throw new Error('Nav point does not have content');
          return {
            text: navLabel.textContent?.trim() || '',
            href: content.getAttribute('src'),
            children: parseNavPoints(navPointEl),
          };
        });

    const navMap = doc.getElementsByTagName('navMap').item(0);
    if (!navMap) throw new Error('NCX navMap does not exist');
    this.navItems = normalizeEpubNavigationItems(
      this.ncxPath,
      parseNavPoints(navMap),
    );
    if (this.navItems.length === 0) throw new Error('NCX navMap is empty');
  }

  private createSpineFallbackNavigation() {
    this.navItems = createSpineFallbackNavigation(
      this.iterDocInSpine().map((item) => ({
        href: this.getCanonicalHref(item.href),
        title:
          item.doc.title.trim() ||
          item.doc.querySelector('h1, h2, h3, h4, h5, h6')?.textContent ||
          undefined,
      })),
    );
  }

  private async parseFile(file: File) {
    const { BlobReader, BlobWriter, ZipReader, TextWriter } = await import(
      '@zip.js/zip.js'
    );
    const reader = new ZipReader(new BlobReader(file));
    const entries = new Map(
      (await reader.getEntries()).map((obj) => [obj.filename, obj] as const),
    );

    const readDocWithType = async (
      path: string,
      type: DOMParserSupportedType,
    ) => {
      const entry = entries.get(path);
      if (!entry) throw new Error(`Entry not found: ${path}`);
      const text = await entry.getData!(new TextWriter());
      const parser = new DOMParser();
      return parser.parseFromString(text, type);
    };

    const readDoc = async (path: string) =>
      readDocWithType(path, 'application/xhtml+xml');
    const readDocLegacy = async (path: string) =>
      readDocWithType(path, 'text/html');

    const readBlob = async (path: string, type: string) => {
      const entry = entries.get(path);
      if (!entry) throw new Error(`Entry not found: ${path}`);
      const data = await entry.getData!(new BlobWriter());
      return new Blob([data], { type });
    };

    this.parseContainer(await readDoc(CONTAINER_PATH));
    this.parsePackage(await readDoc(this.packagePath));

    let navigationParsed = false;
    if (this.navigationPath) {
      try {
        this.parseNavigationDocument(await readDoc(this.navigationPath));
        navigationParsed = this.navItems.length > 0;
      } catch {
        this.navItems = [];
      }
    }
    if (!navigationParsed && this.ncxPath) {
      try {
        this.parseNcx(await readDoc(this.ncxPath));
        navigationParsed = this.navItems.length > 0;
      } catch {
        this.navItems = [];
      }
    }

    for (const item of this.items.values()) {
      const path = this.resolve(this.packagePath, item.href);

      if (item.mediaType === 'application/xhtml+xml') {
        (item as EpubItemDoc).doc = await readDoc(path);
      } else if (item.mediaType === 'text/html') {
        item.mediaType = 'application/xhtml+xml';
        (item as EpubItemDoc).doc = await readDocLegacy(path);
      } else {
        (item as EpubItemBlob).blob = await readBlob(path, item.mediaType);
      }
    }
    if (!navigationParsed) {
      this.createSpineFallbackNavigation();
    }
  }

  static async fromFile(file: File) {
    const epub = new Epub(file.name, file);
    await epub.parseFile(file);
    StandardNovel.fromEpub(epub);
    return epub;
  }

  static async extractCoverFromFile(file: File) {
    const { BlobReader, BlobWriter, TextWriter, ZipReader } = await import(
      '@zip.js/zip.js'
    );
    const reader = new ZipReader(new BlobReader(file));
    try {
      const entries = new Map(
        (await reader.getEntries()).map((entry) => [entry.filename, entry]),
      );
      const readDoc = async (path: string) => {
        const entry = entries.get(path);
        if (!entry) throw new Error(`Entry not found: ${path}`);
        const text = await entry.getData!(new TextWriter());
        return new DOMParser().parseFromString(text, 'application/xhtml+xml');
      };
      const epub = new Epub(file.name, file);
      epub.parseContainer(await readDoc(CONTAINER_PATH));
      epub.parsePackage(await readDoc(epub.packagePath));
      const cover = epub.getCoverItem();
      if (cover === undefined) return;
      const entry = entries.get(epub.resolve(epub.packagePath, cover.href));
      if (!entry) return;
      const data = await entry.getData!(new BlobWriter());
      return new Blob([data], { type: cover.mediaType });
    } finally {
      await reader.close();
    }
  }

  private getCoverItem() {
    const coverId = resolveEpubCoverId(this.items.values(), this.legacyCoverId);
    const item = coverId === undefined ? undefined : this.items.get(coverId);
    return item && MIME.IMAGE.includes(item.mediaType) ? item : undefined;
  }

  getCover() {
    const cover = this.getCoverItem();
    return cover && 'blob' in cover ? cover.blob : undefined;
  }

  getBookMetadata(): EpubBookMetadata {
    const metadata = getEl(this.packageDoc, 'metadata');
    if (!metadata) {
      return { authors: [], languages: [] };
    }
    const values = (localName: string) =>
      Array.from(metadata.children)
        .filter((element) => element.localName === localName)
        .map((element) => element.textContent?.trim() ?? '')
        .filter(Boolean);
    return {
      title: values('title')[0],
      authors: values('creator'),
      description: values('description')[0],
      languages: values('language'),
    };
  }

  updateBookMetadata(metadataValue: EpubBookMetadata) {
    const metadata = getEl(this.packageDoc, 'metadata');
    if (!metadata) throw new Error('Package does not have metadata');
    const replace = (localName: string, values: readonly string[]) => {
      Array.from(metadata.children)
        .filter((element) => element.localName === localName)
        .forEach((element) => element.remove());
      values
        .map((value) => value.trim())
        .filter(Boolean)
        .forEach((value) => {
          const element = this.packageDoc.createElementNS(
            DUBLIN_CORE_NAMESPACE,
            `dc:${localName}`,
          );
          element.textContent = value;
          metadata.appendChild(element);
        });
    };
    replace('title', metadataValue.title ? [metadataValue.title] : []);
    replace('creator', metadataValue.authors);
    replace(
      'description',
      metadataValue.description ? [metadataValue.description] : [],
    );
    replace('language', metadataValue.languages);
  }

  setCover(blob: Blob) {
    const extension = imageExtension(blob.type);
    if (!extension) throw new Error('不支持的封面图片格式');
    let cover = this.getCoverItem();
    if (cover && 'blob' in cover) {
      cover.mediaType = blob.type;
      cover.blob = blob;
      cover.properties = [
        ...new Set([...(cover.properties ?? []), 'cover-image']),
      ];
    } else {
      let index = 0;
      let id = 'cover-image';
      while (this.items.has(id)) id = `cover-image-${++index}`;
      cover = {
        id,
        href: `images/${id}.${extension}`,
        mediaType: blob.type,
        overlay: null,
        properties: ['cover-image'],
        fallback: null,
        blob,
      };
      this.items.set(id, cover);
    }
    this.legacyCoverId = cover.id;
    const metadata = getEl(this.packageDoc, 'metadata');
    if (!metadata) throw new Error('Package does not have metadata');
    let legacyMeta = Array.from(metadata.getElementsByTagName('meta')).find(
      (element) => element.getAttribute('name')?.toLowerCase() === 'cover',
    );
    if (!legacyMeta) {
      legacyMeta = this.packageDoc.createElementNS(
        this.packageDoc.documentElement.namespaceURI,
        'meta',
      );
      legacyMeta.setAttribute('name', 'cover');
      metadata.appendChild(legacyMeta);
    }
    legacyMeta.setAttribute('content', cover.id);
  }

  async clone() {
    if (!this.rawFile)
      throw new Error('Cannot clone manually constructed file.');
    return Epub.fromFile(this.rawFile);
  }

  // ==============================
  // 将内容写入文件
  // ==============================

  private fixHrefExtension() {
    const getFileExtension = (path: string) => {
      const match = path.match(/\.([a-zA-Z0-9]+)$/);
      if (match) return match[1];
      return '';
    };

    const mimeToExtensions: { [key: string]: string[] } = {
      'image/gif': ['.gif'],
      'image/jpeg': ['.jpg', '.jpeg', '.jpe', '.jif', '.jfif'],
      'image/png': ['.png'],
      'image/svg+xml': ['.svg'],
      'image/webp': ['.webp'],
    };
    for (const item of this.items.values()) {
      const mime = item.mediaType;
      if (mime in mimeToExtensions) {
        const extensions = mimeToExtensions[mime];
        const ext = getFileExtension(item.href);
        if (!extensions.includes(ext)) {
          const newHref = item.href.replace(/\.([a-zA-Z0-9]+)$/, extensions[0]);
          this.updateHref(item.href, newHref);
          item.href = newHref;
        }
      }
    }
  }

  private updatePackage() {
    const packageDocNs = this.packageDoc.documentElement.namespaceURI;
    const items = [...this.items.values()].map((item) => {
      const itemEl = this.packageDoc.createElementNS(packageDocNs, 'item');
      itemEl.setAttribute('id', item.id);
      itemEl.setAttribute('href', item.href);
      itemEl.setAttribute('media-type', item.mediaType);
      if (item.overlay) itemEl.setAttribute('media-overlay', item.overlay);
      if (item.properties)
        itemEl.setAttribute('properties', item.properties.join(' '));
      if (item.fallback) itemEl.setAttribute('fallback', item.fallback);
      return itemEl;
    });
    const manifest = getEl(this.packageDoc, 'manifest')!;
    manifest.replaceChildren(...items);
  }

  async toBlob() {
    // this.fixHrefExtension();
    this.updatePackage();

    const { BlobReader, BlobWriter, ZipWriter, TextReader } = await import(
      '@zip.js/zip.js'
    );

    const zipBlobWriter = new BlobWriter();
    const writer = new ZipWriter(zipBlobWriter);

    const writeText = (path: string, text: string) =>
      writer.add(path, new TextReader(text));
    const writeBlob = (path: string, blob: Blob) =>
      writer.add(path, new BlobReader(blob));
    const writeDoc = (path: string, doc: Document) =>
      writeText(path, new XMLSerializer().serializeToString(doc));

    await writeText(MIMETYPE_PATH, MIMETYPE_TEMPLATE);
    await writeText(
      CONTAINER_PATH,
      CONTAINER_TEMPLATE.replace('OEBPS/content.opf', this.packagePath),
    );
    await writeDoc(this.packagePath, this.packageDoc);

    for (const item of this.items.values()) {
      const path = this.resolve(this.packagePath, item.href);
      if ('doc' in item) {
        await writeDoc(path, item.doc);
      } else {
        await writeBlob(path, item.blob);
      }
    }

    await writer.close();

    const zipBlob = await zipBlobWriter.getData();
    return zipBlob;
  }

  // ==============================
  // API
  // ==============================

  iterDocInSpine() {
    return this.itemrefs
      .map((itemref) => this.items.get(itemref.idref)!)
      .filter((item) => 'doc' in item);
  }
  iterDoc() {
    return [...this.items.values()].filter((item) => 'doc' in item);
  }
  iterBlob(mediaTypes: string[]) {
    return [...this.items.values()]
      .filter((item) => 'blob' in item)
      .filter((item) => mediaTypes.includes(item.mediaType));
  }
  iterImage() {
    return this.iterBlob(MIME.IMAGE);
  }

  updateImage(id: string, blob: Blob) {
    if (!MIME.IMAGE.includes(blob.type)) return;

    const item = this.items.get(id);
    if (!item || !('blob' in item) || !MIME.IMAGE.includes(item.mediaType))
      return;

    item.mediaType = blob.type;
    item.blob = blob;
  }

  cleanStyle() {
    for (const item of this.iterBlob(MIME.CSS)) {
      item.blob = new Blob([''], { type: item.mediaType });
    }
  }

  getText() {
    const contents: string[] = [];
    for (const item of this.iterDocInSpine()) {
      Array.from(item.doc.getElementsByClassName('rt')).forEach((node) =>
        node.parentNode!.removeChild(node),
      );
      contents.push(item.doc.body.textContent ?? '');
    }
    return contents.join('\n');
  }
}
