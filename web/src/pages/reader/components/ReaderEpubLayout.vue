<script lang="ts" setup>
import type {
  ReaderEpubChapterContent,
  ReaderEpubDocumentSlice,
} from '@/model/Reader';

import { EpubResourceSession } from '../core/EpubResources';

import { resolveEpubArchiveHref } from '@/util/file/epub';

const props = defineProps<{
  epub: ReaderEpubChapterContent;
}>();

const emit = defineEmits<{
  'content-change': [];
  'link-activate': [href: string];
}>();

const layout = ref<HTMLElement>();
let session: EpubResourceSession | undefined;
let renderGeneration = 0;

const BLOCKED_ELEMENTS = new Set([
  'base',
  'button',
  'embed',
  'form',
  'frame',
  'frameset',
  'iframe',
  'input',
  'link',
  'meta',
  'noscript',
  'object',
  'option',
  'script',
  'select',
  'style',
  'textarea',
]);

const URL_ATTRIBUTES = new Set(['src', 'poster', 'data', 'background']);
const SAFE_EXTERNAL_LINK = /^(?:https?:|mailto:)/i;

const publisherSelectorsToShadow = (css: string) =>
  css
    .replaceAll(/:root\b/g, ':host')
    .replaceAll(/(^|[\s>+~,])html(?=$|[\s>+~,.#:[{])/g, '$1:host')
    .replaceAll(/(^|[\s>+~,])body(?=$|[\s>+~,.#:[{])/g, '$1.epub-document');

const applySafeAttributes = (
  target: HTMLElement,
  attributes: Record<string, string>,
) => {
  const language = attributes.lang ?? attributes['xml:lang'];
  if (language) target.lang = language;
  if (attributes.dir === 'ltr' || attributes.dir === 'rtl') {
    target.dir = attributes.dir;
  }
  if (attributes.class)
    target.classList.add(...attributes.class.split(/\s+/).filter(Boolean));
};

const rewriteSrcset = (
  resourceSession: EpubResourceSession,
  sourcePath: string,
  value: string,
) =>
  value
    .split(',')
    .flatMap((candidate) => {
      const [href, ...descriptor] = candidate.trim().split(/\s+/);
      const resolved = href && resourceSession.resolveAsset(sourcePath, href);
      return resolved === undefined
        ? []
        : [
            `${resolved}${descriptor.length > 0 ? ` ${descriptor.join(' ')}` : ''}`,
          ];
    })
    .join(', ');

const sanitizeElement = async (
  element: Element,
  slice: ReaderEpubDocumentSlice,
  resourceSession: EpubResourceSession,
) => {
  const localName = element.localName.toLowerCase();
  if (BLOCKED_ELEMENTS.has(localName)) {
    element.remove();
    return;
  }
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    if (
      name.startsWith('on') ||
      name === 'srcdoc' ||
      name === 'autofocus' ||
      name === 'contenteditable'
    ) {
      element.removeAttribute(attribute.name);
      continue;
    }
    if (name === 'style') {
      element.setAttribute(
        attribute.name,
        await resourceSession.rewriteCss(attribute.value, slice.sourcePath),
      );
      continue;
    }
    if (name === 'srcset') {
      const rewritten = rewriteSrcset(
        resourceSession,
        slice.sourcePath,
        attribute.value,
      );
      if (rewritten) element.setAttribute(attribute.name, rewritten);
      else element.removeAttribute(attribute.name);
      continue;
    }
    if (localName === 'a' || localName === 'area') {
      if (name !== 'href') continue;
      const href = attribute.value.trim();
      if (SAFE_EXTERNAL_LINK.test(href)) {
        element.setAttribute('target', '_blank');
        element.setAttribute('rel', 'noopener noreferrer');
      } else {
        element.setAttribute('href', '#');
        element.setAttribute('data-epub-href', href);
      }
      continue;
    }
    if (
      URL_ATTRIBUTES.has(name) ||
      (name === 'href' && ['image', 'use'].includes(localName)) ||
      name === 'xlink:href'
    ) {
      const resolved = resourceSession.resolveAsset(
        slice.sourcePath,
        attribute.value,
      );
      if (resolved === undefined) element.removeAttribute(attribute.name);
      else element.setAttribute(attribute.name, resolved);
    }
  }
  if (element.hasAttribute('data-reader-segment-id')) {
    element.setAttribute('data-reader-language-side', 'original');
  }
  await Promise.all(
    Array.from(element.children).map((child) =>
      sanitizeElement(child, slice, resourceSession),
    ),
  );
};

const parseSlice = (slice: ReaderEpubDocumentSlice) => {
  const source = `<html xmlns="http://www.w3.org/1999/xhtml"><body>${slice.content}</body></html>`;
  const doc = new DOMParser().parseFromString(source, 'application/xhtml+xml');
  return doc.getElementsByTagName('parsererror').length > 0 ? undefined : doc;
};

const renderSlice = async (
  host: HTMLElement,
  slice: ReaderEpubDocumentSlice,
  resourceSession: EpubResourceSession,
  isCurrent: () => boolean,
) => {
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  const content = document.createDocumentFragment();
  const baseStyle = document.createElement('style');
  baseStyle.textContent = `
    :host { display: block; color: inherit; font: inherit; line-height: inherit; }
    .epub-document { box-sizing: border-box; color: inherit; font: inherit; line-height: inherit; }
    .epub-document img, .epub-document svg, .epub-document video,
    .epub-document canvas { max-width: 100%; height: auto; }
    .epub-document audio, .epub-document video { width: min(100%, 42rem); }
    .epub-document table { max-width: 100%; border-collapse: collapse; }
    .epub-document pre { overflow-wrap: anywhere; white-space: pre-wrap; }
    .epub-document a { color: #2faf86; text-decoration: underline; }
  `;
  content.append(baseStyle);

  const publisherCss: string[] = [];
  for (const href of slice.stylesheetHrefs) {
    const stylesheet = await resourceSession.getStylesheet(
      slice.sourcePath,
      href,
    );
    if (stylesheet !== undefined) {
      publisherCss.push(publisherSelectorsToShadow(stylesheet));
    }
  }
  for (const css of slice.inlineStyles) {
    publisherCss.push(
      publisherSelectorsToShadow(
        await resourceSession.rewriteCss(css, slice.sourcePath),
      ),
    );
  }
  if (publisherCss.length > 0) {
    const style = document.createElement('style');
    style.textContent = publisherCss.join('\n');
    content.append(style);
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'epub-document';
  applySafeAttributes(wrapper, slice.documentAttributes);
  applySafeAttributes(wrapper, slice.bodyAttributes);
  wrapper.addEventListener('click', (event) => {
    const link = event
      .composedPath()
      .find(
        (node): node is Element =>
          node instanceof Element && node.localName.toLowerCase() === 'a',
      );
    if (link === undefined) return;
    event.stopPropagation();
    if (!link.hasAttribute('data-epub-href')) return;
    event.preventDefault();
    const href = resolveEpubArchiveHref(
      slice.sourcePath,
      link.getAttribute('data-epub-href') ?? '',
    );
    if (href !== undefined) emit('link-activate', href);
  });
  const parsed = parseSlice(slice);
  if (parsed === undefined) {
    wrapper.textContent = '此 EPUB 章节的 XHTML 无法解析。';
  } else {
    await Promise.all(
      Array.from(parsed.body.children).map((element) =>
        sanitizeElement(element, slice, resourceSession),
      ),
    );
    wrapper.append(...Array.from(parsed.body.childNodes));
  }
  content.append(wrapper);
  if (isCurrent()) shadow.replaceChildren(content);
};

const render = async () => {
  const generation = ++renderGeneration;
  session?.dispose();
  const resourceSession = new EpubResourceSession(props.epub.resources);
  session = resourceSession;
  await nextTick();
  const hosts = Array.from(
    layout.value?.querySelectorAll<HTMLElement>('[data-reader-epub-host]') ??
      [],
  );
  await Promise.all(
    props.epub.documents.map((slice, index) => {
      const host = hosts[index];
      return host === undefined
        ? Promise.resolve()
        : renderSlice(
            host,
            slice,
            resourceSession,
            () =>
              generation === renderGeneration && session === resourceSession,
          );
    }),
  );
  if (generation === renderGeneration) emit('content-change');
};

watch(
  () => props.epub,
  () => void render(),
  { immediate: true },
);

onBeforeUnmount(() => {
  renderGeneration += 1;
  session?.dispose();
});
</script>

<template>
  <section ref="layout" class="reader-epub-layout">
    <div
      v-for="documentSlice in props.epub.documents"
      :key="documentSlice.sourcePath"
      class="reader-epub-layout__document"
      data-reader-epub-host
    />
  </section>
</template>

<style scoped>
.reader-epub-layout,
.reader-epub-layout__document {
  display: contents;
}
</style>
