<script lang="ts" setup>
import type {
  ReaderEpubChapterContent,
  ReaderChineseScript,
  ReaderEpubDocumentSlice,
  ReaderFlow,
  ReaderSegment,
} from '@/model/Reader';

import { EpubResourceSession } from '../core/EpubResources';
import type { RenderedReaderMode } from '../core/BilingualLayout';

import { resolveEpubArchiveHref } from '@/util/file/epub';
import { convertReaderTextParts } from '../core/ReaderChineseScript';

const props = defineProps<{
  epub: ReaderEpubChapterContent;
  segments: ReaderSegment[];
  mode: RenderedReaderMode;
  flow: ReaderFlow;
  doubleSpread?: boolean;
  layoutRevision: string;
  preview?: boolean;
  bookId: string;
  chineseScript: ReaderChineseScript;
  convertOriginal: boolean;
  convertTranslated: boolean;
}>();

const emit = defineEmits<{
  'content-change': [];
  'link-activate': [href: string];
}>();

const layout = ref<HTMLElement>();
let session: EpubResourceSession | undefined;
let renderGeneration = 0;
let layoutResizeFrame: number | undefined;

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
const RICH_MEDIA_SELECTOR = 'img, picture, svg, math, audio, video, canvas';

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

const trimSliceToSegments = (doc: Document) => {
  if (!props.preview) return;
  const segmentIds = new Set(props.segments.map((segment) => segment.id));
  const prune = (element: Element): boolean => {
    const segmentId = element.getAttribute('data-reader-segment-id');
    if (segmentId !== null) return segmentIds.has(segmentId);
    for (const child of Array.from(element.childNodes)) {
      if (child instanceof Element ? !prune(child) : true) child.remove();
    }
    return element.children.length > 0;
  };
  for (const element of Array.from(doc.body.children)) {
    if (!prune(element)) element.remove();
  }
};

const removeTargetIdentity = (element: Element) => {
  element.removeAttribute('id');
  element.removeAttribute('name');
  element.querySelectorAll('[id], [name]').forEach((child) => {
    child.removeAttribute('id');
    child.removeAttribute('name');
  });
};

const createTranslatedBlock = (original: Element, segment: ReaderSegment) => {
  const translated = original.cloneNode(false) as HTMLElement;
  removeTargetIdentity(translated);
  translated.classList.add('epub-translated-block');
  translated.setAttribute('data-reader-segment-id', segment.id);
  translated.setAttribute('data-reader-language-side', 'translated');
  original
    .querySelectorAll(RICH_MEDIA_SELECTOR)
    .forEach((media) => translated.append(media.cloneNode(true)));
  const text = document.createElement('span');
  text.textContent = segment.translated?.trim() || '未翻译';
  if (!segment.translated?.trim()) text.className = 'epub-missing-translation';
  translated.append(text);
  return translated;
};

const applyReaderMode = (wrapper: HTMLElement) => {
  const segmentById = new Map(
    props.segments.map((segment) => [segment.id, segment]),
  );
  wrapper
    .querySelectorAll<HTMLElement>('[data-reader-segment-id]')
    .forEach((original) => {
      const segmentId = original.dataset.readerSegmentId;
      const segment = segmentId && segmentById.get(segmentId);
      if (segment === undefined) return;
      original.setAttribute('data-reader-language-side', 'original');
      const translated = createTranslatedBlock(original, segment);
      if (props.mode === 'translated') {
        original.hidden = true;
        original.style.display = 'none';
        original.after(translated);
      } else if (props.mode === 'translated-original') {
        original.before(translated);
        original.classList.add('epub-bilingual-block');
        translated.classList.add('epub-bilingual-block');
      } else if (props.mode === 'original-translated') {
        original.after(translated);
        original.classList.add('epub-bilingual-block');
        translated.classList.add('epub-bilingual-block');
      }
    });
};

const convertElementText = async (element: HTMLElement) => {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node = walker.nextNode();
  while (node !== null) {
    nodes.push(node as Text);
    node = walker.nextNode();
  }
  const sourceParts = nodes.map((text) => text.data);
  const convertedParts = await convertReaderTextParts({
    bookId: props.bookId,
    script: props.chineseScript,
    parts: sourceParts,
  });
  nodes.forEach((text, index) => (text.data = convertedParts[index] ?? ''));
};

const applyChineseScript = async (wrapper: HTMLElement) => {
  const sides = [
    ...(props.convertOriginal ? ['original'] : []),
    ...(props.convertTranslated ? ['translated'] : []),
  ];
  await Promise.all(
    sides.flatMap((side) =>
      Array.from(
        wrapper.querySelectorAll<HTMLElement>(
          `[data-reader-language-side="${side}"]`,
        ),
      )
        .filter(
          (element) =>
            element.parentElement?.closest(
              `[data-reader-language-side="${side}"]`,
            ) === null,
        )
        .map(convertElementText),
    ),
  );
};

const sizeDocumentLayout = (
  host: HTMLElement,
  wrapper: HTMLElement,
  slice: ReaderEpubDocumentSlice,
) => {
  const viewport = layout.value?.parentElement;
  if (props.flow === 'paginated' && slice.layout === 'reflowable') {
    const width = Math.max(1, viewport?.clientWidth ?? host.clientWidth);
    const height = Math.max(1, viewport?.clientHeight ?? window.innerHeight);
    host.style.display = 'block';
    host.style.height = `${height}px`;
    host.style.overflow = 'visible';
    wrapper.style.boxSizing = 'border-box';
    wrapper.style.width = `${width}px`;
    wrapper.style.height = `${height}px`;
    wrapper.style.padding = '44px var(--reader-page-padding) 24px';
    wrapper.style.columnCount = props.doubleSpread ? '2' : '1';
    wrapper.style.columnGap = 'calc(var(--reader-page-padding) * 2)';
    wrapper.style.columnFill = 'auto';
    host.style.width = `${Math.max(width, wrapper.scrollWidth)}px`;
    host.style.flex = '0 0 auto';
    return;
  }
  if (slice.layout !== 'pre-paginated') {
    host.style.removeProperty('display');
    host.style.removeProperty('height');
    host.style.removeProperty('overflow');
    host.style.removeProperty('width');
    host.style.removeProperty('flex');
    return;
  }
  const width = Math.max(1, slice.viewport?.width ?? 1200);
  const height = Math.max(1, slice.viewport?.height ?? 1600);
  host.style.display = 'block';
  host.style.overflow = 'hidden';
  const availableWidth = Math.max(1, viewport?.clientWidth ?? host.clientWidth);
  const availableHeight =
    props.flow === 'paginated'
      ? Math.max(1, viewport?.clientHeight ?? window.innerHeight)
      : Number.POSITIVE_INFINITY;
  const scale = Math.min(availableWidth / width, availableHeight / height);
  const renderedWidth = width * scale;
  const renderedHeight = height * scale;
  host.style.width = `${availableWidth}px`;
  host.style.height = `${
    props.flow === 'paginated' ? availableHeight : renderedHeight
  }px`;
  host.style.flex = '0 0 auto';
  host.style.position = 'relative';
  wrapper.style.width = `${width}px`;
  wrapper.style.height = `${height}px`;
  wrapper.style.position = 'absolute';
  wrapper.style.left = `${Math.max(0, (availableWidth - renderedWidth) / 2)}px`;
  wrapper.style.top = `${
    props.flow === 'paginated'
      ? Math.max(0, (availableHeight - renderedHeight) / 2)
      : 0
  }px`;
  wrapper.style.transform = `scale(${scale})`;
  wrapper.style.transformOrigin = 'top left';
};

const resizeDocumentLayouts = () => {
  if (layoutResizeFrame !== undefined) {
    cancelAnimationFrame(layoutResizeFrame);
  }
  layoutResizeFrame = requestAnimationFrame(() => {
    layoutResizeFrame = undefined;
    const hosts = Array.from(
      layout.value?.querySelectorAll<HTMLElement>('[data-reader-epub-host]') ??
        [],
    );
    hosts.forEach((host, index) => {
      const wrapper =
        host.shadowRoot?.querySelector<HTMLElement>('.epub-document');
      const slice = props.epub.documents[index];
      if (wrapper !== undefined && wrapper !== null && slice !== undefined) {
        sizeDocumentLayout(host, wrapper, slice);
      }
    });
    emit('content-change');
  });
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
    .epub-translated-block { color: var(--reader-translation-color, inherit); }
    .epub-missing-translation { opacity: .64; font-style: italic; }
    @media (min-width: 760px) {
      .epub-bilingual-block {
        box-sizing: border-box; display: inline-block !important;
        width: 50%; vertical-align: top;
      }
    }
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
    trimSliceToSegments(parsed);
    await Promise.all(
      Array.from(parsed.body.children).map((element) =>
        sanitizeElement(element, slice, resourceSession),
      ),
    );
    wrapper.append(...Array.from(parsed.body.childNodes));
    applyReaderMode(wrapper);
    await applyChineseScript(wrapper);
  }
  content.append(wrapper);
  if (isCurrent()) {
    shadow.replaceChildren(content);
    sizeDocumentLayout(host, wrapper, slice);
    wrapper.addEventListener('load', resizeDocumentLayouts, true);
  }
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
  () =>
    [
      props.epub,
      props.segments,
      props.mode,
      props.flow,
      props.doubleSpread,
      props.layoutRevision,
      props.bookId,
      props.chineseScript,
      props.convertOriginal,
      props.convertTranslated,
    ] as const,
  () => void render(),
  { immediate: true },
);

onMounted(() => window.addEventListener('resize', resizeDocumentLayouts));

onBeforeUnmount(() => {
  renderGeneration += 1;
  session?.dispose();
  window.removeEventListener('resize', resizeDocumentLayouts);
  if (layoutResizeFrame !== undefined) {
    cancelAnimationFrame(layoutResizeFrame);
  }
});
</script>

<template>
  <section
    ref="layout"
    class="reader-epub-layout"
    :class="`reader-epub-layout--${props.flow}`"
  >
    <div
      v-for="(documentSlice, documentIndex) in props.epub.documents"
      :key="`${documentSlice.sourcePath}/${documentIndex}`"
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

.reader-epub-layout--paginated {
  display: flex;
  width: max-content;
  min-width: 100%;
  height: 100%;
}
</style>
