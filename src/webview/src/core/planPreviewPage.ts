/**
 * The plan preview page's HTML sanitiser: the official page's own allowlist,
 * ported literally. The host renders the plan's markdown with `marked`; this
 * strips every element and attribute not listed, event handlers, and
 * `javascript:` links before the HTML reaches the page.
 */

/** The official `ALLOWED_TAGS`. */
export const ALLOWED_TAGS: ReadonlySet<string> = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'blockquote',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins', 'sub', 'sup', 'mark',
  'a', 'code', 'pre', 'kbd', 'var', 'samp',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'img', 'figure', 'figcaption',
  'div', 'span', 'details', 'summary', 'input',
]);

/** The official `ALLOWED_ATTRS`. */
export const ALLOWED_ATTRS: ReadonlySet<string> = new Set([
  'href', 'src', 'alt', 'title', 'id', 'class', 'colspan', 'rowspan',
  'align', 'valign', 'scope', 'headers',
  'open', 'start', 'reversed', 'type',
  'width', 'height', 'checked', 'disabled',
]);

export function isAllowedTag(tagName: string): boolean {
  return ALLOWED_TAGS.has(tagName.toLowerCase());
}

/**
 * Keep an attribute? Only listed names, never an `on*` handler, and no
 * `javascript:` in `href` / `src`.
 */
export function isAllowedAttribute(name: string, value: string | null): boolean {
  const lower = name.toLowerCase();
  if (!ALLOWED_ATTRS.has(lower) || lower.startsWith('on')) return false;
  if ((lower === 'href' || lower === 'src') && /^\s*javascript:/i.test(value || '')) return false;
  return true;
}

function sanitizeNode(node: Node): void {
  let child = node.firstChild;
  while (child) {
    const next = child.nextSibling;
    if (child.nodeType === 1) {
      const element = child as Element;
      if (!isAllowedTag(element.tagName)) {
        // Drop the element, keep its text. Deviation (hardening): its children
        // are sanitised first -- the official moves them up unvisited, so an
        // `<img onerror>` inside a dropped element kept its handler.
        sanitizeNode(element);
        while (element.firstChild) node.insertBefore(element.firstChild, element);
        node.removeChild(element);
      } else {
        for (const attr of Array.from(element.attributes)) {
          if (!isAllowedAttribute(attr.name, element.getAttribute(attr.name))) element.removeAttribute(attr.name);
        }
        sanitizeNode(element);
      }
    }
    child = next;
  }
}

/** The official `sanitizeHtml`. */
export function sanitizePlanHtml(html: string): string {
  const doc = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html');
  const root = doc.body.firstChild as Element;
  sanitizeNode(root);
  return root.innerHTML;
}
