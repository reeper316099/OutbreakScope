// Tiny DOM helpers (no framework): element builders for HTML, SVG and MathML.
const SVG_NS = 'http://www.w3.org/2000/svg';
const MATH_NS = 'http://www.w3.org/1998/Math/MathML';

type Attrs = Record<string, string | number | boolean | undefined>;
type Child = Node | string | number | null | undefined | false;

/** Applies attributes (booleans toggle presence) and appends children to an element. */
function fill<T extends Element>(el: T, attrs: Attrs, children: Child[]): T {
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'object' ? c : String(c));
  }
  return el;
}

/** Creates an HTML element: h('div', {class: 'card'}, 'text', child). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  return fill(document.createElement(tag), attrs, children);
}

/** Creates an SVG element in the SVG namespace. */
export function svg(tag: string, attrs: Attrs = {}, ...children: Child[]): SVGElement {
  return fill(document.createElementNS(SVG_NS, tag), attrs, children);
}

/** Creates a MathML element in the MathML namespace. */
export function ml(tag: string, attrs: Attrs = {}, ...children: Child[]): Element {
  return fill(document.createElementNS(MATH_NS, tag), attrs, children);
}

/** Removes all children of a node. */
export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Looks up an element by id and fails loudly if the HTML shell is missing it. */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`Missing element #${id}`);
  return el as T; // ids in index.html are unique and typed by the caller
}

/** Reads a CSS custom property (e.g. '--c-I') from the document root, so charts follow the active theme. */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
