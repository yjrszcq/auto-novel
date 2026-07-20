import { BaseFile } from './base';
import { StandardNovel } from './standard';

const MIMETYPE_PATH = 'mimetype';
const MIMETYPE_TEMPLATE = 'application/epub+zip';
const DUBLIN_CORE_NAMESPACE = 'http://purl.org/dc/elements/1.1/';
const EPUB_ROOT_URL = new URL('file://book/');

const CONTAINER_PATH = 'META-INF/container.xml';
const CONTAINER_TEMPLATE = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const getEl = (doc: Document, tagName: string) =>
  doc.getElementsByTagName(tagName).item(0);

export const EPUB_MIME = {
  IMAGE: [
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/svg+xml',
    'image/webp',
  ],
  CSS: ['text/css'],
};

const isLocalEpubUrl = (url: URL) =>
  url.protocol === EPUB_ROOT_URL.protocol &&
  url.hostname === EPUB_ROOT_URL.hostname;

const decodeArchivePath = (path: string) => {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
};

export const resolveEpubArchiveHref = (sourcePath: string, href: string) => {
  const sourceUrl = new URL(sourcePath.replaceAll('\\', '/'), EPUB_ROOT_URL);
  const targetUrl = new URL(href.replaceAll('\\', '/'), sourceUrl);
  if (!isLocalEpubUrl(targetUrl)) return undefined;
  const path = decodeArchivePath(targetUrl.pathname.substring(1));
  return `${path}${targetUrl.hash}`;
};

export const normalizeEpubArchivePath = (path: string) =>
  resolveEpubArchiveHref('', path)?.split('#', 1)[0];

const imageExtension = (mime: string) =>
  ({
    'image/gif': 'gif',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/svg+xml': 'svg',
    'image/webp': 'webp',
  })[mime];

export type EpubManifestItemBase = {
  id: string;
  href: string;
  path: string;
  mediaType: string;
  overlay: string | null;
  properties: string[] | null;
  fallback: string | null;
};
export type EpubDocumentResource = EpubManifestItemBase & { doc: Document };
export type EpubBlobResource = EpubManifestItemBase & { blob: Blob };
export type EpubUnavailableResource = EpubManifestItemBase & {
  unavailableReason: string;
};
export type EpubResource =
  | EpubManifestItemBase
  | EpubDocumentResource
  | EpubBlobResource
  | EpubUnavailableResource;

export type EpubDiagnosticCode =
  | 'active-content-disabled'
  | 'encrypted-font-disabled'
  | 'malformed-document-recovered'
  | 'missing-resource'
  | 'navigation-fallback'
  | 'remote-resource-disabled'
  | 'unsupported-spine-resource';

export interface EpubDiagnostic {
  code: EpubDiagnosticCode;
  message: string;
  path?: string;
}

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
  EPUB_MIME.IMAGE.includes(item.mediaType);

export const resolveEpubCoverId = (
  items: Iterable<EpubCoverManifestItem>,
  epub2CoverId?: string,
) => {
  const images = [...items].filter(isImage);
  return (
    images.find((item) => item.properties?.includes('cover-image'))?.id ??
    images.find((item) => item.id === epub2CoverId)?.id ??
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

export interface EpubSpineItem {
  index: number;
  idref: string;
  linear: boolean;
  properties: string[];
  resource: EpubDocumentResource;
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
  return resolveEpubArchiveHref(sourcePath, href);
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
  items = new Map<string, EpubResource>();
  itemrefs: EpubItemref[] = [];
  navItems: EpubNavigationItem[] = [];
  diagnostics: EpubDiagnostic[] = [];
  renditionLayout: 'reflowable' | 'pre-paginated' = 'reflowable';
  private epub2CoverId: string | undefined;

  private addDiagnostic(diagnostic: EpubDiagnostic) {
    if (
      !this.diagnostics.some(
        (item) =>
          item.code === diagnostic.code &&
          item.message === diagnostic.message &&
          item.path === diagnostic.path,
      )
    ) {
      this.diagnostics.push(diagnostic);
    }
  }

  private resolve(root: string, rpath: string) {
    const resolved = resolveEpubArchiveHref(root, rpath);
    if (resolved === undefined) {
      throw new Error(`EPUB 资源路径越界或无效：${rpath}`);
    }
    return resolved.split('#', 1)[0];
  }

  getCanonicalHref(href: string) {
    return this.resolve(this.packagePath, href);
  }

  getRenditionLayout(path: string) {
    const spineItem = this.iterSpine().find(
      (item) => item.resource.path === path,
    );
    if (spineItem?.properties.includes('rendition:layout-pre-paginated')) {
      return 'pre-paginated' as const;
    }
    if (spineItem?.properties.includes('rendition:layout-reflowable')) {
      return 'reflowable' as const;
    }
    return this.renditionLayout;
  }

  // ==============================
  // 读取文件内容
  // ==============================

  private parseProperties(attr: string | null) {
    if (!attr) return null;
    return attr.trim().split(/\s+/).filter(Boolean);
  }

  private parseContainer(doc: Document) {
    const rootfile = getEl(doc, 'rootfile');
    if (!rootfile) throw new Error('EPUB 容器缺少根文件声明');
    const packagePath = rootfile.getAttribute('full-path');
    if (!packagePath) throw new Error('EPUB 容器缺少包文档路径');
    const canonicalPath = normalizeEpubArchivePath(packagePath);
    if (!canonicalPath) throw new Error('EPUB 包文档路径无效');
    this.packagePath = canonicalPath;
  }

  private parsePackage(doc: Document) {
    const metadata = getEl(doc, 'metadata');
    if (!metadata) throw new Error('EPUB 包文档缺少 metadata');
    const manifest = getEl(doc, 'manifest');
    if (!manifest) throw new Error('EPUB 包文档缺少 manifest');
    const spine = getEl(doc, 'spine');
    if (!spine) throw new Error('EPUB 包文档缺少 spine');

    this.packageDoc = doc;
    const renditionLayout = Array.from(metadata.getElementsByTagName('meta'))
      .find(
        (meta) =>
          meta.getAttribute('property')?.toLowerCase() === 'rendition:layout',
      )
      ?.textContent?.trim()
      .toLowerCase();
    this.renditionLayout =
      renditionLayout === 'pre-paginated' ? 'pre-paginated' : 'reflowable';
    this.epub2CoverId =
      Array.from(metadata.getElementsByTagName('meta'))
        .find((meta) => meta.getAttribute('name')?.toLowerCase() === 'cover')
        ?.getAttribute('content') ?? undefined;
    this.parseManifest(manifest);
    this.parseSpine(spine);
  }

  private parseManifest(el: Element) {
    for (const itemEl of Array.from(el.getElementsByTagName('item'))) {
      const id = itemEl.getAttribute('id');
      if (!id) throw new Error('EPUB 清单资源缺少 id');
      if (this.items.has(id)) throw new Error(`EPUB 清单包含重复 id：${id}`);
      const href = itemEl.getAttribute('href');
      if (!href) throw new Error(`EPUB 清单资源缺少 href：${id}`);
      const mediaTypeValue = itemEl.getAttribute('media-type');
      if (!mediaTypeValue)
        throw new Error(`EPUB 清单资源缺少 media-type：${id}`);
      const mediaType = mediaTypeValue.split(';', 1)[0].trim().toLowerCase();
      const overlay = itemEl.getAttribute('media-overlay');
      const properties = itemEl.getAttribute('properties');
      const fallback = itemEl.getAttribute('fallback');

      const path = resolveEpubArchiveHref(this.packagePath, href)?.split(
        '#',
        1,
      )[0];
      const itemBase: EpubManifestItemBase = {
        id,
        href,
        path: path ?? `remote:${href}`,
        mediaType,
        overlay,
        properties: this.parseProperties(properties),
        fallback,
      };
      if (path === undefined) {
        const message = `已禁用远程清单资源：${href}`;
        this.items.set(id, { ...itemBase, unavailableReason: message });
        this.addDiagnostic({
          code: 'remote-resource-disabled',
          message,
          path: href,
        });
      } else {
        this.items.set(id, itemBase);
      }
    }

    const navItem = Array.from(this.items.values()).find(({ properties }) =>
      properties?.includes('nav'),
    );
    this.navigationPath =
      navItem && !navItem.path.startsWith('remote:') ? navItem.path : undefined;
  }

  private parseSpine(el: Element) {
    for (const itemEl of Array.from(el.getElementsByTagName('itemref'))) {
      const idref = itemEl.getAttribute('idref');
      if (!idref) throw new Error('EPUB 正文条目缺少 idref');
      if (!this.items.has(idref))
        throw new Error(`EPUB 正文条目未在清单中声明：${idref}`);
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
      this.ncxPath =
        tocItem && !tocItem.path.startsWith('remote:')
          ? tocItem.path
          : undefined;
    }
  }

  private parseNavigationDocument(doc: Document) {
    if (this.navigationPath === undefined) {
      throw new Error('Navigation document path is missing');
    }
    const parseTocList = (olEl: Element): EpubNavigationSourceItem[] => {
      const items: EpubNavigationSourceItem[] = [];

      olEl.querySelectorAll(':scope > li').forEach((liEl) => {
        const linkEl = liEl.querySelector(':scope > a, :scope > span, a, span');
        if (!linkEl) return;

        const item: EpubNavigationSourceItem = {
          text: linkEl.textContent?.trim() || '未命名章节',
          href: linkEl.getAttribute('href'),
          children: [],
        };
        const childOlEl = liEl.querySelector(':scope > ol, ol');
        if (childOlEl) item.children = parseTocList(childOlEl);
        items.push(item);
      });
      return items;
    };
    const navEls = Array.from(doc.getElementsByTagName('nav'));
    const tocNavEl =
      navEls.find((navEl) =>
        [navEl.getAttribute('epub:type'), navEl.getAttribute('type')].some(
          (value) => value?.trim().toLowerCase().split(/\s+/).includes('toc'),
        ),
      ) ?? navEls.find((navEl) => navEl.id === 'toc'); // 保守支持缺少 epub:type 的目录
    const tocOlEl = tocNavEl?.querySelector('ol');
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
    const { BlobReader, BlobWriter, ZipReader, TextWriter } =
      await import('@zip.js/zip.js');
    const reader = new ZipReader(new BlobReader(file));
    try {
      const entries = new Map(
        (await reader.getEntries()).flatMap((entry) => {
          const path = normalizeEpubArchivePath(entry.filename);
          return path === undefined ? [] : ([[path, entry]] as const);
        }),
      );

      const readDocWithType = async (
        path: string,
        type: DOMParserSupportedType,
      ) => {
        const entry = entries.get(path);
        if (!entry) throw new Error(`EPUB 缺少资源：${path}`);
        const text = await entry.getData!(new TextWriter());
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, type);
        if (
          type !== 'text/html' &&
          doc.getElementsByTagName('parsererror').length > 0
        ) {
          throw new Error(`EPUB XML 无法解析：${path}`);
        }
        return doc;
      };

      const readDoc = async (path: string) =>
        readDocWithType(path, 'application/xhtml+xml');
      const readHtmlDoc = async (path: string) =>
        readDocWithType(path, 'text/html');

      const readBlob = async (path: string, type: string) => {
        const entry = entries.get(path);
        if (!entry) throw new Error(`EPUB 缺少资源：${path}`);
        const data = await entry.getData!(new BlobWriter());
        return new Blob([data], { type });
      };

      this.parseContainer(await readDoc(CONTAINER_PATH));
      this.parsePackage(await readDoc(this.packagePath));

      const encryptedResources = new Map<string, string>();
      const encryptionPath = 'META-INF/encryption.xml';
      if (entries.has(encryptionPath)) {
        const encryptionDoc = await readDoc(encryptionPath);
        for (const encryptedData of Array.from(
          encryptionDoc.getElementsByTagNameNS('*', 'EncryptedData'),
        )) {
          const encryptionMethod = encryptedData.getElementsByTagNameNS(
            '*',
            'EncryptionMethod',
          )[0];
          const cipherReference = encryptedData.getElementsByTagNameNS(
            '*',
            'CipherReference',
          )[0];
          const algorithm = encryptionMethod?.getAttribute('Algorithm');
          const uri = cipherReference?.getAttribute('URI');
          const path = uri && normalizeEpubArchivePath(uri);
          if (algorithm && path) encryptedResources.set(path, algorithm);
        }
      }

      const fontObfuscationAlgorithms = new Set([
        'http://www.idpf.org/2008/embedding',
        'http://ns.adobe.com/pdf/enc#RC',
      ]);
      for (const [path, algorithm] of encryptedResources) {
        if (fontObfuscationAlgorithms.has(algorithm)) continue;
        throw new Error(`此 EPUB 包含不支持的受保护内容：${path}`);
      }

      const inspectDocument = (doc: Document, path: string) => {
        if (
          doc.querySelector(
            'script, iframe, frame, object, embed, form, input, button',
          )
        ) {
          this.addDiagnostic({
            code: 'active-content-disabled',
            message: `已禁用文档中的可执行或交互内容：${path}`,
            path,
          });
        }
        const hasRemoteResource = Array.from(
          doc.querySelectorAll('[src], [poster], [data], link[href]'),
        ).some((element) => {
          const value =
            element.getAttribute('src') ??
            element.getAttribute('poster') ??
            element.getAttribute('data') ??
            element.getAttribute('href');
          return (
            value !== null && resolveEpubArchiveHref(path, value) === undefined
          );
        });
        if (hasRemoteResource) {
          this.addDiagnostic({
            code: 'remote-resource-disabled',
            message: `已禁用文档引用的远程资源：${path}`,
            path,
          });
        }
      };

      const readPublicationDocument = async (path: string) => {
        try {
          const doc = await readDoc(path);
          inspectDocument(doc, path);
          return doc;
        } catch (error) {
          if (!entries.has(path)) throw error;
          const doc = await readHtmlDoc(path);
          this.addDiagnostic({
            code: 'malformed-document-recovered',
            message: `文档不是规范 XML，已按兼容 HTML 读取：${path}`,
            path,
          });
          inspectDocument(doc, path);
          return doc;
        }
      };

      let navigationParsed = false;
      if (this.navigationPath) {
        try {
          this.parseNavigationDocument(
            await readPublicationDocument(this.navigationPath),
          );
          navigationParsed = this.navItems.length > 0;
        } catch (error) {
          this.navItems = [];
          this.addDiagnostic({
            code: 'navigation-fallback',
            message: `EPUB 3 目录不可用，已尝试兼容目录：${String(error)}`,
            path: this.navigationPath,
          });
        }
      }
      if (!navigationParsed && this.ncxPath) {
        try {
          this.parseNcx(await readDoc(this.ncxPath));
          navigationParsed = this.navItems.length > 0;
        } catch (error) {
          this.navItems = [];
          this.addDiagnostic({
            code: 'navigation-fallback',
            message: `EPUB 2 NCX 目录不可用，已改用正文顺序：${String(error)}`,
            path: this.ncxPath,
          });
        }
      }

      for (const [id, item] of [...this.items]) {
        if ('unavailableReason' in item) continue;
        const encryptedAlgorithm = encryptedResources.get(item.path);
        if (
          encryptedAlgorithm !== undefined &&
          fontObfuscationAlgorithms.has(encryptedAlgorithm)
        ) {
          const message = `内嵌字体经过混淆，已使用阅读器字体替代：${item.path}`;
          this.items.set(id, { ...item, unavailableReason: message });
          this.addDiagnostic({
            code: 'encrypted-font-disabled',
            message,
            path: item.path,
          });
          continue;
        }
        if (!entries.has(item.path)) {
          const message = `EPUB 缺少可选资源，已跳过：${item.path}`;
          this.items.set(id, { ...item, unavailableReason: message });
          this.addDiagnostic({
            code: 'missing-resource',
            message,
            path: item.path,
          });
          continue;
        }
        if (item.mediaType === 'application/xhtml+xml') {
          this.items.set(id, {
            ...item,
            doc: await readPublicationDocument(item.path),
          });
        } else if (item.mediaType === 'text/html') {
          const doc = await readHtmlDoc(item.path);
          inspectDocument(doc, item.path);
          this.items.set(id, {
            ...item,
            mediaType: 'application/xhtml+xml',
            doc,
          });
        } else {
          const blob = await readBlob(item.path, item.mediaType);
          if (
            item.mediaType === 'text/css' &&
            /(?:url\s*\(\s*['"]?https?:|@import\s+(?:url\s*\()?\s*['"]?https?:)/i.test(
              await blob.text(),
            )
          ) {
            this.addDiagnostic({
              code: 'remote-resource-disabled',
              message: `已禁用样式表引用的远程资源：${item.path}`,
              path: item.path,
            });
          }
          this.items.set(id, { ...item, blob });
        }
      }

      for (const itemref of this.itemrefs) {
        if (
          !this.getFallbackChain(itemref.idref).some(
            (resource) => 'doc' in resource,
          )
        ) {
          const resource = this.items.get(itemref.idref);
          const path = resource?.path ?? itemref.idref;
          this.addDiagnostic({
            code: 'unsupported-spine-resource',
            message: `正文资源不可读取且没有可用回退：${path}`,
            path,
          });
        }
      }
      if (this.iterSpine().length === 0) {
        throw new Error('EPUB 正文中没有浏览器可读取的 XHTML/HTML 内容');
      }
      if (!navigationParsed) {
        this.createSpineFallbackNavigation();
        this.addDiagnostic({
          code: 'navigation-fallback',
          message: '未找到可用目录，已按正文顺序生成目录',
        });
      }
    } finally {
      await reader.close();
    }
  }

  static async fromFile(file: File) {
    const epub = new Epub(file.name, file);
    await epub.parseFile(file);
    StandardNovel.fromEpub(epub);
    return epub;
  }

  static async extractCoverFromFile(file: File) {
    const { BlobReader, BlobWriter, TextWriter, ZipReader } =
      await import('@zip.js/zip.js');
    const reader = new ZipReader(new BlobReader(file));
    try {
      const entries = new Map(
        (await reader.getEntries()).flatMap((entry) => {
          const path = normalizeEpubArchivePath(entry.filename);
          return path === undefined ? [] : ([[path, entry]] as const);
        }),
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
      if (cover.path.startsWith('remote:')) return;
      const entry = entries.get(cover.path);
      if (!entry) return;
      const data = await entry.getData!(new BlobWriter());
      return new Blob([data], { type: cover.mediaType });
    } finally {
      await reader.close();
    }
  }

  private getCoverItem() {
    const coverId = resolveEpubCoverId(this.items.values(), this.epub2CoverId);
    const item = coverId === undefined ? undefined : this.items.get(coverId);
    return item && EPUB_MIME.IMAGE.includes(item.mediaType) ? item : undefined;
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

  updateNavigationTitles(titles: readonly string[]) {
    const updateItems = (items: EpubNavigationItem[], state = { index: 0 }) => {
      items.forEach((item) => {
        const title = titles[state.index]?.trim();
        state.index += 1;
        if (title) item.text = title;
        updateItems(item.children, state);
      });
    };
    updateItems(this.navItems);

    const updateNavigationDocument = (doc: Document) => {
      const navEls = Array.from(doc.getElementsByTagName('nav'));
      const tocNavEl =
        navEls.find((navEl) =>
          [navEl.getAttribute('epub:type'), navEl.getAttribute('type')].some(
            (value) => value?.trim().toLowerCase().split(/\s+/).includes('toc'),
          ),
        ) ?? navEls.find((navEl) => navEl.id === 'toc');
      const tocOlEl = tocNavEl?.querySelector('ol');
      if (!tocOlEl) return;
      let index = 0;
      const visit = (ol: Element) => {
        Array.from(ol.children)
          .filter((element) => element.localName === 'li')
          .forEach((li) => {
            const label = li.querySelector(
              ':scope > a, :scope > span, a, span',
            );
            const title = titles[index]?.trim();
            index += 1;
            if (label && title) label.textContent = title;
            const child = li.querySelector(':scope > ol, ol');
            if (child) visit(child);
          });
      };
      visit(tocOlEl);
    };
    const navigation = this.navigationPath
      ? this.getResourceByPath(this.navigationPath)
      : undefined;
    if (navigation && 'doc' in navigation) {
      updateNavigationDocument(navigation.doc);
    }

    const ncx = this.ncxPath ? this.getResourceByPath(this.ncxPath) : undefined;
    if (ncx && 'doc' in ncx) {
      let index = 0;
      const visit = (parent: Element) => {
        Array.from(parent.children)
          .filter((element) => element.localName === 'navPoint')
          .forEach((navPoint) => {
            const label = Array.from(navPoint.children).find(
              (element) => element.localName === 'navLabel',
            );
            const title = titles[index]?.trim();
            index += 1;
            if (label && title) label.textContent = title;
            visit(navPoint);
          });
      };
      const navMap = Array.from(ncx.doc.getElementsByTagName('*')).find(
        (element) => element.localName === 'navMap',
      );
      if (navMap) visit(navMap);
    }
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
        path: this.resolve(this.packagePath, `images/${id}.${extension}`),
        mediaType: blob.type,
        overlay: null,
        properties: ['cover-image'],
        fallback: null,
        blob,
      };
      this.items.set(id, cover);
    }
    this.epub2CoverId = cover.id;
    const metadata = getEl(this.packageDoc, 'metadata');
    if (!metadata) throw new Error('Package does not have metadata');
    let epub2CoverMeta = Array.from(metadata.getElementsByTagName('meta')).find(
      (element) => element.getAttribute('name')?.toLowerCase() === 'cover',
    );
    if (!epub2CoverMeta) {
      epub2CoverMeta = this.packageDoc.createElementNS(
        this.packageDoc.documentElement.namespaceURI,
        'meta',
      );
      epub2CoverMeta.setAttribute('name', 'cover');
      metadata.appendChild(epub2CoverMeta);
    }
    epub2CoverMeta.setAttribute('content', cover.id);
  }

  async clone() {
    if (!this.rawFile)
      throw new Error('Cannot clone manually constructed file.');
    return Epub.fromFile(this.rawFile);
  }

  // ==============================
  // 将内容写入文件
  // ==============================

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
    this.updatePackage();

    const { BlobReader, BlobWriter, ZipWriter, TextReader } =
      await import('@zip.js/zip.js');

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
      if ('doc' in item) {
        await writeDoc(item.path, item.doc);
      } else if ('blob' in item) {
        await writeBlob(item.path, item.blob);
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
    return this.iterSpine().map((item) => item.resource);
  }
  iterSpine(): EpubSpineItem[] {
    return this.itemrefs.flatMap((itemref, index) => {
      const resource = this.getFallbackChain(itemref.idref).find(
        (candidate): candidate is EpubDocumentResource => 'doc' in candidate,
      );
      return resource
        ? [
            {
              index,
              idref: itemref.idref,
              linear: itemref.linear?.toLowerCase() !== 'no',
              properties: itemref.properties ?? [],
              resource,
            },
          ]
        : [];
    });
  }
  iterDoc() {
    return [...this.items.values()].filter(
      (item): item is EpubDocumentResource => 'doc' in item,
    );
  }
  iterBlob(mediaTypes: string[]) {
    return [...this.items.values()]
      .filter((item): item is EpubBlobResource => 'blob' in item)
      .filter((item) => mediaTypes.includes(item.mediaType));
  }
  iterImage() {
    return this.iterBlob(EPUB_MIME.IMAGE);
  }

  getResourceByPath(path: string) {
    const canonicalPath = normalizeEpubArchivePath(path);
    return [...this.items.values()].find((item) => item.path === canonicalPath);
  }

  resolveResource(sourcePath: string, href: string) {
    const resolved = resolveEpubArchiveHref(sourcePath, href);
    return resolved === undefined
      ? undefined
      : this.getResourceByPath(resolved.split('#', 1)[0]);
  }

  getFallbackChain(id: string) {
    const chain: EpubResource[] = [];
    const seen = new Set<string>();
    let current = this.items.get(id);
    while (current !== undefined && !seen.has(current.id)) {
      chain.push(current);
      seen.add(current.id);
      current = current.fallback ? this.items.get(current.fallback) : undefined;
    }
    return chain;
  }

  updateImage(id: string, blob: Blob) {
    if (!EPUB_MIME.IMAGE.includes(blob.type)) return;

    const item = this.items.get(id);
    if (!item || !('blob' in item) || !EPUB_MIME.IMAGE.includes(item.mediaType))
      return;

    item.mediaType = blob.type;
    item.blob = blob;
  }

  getText() {
    const contents: string[] = [];
    for (const item of this.iterDocInSpine()) {
      const body = item.doc.body.cloneNode(true) as HTMLElement;
      body.querySelectorAll('.rt, rt, rp').forEach((node) => node.remove());
      contents.push(body.textContent ?? '');
    }
    return contents.join('\n');
  }
}
