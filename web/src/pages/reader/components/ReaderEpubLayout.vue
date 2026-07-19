<script lang="ts" setup>
import type {
  ReaderAnnotation,
  ReaderEpubChapterContent,
  ReaderEpubDocumentSlice,
  ReaderSegment,
} from '@/model/Reader';

import { EpubResourceSession } from '../core/EpubResources';
import type { RenderedReaderMode } from '../core/BilingualLayout';

import { resolveEpubArchiveHref } from '@/util/file/epub';

const props = defineProps<{
  epub: ReaderEpubChapterContent;
  segments: ReaderSegment[];
  mode: RenderedReaderMode;
  annotations: ReaderAnnotation[];
}>();

const emit = defineEmits<{
  'content-change': [];
  'link-activate': [href: string];
}>();

const layout = ref<HTMLElement>();
let session: EpubResourceSession | undefined;
let renderGeneration = 0;
let fixedLayoutResizeFrame: number | undefined;

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

const findTextRange = (element: Element, quote: string) => {
  if (!quote) return undefined;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let text = '';
  let node = walker.nextNode();
  while (node !== null) {
    nodes.push(node as Text);
    text += node.textContent ?? '';
    node = walker.nextNode();
  }
  const start = text.indexOf(quote);
  if (start < 0) return undefined;
  const end = start + quote.length;
  let offset = 0;
  let startNode: Text | undefined;
  let endNode: Text | undefined;
  let startOffset = 0;
  let endOffset = 0;
  for (const textNode of nodes) {
    const nextOffset = offset + (textNode.textContent?.length ?? 0);
    if (startNode === undefined && start >= offset && start <= nextOffset) {
      startNode = textNode;
      startOffset = start - offset;
    }
    if (end >= offset && end <= nextOffset) {
      endNode = textNode;
      endOffset = end - offset;
      break;
    }
    offset = nextOffset;
  }
  if (startNode === undefined || endNode === undefined) return undefined;
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
};

const applyAnnotations = (
  element: Element,
  annotations: readonly ReaderAnnotation[],
) => {
  for (const annotation of annotations) {
    const range = findTextRange(element, annotation.quote);
    if (range === undefined) continue;
    const mark = document.createElement('mark');
    mark.className = `epub-annotation epub-annotation--${annotation.style}`;
    mark.dataset.readerAnnotationId = annotation.id;
    try {
      range.surroundContents(mark);
    } catch {
      mark.append(range.extractContents());
      range.insertNode(mark);
    }
  }
};

const applyReaderMode = (wrapper: HTMLElement) => {
  const segmentById = new Map(
    props.segments.map((segment) => [segment.id, segment]),
  );
  const annotationsByTarget = new Map<string, ReaderAnnotation[]>();
  for (const annotation of props.annotations) {
    const key = `${annotation.segmentId}/${annotation.languageSide}`;
    const values = annotationsByTarget.get(key) ?? [];
    values.push(annotation);
    annotationsByTarget.set(key, values);
  }
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
      applyAnnotations(
        original,
        annotationsByTarget.get(`${segment.id}/original`) ?? [],
      );
      if (props.mode !== 'original') {
        applyAnnotations(
          translated,
          annotationsByTarget.get(`${segment.id}/translated`) ?? [],
        );
      }
    });
};

const sizeFixedLayout = (
  host: HTMLElement,
  wrapper: HTMLElement,
  slice: ReaderEpubDocumentSlice,
) => {
  if (slice.layout !== 'pre-paginated') {
    host.style.removeProperty('display');
    host.style.removeProperty('height');
    host.style.removeProperty('overflow');
    return;
  }
  const width = Math.max(1, slice.viewport?.width ?? 1200);
  const height = Math.max(1, slice.viewport?.height ?? 1600);
  host.style.display = 'block';
  host.style.overflow = 'hidden';
  const availableWidth = Math.max(
    1,
    host.clientWidth || host.parentElement?.clientWidth || width,
  );
  const scale = availableWidth / width;
  host.style.height = `${height * scale}px`;
  wrapper.style.width = `${width}px`;
  wrapper.style.height = `${height}px`;
  wrapper.style.transform = `scale(${scale})`;
  wrapper.style.transformOrigin = 'top left';
};

const resizeFixedLayouts = () => {
  if (fixedLayoutResizeFrame !== undefined) {
    cancelAnimationFrame(fixedLayoutResizeFrame);
  }
  fixedLayoutResizeFrame = requestAnimationFrame(() => {
    fixedLayoutResizeFrame = undefined;
    const hosts = Array.from(
      layout.value?.querySelectorAll<HTMLElement>('[data-reader-epub-host]') ??
        [],
    );
    hosts.forEach((host, index) => {
      const wrapper =
        host.shadowRoot?.querySelector<HTMLElement>('.epub-document');
      const slice = props.epub.documents[index];
      if (wrapper !== undefined && wrapper !== null && slice !== undefined) {
        sizeFixedLayout(host, wrapper, slice);
      }
    });
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
    .epub-annotation { color: inherit; background: transparent; }
    .epub-annotation--highlight { background: #f4df78; }
    .epub-annotation--underline { text-decoration: underline 2px #d68d1a; }
    .epub-annotation--strike { text-decoration: line-through; }
    .epub-annotation--wavy { text-decoration: underline wavy #d66; }
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
    await Promise.all(
      Array.from(parsed.body.children).map((element) =>
        sanitizeElement(element, slice, resourceSession),
      ),
    );
    wrapper.append(...Array.from(parsed.body.childNodes));
    applyReaderMode(wrapper);
  }
  content.append(wrapper);
  if (isCurrent()) {
    shadow.replaceChildren(content);
    sizeFixedLayout(host, wrapper, slice);
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
  () => [props.epub, props.segments, props.mode, props.annotations] as const,
  () => void render(),
  { immediate: true },
);

onMounted(() => window.addEventListener('resize', resizeFixedLayouts));

onBeforeUnmount(() => {
  renderGeneration += 1;
  session?.dispose();
  window.removeEventListener('resize', resizeFixedLayouts);
  if (fixedLayoutResizeFrame !== undefined) {
    cancelAnimationFrame(fixedLayoutResizeFrame);
  }
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
