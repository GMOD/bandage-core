// Panels this far apart, each a title row over a drawing padded this much
export const FACET_GAP_PX = 8
export const FACET_TITLE_PX = 34
export const FACET_PAD_PX = 12
const MIN_FACET_PANEL_PX = 60

export interface FacetGrid {
  columns: number
  width: number
  height: number
  // the drawing's scale in each panel
  scale: number
  total: number
}

// How `count` panels of one drawing tile a pane `width` wide that may grow to
// `room` tall. Unless `columns` says, as many go across as draws each panel
// largest, as facet_wrap chooses its grid: four square drawings go two by
// two in a tall pane and four across in a wide one, and a drawing far wider
// than it is tall stacks. A row layout's rows are px, so its scale is x
// alone and its panels stack. Each panel is as tall as its drawing needs.
export function facetGrid({
  count,
  bounds,
  pixelRows,
  width,
  room,
  columns,
}: {
  count: number
  bounds: { w: number; h: number }
  pixelRows: boolean
  width: number
  room: number
  columns?: number
}): FacetGrid {
  function tile(across: number): FacetGrid {
    const rows = Math.ceil(count / across)
    const panelWidth = Math.floor(
      (width - (across - 1) * FACET_GAP_PX) / across,
    )
    const panelRoom =
      (room - rows * FACET_TITLE_PX - (rows - 1) * FACET_GAP_PX) / rows
    const fitX = (panelWidth - 2 * FACET_PAD_PX) / bounds.w
    const fitY =
      bounds.h > 0 ? (panelRoom - 2 * FACET_PAD_PX) / bounds.h : Infinity
    const scale = pixelRows ? fitX : Math.min(fitX, fitY)
    const drawn = pixelRows ? bounds.h : bounds.h * scale
    const height = Math.floor(
      Math.max(
        MIN_FACET_PANEL_PX,
        Math.min(drawn + 2 * FACET_PAD_PX, panelRoom),
      ),
    )
    return {
      columns: across,
      width: panelWidth,
      height,
      scale,
      total: rows * (height + FACET_TITLE_PX) + (rows - 1) * FACET_GAP_PX,
    }
  }
  if (columns !== undefined) {
    return tile(Math.max(1, Math.min(count, Math.round(columns))))
  }
  let best = tile(1)
  for (let across = 2; across <= count; across++) {
    const grid = tile(across)
    if (grid.scale > best.scale) {
      best = grid
    }
  }
  return best
}

export type FacetBy = 'walk' | 'sample'

/**
 * The facet as a session or a figure spec writes it, in the shape every
 * JBrowse display's `facet` takes: the field the panels split on, `walk` for
 * a panel per lifted walk or `sample` for a row per sample and a column per
 * haplotype, the order the panels take, and how many go across under `walk`.
 */
export interface FacetSetting {
  field: '' | FacetBy
  /** The walks, or under `sample` the samples, whose panels come first, in order. */
  domain: string[]
  /** How many panels go across; unset takes whichever count draws each largest. */
  columns?: number
}

/** What a session or a spec may write for the facet: the field bare, or the setting's members. */
export type FacetInput =
  string | { field?: string; domain?: readonly string[]; columns?: number }

/** A facet written bare is its field, and a field the pane cannot split on is none. */
export function facetSettingOf(facet: FacetInput | undefined): FacetSetting {
  const raw = typeof facet === 'string' ? { field: facet } : (facet ?? {})
  const field = raw.field === 'walk' || raw.field === 'sample' ? raw.field : ''
  return {
    field,
    domain: [...(raw.domain ?? [])],
    ...(raw.columns === undefined ? {} : { columns: raw.columns }),
  }
}

// The listed names first, in the domain's order, then the rest as they came
function domainFirst(names: readonly string[], domain: readonly string[]) {
  const rank = new Map(domain.map((name, i) => [name, i]))
  const listed = (name: string) => rank.get(name) ?? domain.length
  return names
    .map((name, i) => ({ name, i }))
    .sort((a, b) => listed(a.name) - listed(b.name) || a.i - b.i)
    .map(({ name }) => name)
}

// Which grid cell each walk's panel takes, and how many go across when the
// arrangement fixes it. By walk the panels wrap in reading order. By sample
// each sample takes a row and each haplotype a column, as facet_grid(sample ~
// haplotype) lays out a plot, so a sample's haplotypes read across its row and
// a haploid reference sits in the first column. Names that are not
// `sample#haplotype#contig`, or two walks landing in one cell, wrap instead.
// A `domain` puts the walks, or the samples, it lists first.
export function facetCells(
  names: string[],
  by: FacetBy,
  domain: readonly string[] = [],
) {
  const wrapOrder = domainFirst(names, domain)
  const wrap = {
    columns: undefined,
    count: names.length,
    cells: names.map(name => wrapOrder.indexOf(name)),
  }
  if (by === 'walk') {
    return wrap
  }
  const places = names.map(name => {
    const [sample, haplotype, contig] = name.split('#')
    const n = Number(haplotype)
    return contig !== undefined && Number.isInteger(n) && n >= 0
      ? { sample: sample!, column: Math.max(0, n - 1) }
      : undefined
  })
  const rows = domainFirst(
    [...new Set(places.flatMap(p => (p ? [p.sample] : [])))],
    domain,
  )
  const columns = Math.max(1, ...places.map(p => (p ? p.column + 1 : 1)))
  const cells = places.map(p =>
    p ? rows.indexOf(p.sample) * columns + p.column : -1,
  )
  return cells.includes(-1) || new Set(cells).size < cells.length
    ? wrap
    : { columns, count: rows.length * columns, cells }
}
