import { packAbgr } from '@jbrowse/core/util/colorBits'

import {
  REFERENCE_RAMP_ALT_COLOR,
  REFERENCE_RAMP_MAX_HUE,
  hslToRgb,
} from './renderer/GeometryBuilder'

// How a lifted walk colours its lane, stated the way a grammar of graphics
// states an encoding: a field, the quantity the walk has at each node it
// visits, mapped through a scheme, the scale from that quantity to a colour.
// Colour does one job at a time by default: a walk lifted alone shades light
// to dark along itself, which follows it round a loop, and walks lifted
// together each take one flat colour, which says which lane is which. The
// reference takes grey, so no hue means anything but a haplotype.
//
// A session states it per walk, and leaves out whatever takes the default:
//
//   "walkLayers": [
//     { "walk": "GRCh38#0#chr6" },
//     { "walk": "HG00133#1#CM090050.1", "color": { "scheme": "purple" } }
//   ]

export const WALK_FIELDS = [
  { value: 'progress', label: 'Progress along the walk' },
  { value: 'walk', label: 'One colour for the walk' },
  { value: 'reference', label: 'Reference position' },
] as const

export type WalkField = (typeof WALK_FIELDS)[number]['value']

// Each family runs from a light colour where the walk starts to a dark one of
// another hue where it ends, so a walk reads in hue as well as lightness, and
// no two families share a stretch of the colour wheel: one walk's gradient
// never passes through another's colours. The reference takes grey to black, so
// that no hue on a lane means anything but a haplotype. The rainbow is the
// reference-position ramp, so it goes with that field only.
//
// A dichromat sees one axis, blue to yellow, so cyan to navy and yellow to red
// stay apart for every reader and come first; pink and lime fold into them.
export const WALK_SCHEMES = [
  { value: 'grey', label: 'Grey to black', ends: ['#a3a3a3', '#151515'] },
  { value: 'blue', label: 'Cyan to navy', ends: ['#6ee0f0', '#0b2c7a'] },
  { value: 'red', label: 'Yellow to red', ends: ['#ffd24a', '#b3121b'] },
  { value: 'purple', label: 'Pink to plum', ends: ['#f5a3d8', '#5e1a6e'] },
  { value: 'green', label: 'Lime to forest', ends: ['#b6e36c', '#0b5d3b'] },
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

// the families lifted haplotypes take by default, in the order they were picked
const FAMILIES: WalkScheme[] = ['blue', 'red', 'purple', 'green']

const isField = (v: unknown): v is WalkField =>
  WALK_FIELDS.some(f => f.value === v)
const isScheme = (v: unknown): v is WalkScheme =>
  WALK_SCHEMES.some(s => s.value === v)

// A stated field or scheme this build does not have reads as unset
export function resolveEncoding(
  layer: WalkLayer,
  reference: boolean,
  picked: number,
  alone = true,
): WalkEncoding {
  const { field: askedField, scheme: askedScheme } = layer.color ?? {}
  const field = isField(askedField) ? askedField : alone ? 'progress' : 'walk'
  const family = reference ? 'grey' : FAMILIES[picked % FAMILIES.length]!
  const scheme = isScheme(askedScheme)
    ? askedScheme === 'rainbow' && field !== 'reference'
      ? family
      : askedScheme
    : family
  return { field, scheme }
}

// Where a flat lane sits on its family: halfway between its ends
const BASE_T = 0.5

const toLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
const toGamma = (c: number) =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055

// sRGB hex to OKLab, where a straight line between two colours changes
// lightness evenly, so a family's steps read alike from end to end
function oklab(hex: string) {
  const [r, g, b] = [1, 3, 5].map(i =>
    toLinear(Number.parseInt(hex.slice(i, i + 2), 16) / 255),
  ) as [number, number, number]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function oklabToRgb([L, a, b]: number[]) {
  const l = (L! + 0.3963377774 * a! + 0.2158037573 * b!) ** 3
  const m = (L! - 0.1055613458 * a! - 0.0638541728 * b!) ** 3
  const s = (L! - 0.0894841775 * a! - 1.291485548 * b!) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(c => toGamma(Math.max(0, Math.min(1, c))) * 255)
}

// A scheme at t in [0, 1] as rgb 0-255
export function schemeRgb(scheme: WalkScheme, t: number) {
  const x = Math.max(0, Math.min(1, t))
  const family = WALK_SCHEMES.find(s => s.value === scheme)
  if (!family || !('ends' in family)) {
    return hslToRgb(x * REFERENCE_RAMP_MAX_HUE, 0.7, 0.5).map(c => c * 255)
  }
  const from = oklab(family.ends[0])
  const to = oklab(family.ends[1])
  return oklabToRgb(from.map((v, i) => v + (to[i]! - v) * x))
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

// A key's colours: the walk's one colour, or the scheme across the field
export function encodingStops({ field, scheme }: WalkEncoding) {
  return field === 'walk'
    ? [{ offset: 0, color: schemeCss(scheme, BASE_T) }]
    : Array.from({ length: 7 }, (_, i) => ({
        offset: i / 6,
        color: schemeCss(scheme, i / 6),
      }))
}

// A swatch for the legend: the walk's colour, or the scheme across the field
export function encodingSwatchCss(encoding: WalkEncoding) {
  const stops = encodingStops(encoding)
  return stops.length === 1
    ? stops[0]!.color
    : `linear-gradient(to right, ${stops.map(s => `${s.color} ${s.offset * 100}%`).join(', ')})`
}
