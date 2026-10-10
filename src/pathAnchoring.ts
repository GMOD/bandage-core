import { REFERENCE_RANK } from './anchoredNodes'
import { panSNSample } from './pansn'
import { PathVisitsBuilder } from './pathVisits'

import type { PathVisits } from './pathVisits'
import type { Graph, GraphNode, GraphPath, PathOrigin } from './types'

// Reference coordinates for a GFA that tags none of its segments with one.
//
// rGFA writes the fact per segment (SN/SO/SR). A pggb / odgi / Minigraph-Cactus
// graph writes the same fact once per path and leaves the arithmetic to the
// reader: walking a path's steps in order, accumulating segment lengths,
// assigns every segment that path visits an interval on the path's own
// sequence. Same information, different encoding — so a general GFA is not a
// degraded rGFA, and the anchored layouts work on it once the walk is done.
//
// It carries one thing rGFA cannot: a segment's *carriage*, the set of
// assemblies that actually traverse it. rGFA's SR is build order, so there the
// most a segment can say is which assembly first contributed it.

// `odgi extract` names an extracted path for the interval it covers on its own
// sequence: `K12#1#chr:1004500-1004961`. That suffix is the only place a cut
// subgraph states where in the genome it sits, so it is split off here rather
// than carried around as part of the name — no assembly has a sequence called
// `K12#1#chr:1004500-1004961`, and PanSN parsing of it yields a contig no
// linear view can open.
//
// Anchored on the digits rather than on a trailing colon, because a stable name
// may legitimately contain one (the same hazard gfaParser's tag splitting has).
const RANGE_SUFFIX = /:(\d+)-\d+$/

export function pathOrigin(pathName: string) {
  const match = RANGE_SUFFIX.exec(pathName)
  return match
    ? { name: pathName.slice(0, match.index), start: +match[1]! }
    : { name: pathName, start: 0 }
}

export interface PathSteps {
  name: string
  start: number
  steps: { id: string; strand: '+' | '-' }[]
}

// The single walk. Every segment visit lands in `pathVisits` at the bp its own
// path reaches it at; `anchorPaths` is what the walk learned about the paths
// themselves, which is what a reference-path picker lists.
export function surveyPaths(
  paths: PathSteps[],
  lengthOf: (segmentId: string) => number,
) {
  const anchorPaths: PathOrigin[] = []
  const visits = new PathVisitsBuilder()
  for (const path of paths) {
    const sample = panSNSample(path.name)
    const p = visits.pathOf(path.name, sample)
    let pos = path.start
    for (const step of path.steps) {
      visits.addAt(visits.declare(step.id), p, pos, step.strand === '-')
      pos += lengthOf(step.id)
    }
    anchorPaths.push({
      name: path.name,
      sample,
      start: path.start,
      length: pos - path.start,
    })
  }
  return { anchorPaths, pathVisits: visits.build() }
}

// Which path x is drawn on. This is a choice, not a fact: a general GFA's path
// names are arbitrary and nothing in the file marks one of them as the
// reference, so a preference is matched against a path's PanSN sample name (the
// assembly a subgraph was cut against, which is how the launch path knows) and
// then against its full name. With no preference the first path in the file
// wins, which is where pggb and odgi leave the reference.
export function chooseReferencePath(
  anchorPaths: PathOrigin[],
  preferred: string | undefined,
) {
  const named = anchorPaths.find(
    p => p.sample === preferred || p.name === preferred,
  )
  return named ?? anchorPaths[0]
}

// Rank on a path-derived graph is the one distinction the paths support: on the
// reference path or off it. rGFA's higher ranks are minigraph's build order,
// which a path GFA has no equivalent of, so drawing more rows than this would
// be drawing structure the file does not state.
const OFF_REFERENCE_RANK = 1

// A segment the reference path visits sits on the backbone at the offset that
// visit reaches it. One it never visits is an alternate allele, placed on the
// coordinates of the first path that does carry it — the same asymmetry rGFA
// has, where a rank>0 segment's SO is an offset on the assembly that
// contributed the sequence rather than on the reference.
//
// **First visit wins** when a path reaches the same segment more than once, and
// collapsed repeats make that real rather than hypothetical: pggb folds the
// E. coli rRNA operons into shared segments, so every strain's path walks them
// twice (`odgi depth` reaches 10 over a five-strain graph at chr:4,167,000 and
// chr:3,942,000). A node draws as one tube at one x, so the alternative to
// picking a copy is one tube spanning both, claiming reference the segment does
// not occupy. The repeat stays visible as depth: such a node's traversal count
// is a multiple of the path count.
function anchorNode(
  node: GraphNode,
  visits: PathVisits,
  reference: number,
  samplesOf: (slot: number) => string[],
): GraphNode {
  const slot = visits.slot(node.name)
  if (slot < 0 || visits.offsets[slot] === visits.offsets[slot + 1]) {
    return node
  }
  const own = visits.firstBy(slot, reference)
  const anchor = own >= 0 ? own : visits.offsets[slot]!
  return {
    ...node,
    stable: {
      refName: visits.paths[visits.path[anchor]!]!,
      start: visits.start[anchor]!,
      rank: own >= 0 ? REFERENCE_RANK : OFF_REFERENCE_RANK,
      strand: visits.strand(anchor),
    },
    samples: samplesOf(slot),
  }
}

// A segment's samples, sorted, by each path's sample's place in the graph's
// samples sorted once: sorting each node's own was 40 M string comparisons on
// KIV-2 cut with every haplotype, whose 22 k nodes are each walked by most of
// its 233 samples. A node every sample walks shares one list.
function sampleSorter(visits: PathVisits) {
  const sorted = [...new Set(visits.samples)].sort()
  const rank = new Map(sorted.map((sample, i) => [sample, i]))
  const pathRank = Int32Array.from(visits.samples, s => rank.get(s)!)
  const seen = new Uint8Array(sorted.length)
  const ranks = new Int32Array(sorted.length)
  return (slot: number) => {
    let n = 0
    for (let i = visits.offsets[slot]!; i < visits.offsets[slot + 1]!; i++) {
      const r = pathRank[visits.path[i]!]!
      if (seen[r] === 0) {
        seen[r] = 1
        ranks[n++] = r
      }
    }
    let out: string[]
    if (n === sorted.length) {
      out = sorted
      seen.fill(0)
    } else if (n * 8 < sorted.length) {
      const found = ranks.subarray(0, n)
      found.forEach(r => (seen[r] = 0))
      out = Array.from(found.sort(), r => sorted[r]!)
    } else {
      // most samples: read them off in order rather than sort
      out = []
      for (let r = 0; r < sorted.length; r++) {
        if (seen[r] === 1) {
          seen[r] = 0
          out.push(sorted[r]!)
        }
      }
    }
    return out
  }
}

// Re-runnable against a different reference path at no parsing cost, which is
// what the picker needs: the walk is already recorded in `pathVisits`, and only
// which path counts as rank 0 changes.
export function anchorFromPaths(graph: Graph, preferred: string | undefined) {
  const { anchorPaths, pathVisits } = graph
  const reference =
    anchorPaths && pathVisits
      ? chooseReferencePath(anchorPaths, preferred)
      : undefined
  if (!reference || !anchorPaths || !pathVisits) {
    return graph
  }
  const samplesOf = sampleSorter(pathVisits)
  const referenceIndex = pathVisits.pathIndex(reference.name)
  return {
    ...graph,
    nodes: graph.nodes.map(node =>
      anchorNode(node, pathVisits, referenceIndex, samplesOf),
    ),
    anchoredBy: 'paths',
    referencePath: reference.name,
  } satisfies Graph
}

// rGFA states coordinates on every segment, so only a graph that states none
// has to derive them. A GFA with neither tags nor paths comes back untouched
// and falls through to the force layout, which is the honest answer for it.
export function anchorGraph(graph: Graph, preferred: string | undefined) {
  return graph.anchoredBy === 'tags' ? graph : anchorFromPaths(graph, preferred)
}

// `graph`'s origins once each walk is cut down to the steps `kept` gives it,
// by path name, the first of them at index `first` of the whole walk: it
// starts that much further along its sequence and covers only those steps. A
// walk in several pieces cannot say which piece an origin belongs to, so its
// origin stands.
export function trimOrigins(
  graph: Graph,
  kept: Map<string, { first: number; nodeIds: string[] }>,
) {
  if (!graph.anchorPaths) {
    return undefined
  }
  const lengthOf = new Map(graph.nodes.map(n => [n.id, n.length]))
  const bp = (ids: string[], end = ids.length) => {
    let sum = 0
    for (let i = 0; i < end; i++) {
      sum += lengthOf.get(ids[i]!) ?? 0
    }
    return sum
  }
  const byOrigin = new Map<string, GraphPath[]>()
  for (const path of graph.paths ?? []) {
    const origin = pathOrigin(path.name).name
    byOrigin.set(origin, [...(byOrigin.get(origin) ?? []), path])
  }
  return graph.anchorPaths.map(o => {
    const pieces = byOrigin.get(o.name)
    const path = pieces?.length === 1 ? pieces[0]! : undefined
    const stretch = path && kept.get(path.name)
    return path && stretch
      ? {
          ...o,
          start: o.start + bp(path.nodeIds, stretch.first),
          length: bp(stretch.nodeIds),
        }
      : o
  })
}
