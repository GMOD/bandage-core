// Minimal GFA reader mirroring src/GraphGenomeView/gfa/gfaConverter.ts:
// one node per segment on its canonical strand, edges from L lines, paths from
// P/W lines, stable coordinates from rGFA tags or derived from a reference path.
import { readFileSync } from 'node:fs'

export function readGfa(path, { referencePath } = {}) {
  const text = readFileSync(path, 'utf8')
  const segs = new Map()
  const links = []
  const paths = []
  for (const line of text.split('\n')) {
    if (line.length < 2 || line[1] !== '\t') continue
    const f = line.split('\t')
    if (f[0] === 'S') {
      const tags = {}
      for (let i = 3; i < f.length; i++) {
        const [k, , v] = f[i].split(':')
        tags[k] = v
      }
      const length = f[2] === '*' ? Number(tags.LN ?? 0) : f[2].length
      segs.set(f[1], { id: f[1], length, tags })
    } else if (f[0] === 'L') {
      links.push({ a: f[1], sa: f[2], b: f[3], sb: f[4] })
    } else if (f[0] === 'P') {
      paths.push({
        name: f[1],
        steps: f[2]
          .split(',')
          .filter(Boolean)
          .map(s => ({
            id: s.slice(0, -1),
            strand: s.at(-1),
          })),
      })
    } else if (f[0] === 'W') {
      const steps = []
      for (const m of f[6].matchAll(/([><])([^><]+)/g)) {
        steps.push({ id: m[2], strand: m[1] === '>' ? '+' : '-' })
      }
      paths.push({
        name: `${f[1]}#${f[2]}#${f[3]}`,
        start: f[4] === '*' ? 0 : Number(f[4]),
        steps,
      })
    }
  }
  const canonical = new Map()
  const claim = (id, s) => {
    if (!canonical.has(id)) canonical.set(id, s)
  }
  for (const l of links) {
    claim(l.a, l.sa)
    claim(l.b, l.sb)
  }
  const traversals = new Map()
  for (const p of paths) {
    for (const s of p.steps) {
      claim(s.id, s.strand)
      traversals.set(s.id, (traversals.get(s.id) ?? 0) + 1)
    }
  }
  const nodeId = id => `${id}${canonical.get(id) ?? '+'}`
  const nodes = []
  for (const s of segs.values()) {
    const stable =
      s.tags.SN !== undefined
        ? {
            refName: s.tags.SN,
            start: Number(s.tags.SO),
            rank: Number(s.tags.SR),
          }
        : undefined
    nodes.push({
      id: nodeId(s.id),
      name: s.id,
      length: s.length,
      depth: traversals.get(s.id) ?? 1,
      stable,
    })
  }
  const edges = links
    .filter(l => segs.has(l.a) && segs.has(l.b))
    .map(l => ({ from: nodeId(l.a), to: nodeId(l.b) }))
  const gpaths = paths.map(p => ({
    name: p.name,
    start: p.start ?? 0,
    nodeIds: p.steps.map(s => nodeId(s.id)),
    strands: p.steps.map(s => s.strand),
  }))
  const graph = { nodes, edges, paths: gpaths }
  if (!nodes.some(n => n.stable) && gpaths.length) {
    anchorFromPaths(graph, referencePath)
  }
  return graph
}

// pathAnchoring.ts, condensed: the reference path's visits put nodes on rank 0
// at the offset the walk reaches them; first other visit wins for the rest.
export function anchorFromPaths(graph, referencePath) {
  const byId = new Map(graph.nodes.map(n => [n.id, n]))
  const ref =
    graph.paths.find(
      p => p.name === referencePath || p.name.startsWith(`${referencePath}#`),
    ) ?? graph.paths[0]
  graph.referencePath = ref.name
  const visits = new Map()
  for (const p of graph.paths) {
    let pos = p.start
    p.nodeIds.forEach((id, i) => {
      if (!visits.has(id)) visits.set(id, [])
      visits.get(id).push({ path: p.name, start: pos, strand: p.strands[i] })
      pos += byId.get(id)?.length ?? 0
    })
  }
  for (const n of graph.nodes) {
    const v = visits.get(n.id)
    if (!v) continue
    const a = v.find(x => x.path === ref.name) ?? v[0]
    n.stable = {
      refName: a.path,
      start: a.start,
      rank: a.path === ref.name ? 0 : 1,
      strand: a.strand,
    }
  }
  graph.pathVisits = visits
  return graph
}

export const isBackbone = n => n.stable?.rank === 0

// drawnScale.ts bandageAutoScale
export function bandageAutoScale(graph, minNodeLength = 5) {
  const total = graph.nodes.reduce((s, n) => s + n.length, 0)
  const mb = total / 1e6
  const target = Math.max(graph.nodes.length * 40, 500)
  return {
    nodeLengthPerMegabase: mb > 0 ? target / mb : 10000,
    minimumNodeLength: Math.max(5, minNodeLength),
    edgeLength: 5,
    nodeSegmentLength: 20,
  }
}

export function drawnLength(opts, bp) {
  return Math.max(
    (opts.nodeLengthPerMegabase * bp) / 1e6,
    opts.minimumNodeLength,
  )
}

// Cut a window on the reference path of a path GFA: reference nodes whose
// interval overlaps [start,end], plus every other path's excursions that leave
// and re-enter that set (the interior of each excursion is added), bounded by
// maxExcursion steps.
export function cutWindow(graph, start, end, { maxExcursion = 2000 } = {}) {
  const byId = new Map(graph.nodes.map(n => [n.id, n]))
  const keep = new Set()
  for (const n of graph.nodes) {
    if (
      isBackbone(n) &&
      n.stable.start < end &&
      n.stable.start + n.length > start
    ) {
      keep.add(n.id)
    }
  }
  const ref = graph.referencePath
  for (const p of graph.paths) {
    if (p.name === ref) continue
    let lastIn = -1
    for (let i = 0; i < p.nodeIds.length; i++) {
      if (keep.has(p.nodeIds[i])) {
        if (lastIn >= 0 && i - lastIn - 1 <= maxExcursion) {
          for (let j = lastIn + 1; j < i; j++) keep.add(p.nodeIds[j])
        }
        lastIn = i
      }
    }
  }
  return subgraph(graph, keep)
}

export function subgraph(graph, keep) {
  const nodes = graph.nodes.filter(n => keep.has(n.id))
  const edges = graph.edges.filter(e => keep.has(e.from) && keep.has(e.to))
  const paths = []
  for (const p of graph.paths) {
    let run = []
    const flush = () => {
      if (run.length > 1) {
        paths.push({
          ...p,
          nodeIds: run.map(r => r.id),
          strands: run.map(r => r.s),
        })
      }
      run = []
    }
    p.nodeIds.forEach((id, i) => {
      if (keep.has(id)) run.push({ id, s: p.strands[i] })
      else flush()
    })
    flush()
  }
  return { ...graph, nodes, edges, paths }
}
