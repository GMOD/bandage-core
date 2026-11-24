import { gfaTables } from './gfa/gfaTables'
import { walkKeyEntry, walkScaleEntries } from './graphKey'
import { countLaneWidthPx, countLanes, linkPasses, nodeInk } from './nodeWidths'
import { loadGraph } from './pipeline'
import { buildGeometry } from './renderer/GeometryBuilder'
import {
  eventsAtLink,
  eventsAtNode,
  foldThreads,
  threadFoldInput,
  threadLayers,
  threadsOf,
  threadsThrough,
} from './threadFold'
import { threadFoldKey, threadLabel } from './threadKey'
import { walkLift } from './walkHighlight'

import type { Graph, NodeSegment } from './types'

// The reference walks a s b c. h1 takes t for s, a 1 bp difference; h2 and h3
// skip b's 2 kb, one through s and one through t; h4 reads b reversed.
const GFA = `S\ta\t*\tLN:i:1000
S\ts\t*\tLN:i:1
S\tt\t*\tLN:i:1
S\tb\t*\tLN:i:2000
S\tc\t*\tLN:i:1000
L\ta\t+\ts\t+\t0M
L\ta\t+\tt\t+\t0M
L\ts\t+\tb\t+\t0M
L\tt\t+\tb\t+\t0M
L\tb\t+\tc\t+\t0M
L\ts\t+\tc\t+\t0M
L\tt\t+\tc\t+\t0M
L\ts\t+\tb\t-\t0M
L\tb\t-\tc\t+\t0M
W\tref\t0\tchr\t0\t4001\t>a>s>b>c
W\th1\t1\tchr\t0\t4001\t>a>t>b>c
W\th2\t1\tchr\t0\t2001\t>a>s>c
W\th3\t1\tchr\t0\t2001\t>a>t>c
W\th4\t1\tchr\t0\t4001\t>a>s<b>c`

const whole = loadGraph(GFA, 'toy', { referencePath: 'ref#0#chr' })

function inputOf(graph: Graph) {
  const input = threadFoldInput(graph)
  if (input.reason !== undefined) {
    throw new Error(input.reason)
  }
  return input
}

function folded(graph = whole, belowBp = 500) {
  const result = foldThreads(graph, belowBp)
  if (!result.folded) {
    throw new Error(result.reason)
  }
  return result
}

test('the input is the reference first, a reversed step behind a dash', () => {
  const input = inputOf(whole)
  expect(input.tracks.map(t => t.name)).toEqual([
    'ref#0#chr',
    'h1#1#chr',
    'h2#1#chr',
    'h3#1#chr',
    'h4#1#chr',
  ])
  expect(input.tracks[0]).toMatchObject({ indexOfFirstBase: 0 })
  expect(input.tracks[4]!.sequence).toEqual(['a', 's', '-b', 'c'])
  expect(input.tracks[4]!.haplotype).toBe('h4#1')
  expect(input.refName).toBe('ref#0#chr')
})

test('the reference moves to the front from wherever the file lists it', () => {
  const last = GFA.split('\n')
  const ref = last.findIndex(line => line.startsWith('W\tref'))
  const moved = [...last.filter((_, i) => i !== ref), last[ref]!].join('\n')
  const input = inputOf(loadGraph(moved, 'toy', { referencePath: 'ref#0#chr' }))
  expect(input.tracks[0]!.name).toBe('ref#0#chr')
  expect(input.tracks).toHaveLength(5)
})

test('folded nodes are segments placed on the reference at their bp', () => {
  const { graph } = folded()
  expect(graph.anchoredBy).toBe('tags')
  expect(graph.referencePath).toBe('ref#0#chr')
  expect(
    graph.nodes.map(n => [n.id, n.length, n.stable?.start, n.stable?.rank]),
  ).toEqual([
    ['a+', 1000, 0, 0],
    ['s+', 1, 1000, 0],
    ['b+', 2000, 1001, 0],
    ['c+', 1000, 3001, 0],
  ])
  expect(graph.nodes.every(n => n.stable?.refName === 'ref#0#chr')).toBe(true)
  expect(graph.nodes[0]!.members).toEqual(['a', 't', 's'])
})

test('a thread is the walks of one route, with their count and names, the ones that walk most first', () => {
  const { graph } = folded()
  expect(
    graph.paths!.map(p => [p.name, p.count, p.members, p.nodeIds.join(' ')]),
  ).toEqual([
    ['ref#0#chr', 1, ['ref#0#chr'], 'a+ s+ b+ c+'],
    ['h1#1#chr', 1, ['h1#1#chr'], 'a+ s+ b+ c+'],
    ['h4#1#chr', 1, ['h4#1#chr'], 'a+ s+ b+ c+'],
    ['h2#1#chr', 2, ['h2#1#chr', 'h3#1#chr'], 'a+ c+'],
  ])
  expect(graph.paths![3]!.variation).toBe(
    '2 haplotypes on 2 distinct walks, 1 bp folded away in each',
  )
  expect(graph.threadFold).toEqual({
    belowBp: 500,
    haplotypes: 5,
    walks: 5,
    stepless: 0,
  })
})

test('a node is as deep as the haplotypes of the threads through it', () => {
  const { graph } = folded()
  expect(graph.nodes.map(n => n.depth)).toEqual([5, 3, 3, 5])
})

// on main a link counted its threads while its nodes counted their walks, so
// by walks a thread of two drew its link one walk wide between nodes of five
test('by walks, a link counts the walks of the threads through it on the scale its nodes do, so the widths at a node add up', () => {
  const { graph } = folded()
  const depthOf = (id: string) => graph.nodes.find(n => n.id === id)!.depth
  const into = (id: string) =>
    graph.edges
      .filter(e => e.to === id)
      .reduce((sum, e) => sum + linkPasses(e), 0)
  expect(into('c+')).toBe(depthOf('c+'))
  expect(
    linkPasses(graph.edges.find(e => e.from === 'a+' && e.to === 'c+')!),
  ).toBe(2)
  const scale = walkScaleEntries(graph, 6, true).map(e => e.text)
  expect(scale[0]).toBe('5 walks')
})

// what every link entering a node on its left side carries, and the node's
// depth; a pass that neither starts nor ends at a node enters it once
function leftSides(graph: Graph) {
  return graph.nodes
    .map(node => [
      node.id,
      graph.edges
        .filter(
          e =>
            (e.to === node.id && e.toStrand === '+') ||
            (e.from === node.id && e.fromStrand === '-'),
        )
        .reduce((sum, e) => sum + linkPasses(e), 0),
      node.depth,
    ])
    .filter(([, into]) => into !== 0)
}

test('a walk that takes a node twice counts two passes on the node and on the links in and out, so the widths at it add up', () => {
  const repeat = loadGraph(
    `S\ta\t*\tLN:i:1000
S\tb\t*\tLN:i:2000
S\tc\t*\tLN:i:1000
L\ta\t+\tb\t+\t0M
L\tb\t+\tb\t+\t0M
L\tb\t+\tc\t+\t0M
W\tref\t0\tchr\t0\t4000\t>a>b>c
W\th1\t1\tchr\t0\t6000\t>a>b>b>c`,
    'repeat',
    { referencePath: 'ref#0#chr' },
  )
  expect(leftSides(folded(repeat).graph)).toEqual([
    ['b+', 3, 3],
    ['c+', 2, 2],
  ])
})

test('a walk the folded graph names afresh counts on its links as it does under its own name', () => {
  const t = gfaTables(GFA)!
  const h2 = t.walks.names.indexOf('h2#1#chr')
  const renamed = loadGraph(
    {
      ...t,
      walks: {
        ...t.walks,
        names: t.walks.names.map((name, i) => (i === h2 ? 'h2.alt' : name)),
        starts: t.walks.starts.map((start, i) => (i === h2 ? 1000 : start)),
        ends: t.walks.ends.map((end, i) => (i === h2 ? end + 1000 : end)),
      },
    },
    'toy',
    { referencePath: 'ref#0#chr' },
  )
  const passesOf = (graph: Graph) =>
    graph.edges.map(
      e => `${e.from}${e.fromStrand} ${e.to}${e.toStrand} ${linkPasses(e)}`,
    )
  expect(passesOf(folded(renamed).graph)).toEqual(passesOf(folded().graph))
  expect(leftSides(folded().graph)).toEqual([
    ['s+', 3, 3],
    ['b+', 3, 3],
    ['c+', 5, 5],
  ])
})

test('links come from consecutive steps, with the strands they read', () => {
  const { graph } = folded()
  expect(
    graph.edges.map(e => `${e.from}${e.fromStrand} ${e.to}${e.toStrand}`),
  ).toEqual(['a++ s++', 's++ b++', 'b++ c++', 'b++ s+-', 'b+- c++', 'a++ c++'])
  expect(graph.edges[5]!.pathIds).toEqual(['h2#1#chr'])
})

test('a thread lifted takes the links of its route, the reversed ones too', () => {
  const { graph } = folded()
  const lift = walkLift(graph, [{ walk: 'h4#1#chr' }])!
  expect([...lift.walks[0]!.edgeIndexes].sort((a, b) => a - b)).toEqual([
    0, 3, 4,
  ])
  expect(lift.walks[0]!.backwards.get('b+')).toEqual([true])
})

test('what the fold kept is data in graph-fold words, not on the graph', () => {
  const { events } = folded()
  expect(events).toEqual([
    {
      text: 'deletion about 2 kb (cluster of 2 lengths), 2 of 5',
      kind: 'deletion',
      refStart: 1000,
      refEnd: 3001,
      haplotypes: 2,
      paths: ['h2#1#chr'],
      nodeIds: [],
      from: 'a+',
      to: 'c+',
      anchored: true,
    },
    {
      text: 'inversion 2 kb, 1 of 5',
      kind: 'inversion',
      refStart: 1001,
      refEnd: 3001,
      haplotypes: 1,
      paths: ['h4#1#chr'],
      nodeIds: ['b+'],
      from: 's+',
      to: 'c+',
      anchored: true,
    },
  ])
})

test('a hover finds the threads through a node and the events drawn there', () => {
  const { graph, events } = folded()
  expect(threadsThrough(graph, 'b+').map(t => [t.label, t.count])).toEqual([
    ['ref#0#chr', 1],
    ['h1#1#chr', 1],
    ['h4#1#chr', 1],
  ])
  expect(threadsThrough(graph, 'c+')[3]).toEqual({
    name: 'h2#1#chr',
    label: '2 haplotypes',
    count: 2,
    variation: '2 haplotypes on 2 distinct walks, 1 bp folded away in each',
  })
  expect(eventsAtNode(events, 'b+').map(e => e.kind)).toEqual(['inversion'])
  expect(
    eventsAtLink(events, { from: 'c+', to: 'a+' }).map(e => e.kind),
  ).toEqual(['deletion'])
  expect(eventsAtLink(events, { from: 'a+', to: 's+' })).toEqual([])
})

test('a fold that cannot be made hands the graph back with the reason', () => {
  expect(foldThreads(whole, 0)).toEqual({
    folded: false,
    graph: whole,
    reason: 'nothing to fold',
  })
  const walkless = loadGraph(
    GFA.split('\n')
      .filter(line => !line.startsWith('W'))
      .join('\n'),
    'toy',
  )
  expect(foldThreads(walkless, 500)).toMatchObject({
    folded: false,
    graph: walkless,
    reason: 'the graph has no reference walk',
  })
  const looped = loadGraph(
    GFA.replace('>a>s>b>c\n', '>a>s>b>c>b\n') + '\nL\tc\t+\tb\t+\t0M',
    'toy',
    { referencePath: 'ref#0#chr' },
  )
  const refused = foldThreads(looped, 500)
  expect(refused.folded).toBe(false)
  expect(refused.graph).toBe(looped)
  expect(refused.folded ? undefined : refused.reason).toMatch(/reference/)
})

test('a picked walk lights the thread that holds it', () => {
  const { graph } = folded()
  const names = (walk: string) => threadsOf(graph, walk).map(t => t.name)
  expect(names('h3#1#chr')).toEqual(['h2#1#chr'])
  expect(names('h4#1#chr')).toEqual(['h4#1#chr'])
  expect(names('nobody#1#chr')).toEqual([])
  expect(
    threadLayers(graph, [
      { walk: 'h3#1#chr', color: { value: '#ff0000' } },
      { walk: 'h4#1#chr' },
      { walk: 'h2#1#chr' },
    ]),
  ).toEqual([
    {
      walk: 'h2#1#chr',
      color: { value: '#ff0000' },
      picked: ['h3#1#chr', 'h2#1#chr'],
    },
    { walk: 'h4#1#chr', picked: ['h4#1#chr'] },
  ])
  const layers = [{ walk: 'h3#1#chr' }]
  expect(threadLayers(whole, layers)).toEqual(layers)
})

test('the key names a thread by its count and the picks it holds', () => {
  const { graph } = folded()
  const lift = walkLift(
    graph,
    threadLayers(graph, [{ walk: 'h3#1#chr' }, { walk: 'h4#1#chr' }]),
  )!
  const [many, one] = lift.walks.map(walk =>
    walkKeyEntry(walk, walk.name, undefined, name => name.split('#')[0]!),
  )
  expect(many).toMatchObject({
    strong: '2 haplotypes, h3 among them',
    hover: '2 haplotypes on 2 distinct walks, 1 bp folded away in each',
    swatch: { kind: 'width', px: countLaneWidthPx(2) },
  })
  expect(one).toMatchObject({ strong: 'h4' })
  expect(threadLabel({ count: 1, pieces: 2 }, 'HG03654#1')).toBe(
    'HG03654#1, one of its 2 pieces here',
  )
  expect(threadFoldKey({ belowBp: 5000 })).toBe(
    'a thread is the haplotypes alike in every difference of 5 kb or more; smaller ones are not drawn',
  )
})

test('a haplotype in two walks says so on the thread that is one of them', () => {
  const pieces = `${GFA}\nW\th4\t1\tother\t0\t1000\t>c`
  const { graph } = folded(
    loadGraph(pieces, 'toy', { referencePath: 'ref#0#chr' }),
  )
  expect(graph.paths!.map(p => [p.name, p.pieces])).toEqual([
    ['ref#0#chr', undefined],
    ['h1#1#chr', undefined],
    ['h4#1#chr', 2],
    ['h2#1#chr', undefined],
    ['h4#1#other', 2],
  ])
})

test('count lanes widen by the log of the count and keep their places', () => {
  expect(countLanes([{}, {}])).toBeUndefined()
  const lanes = countLanes([{ count: 1 }, { count: 173 }, {}])!
  expect(lanes.widths[0]).toBe(3)
  expect(lanes.widths[1]).toBeCloseTo(3 + 2 * Math.log(173))
  expect(lanes.widths[2]).toBe(3)
  expect(lanes.band).toBeCloseTo(9 + 2 * Math.log(173))
  expect(lanes.offsets[0]).toBeCloseTo(-lanes.band / 2 + 1.5)
  expect(lanes.offsets[2]).toBeCloseTo(lanes.band / 2 - 1.5)
})

function lanesOf(graph: Graph, contigThickness: number) {
  let x = 0
  const nodePositions: Record<string, NodeSegment[]> = {}
  for (const node of graph.nodes) {
    nodePositions[node.id] = [
      { x, y: 0 },
      { x: x + node.length, y: 0 },
    ]
    x += node.length + 100
  }
  const batch = buildGeometry({
    axis: { scaleX: 1, scaleY: 1 },
    nodePositions,
    graph,
    nodeById: new Map(graph.nodes.map(n => [n.id, n])),
    colorScheme: 'uniform',
    contigThickness,
    connectorThickness: 2,
    drawPaths: false,
    nodeWidth: 'depth',
    smallSites: 'nodes',
    highlight: walkLift(
      graph,
      graph.paths!.map(p => ({ walk: p.name })),
    ),
  })
  return {
    batch,
    lanes: (id: string) => {
      const run = batch.nodeStrokeRuns.get(id)!
      return batch.nodeStrokes
        .slice(run.start, run.start + run.count)
        .map(s => ({
          walk: s.walk,
          y: s.points[0]!.y,
          thickness: s.thickness,
        }))
    },
  }
}

test('a thread is as wide as its count on every node, and runs straight', () => {
  const { graph } = folded()
  const thin = lanesOf(graph, 5)
  const thick = lanesOf(graph, 40)
  const a = thin.lanes('a+')
  expect(a.map(l => l.thickness * 2)).toEqual(
    [1, 1, 1, 2].map(countLaneWidthPx),
  )
  expect(thin.lanes('c+')).toEqual(a)
  expect(thin.lanes('b+')).toEqual(a.filter(l => l.walk !== 3))
  expect(thick.lanes('a+')).toEqual(a)
  expect(thick.lanes('b+')).toEqual(thin.lanes('b+'))
  expect(thin.batch.countedLanes).toBe(true)
})

test('lanes of walks with no count split their node as before', () => {
  const { batch, lanes } = lanesOf(whole, 40)
  expect(batch.countedLanes).toBeUndefined()
  const a = lanes('a+')
  const width = a[0]!.thickness * 2
  expect(width).toBeGreaterThan(countLaneWidthPx(2))
  expect(a.map(l => l.thickness * 2)).toEqual(a.map(() => width))
  a.forEach((lane, i) => {
    expect(lane.y).toBeCloseTo((i - 2) * width)
  })
  expect(lanes('s+')[0]!.thickness).not.toBe(a[0]!.thickness)
})

const withWalks = (...lines: string[]) =>
  loadGraph([GFA, ...lines].join('\n'), 'toy', { referencePath: 'ref#0#chr' })

test('a haplotype in two walks on one route counts once, on its thread and in each event', () => {
  const { graph, events } = folded(
    withWalks(
      'W\th5\t1\tchr\t0\t2001\t>a>s>c',
      'W\th5\t1\tother\t0\t2001\t>a>s>c',
    ),
  )
  const skipping = graph.paths!.find(p => p.name === 'h2#1#chr')!
  expect(skipping.count).toBe(3)
  expect(skipping.members).toEqual([
    'h2#1#chr',
    'h3#1#chr',
    'h5#1#chr',
    'h5#1#other',
  ])
  expect(skipping.variation).toBe(
    '3 haplotypes on 2 distinct walks, 0 bp to 2 bp folded away in each',
  )
  expect(graph.threadFold).toMatchObject({ haplotypes: 6, walks: 7 })
  expect(events.map(e => [e.text, e.haplotypes])).toEqual([
    ['deletion about 2 kb (cluster of 2 lengths), 3 of 6', 3],
    ['inversion 2 kb, 1 of 6', 1],
  ])
})

test('pieces of one contig are threads of their own names and starts', () => {
  const { graph, events } = folded(
    withWalks('W\th5\t1\tchr\t0\t1000\t>a', 'W\th5\t1\tchr\t3001\t4001\t>c'),
  )
  const pieces = graph.paths!.filter(p => p.members?.[0] === 'h5#1#chr')
  expect(pieces.map(p => [p.name, p.start, p.nodeIds, p.pieces])).toEqual([
    ['h5#1#chr piece 1', 0, ['a+'], 2],
    ['h5#1#chr piece 2', 3001, ['c+'], 2],
  ])
  expect(new Set(graph.paths!.map(p => p.name)).size).toBe(graph.paths!.length)
  expect(graph.threadFold).toMatchObject({ haplotypes: 6, walks: 7 })
  expect(
    events
      .filter(e => !e.anchored)
      .map(e => [e.text.replace(/ \d.*/, ''), e.paths]),
  ).toEqual([
    ['walk ends inside the window', ['h5#1#chr piece 1']],
    ['walk starts inside the window', ['h5#1#chr piece 2']],
  ])
  const key = walkLift(graph, threadLayers(graph, [{ walk: 'h5#1#chr' }]))!
  expect(key.walks.map(w => w.name)).toEqual([
    'h5#1#chr piece 1',
    'h5#1#chr piece 2',
  ])
  expect(
    walkKeyEntry(key.walks[0]!, key.walks[0]!.name, undefined).strong,
  ).toBe('h5#1#chr, one of its 2 pieces here')
})

test('an event is carried by the threads of its tracks, whatever their walks are named', () => {
  const { graph, events } = folded(
    withWalks(
      'W\th5\t1\tchr\t0\t1000\t>a',
      'W\th5\t1\tchr\t5000\t7001\t>a>s>c',
    ),
  )
  const ends = events.find(e => e.text.startsWith('walk ends'))!
  expect(ends.paths).toEqual(['h5#1#chr piece 1'])
  expect(ends.haplotypes).toBe(1)
  const deletion = events.find(e => e.kind === 'deletion')!
  expect(deletion.paths).toEqual(['h2#1#chr'])
  expect(deletion.text).toBe(
    'deletion about 2 kb (cluster of 2 lengths), 3 of 6',
  )
  expect(threadsOf(graph, 'h5#1#chr').map(t => t.name)).toEqual([
    'h2#1#chr',
    'h5#1#chr piece 1',
  ])
  expect(
    threadLayers(graph, [{ walk: 'h5#1#chr' }, { walk: 'h3#1#chr' }]),
  ).toEqual([
    { walk: 'h2#1#chr', picked: ['h5#1#chr', 'h3#1#chr'] },
    { walk: 'h5#1#chr piece 1', picked: ['h5#1#chr'] },
  ])
})

test('the order the graph lists its walks in changes no thread', () => {
  const reversed = { ...whole, paths: [...whole.paths!].reverse() }
  const { graph, events } = folded(reversed)
  expect(graph.paths!.map(p => [p.name, p.count])).toEqual([
    ['ref#0#chr', 1],
    ['h4#1#chr', 1],
    ['h1#1#chr', 1],
    ['h3#1#chr', 2],
  ])
  expect(events.map(e => e.paths)).toEqual([['h3#1#chr'], ['h4#1#chr']])
})

test('a graph that does not say which way its walks read a node is not folded', () => {
  const unstranded = { ...whole, pathVisits: undefined }
  expect(foldThreads(unstranded, 500)).toEqual({
    folded: false,
    graph: unstranded,
    reason: 'the graph does not say which way its walks read each node',
  })
})

test('a walk with no steps here is left out of the threads and counted', () => {
  const stepless = {
    ...whole,
    paths: [...whole.paths!, { name: 'h9#1#chr', nodeIds: [] }],
  }
  const { graph } = folded(stepless)
  expect(graph.paths!.some(p => p.members?.includes('h9#1#chr'))).toBe(false)
  expect(graph.threadFold).toMatchObject({
    haplotypes: 5,
    walks: 5,
    stepless: 1,
  })
})

test('a node under count lanes is hit as far as the lanes reach', () => {
  const { graph } = folded()
  const lift = walkLift(
    graph,
    graph.paths!.map(p => ({ walk: p.name })),
  )!
  const band = countLanes(lift.walks)!.band
  const nodeById = new Map(graph.nodes.map(n => [n.id, n]))
  const ink = nodeInk(graph, nodeById, 2, 'depth', lift.walks)
  expect(ink.halfWidthPx('a+')).toBeCloseTo(band / 2)
  expect(
    nodeInk(graph, nodeById, 2, 'depth', 0).halfWidthPx('a+'),
  ).toBeLessThan(band / 2)
  expect(
    nodeInk(graph, nodeById, 80, 'depth', lift.walks).halfWidthPx('a+'),
  ).toBeGreaterThan(band / 2)
})

test('the fold is gated on the revisits of the reference it folds against', () => {
  const looped =
    GFA.replace('>a>s>b>c\n', '>a>s>b>c>b\n') + '\nL\tc\t+\tb\t+\t0M'
  const onRef = loadGraph(looped, 'toy', { referencePath: 'ref#0#chr' })
  const onH1 = loadGraph(looped, 'toy', { referencePath: 'h1#1#chr' })
  expect(onH1.revisited).toBe(1)
  expect(foldThreads(onRef, 500).folded).toBe(false)
  expect(foldThreads(onH1, 500).folded).toBe(true)
  const stated = foldThreads({ ...whole, revisited: 3 }, 500)
  expect(stated.folded ? undefined : stated.reason).toMatch(
    /passes 3 nodes of the graph/,
  )
  expect(
    foldThreads(
      { ...loadGraph(GFA, 'toy', { referencePath: 'h1#1#chr' }), revisited: 3 },
      500,
    ).folded,
  ).toBe(true)
})
