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

/**
 * Make a fold-out section part of an accordion: opening it closes the other
 * sections with the same group name under the same parent, so only one is
 * open at a time. Phones with a recent browser do this natively through the
 * `name` attribute; the toggle listener does the same on older ones. When the
 * player taps a heading and a long section above it folds shut, the page is
 * scrolled back so the heading they tapped stays under their thumb.
 */
export function oneOpenAtATime(details: HTMLDetailsElement, group: string): void {
  details.setAttribute('name', group)
  let tappedAt: number | null = null
  details.addEventListener('click', (event) => {
    const summary = details.querySelector(':scope > summary')
    if (!details.open && summary && event.target instanceof Node && summary.contains(event.target)) {
      tappedAt = summary.getBoundingClientRect().top
    }
  })
  details.addEventListener('toggle', () => {
    if (!details.open) return
    for (const other of details.parentElement?.querySelectorAll<HTMLDetailsElement>(':scope > details[open]') ?? []) {
      if (other !== details && other.getAttribute('name') === group) other.open = false
    }
    const summary = details.querySelector(':scope > summary')
    if (tappedAt !== null && summary) {
      const moved = summary.getBoundingClientRect().top - tappedAt
      if (Math.abs(moved) > 1) window.scrollBy(0, moved)
    }
    tappedAt = null
  })
}
