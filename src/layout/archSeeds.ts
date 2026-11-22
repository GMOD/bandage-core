import { isBackbone, readsAsReference } from '../anchoredNodes'
import { compareValues } from '../util/canonicalOrder'
import { ownStrand } from '../util/geometry'
import { groupBy } from '../util/groups'

import type { AnchoredNode } from '../anchoredNodes'
import type { Graph } from '../types'
import type { BandageScaleOpts } from './drawnScale'
import type { LayoutNode } from './referenceSeeds'

type Edge = Graph['edges'][number]
type Side = 'left' | 'right'
type Seeded = LayoutNode & AnchoredNode & { x: number; y: number }

interface Join {
  from: string
  fromSide: Side
  to: string
  toSide: Side
  via?: string
}

interface Stretch {
  lo: number
  hi: number
}

// Share of a half-circle on the stretch's chord. On the line, FMMM draws some
// of these stretches as a loop lying across the reference; 0.1 left more of
// them than 0.3 did and 1 bent the flanks more often.
const ARCH_SHARE = 0.3
const MAX_HEIGHT_SHARE = 0.25
const MAX_JUMP_SHARE = 0.5

const strandAt = (id: string, strand: Edge['fromStrand']) =>
  strand ?? ownStrand(id)

const readsOwn = (id: string, strand: Edge['fromStrand']) =>
  strandAt(id, strand) === ownStrand(id)

const isSeededReference = (node: LayoutNode): node is Seeded =>
  node.x !== undefined && node.y === 0 && isBackbone(node)

const leaving = (node: Seeded, strand: Edge['fromStrand']): Side =>
  readsAsReference(node, strandAt(node.id, strand)) ? 'right' : 'left'

const entering = (node: Seeded, strand: Edge['toStrand']): Side =>
  readsAsReference(node, strandAt(node.id, strand)) ? 'left' : 'right'

const joinKey = (j: Join) =>
  [j.from, j.fromSide, j.to, j.toSide, j.via ?? ''].join(' ')

const drawsAtMinimum = (opts: BandageScaleOpts) => (node: LayoutNode) =>
  !node.placeholder &&
  (opts.nodeLengthPerMegabase * node.length) / 1_000_000 <=
    opts.minimumNodeLength

function hopEnds(
  edge: Edge,
  byId: Map<string, LayoutNode>,
  short: (node: LayoutNode) => boolean,
) {
  const from = byId.get(edge.from)
  const to = byId.get(edge.to)
  return from && to && from.id !== to.id
    ? isSeededReference(from) && !isSeededReference(to) && short(to)
      ? [
          {
            hop: to.id,
            hopEnd: readsOwn(to.id, edge.toStrand) ? 'start' : 'end',
            anchor: from.id,
            side: leaving(from, edge.fromStrand),
          },
        ]
      : isSeededReference(to) && !isSeededReference(from) && short(from)
        ? [
            {
              hop: from.id,
              hopEnd: readsOwn(from.id, edge.fromStrand) ? 'end' : 'start',
              anchor: to.id,
              side: entering(to, edge.toStrand),
            },
          ]
        : []
    : []
}

export function likeEndJoins(
  nodes: readonly LayoutNode[],
  edges: readonly Edge[],
  opts: BandageScaleOpts,
) {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const direct: Join[] = edges.flatMap(edge => {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    return from && to && isSeededReference(from) && isSeededReference(to)
      ? [
          {
            from: from.id,
            fromSide: leaving(from, edge.fromStrand),
            to: to.id,
            toSide: entering(to, edge.toStrand),
          },
        ]
      : []
  })
  const short = drawsAtMinimum(opts)
  const ends = edges.flatMap(edge => hopEnds(edge, byId, short))
  const byHop = groupBy(ends, end => end.hop)
  const through: Join[] = [...byHop.values()].flatMap(list =>
    list.flatMap(a =>
      list
        .filter(b => a.hopEnd !== b.hopEnd && a.anchor < b.anchor)
        .map(b => ({
          from: a.anchor,
          fromSide: a.side,
          to: b.anchor,
          toSide: b.side,
          via: a.hop,
        })),
    ),
  )
  const unique = new Map(
    [...direct, ...through]
      .filter(j => j.fromSide === j.toSide)
      .map(j => [joinKey(j), j]),
  )
  return [...unique.values()].sort((a, b) =>
    compareValues(joinKey(a), joinKey(b)),
  )
}

function seededReference(nodes: readonly LayoutNode[]) {
  return nodes
    .filter(isSeededReference)
    .sort((a, b) => a.x - b.x || compareValues(a.id, b.id))
}

export function closedStretches(
  nodes: readonly LayoutNode[],
  edges: readonly Edge[],
  opts: BandageScaleOpts,
) {
  const reference = seededReference(nodes)
  const rank = new Map(reference.map((n, i) => [n.id, i]))
  const linked = new Set(
    edges.flatMap(e => {
      const a = rank.get(e.from)
      const b = rank.get(e.to)
      return a !== undefined && b !== undefined && Math.abs(a - b) === 1
        ? [Math.min(a, b)]
        : []
    }),
  )
  const breaksBefore = new Int32Array(reference.length)
  for (let r = 1; r < reference.length; r++) {
    breaksBefore[r] = breaksBefore[r - 1]! + (linked.has(r - 1) ? 0 : 1)
  }
  const unbroken = (lo: number, hi: number) =>
    breaksBefore[lo] === breaksBefore[hi]
  const spans = likeEndJoins(nodes, edges, opts).flatMap(j => {
    const a = rank.get(j.from)
    const b = rank.get(j.to)
    return a === undefined ||
      b === undefined ||
      a === b ||
      !unbroken(Math.min(a, b), Math.max(a, b))
      ? []
      : [
          j.fromSide === 'right'
            ? { lo: Math.min(a, b) + 1, hi: Math.max(a, b) }
            : { lo: Math.min(a, b), hi: Math.max(a, b) - 1 },
        ]
  })
  const unique = new Map(spans.map(s => [`${s.lo},${s.hi}`, s]))
  return {
    reference,
    stretches: [...unique.values()]
      .filter(s => s.lo < s.hi)
      .sort((a, b) => a.lo - b.lo || b.hi - a.hi),
  }
}

function merged(stretches: readonly Stretch[]) {
  const out: Stretch[] = []
  for (const s of stretches) {
    const last = out.at(-1)
    if (last && s.lo <= last.hi) {
      last.hi = Math.max(last.hi, s.hi)
    } else {
      out.push({ ...s })
    }
  }
  return out
}

export function archSeeds(
  nodes: LayoutNode[],
  edges: readonly Edge[],
  opts: BandageScaleOpts,
) {
  const { reference, stretches } = closedStretches(nodes, edges, opts)
  const width = (reference.at(-1)?.x ?? 0) - (reference[0]?.x ?? 0)
  const starts = reference.map(n => n.stable.start)
  const span = (starts.at(-1) ?? 0) - (starts[0] ?? 0)
  const jumps = (s: Stretch) =>
    starts
      .slice(Math.max(0, s.lo - 1), s.hi + 2)
      .some((v, i, list) => v - (list[i - 1] ?? v) > MAX_JUMP_SHARE * span)
  const offReferenceY = nodes
    .filter(n => !isSeededReference(n))
    .reduce((sum, n) => sum + (n.y ?? 0), 0)
  const away = offReferenceY > 0 ? -1 : 1
  const lift = new Map(
    merged(stretches)
      .filter(s => !jumps(s))
      .flatMap(s => {
        const arch = reference.slice(s.lo, s.hi + 1)
        const first = arch[0]
        const last = arch.at(-1)
        const chord = (last?.x ?? 0) - (first?.x ?? 0)
        const height = away * Math.min(chord / 2, MAX_HEIGHT_SHARE * width)
        return first
          ? arch
              .slice(1, -1)
              .map((n): [string, number] => [
                n.id,
                ARCH_SHARE *
                  (height * Math.sin((Math.PI * (n.x - first.x)) / chord)),
              ])
          : []
      }),
  )
  return nodes.map(n => {
    const y = lift.get(n.id)
    return y === undefined || y === 0 ? n : { ...n, y }
  })
}
