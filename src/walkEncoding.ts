import {
  REFERENCE_RAMP_LIGHTNESS,
  REFERENCE_RAMP_SATURATION,
  rampHueAt,
} from './referenceRampCss'
import { REFERENCE_RAMP_ALT_COLOR, hslToRgb } from './renderer/GeometryBuilder'
import { packAbgr } from './renderer/colorBits'

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
  { value: 'pass', label: 'Each pass through repeated nodes' },
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
// Orange runs within red's stretch, so no walk takes it unasked.
export const WALK_SCHEMES = [
  { value: 'grey', label: 'Grey to black', ends: ['#a3a3a3', '#151515'] },
  { value: 'blue', label: 'Cyan to navy', ends: ['#6ee0f0', '#0b2c7a'] },
  { value: 'red', label: 'Yellow to red', ends: ['#ffd24a', '#b3121b'] },
  { value: 'purple', label: 'Pink to plum', ends: ['#f5a3d8', '#5e1a6e'] },
  { value: 'green', label: 'Lime to forest', ends: ['#b6e36c', '#0b5d3b'] },
  { value: 'orange', label: 'Peach to rust', ends: ['#ffc285', '#8f3a00'] },
  { value: 'rainbow', label: 'Rainbow' },
] as const

export type WalkScheme = (typeof WALK_SCHEMES)[number]['value']

export interface WalkEncoding {
  field: WalkField
  scheme: WalkScheme
  darkest?: number
  shade?: number
  stretch?: readonly [number, number]
}

// bp from the walk's first base
export interface PassSpan {
  start: number
  end: number
}

export interface WalkLayer {
  walk: string
  color?: Partial<WalkEncoding>
  // for a walk that steps no node twice here
  passes?: readonly PassSpan[]
  passNames?: readonly string[]
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
  const round = Math.floor(picked / FAMILIES.length) % SHADES.length
  return flatField(field) && scheme === family && round > 0
    ? { field, scheme, shade: SHADES[round] }
    : alone || flatField(field)
      ? { field, scheme }
      : { field, scheme, darkest: TOGETHER_DARKEST }
}

const flatField = (field: WalkField) => field === 'walk' || field === 'pass'

export const TOGETHER_DARKEST = 0.55

// Where a flat lane sits on its family: halfway between its ends
const BASE_T = 0.5

// The shade a flat lane takes on each round through the families, deeper
// then paler, so twelve walks lifted together take twelve colours
const SHADES = [BASE_T, 0.85, 0.2]

// The gap left between two ramps that split one family, so neither ends on
// the colour the other starts at
const STRETCH_GAP = 0.08

const rampsOn = ({ field, scheme }: WalkEncoding) =>
  !flatField(field) && scheme !== 'rainbow'

// Ramps lifted together that share a family split it, the first taking the
// pale end, so past the fourth walk no two gradients pass through one colour
export function splitFamilies(encodings: readonly WalkEncoding[]) {
  const counts = new Map<WalkScheme, number>()
  for (const e of encodings) {
    if (rampsOn(e)) {
      counts.set(e.scheme, (counts.get(e.scheme) ?? 0) + 1)
    }
  }
  const seen = new Map<WalkScheme, number>()
  return encodings.map((e): WalkEncoding => {
    const k = rampsOn(e) ? counts.get(e.scheme)! : 1
    if (k < 2) {
      return e
    }
    const j = seen.get(e.scheme) ?? 0
    seen.set(e.scheme, j + 1)
    const half = STRETCH_GAP / 2
    return {
      ...e,
      stretch: [
        j / k + (j > 0 ? half : 0),
        (j + 1) / k - (j < k - 1 ? half : 0),
      ],
    }
  })
}

const along = ({ stretch }: WalkEncoding, t: number) =>
  stretch ? stretch[0] + (stretch[1] - stretch[0]) * t : t

const toLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
const toGamma = (c: number) =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055

// sRGB hex to OKLab, where a straight line between two colours changes
// lightness evenly, so a family's steps read alike from end to end
function oklab(hex: string) {
  const channel = (i: number) =>
    toLinear(Number.parseInt(hex.slice(i, i + 2), 16) / 255)
  const r = channel(1)
  const g = channel(3)
  const b = channel(5)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const lab: [number, number, number] = [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
  return lab
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

const hexOf = (rgb: number[]) =>
  `#${rgb.map(c => Math.round(c).toString(16).padStart(2, '0')).join('')}`

// Two hex colours mixed in OKLab, `t` of the way from the first
export function mixHex(from: string, to: string, t: number) {
  const a = oklab(from)
  const b = oklab(to)
  return hexOf(oklabToRgb(a.map((v, i) => v + (b[i]! - v) * t)))
}

const endsCache = new Map<WalkScheme, number[][] | undefined>()

function oklabEnds(scheme: WalkScheme) {
  if (!endsCache.has(scheme)) {
    const family = WALK_SCHEMES.find(s => s.value === scheme)
    endsCache.set(
      scheme,
      family && 'ends' in family ? family.ends.map(oklab) : undefined,
    )
  }
  return endsCache.get(scheme)
}

// A scheme at t in [0, 1] as rgb 0-255
export function schemeRgb(scheme: WalkScheme, t: number, darkest = 0) {
  const x = Math.max(0, Math.min(1, t))
  const ends = oklabEnds(scheme)
  if (!ends) {
    return hslToRgb(
      rampHueAt(x),
      REFERENCE_RAMP_SATURATION,
      REFERENCE_RAMP_LIGHTNESS,
    ).map(c => c * 255)
  }
  const from = ends[0]!
  const to = ends[1]!
  const light = from[0]!
  const dark = to[0]!
  const reach =
    dark < darkest && light > darkest ? (light - darkest) / (light - dark) : 1
  return oklabToRgb(from.map((v, i) => v + (to[i]! - v) * x * reach))
}

export function schemeCss(scheme: WalkScheme, t: number, darkest?: number) {
  const [r, g, b] = schemeRgb(scheme, t, darkest).map(Math.round)
  return `rgb(${r}, ${g}, ${b})`
}

export function schemeColor(scheme: WalkScheme, t: number, darkest?: number) {
  const [r, g, b] = schemeRgb(scheme, t, darkest).map(Math.round)
  return packAbgr(r!, g!, b!, 255)
}

// A field's value at a node through the walk's scheme; `t` undefined is a node
// the field has nothing to say about, off the reference for `reference`
export function encodedColor(encoding: WalkEncoding, t?: number) {
  const { field, scheme, darkest, shade = BASE_T } = encoding
  return flatField(field)
    ? schemeColor(scheme, shade)
    : t === undefined
      ? NO_VALUE_COLOR
      : schemeColor(scheme, along(encoding, t), darkest)
}

export const NO_VALUE_COLOR = REFERENCE_RAMP_ALT_COLOR

// A key's colours: the walk's one colour, or the scheme across the field
export function encodingStops(encoding: WalkEncoding) {
  const { field, scheme, darkest, shade = BASE_T } = encoding
  const stop = (offset: number, t: number) => ({
    offset,
    color: schemeCss(scheme, t, darkest),
    abgr: schemeColor(scheme, t, darkest),
  })
  return flatField(field)
    ? [stop(0, shade)]
    : Array.from({ length: 7 }, (_, i) => stop(i / 6, along(encoding, i / 6)))
}

// A swatch for the legend: the walk's colour, or the scheme across the field
export function encodingSwatchCss(encoding: WalkEncoding) {
  const stops = encodingStops(encoding)
  return stops.length === 1
    ? stops[0]!.color
    : `linear-gradient(to right, ${stops.map(s => `${s.color} ${s.offset * 100}%`).join(', ')})`
}

// Okabe and Ito's, then Tol's
export const PASS_HUES = [
  '#D55E00',
  '#0072B2',
  '#009E73',
  '#CC79A7',
  '#E69F00',
  '#56B4E9',
  '#882255',
  '#332288',
  '#999933',
  '#44AA99',
  '#CCBB44',
  '#AA3377',
  '#117733',
  '#DDCC77',
  '#CC6677',
  '#AA4499',
  '#88CCEE',
  '#EE6677',
  '#228833',
  '#4477AA',
  '#66CCEE',
  '#EE8866',
  '#EEDD88',
  '#FFAABB',
  '#99DDFF',
  '#44BB99',
  '#BBCC33',
  '#AAAA00',
  '#EE7733',
  '#0077BB',
  '#33BBEE',
  '#EE3377',
  '#CC3311',
  '#009988',
  '#661100',
  '#6699CC',
  '#994455',
  '#997700',
  '#EECC66',
  '#004488',
]

// OKLab distances from every lane colour and from every pass colour taken
export const PASS_FROM_WALK = 0.17
export const PASS_FROM_PASS = 0.18

export const oklabGap = (a: string, b: string) => {
  const p = oklab(a)
  const q = oklab(b)
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
}

const nearestGap = (hue: string, colours: readonly string[]) =>
  colours.reduce((least, c) => Math.min(least, oklabGap(hue, c)), Infinity)

export function passPalette(
  own: string,
  count: number,
  lanes: readonly string[] = [],
  taken: readonly string[] = [],
) {
  const walks = [own].concat(lanes)
  const picked: string[] = []
  const slack = (hue: string) =>
    Math.min(
      nearestGap(hue, walks) - PASS_FROM_WALK,
      nearestGap(hue, taken.concat(picked)) - PASS_FROM_PASS,
    )
  while (picked.length < Math.min(count, PASS_HUES.length)) {
    const open = PASS_HUES.filter(hue => !picked.includes(hue))
    picked.push(
      open.find(hue => slack(hue) >= 0) ??
        open.reduce((most, hue) => (slack(hue) > slack(most) ? hue : most)),
    )
  }
  return picked
}
