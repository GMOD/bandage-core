import { REFERENCE_RANK } from '../anchoredNodes'
import { stableCoordinate } from '../gfa-core/index'
import { pathOrigin, stateStrands, surveyPaths } from '../pathAnchoring'
import { revisitedCount } from './graphTables'
import { linkKey } from './linkKey'
import {
  FORWARD,
  REVERSED,
  orientSegments,
  respelled,
} from './segmentOrientation'

import type { GFAGraph, GFANode, GFAPath, GFAWalk } from '../gfa-core/index'
import type { PathSteps } from '../pathAnchoring'
import type { Graph, GraphEdge, GraphNode, GraphPath } from '../types'

// Every reference a GFA makes to a segment, collecting the things the drawn
// graph needs from them.
//
// `canonical` is the one orientation each segment is drawn in, which is what
// Bandage calls single-node mode. A segment is the same sequence read either
// way (`L 1 + 2 +` is the same edge as `L 2 - 1 -`), so `1+` and `1-` are one
// node, not two: drawing both doubles every segment, and since the L lines only
// wire one of the pair, the other copy has no edges at all and scatters loose
// across the layout. Which of the two it is reads off the reference, not off
// the file's order or spelling (segmentOrientation.ts). `respell` says which
// links read better in their other spelling.
//
// `traversals` is how many paths cross each segment. Assembly GFAs carry read
// depth in a dp/RC/FC/KC tag, but a pangenome GFA (odgi, vg) carries none —
// there the meaningful depth is how many samples go through the segment, i.e.
// core versus accessory sequence.
function surveySegments(gfaGraph: GFAGraph, stepped: PathSteps[]) {
  const index = new Map<string, number>()
  const names: string[] = []
  const indexOf = (id: string) => {
    let i = index.get(id)
    if (i === undefined) {
      i = names.length
      index.set(id, i)
      names.push(id)
    }
    return i
  }
  const backbone: number[] = []
  const referenceOf: (string | undefined)[] = []
  for (const node of gfaGraph.nodes) {
    const i = indexOf(node.id)
    const stable = stableCoordinate(node)
    backbone[i] ??= stable?.rank === REFERENCE_RANK ? 1 : 0
    referenceOf[i] ??= stable?.refName
  }
  const links = {
    from: gfaGraph.links.map(link => indexOf(link.source)),
    to: gfaGraph.links.map(link => indexOf(link.target)),
    strands: gfaGraph.links.map(
      link => (link.strand1 === '-' ? 1 : 0) | (link.strand2 === '-' ? 2 : 0),
    ),
  }
  const traversals = new Map<string, number>()
  const reversals: number[] = []
  const referenceReversals: number[] = []
  const traverse =
    (walk: string) =>
    ({ id, strand }: { id: string; strand: '+' | '-' }) => {
      const i = indexOf(id)
      const reading = strand === '-' ? 1 : -1
      reversals[i] = (reversals[i] ?? 0) + reading
      if (backbone[i] && referenceOf[i] === walk) {
        referenceReversals[i] = (referenceReversals[i] ?? 0) + reading
      }
      traversals.set(id, (traversals.get(id) ?? 0) + 1)
    }
  for (const { name, steps } of stepped) {
    steps.forEach(traverse(name))
  }
  const orient = orientSegments(
    names,
    Array.from(names, (_, i) =>
      backbone[i] ? ((referenceReversals[i] ?? 0) > 0 ? REVERSED : FORWARD) : 0,
    ),
    links,
    Array.from(names, (_, i) => reversals[i] ?? 0),
  )
  const canonical = new Map(
    names.map((id, i) => [id, orient[i] === REVERSED ? '-' : '+'] as const),
  )
  return {
    canonical,
    traversals,
    respell: (k: number) => respelled(names, orient, links, k),
  }
}

// `*` parses to -1, meaning the record declines to say; 0 is then the only
// offset that can be assumed, and it makes the walk self-relative rather than
// wrong
const walkStart = (w: GFAWalk) => (w.start === -1 ? 0 : w.start)

// A P body is a comma-joined `<id><strand>` list whose start offset lives in
// the record's name; a W record arrives split into steps with its start as a
// field
function stepsOfPath(p: GFAPath): PathSteps {
  return {
    ...pathOrigin(p.name),
    steps: p.path.split(',').map(segment => ({
      id: segment.slice(0, -1),
      strand: segment.endsWith('-') ? ('-' as const) : ('+' as const),
    })),
  }
}

// Named by the full PanSN name, contig included. Dropping the contig made a
// path's name an ASSEMBLY's name, and one assembly walks one W record per
// contig: two walks of `HG00438#1` then shared an identity, so
// `edgeToPathsMap` merged them, `pathColors` (keyed by name) kept only the
// last colour written while the node stripes kept the first, and the key drew
// one haplotype twice in two colours. That is the ordinary Minigraph-Cactus
// shape, not a corner case.
//
// The legend narrows it back: `labelTiers` tries sample, then sample and
// haplotype, then the whole name, so a graph with one contig per haplotype
// is labelled exactly as before and only a colliding one widens.
function stepsOfWalk(w: GFAWalk) {
  return {
    name: `${w.sample}#${w.haplotype}#${w.contig}`,
    start: walkStart(w),
    steps: w.segments,
  }
}

// Carriage stated as a tag rather than derived from a walk. `RgfaTabixAdapter`
// synthesizes its S-lines from a segs.bed whose sixth column is a list of GFA
// tags, and `scripts/pggb_gfa_to_bed.py` in jbrowse-components puts every
// haplotype that visits a segment there as `SM:Z:K12.1,Sakai.1`. That is the
// only way carriage reaches an INDEXED graph: the cut has no P or W lines to
// walk, so `pathAnchoring` has no visits to derive it from.
//
// It does not compete with that walk. `pathAnchoring.anchorNode` rebuilds
// `samples` from the visits whenever there are any, so a graph loaded as a file
// keeps the authoritative path-derived set and this is what a tabix cut falls
// back to.
function carriedSamples(gfaNode: GFANode) {
  const sm = gfaNode.tags.SM
  if (typeof sm !== 'string') {
    return undefined
  }
  const samples = sm
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  return samples.length > 0 ? samples : undefined
}

const positive = (v: unknown) =>
  typeof v === 'number' && v > 0 ? v : undefined

// The depth a segment states, or undefined. DP is a depth in either case it is
// written. RC, FC and KC are read, fragment and k-mer counts, so depth is the
// count over the length: taken raw, a 100 kb node at 5x outweighed a 1 kb node
// at 50x tenfold in every width drawn from it.
function statedDepth({ tags, length }: GFANode) {
  const count = positive(tags.RC) ?? positive(tags.FC) ?? positive(tags.KC)
  return (
    positive(tags.dp) ??
    positive(tags.DP) ??
    (count !== undefined && length > 0 ? count / length : undefined)
  )
}

function makeNode(
  gfaNode: GFANode,
  strand: '+' | '-',
  depth: number,
): GraphNode {
  const frequency = gfaNode.tags.AF
  return {
    id: `${gfaNode.id}${strand}`,
    name: gfaNode.id,
    length: gfaNode.length,
    depth,
    ...(typeof frequency === 'number' && frequency >= 0 ? { frequency } : {}),
    stable: stableCoordinate(gfaNode),
    samples: carriedSamples(gfaNode),
    ...(gfaNode.tags.mv === 1 ? { moved: true as const } : {}),
    ...(gfaNode.tags.nl === 1 ? { placeholder: true as const } : {}),
  }
}

export function convertGFAToGraph(stated: GFAGraph, name = 'Imported GFA') {
  const linked = new Set<string>()
  const gfaGraph = {
    ...stated,
    links: stated.links.filter(link => {
      const key = linkKey(link.source, link.strand1, link.target, link.strand2)
      const first = !linked.has(key)
      linked.add(key)
      return first
    }),
  }
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  const pathSteps = gfaGraph.paths.map(stepsOfPath)
  const walkSteps = gfaGraph.walks.map(stepsOfWalk)
  const stepped = [...pathSteps, ...walkSteps]
  const { canonical, traversals, respell } = surveySegments(gfaGraph, stepped)
  // segments no link, path, or walk mentions are drawn forward-strand. One
  // string per segment, not per step: a walk of 100k steps built 100k.
  const canonicalIds = new Map<string, string>()
  const nodeId = (segmentId: string) => {
    let id = canonicalIds.get(segmentId)
    if (id === undefined) {
      id = `${segmentId}${canonical.get(segmentId) ?? '+'}`
      canonicalIds.set(segmentId, id)
    }
    return id
  }

  // a segment declared twice keeps its first declaration, as links and walks
  // can only name one node
  const lengths = new Map<string, number>()
  let depthStated = false
  for (const gfaNode of gfaGraph.nodes) {
    if (lengths.has(gfaNode.id)) {
      continue
    }
    lengths.set(gfaNode.id, gfaNode.length)
    const fileDepth = statedDepth(gfaNode)
    depthStated ||= fileDepth !== undefined
    const depth = fileDepth ?? Math.max(traversals.get(gfaNode.id) ?? 1, 1)
    nodes.push(makeNode(gfaNode, canonical.get(gfaNode.id) ?? '+', depth))
  }

  const flip = { '+': '-', '-': '+' } as const
  gfaGraph.links.forEach((link, k) => {
    const fromStrand = link.strand1 === '-' ? '-' : '+'
    const toStrand = link.strand2 === '-' ? '-' : '+'
    edges.push(
      respell(k)
        ? {
            from: nodeId(link.target),
            to: nodeId(link.source),
            fromStrand: flip[toStrand],
            toStrand: flip[fromStrand],
          }
        : {
            from: nodeId(link.source),
            to: nodeId(link.target),
            fromStrand,
            toStrand,
          },
    )
  })

  const paths: GraphPath[] = []

  // The paths crossing each edge, found by the node pair either way round: a
  // path that walks the graph on the reverse strand visits an edge's nodes in
  // the opposite order to the L line that declared it. Links between the same
  // two nodes share one set. Looked up through the node id strings already
  // built, so a step allocates nothing; a key string per step was most of the
  // conversion of a cut with walks.
  const pathsByPair = new Map<string, Map<string, Set<string>>>()
  const pairPaths = (a: string, b: string) => pathsByPair.get(a)?.get(b)
  function addPair(a: string, b: string, set: Set<string>) {
    let to = pathsByPair.get(a)
    if (!to) {
      to = new Map()
      pathsByPair.set(a, to)
    }
    to.set(b, set)
  }
  const edgePaths = edges.map(edge => {
    let set = pairPaths(edge.from, edge.to)
    if (!set) {
      set = new Set()
      addPair(edge.from, edge.to, set)
      addPair(edge.to, edge.from, set)
    }
    return set
  })

  function recordPathEdges(nodeIds: string[], pathName: string) {
    for (let i = 0; i < nodeIds.length - 1; i++) {
      pairPaths(nodeIds[i]!, nodeIds[i + 1]!)?.add(pathName)
    }
  }

  gfaGraph.paths.forEach(({ name: pathName }, i) => {
    // a step lands on its segment's canonical orientation, whichever way this
    // path reads it
    const { start, steps } = pathSteps[i]!
    const nodeIds = steps.map(step => nodeId(step.id))
    paths.push({ name: pathName, nodeIds, start } satisfies GraphPath)
    recordPathEdges(nodeIds, pathName)
  })

  gfaGraph.walks.forEach((walk, i) => {
    const { name: walkName, start } = walkSteps[i]!
    const nodeIds = walk.segments.map(seg => nodeId(seg.id))
    paths.push({
      name: walkName,
      nodeIds,
      start,
      sample: walk.sample,
      haplotype: walk.haplotype,
      contig: walk.contig,
    } satisfies GraphPath)
    recordPathEdges(nodeIds, walkName)
  })

  edges.forEach((edge, i) => {
    const pathIds = edgePaths[i]!
    if (pathIds.size > 0) {
      edge.pathIds = [...pathIds]
    }
  })

  // Only walked when the file has paths to walk, so an rGFA, which has none,
  // pays nothing for it
  const anchoring =
    stepped.length > 0
      ? surveyPaths(stepped, id => lengths.get(id) ?? 0)
      : undefined
  if (anchoring) {
    stateStrands(nodes, anchoring.pathVisits)
  }

  return {
    name,
    nodes,
    edges,
    paths: paths.length > 0 ? paths : undefined,
    anchorPaths: anchoring?.anchorPaths,
    pathVisits: anchoring?.pathVisits,
    // rGFA's own tags win wherever they are present; pathAnchoring only ever
    // fills in for a graph that carries none.
    anchoredBy: nodes.some(n => n.stable) ? 'tags' : undefined,
    revisited: revisitedCount(
      [
        ...gfaGraph.paths.map(({ name: pathName }, i) => ({
          name: pathName,
          segments: pathSteps[i]!.steps.map(step => step.id),
        })),
        ...walkSteps.map(({ name: walkName, steps }) => ({
          name: walkName,
          segments: steps.map(step => step.id),
        })),
      ],
      new Set(
        nodes.flatMap(n => (n.stable?.rank === 0 ? [n.stable.refName] : [])),
      ),
    ),
    ...(depthStated ? { depthStated } : {}),
  } satisfies Graph
}
