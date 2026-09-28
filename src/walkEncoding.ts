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
// A haplotype's lane takes one colour of its own by default, so hue names the
// walk; which way it runs is a mark rather than a colour, a dashed lane where
// it crosses the reference's nodes the other way (`reversedMark`).
//
// A session states it per walk, and leaves out whatever takes the default:
//
//   "walkLayers": [
//     { "walk": "GRCh38#0#chr6" },
//     { "walk": "HG00133#1#CM090050.1", "color": { "field": "progress" } }
//   ]

export const WALK_FIELDS = [
  { value: 'walk', label: 'One colour for the walk', legend: '' },
  {
    value: 'progress',
    label: 'Progress along the walk',
    legend: 'pale where each walk starts, deep where it ends',
  },
  {
    value: 'reference',
    label: 'Reference position',
    legend: 'along the reference left to right, charcoal off it',
  },
] as const

export type WalkField = (typeof WALK_FIELDS)[number]['value']

// Okabe–Ito's first five, which stay apart under the common colour vision
// deficiencies, each running pale to deep where a field has a range. The
// rainbow is the reference-position ramp, so it goes with that field only.
export const WALK_SCHEMES = [
  { value: 'blue', label: 'Blue', rgb: [0, 114, 178] },
  { value: 'vermillion', label: 'Vermillion', rgb: [213, 94, 0] },
  { value: 'green', label: 'Bluish green', rgb: [0, 158, 115] },
  { value: 'orange', label: 'Orange', rgb: [230, 159, 0] },
  { value: 'purple', label: 'Reddish purple', rgb: [204, 121, 167] },
  { value: 'rainbow', label: 'Rainbow' },
] as const

export type WalkScheme = (typeof WALK_SCHEMES)[number]['value']

export interface WalkEncoding {
  field: WalkField
  scheme: WalkScheme
}

export interface WalkLayer {
  walk: string
  color?: Partial<WalkEncoding>
  // dash the lane where the walk runs against the reference; on unless false
  reversedMark?: boolean
}

// the colours lifted haplotypes take by default, in the order they were picked
const FAMILIES: WalkScheme[] = [
  'blue',
  'vermillion',
  'green',
  'orange',
  'purple',
]

const isField = (v: unknown): v is WalkField =>
  WALK_FIELDS.some(f => f.value === v)
const isScheme = (v: unknown): v is WalkScheme =>
  WALK_SCHEMES.some(s => s.value === v)

// A stated field or scheme this build does not have reads as unset
export function resolveEncoding(
  layer: WalkLayer,
  reference: boolean,
  picked: number,
): WalkEncoding {
  const { field: askedField, scheme: askedScheme } = layer.color ?? {}
  const field = isField(askedField)
    ? askedField
    : reference
      ? 'reference'
      : 'walk'
  const family = FAMILIES[picked % FAMILIES.length]!
  const scheme = isScheme(askedScheme)
    ? askedScheme === 'rainbow' && field !== 'reference'
      ? family
      : askedScheme
    : field === 'reference'
      ? 'rainbow'
      : family
  return { field, scheme }
}

// Where a flat lane sits on its family: the family's own colour
const BASE_T = 0.5

function mix(a: readonly number[], b: readonly number[], f: number) {
  return a.map((x, i) => x + (b[i]! - x) * f)
}

// A scheme at t in [0, 1] as rgb 0-255: a family mixes from white to its
// colour over the first half and on towards black over the second
export function schemeRgb(scheme: WalkScheme, t: number) {
  const x = Math.max(0, Math.min(1, t))
  const family = WALK_SCHEMES.find(s => s.value === scheme)
  if (!family || !('rgb' in family)) {
    const [r, g, b] = hslToRgb(x * REFERENCE_RAMP_MAX_HUE, 0.7, 0.5)
    return [r * 255, g * 255, b * 255]
  }
  return x < BASE_T
    ? mix([255, 255, 255], family.rgb, 0.35 + (0.65 * x) / BASE_T)
    : mix(family.rgb, [0, 0, 0], ((x - BASE_T) / (1 - BASE_T)) * 0.45)
}

export function schemeCss(scheme: WalkScheme, t: number) {
  const [r, g, b] = schemeRgb(scheme, t).map(Math.round)
  return `rgb(${r}, ${g}, ${b})`
}

export function schemeColor(scheme: WalkScheme, t: number) {
  const [r, g, b] = schemeRgb(scheme, t).map(Math.round)
  return packAbgr(r!, g!, b!, 255)
}

// A field's value at a node through the walk's scheme; `t` undefined is a node
// the field has nothing to say about, off the reference for `reference`
export function encodedColor({ field, scheme }: WalkEncoding, t?: number) {
  return field === 'walk'
    ? schemeColor(scheme, BASE_T)
    : t === undefined
      ? NO_VALUE_COLOR
      : schemeColor(scheme, t)
}

export const NO_VALUE_COLOR = REFERENCE_RAMP_ALT_COLOR
export const NO_VALUE_CSS = REFERENCE_RAMP_ALT_CSS

// A swatch for the legend: the walk's colour, or the scheme across the field
export function encodingSwatchCss({ field, scheme }: WalkEncoding) {
  if (field === 'walk') {
    return schemeCss(scheme, BASE_T)
  }
  const stops = Array.from({ length: 7 }, (_, i) => {
    const t = i / 6
    return `${schemeCss(scheme, t)} ${t * 100}%`
  })
  return `linear-gradient(to right, ${stops.join(', ')})`
}

// The dashed lane of a walk running against the reference, for the legend
export const REVERSED_SWATCH_CSS =
  'repeating-linear-gradient(to right, #555 0 5px, transparent 5px 9px)'

export function fieldLegend(field: WalkField) {
  return WALK_FIELDS.find(f => f.value === field)!.legend
}
