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
// By default every lane shades pale to deep along its walk, the reference in
// grey and each haplotype in a hue of its own, so hue names the walk and
// lightness follows it round a loop. A walk crossing the reference's nodes the
// other way shades against the reference's lane beside it.
//
// A session states it per walk, and leaves out whatever takes the default:
//
//   "walkLayers": [
//     { "walk": "GRCh38#0#chr6" },
//     { "walk": "HG00133#1#CM090050.1", "color": { "scheme": "purple" } }
//   ]

export const WALK_FIELDS = [
  {
    value: 'progress',
    label: 'Progress along the walk',
    legend: 'pale where each walk starts, deep where it ends',
  },
  { value: 'walk', label: 'One colour for the walk', legend: '' },
  {
    value: 'reference',
    label: 'Reference position',
    legend: 'along the reference left to right, charcoal off it',
  },
] as const

export type WalkField = (typeof WALK_FIELDS)[number]['value']

// Grey, which the reference takes so that no hue on a lane means anything but
// a haplotype, then Okabe–Ito's first five, which stay apart under the common
// colour vision deficiencies. Each runs pale to deep in lightness around its
// own colour (hue, saturation, lightness at the family's middle). The rainbow
// is the reference-position ramp, so it goes with that field only.
export const WALK_SCHEMES = [
  { value: 'grey', label: 'Grey', hsl: [0, 0, 0.5] },
  { value: 'blue', label: 'Blue', hsl: [202, 1, 0.4] },
  { value: 'vermillion', label: 'Vermillion', hsl: [26, 1, 0.45] },
  { value: 'green', label: 'Bluish green', hsl: [164, 1, 0.35] },
  { value: 'orange', label: 'Orange', hsl: [41, 1, 0.45] },
  { value: 'purple', label: 'Reddish purple', hsl: [327, 0.5, 0.55] },
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
}

// The colours lifted haplotypes take by default, in the order they were picked.
// Orange comes last: shaded pale to deep it runs into vermillion.
const FAMILIES: WalkScheme[] = [
  'blue',
  'vermillion',
  'green',
  'purple',
  'orange',
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
  const field = isField(askedField) ? askedField : 'progress'
  const family = reference ? 'grey' : FAMILIES[picked % FAMILIES.length]!
  const scheme = isScheme(askedScheme)
    ? askedScheme === 'rainbow' && field !== 'reference'
      ? family
      : askedScheme
    : family
  return { field, scheme }
}

// Where a flat lane sits on its family: the family's own colour
const BASE_T = 0.5
// how far a family's lightness runs either side of its middle
const LIGHTNESS_SPAN = 0.22

// A scheme at t in [0, 1] as rgb 0-255
export function schemeRgb(scheme: WalkScheme, t: number) {
  const x = Math.max(0, Math.min(1, t))
  const family = WALK_SCHEMES.find(s => s.value === scheme)
  const [h, s, l] =
    family && 'hsl' in family
      ? [
          family.hsl[0],
          family.hsl[1],
          family.hsl[2] + LIGHTNESS_SPAN * (1 - 2 * x),
        ]
      : [x * REFERENCE_RAMP_MAX_HUE, 0.7, 0.5]
  return hslToRgb(h, s, l).map(c => c * 255)
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

export function fieldLegend(field: WalkField) {
  return WALK_FIELDS.find(f => f.value === field)!.legend
}
