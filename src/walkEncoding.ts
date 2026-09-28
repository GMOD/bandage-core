import { packAbgr } from '@jbrowse/core/util/colorBits'

import {
  REFERENCE_RAMP_ALT_COLOR,
  REFERENCE_RAMP_ALT_CSS,
  REFERENCE_RAMP_MAX_HUE,
  hslToRgb,
} from './renderer/GeometryBuilder'

// How a lifted walk colours its lane, stated the way a grammar of graphics
// states an encoding: a field, the quantity the walk has at each node it
// visits, mapped through a scheme, the scale from that quantity to a colour.
// Any field goes with any scheme, so "the reference in the rainbow, one
// haplotype in blues by how far along it is, another in reds by which way it
// runs" is three layers rather than three special cases.
//
// A session states it per walk, and leaves out whatever takes the default:
//
//   "walkLayers": [
//     { "walk": "GRCh38#0#chr6" },
//     { "walk": "HG00133#1#CM090050.1", "color": { "field": "strand" } }
//   ]

export const WALK_FIELDS = [
  {
    value: 'progress',
    label: 'Progress along the walk',
    legend: 'pale where the walk starts, deep where it ends',
  },
  {
    value: 'reference',
    label: 'Reference position',
    legend: 'along the reference left to right, charcoal off it',
  },
  {
    value: 'strand',
    label: 'Strand against the reference',
    legend:
      'pale where the walk runs as the reference does, deep where reversed',
  },
  {
    value: 'visits',
    label: 'Visits',
    legend: 'pale where the walk passes once, deep four times or more',
  },
] as const

export type WalkField = (typeof WALK_FIELDS)[number]['value']

// Sequential families run pale to deep in one hue; the rainbow is the
// reference-position ramp's hues at the ramp's own saturation and lightness
export const WALK_SCHEMES = [
  { value: 'rainbow', label: 'Rainbow' },
  { value: 'blues', label: 'Blues', hue: 215 },
  { value: 'reds', label: 'Reds', hue: 0 },
  { value: 'greens', label: 'Greens', hue: 130 },
  { value: 'oranges', label: 'Oranges', hue: 30 },
  { value: 'purples', label: 'Purples', hue: 280 },
  { value: 'greys', label: 'Greys' },
] as const

export type WalkScheme = (typeof WALK_SCHEMES)[number]['value']

export interface WalkEncoding {
  field: WalkField
  scheme: WalkScheme
}

export interface WalkLayer {
  walk: string
  color?: Partial<WalkEncoding>
}

// the families a lifted haplotype takes by default, in the order it was picked
const DEFAULT_FAMILIES: WalkScheme[] = [
  'blues',
  'reds',
  'greens',
  'oranges',
  'purples',
]

export function resolveEncoding(
  layer: WalkLayer,
  reference: boolean,
  picked: number,
): WalkEncoding {
  return {
    field: layer.color?.field ?? (reference ? 'reference' : 'progress'),
    scheme:
      layer.color?.scheme ??
      (reference
        ? 'rainbow'
        : DEFAULT_FAMILIES[picked % DEFAULT_FAMILIES.length]!),
  }
}

const PALE = 0.82
const DEEP = 0.28

// A scheme at t in [0, 1], as hue, saturation and lightness
export function schemeHsl(scheme: WalkScheme, t: number) {
  const x = Math.max(0, Math.min(1, t))
  if (scheme === 'rainbow') {
    return { h: x * REFERENCE_RAMP_MAX_HUE, s: 0.7, l: 0.5 }
  }
  const family = WALK_SCHEMES.find(s => s.value === scheme)
  const l = PALE + (DEEP - PALE) * x
  return family && 'hue' in family
    ? { h: family.hue, s: 0.75, l }
    : { h: 0, s: 0, l }
}

export function schemeCss(scheme: WalkScheme, t: number) {
  const { h, s, l } = schemeHsl(scheme, t)
  return `hsl(${h}, ${s * 100}%, ${l * 100}%)`
}

export function schemeColor(scheme: WalkScheme, t: number) {
  const { h, s, l } = schemeHsl(scheme, t)
  const [r, g, b] = hslToRgb(h, s, l)
  return packAbgr(
    Math.round(r * 255),
    Math.round(g * 255),
    Math.round(b * 255),
    255,
  )
}

// Where a field has no value at a node: off the reference for `reference` and
// `strand`, which have nothing to measure there
export const NO_VALUE_COLOR = REFERENCE_RAMP_ALT_COLOR
export const NO_VALUE_CSS = REFERENCE_RAMP_ALT_CSS

// Where a strand sits on its scheme, far enough apart to tell at a glance
export const STRAND_T = { same: 0.2, reversed: 0.95 }

// A swatch for the legend: the scheme across what the field spans
export function encodingSwatchCss({ field, scheme }: WalkEncoding) {
  if (field === 'strand') {
    const same = schemeCss(scheme, STRAND_T.same)
    const reversed = schemeCss(scheme, STRAND_T.reversed)
    return `linear-gradient(to right, ${same} 50%, ${reversed} 50%)`
  }
  const stops = Array.from({ length: 7 }, (_, i) => {
    const t = i / 6
    return `${schemeCss(scheme, t)} ${t * 100}%`
  })
  return `linear-gradient(to right, ${stops.join(', ')})`
}

export function fieldLegend(field: WalkField) {
  return WALK_FIELDS.find(f => f.value === field)!.legend
}
