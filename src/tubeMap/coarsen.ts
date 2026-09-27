import { isBackbone } from '../anchoredNodes'
import { visitStrands } from '../layout/tubeMapLayout'
import { pathOrigin } from '../pathAnchoring'
import { canonicalStrand } from './reads'

import type { AnchoredNode } from '../anchoredNodes'
import type {
  Graph,
  GraphEdge,
  GraphNode,
  GraphPath,
  PathVisit,
} from '../types'

// A tube map of a human window is mostly SNP bubbles: MICB's 22 kb cut draws
// 475 columns for 238 bubbles, one of them 50 bp or more. This folds every
// variant under `sigma` into the reference, as svSTM does (van den Brandt et
// al., EuroVis 2025), so the reference between two structural variants is one
// node and each walk keeps what it carries there as deviations at their bp.
//
// Cut from each walk's own runs over the reference, not from the bubbles:
// derived bubbles are chain level, so a kept superbubble keeps every SNP inside
// it raw, and a one-node inversion never forms one.

type Strand = '+' | '-'

// A variant a walk carries inside a merged node: it leaves the reference at
// `start`, rejoins it at `end`, and carries `bp` of its own in between
export interface Deviation {
  start: number
  end: number
  bp: number
  inverted?: true
}

export type CutCause =
  | 'variant'
  | 'backward'
  | 'inversion'
  | 'walk-end'
  | 'overlap'
  | 'reference-gap'

export interface Coarsened {
  graph: Graph
  // coarse node id to the original node ids it stands for
  members: Map<string, string[]>
  // original node id to the coarse node that draws it
  coarseOf: Map<string, string>
  // by path name, the variants folded into the merged nodes it visits
  deviations: Map<string, Deviation[]>
  cuts: Map<number, CutCause>
}

interface Step {
  node: GraphNode
  strand: Strand
}

// A stretch of reference a walk reads contiguously, in reference order
// whichever way it reads it
interface Run {
  start: number
  end: number
  inverted: boolean
}

interface Gap {
  a: number
  b: number
  detour: Step[]
  bp: number
}

// A walk as runs over the reference and the detours between them. A detour
// before the first run or after the last has no reference on that side.
interface Walk {
  path: GraphPath
  runs: Run[]
  // gaps[i] lies between runs[i - 1] and runs[i]; gaps[runs.length] trails
  gaps: Gap[]
}

function readWalk(
  path: GraphPath,
  nodeById: Map<string, GraphNode>,
  strands: Map<string, Strand[]>,
): Walk {
  const visitName = pathOrigin(path.name).name
  const seen = new Map<string, number>()
  const runs: Run[] = []
  const open = (): Gap => ({ a: -Infinity, b: Infinity, detour: [], bp: 0 })
  const gaps: Gap[] = [open()]
  for (const id of path.nodeIds) {
    const node = nodeById.get(id)
    if (!node) {
      continue
    }
    const k = seen.get(node.name) ?? 0
    seen.set(node.name, k + 1)
    const strand =
      strands.get(`${visitName}\t${node.name}`)?.[k] ?? canonicalStrand(node)
    const gap = gaps.at(-1)!
    const last = runs.at(-1)
    if (isBackbone(node)) {
      const start = node.stable.start
      const end = start + node.length
      const inverted = strand !== (node.stable.strand ?? '+')
      const joins = last !== undefined && gap.detour.length === 0
      if (joins && !last.inverted && !inverted && last.end === start) {
        last.end = end
      } else if (joins && last.inverted && inverted && last.start === end) {
        last.start = start
      } else {
        runs.push({ start, end, inverted })
        gaps.push(open())
      }
    } else {
      gap.detour.push({ node, strand })
      gap.bp += node.length
    }
  }
  runs.forEach((run, i) => {
    gaps[i]!.b = run.start
    gaps[i + 1]!.a = run.end
  })
  return { path, runs, gaps }
}

function isSmall(gap: Gap, sigma: number) {
  return (
    Number.isFinite(gap.a) &&
    Number.isFinite(gap.b) &&
    gap.b >= gap.a &&
    Math.max(gap.b - gap.a, gap.bp) < sigma
  )
}

function strictlyInside(cuts: readonly number[], a: number, b: number) {
  let lo = 0
  let hi = cuts.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cuts[mid]! <= a) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  return lo < cuts.length && cuts[lo]! < b
}

// Both sides of a hole in the reference, which a walk that seems to step over
// it has not stepped over any reference
function referenceGaps(backbone: readonly AnchoredNode[]) {
  const cuts = new Map<number, CutCause>()
  for (let i = 1; i < backbone.length; i++) {
    const prev = backbone[i - 1]!
    const node = backbone[i]!
    const end = prev.stable.start + prev.length
    if (end !== node.stable.start) {
      cuts.set(end, 'reference-gap')
      cuts.set(node.stable.start, 'reference-gap')
    }
  }
  return cuts
}

// Where the reference is cut. A small variant that straddles another walk's cut
// would skip a whole merged node, so it is cut too, until nothing changes.
function findCuts(
  walks: readonly Walk[],
  sigma: number,
  cuts: Map<number, CutCause>,
) {
  const cut = (bp: number, cause: CutCause) => {
    if (Number.isFinite(bp) && !cuts.has(bp)) {
      cuts.set(bp, cause)
    }
  }
  for (const { runs, gaps } of walks) {
    const first = runs[0]
    const last = runs.at(-1)
    if (first && last) {
      cut(first.start, 'walk-end')
      cut(last.end, 'walk-end')
    }
    for (const run of runs) {
      if (run.inverted && run.end - run.start >= sigma) {
        cut(run.start, 'inversion')
        cut(run.end, 'inversion')
      }
    }
    for (const gap of gaps) {
      if (gap.b < gap.a) {
        cut(gap.a, 'backward')
        cut(gap.b, 'backward')
      } else if (!isSmall(gap, sigma)) {
        cut(gap.a, 'variant')
        cut(gap.b, 'variant')
      }
    }
  }
  for (let changed = true; changed;) {
    changed = false
    const sorted = [...cuts.keys()].sort((x, y) => x - y)
    const spans = walks.flatMap(({ runs, gaps }) => [
      ...gaps.filter(g => isSmall(g, sigma)).map(g => [g.a, g.b] as const),
      ...runs
        .filter(r => r.inverted && r.end - r.start < sigma)
        .map(r => [r.start, r.end] as const),
    ])
    for (const [a, b] of spans) {
      if (strictlyInside(sorted, a, b)) {
        changed ||= !cuts.has(a) || !cuts.has(b)
        cut(a, 'overlap')
        cut(b, 'overlap')
      }
    }
  }
  return cuts
}

interface Merged {
  node: GraphNode
  members: AnchoredNode[]
}

function mergeReference(
  backbone: readonly AnchoredNode[],
  cuts: Map<number, CutCause>,
) {
  const merged: Merged[] = []
  let group: AnchoredNode[] = []
  const close = () => {
    const first = group[0]
    const last = group.at(-1)
    if (first && last) {
      const bp0 = first.stable.start
      const bp1 = last.stable.start + last.length
      const name = `${bp0}-${bp1}`
      merged.push({
        node: {
          id: `${name}+`,
          name,
          length: bp1 - bp0,
          depth: 0,
          stable: {
            refName: first.stable.refName,
            start: bp0,
            rank: 0,
            strand: '+',
          },
        },
        members: group,
      })
    }
    group = []
  }
  for (const node of backbone) {
    if (cuts.has(node.stable.start)) {
      close()
    }
    group.push(node)
  }
  close()
  return merged
}

export function coarsenTubeMap(
  graph: Graph,
  sigma: number,
): Coarsened | undefined {
  const backbone = graph.nodes
    .filter(isBackbone)
    .sort((a, b) => a.stable.start - b.stable.start)
  const paths = graph.paths ?? []
  if (backbone.length === 0 || paths.length === 0) {
    return undefined
  }
  const nodeById = new Map(graph.nodes.map(n => [n.id, n]))
  const strands = visitStrands(graph)
  const walks = paths.map(p => readWalk(p, nodeById, strands))
  const cuts = findCuts(walks, sigma, referenceGaps(backbone))
  const sortedCuts = [...cuts.keys()].sort((x, y) => x - y)
  const merged = mergeReference(backbone, cuts)
  const starts = merged.map(m => m.node.stable!.start)
  const mergedAt = (bp: number) => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid]! <= bp) {
        lo = mid
      } else {
        hi = mid - 1
      }
    }
    return lo
  }

  const members = new Map<string, string[]>()
  const coarseOf = new Map<string, string>()
  for (const m of merged) {
    members.set(
      m.node.id,
      m.members.map(n => n.id),
    )
    for (const n of m.members) {
      coarseOf.set(n.id, m.node.id)
    }
  }

  // One node per distinct detour a structural gap takes, shared by the walks
  // that take the same one
  const routes = new Map<string, GraphNode>()
  const routeFor = (gap: Gap) => {
    const key = `${gap.a}\t${gap.b}\t${gap.detour.map(s => s.node.id + s.strand).join(',')}`
    let node = routes.get(key)
    if (!node) {
      const name = `r${routes.size}`
      node = {
        id: `${name}+`,
        name,
        length: gap.bp,
        depth: 0,
        stable: {
          refName: backbone[0]!.stable.refName,
          start: Number.isFinite(gap.a) ? gap.a : gap.b,
          rank: 1,
          strand: '+',
        },
      }
      routes.set(key, node)
      members.set(
        node.id,
        gap.detour.map(s => s.node.id),
      )
      for (const s of gap.detour) {
        if (!coarseOf.has(s.node.id)) {
          coarseOf.set(s.node.id, node.id)
        }
      }
    }
    return node
  }

  const deviations = new Map<string, Deviation[]>()
  const coarsePaths: GraphPath[] = []
  const pathVisits = new Map<string, PathVisit[]>()
  const edges = new Map<string, GraphEdge>()
  const depth = new Map<string, number>()

  for (const { path, runs, gaps } of walks) {
    const steps: { node: GraphNode; strand: Strand }[] = []
    const devs: Deviation[] = []
    // a structural gap ends the stretch a merged node may be continued over
    let continuing = false
    const append = (node: GraphNode, strand: Strand) => {
      const last = steps.at(-1)
      if (!(continuing && last?.node === node && last.strand === strand)) {
        steps.push({ node, strand })
      }
      continuing = true
    }
    const structural = (gap: Gap) => {
      continuing = false
      if (gap.detour.length > 0) {
        append(routeFor(gap), '+')
        continuing = false
      }
    }
    const fold = (gap: Gap) => {
      if (gap.bp > 0 || gap.b > gap.a) {
        devs.push({ start: gap.a, end: gap.b, bp: gap.bp })
      }
      const home = merged[mergedAt(gap.b > gap.a ? gap.a : gap.a - 1)]!
      for (const s of gap.detour) {
        if (!coarseOf.has(s.node.id)) {
          coarseOf.set(s.node.id, home.node.id)
          members.get(home.node.id)!.push(s.node.id)
        }
      }
    }
    runs.forEach((run, i) => {
      const gap = gaps[i]!
      if (isSmall(gap, sigma) && !strictlyInside(sortedCuts, gap.a, gap.b)) {
        fold(gap)
      } else {
        structural(gap)
      }
      const i0 = mergedAt(run.start)
      const i1 = mergedAt(run.end - 1)
      const small = run.end - run.start < sigma
      if (run.inverted && !small) {
        continuing = false
        for (let j = i1; j >= i0; j--) {
          append(merged[j]!.node, '-')
        }
        continuing = false
      } else {
        if (run.inverted) {
          devs.push({
            start: run.start,
            end: run.end,
            bp: run.end - run.start,
            inverted: true,
          })
        }
        for (let j = i0; j <= i1; j++) {
          append(merged[j]!.node, '+')
        }
      }
    })
    structural(gaps.at(-1)!)

    const visitName = pathOrigin(path.name).name
    let pos = 0
    steps.forEach(({ node, strand }, i) => {
      depth.set(node.id, (depth.get(node.id) ?? 0) + 1)
      const visits = pathVisits.get(node.name) ?? []
      visits.push({
        path: visitName,
        sample: path.sample ?? visitName,
        start: pos,
        strand,
      })
      pathVisits.set(node.name, visits)
      pos += node.length
      const next = steps[i + 1]
      if (next) {
        const key = `${node.id}${strand}\t${next.node.id}${next.strand}`
        const edge = edges.get(key)
        if (edge) {
          edge.pathIds!.push(path.name)
        } else {
          edges.set(key, {
            from: node.id,
            to: next.node.id,
            fromStrand: strand,
            toStrand: next.strand,
            pathIds: [path.name],
          })
        }
      }
    })
    coarsePaths.push({ ...path, nodeIds: steps.map(s => s.node.id) })
    deviations.set(path.name, devs)
  }

  const nodes = [...merged.map(m => m.node), ...routes.values()]
    .filter(n => depth.has(n.id))
    .map(n => ({ ...n, depth: depth.get(n.id)! }))
  return {
    graph: {
      ...graph,
      nodes,
      edges: [...edges.values()],
      paths: coarsePaths,
      pathVisits,
      reads: undefined,
    },
    members,
    coarseOf,
    deviations,
    cuts,
  }
}
