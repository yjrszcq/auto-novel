const descriptionTags = new Set([
  'b',
  'blockquote',
  'br',
  'code',
  'del',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'li',
  'ol',
  'p',
  'pre',
  'rp',
  'rt',
  'ruby',
  's',
  'span',
  'strong',
  'sub',
  'sup',
  'u',
  'ul',
]);

const discardedTags = new Set([
  'audio',
  'embed',
  'iframe',
  'img',
  'link',
  'math',
  'meta',
  'object',
  'script',
  'source',
  'style',
  'svg',
  'video',
]);

const sanitizeChildren = (parent: ParentNode) => {
  for (const child of [...parent.childNodes]) {
    if (child.nodeType === Node.COMMENT_NODE) {
      child.remove();
      continue;
    }
    if (!(child instanceof Element)) {
      continue;
    }

    const tag = child.localName;
    if (discardedTags.has(tag)) {
      child.remove();
      continue;
    }

    sanitizeChildren(child);
    if (!descriptionTags.has(tag)) {
      child.replaceWith(...child.childNodes);
      continue;
    }
    for (const attribute of [...child.attributes]) {
      child.removeAttribute(attribute.name);
    }
  }
};

export const sanitizeBookDescription = (description: string) => {
  const template = document.createElement('template');
  template.innerHTML = description;
  sanitizeChildren(template.content);
  return template.innerHTML;
};
