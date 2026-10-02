// A drawing as a plain element tree, so the hosts render the same picture
// their own way: the plugin as React elements, BandageJS as DOM nodes, a
// figure as markup. Attribute names are SVG's own (`stroke-width`,
// `text-anchor`); serializeEl is the one place text becomes markup.

export type ElAttrs = Record<string, string | number | undefined>

export interface El {
  tag: string
  attrs: ElAttrs
  children: (El | string)[]
}

export function el(
  tag: string,
  attrs: ElAttrs = {},
  ...children: (El | string | undefined | false)[]
): El {
  return {
    tag,
    attrs,
    children: children.filter((c): c is El | string => !!c || c === ''),
  }
}

function escapeText(s: string) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function escapeAttr(s: string) {
  return escapeText(s).replaceAll('"', '&quot;')
}

export function serializeEl(node: El | string): string {
  if (typeof node === 'string') {
    return escapeText(node)
  }
  const attrs = Object.entries(node.attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${escapeAttr(String(v))}"`)
    .join('')
  return `<${node.tag}${attrs}>${node.children.map(serializeEl).join('')}</${node.tag}>`
}
