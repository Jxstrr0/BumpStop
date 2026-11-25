// Adapted from Mainline src/ui/dom.ts (25 November 2026)
/** Make an element with a class and optional text. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text) node.textContent = text
  return node
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Make an SVG element with attributes. */
export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag)
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value))
  return node
}

/** Numbers the Canadian way: 1,800 and 2.35. */
export function num(value: number, digits = 0): string {
  return value.toLocaleString('en-CA', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}
