import type { ReaderEpubResource } from '@/model/Reader';

import { resolveEpubArchiveHref } from '@/util/file/epub';

const CSS_IMPORT_PATTERN =
  /@import\s+(?:url\(\s*)?(?:(["'])(.*?)\1|([^\s)'";]+))\s*\)?([^;]*);/gi;
const CSS_URL_PATTERN = /url\(\s*(?:(["'])(.*?)\1|([^\s)'";]+))\s*\)/gi;

const replaceAsync = async (
  value: string,
  pattern: RegExp,
  replacer: (match: RegExpExecArray) => Promise<string>,
) => {
  const matches = Array.from(value.matchAll(pattern));
  if (matches.length === 0) return value;
  const replacements = await Promise.all(matches.map(replacer));
  let result = '';
  let offset = 0;
  matches.forEach((match, index) => {
    result += value.slice(offset, match.index) + replacements[index];
    offset = match.index! + match[0].length;
  });
  return result + value.slice(offset);
};

const isFragmentReference = (href: string) => href.trim().startsWith('#');

export class EpubResourceSession {
  private readonly resources: Map<string, ReaderEpubResource>;
  private readonly objectUrls = new Map<string, string>();
  private readonly stylesheets = new Map<string, Promise<string>>();
  private disposed = false;

  constructor(resources: readonly ReaderEpubResource[]) {
    this.resources = new Map(
      resources.map((resource) => [resource.path, resource]),
    );
  }

  private getObjectUrl(resource: ReaderEpubResource) {
    if (this.disposed) return 'about:blank';
    let url = this.objectUrls.get(resource.path);
    if (url === undefined) {
      url = URL.createObjectURL(resource.blob);
      this.objectUrls.set(resource.path, url);
    }
    return url;
  }

  resolveAsset(sourcePath: string, href: string) {
    if (isFragmentReference(href)) return href.trim();
    const resolved = resolveEpubArchiveHref(sourcePath, href);
    if (resolved === undefined) return undefined;
    const path = resolved.split('#', 1)[0];
    const resource = this.resources.get(path);
    return resource === undefined ? undefined : this.getObjectUrl(resource);
  }

  async getStylesheet(sourcePath: string, href: string) {
    const resolved = resolveEpubArchiveHref(sourcePath, href);
    if (resolved === undefined) return undefined;
    const path = resolved.split('#', 1)[0];
    const resource = this.resources.get(path);
    if (resource === undefined || resource.mediaType !== 'text/css') {
      return undefined;
    }
    let pending = this.stylesheets.get(path);
    if (pending === undefined) {
      pending = resource.blob
        .text()
        .then((css) => this.rewriteCss(css, path, new Set([path])));
      this.stylesheets.set(path, pending);
    }
    return pending;
  }

  async rewriteCss(css: string, sourcePath: string, stack = new Set<string>()) {
    const withoutActiveCss = css
      .replaceAll(/([\w-]+\s*:\s*)expression\s*\([^;}]*(?=;|})/gi, '$1initial')
      .replaceAll(/-moz-binding\s*:[^;}]+[;}]/gi, '');
    const importsRewritten = await replaceAsync(
      withoutActiveCss,
      CSS_IMPORT_PATTERN,
      async (match) => {
        const href = match[2] ?? match[3] ?? '';
        const resolved = resolveEpubArchiveHref(sourcePath, href);
        const path = resolved?.split('#', 1)[0];
        if (path === undefined || stack.has(path)) return '';
        const resource = this.resources.get(path);
        if (resource === undefined || resource.mediaType !== 'text/css')
          return '';
        const nested = new Set(stack);
        nested.add(path);
        const nestedCss = await this.rewriteCss(
          await resource.blob.text(),
          path,
          nested,
        );
        const conditions = match[4]?.trim();
        return `@import url("${this.createCssObjectUrl(path, nestedCss)}")${conditions ? ` ${conditions}` : ''};`;
      },
    );
    return replaceAsync(importsRewritten, CSS_URL_PATTERN, async (match) => {
      const href = match[2] ?? match[3] ?? '';
      if (href.startsWith('blob:')) return match[0];
      const url = this.resolveAsset(sourcePath, href);
      return url === undefined ? 'url("about:blank")' : `url("${url}")`;
    });
  }

  private createCssObjectUrl(path: string, css: string) {
    if (this.disposed) return 'about:blank';
    const key = `css-import:${path}`;
    const existing = this.objectUrls.get(key);
    if (existing !== undefined) return existing;
    const url = URL.createObjectURL(new Blob([css], { type: 'text/css' }));
    this.objectUrls.set(key, url);
    return url;
  }

  dispose() {
    this.disposed = true;
    this.objectUrls.forEach((url) => URL.revokeObjectURL(url));
    this.objectUrls.clear();
    this.stylesheets.clear();
  }
}
