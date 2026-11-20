import { readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

import { deletionEdges } from '../../src/deletionEdges'
import { laidOutGraph } from '../../src/figureData'
import { figureScene } from '../../src/figureScene'
import {
  buildGeometry,
  computeReferenceRamp,
} from '../../src/renderer/GeometryBuilder'
import { makeGraph } from './graphgen'

import type { RenderBatch } from '../../src/renderer/types'
import type { Graph, GraphNode, NodeSegment } from '../../src/types'

export const W = 1280
export const H = 800

const [outDir = '.', rhdPath] = process.argv.slice(2)

function write(
  name: string,
  scene: { nodes: number; scale: number; sy?: number; tx: number; ty: number },
  batch: RenderBatch,
) {
  const replacer = (_k: string, v: unknown) =>
    v instanceof Map
      ? { __map: [...v.entries()] }
      : v instanceof Set
        ? { __set: [...v] }
        : v
  writeFileSync(
    `${outDir}/${name}.json`,
    JSON.stringify({ name, ...scene, batch }, replacer),
  )
  console.log(
    `${name}: ${scene.nodes} nodes, ${batch.nodeStrokes.length} node strokes, ${batch.edgeCurves.length} link strokes`,
  )
}

function gfaText(path: string) {
  const raw = readFileSync(path)
  return path.endsWith('.gz') ? gunzipSync(raw).toString() : raw.toString()
}

async function forceScene(name: string, text: string) {
  const { graph, layout } = await laidOutGraph(text, name, undefined, {
    engine: 'fmmm',
  })
  const scene = figureScene(graph, layout, {
    colorScheme: 'auto',
    nodeWidth: 'depth',
  })
  const { bounds } = scene
  const scale = Math.min((W - 40) / bounds.w, (H - 40) / bounds.h)
  write(
    name,
    {
      nodes: graph.nodes.length,
      scale,
      tx: 20 - bounds.minX * scale + (W - 40 - bounds.w * scale) / 2,
      ty: 20 - bounds.minY * scale + (H - 40 - bounds.h * scale) / 2,
    },
    scene.geometry(scene.lift, { scaleX: scale, scaleY: scale }),
  )
}

function syntheticGfa(n: number) {
  const { graph } = makeGraph(n)
  return [
    'H\tVN:Z:1.0',
    ...graph.nodes.map(
      x => `S\t${x.name}\t*\tLN:i:${x.length}\tDP:f:${x.depth}`,
    ),
    ...graph.edges.map(
      e => `L\t${e.from.slice(0, -1)}\t+\t${e.to.slice(0, -1)}\t+\t0M`,
    ),
  ].join('\n')
}

// renderPasses.bench.ts's bubble chain, laid out in rows and fitted to 900 px
function benchScene(name: string, backbone: number) {
  const nodes: GraphNode[] = []
  const edges: Graph['edges'] = []
  let at = 0
  for (let i = 0; i < backbone; i++) {
    const length = 300 + (i % 17) * 40
    nodes.push({
      id: `b${i}+`,
      name: `b${i}`,
      length,
      depth: 5,
      stable: { refName: 'chr1', start: at, rank: 0 },
    })
    at += length
    if (i > 0) {
      edges.push({ from: `b${i - 1}+`, to: `b${i}+` })
    }
    if (i % 2 === 1 && i > 1) {
      nodes.push({
        id: `a${i}+`,
        name: `a${i}`,
        length: 40 + (i % 7) * 11,
        depth: 2,
        stable: { refName: `HG${i % 40}#1#chr1`, start: i * 100, rank: 1 },
      })
      edges.push({ from: `b${i - 2}+`, to: `a${i}+` })
      edges.push({ from: `a${i}+`, to: `b${i}+` })
      edges.push({ from: `b${i - 2}+`, to: `b${i}+` })
    }
  }
  const graph: Graph = { name, nodes, edges, anchoredBy: 'tags' }
  const nodePositions: Record<string, NodeSegment[]> = {}
  for (const node of nodes) {
    const { start, rank } = node.stable!
    nodePositions[node.id] = [
      { x: start, y: rank * 20 },
      { x: start + node.length, y: rank * 20 },
    ]
  }
  const scale = (900 - 80) / at
  const batch = buildGeometry({
    nodePositions,
    graph,
    nodeById: new Map(nodes.map(n => [n.id, n])),
    colorScheme: 'reference-position',
    contigThickness: 10,
    connectorThickness: 4,
    drawPaths: false,
    axis: { scaleX: scale, scaleY: 1 },
    referenceRamp: computeReferenceRamp(graph, { start: 0, end: at }),
    deletions: new Map(
      deletionEdges(graph).map(d => [d.edgeIndex, d.bypassed]),
    ),
  })
  write(name, { nodes: nodes.length, scale, sy: 1, tx: 40, ty: 280 }, batch)
}

benchScene('doc1500', 1000)
benchScene('doc15k', 10000)
await forceScene('kiv2', gfaText('figures/kiv2_walks.gfa.gz'))
await forceScene('fm15k', syntheticGfa(15000))
await forceScene('fm50k', syntheticGfa(50000))
if (rhdPath) {
  await forceScene('rhd', gfaText(rhdPath))
}
