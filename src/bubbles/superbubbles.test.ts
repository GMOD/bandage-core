import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

import { bubbleKey, sameBubble } from './bubbleLine'
import { bubbleSegmentIds, classifyBubble } from './classifyBubble'
import { bubbleSubgraph } from './popBubble'
import {
  MAX_SUPERBUBBLES,
  graphBubbles,
  superbubblesFromGraph,
} from './superbubbles'
import { convertGFAToGraph } from '../gfa/gfaConverter'
import { parseGFA } from '../gfa-core/index'

import type { MinigraphBubble } from './bubbleLine'
import type { Graph, GraphEdge, GraphNode } from '../types'

function node(name: string, length: number, start?: number): GraphNode {
  return {
    id: `${name}+`,
    name,
    length,
    depth: 1,
    stable:
      start === undefined
        ? { refName: 'alt', start: 0, rank: 1 }
        : { refName: 'chr', start, rank: 0 },
  }
}

function link(spec: string): GraphEdge {
  const [, from, fromStrand, to, toStrand] = /^(\w+)([+-])(\w+)([+-])$/.exec(
    spec,
  )!
  return {
    from: `${from}+`,
    to: `${to}+`,
    fromStrand: fromStrand as '+' | '-',
    toStrand: toStrand as '+' | '-',
  }
}

function graphOf(nodes: GraphNode[], links: string[], walks?: string[][]) {
  return {
    name: 'g',
    nodes,
    edges: links.map(link),
    ...(walks
      ? {
          paths: walks.map((ids, i) => ({
            name: `hap${i}`,
            nodeIds: ids.map(id => `${id}+`),
          })),
        }
      : {}),
    anchoredBy: 'tags',
  } satisfies Graph
}

const segmentSet = (b: MinigraphBubble) => new Set(bubbleSegmentIds(b))

const refFlanks = [node('r1', 10, 0), node('r2', 5, 10), node('r3', 10, 15)]
const refLinks = ['r1+r2+', 'r2+r3+']

// r1 r2 r3 on chr, and an alt arm from r1 to r3 carrying a SNP between x1 and
// x2: the reach rule's one bubble is the whole graph
const altSnp = graphOf(
  [...refFlanks, node('x1', 4), node('y1', 1), node('y2', 1), node('x2', 3)],
  [...refLinks, 'r1+x1+', 'x1+y1+', 'x1+y2+', 'y1+x2+', 'y2+x2+', 'x2+r3+'],
)

// An alt arm p..q holding a chain a..d..g beside h, inside a reach bubble
// that is the whole graph
const chain = graphOf(
  [
    ...refFlanks,
    ...['p', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'q'].map(n => node(n, 2)),
  ],
  [
    ...refLinks,
    'r1+p+',
    'p+a+',
    'a+b+',
    'a+c+',
    'b+d+',
    'c+d+',
    'd+e+',
    'd+f+',
    'e+g+',
    'f+g+',
    'g+q+',
    'p+h+',
    'h+q+',
    'q+r3+',
  ],
)

// x..y around s..e, so s..e is not the whole graph; `inner` links s to e
function framed(inner: GraphNode[], links: string[]) {
  return graphOf(
    [
      node('x', 1),
      node('s', 1),
      node('e', 1),
      node('z', 1),
      node('y', 1),
      ...inner,
    ],
    ['x+s+', 'e+y+', 'x+z+', 'z+y+', ...links],
  )
}

const span = {
  refName: 'chr',
  start: 10,
  end: 15,
  segmentCount: 0,
  pathCount: 0,
  inversion: false,
  shortestAlleleLength: 0,
  longestAlleleLength: 0,
  segments: '',
  shortestAllele: undefined,
  longestAllele: undefined,
}

describe('graphBubbles', () => {
  it('opens a bubble that is the whole graph into the SNP on its alt arm', () => {
    const [snp, ...rest] = graphBubbles(altSnp)
    expect(rest).toEqual([])
    expect(snp).toMatchObject({
      key: 'x1>x2',
      offReference: true,
      refName: 'chr',
      start: 10,
      end: 15,
      segmentCount: 4,
      pathCount: 2,
    })
    expect(bubbleSegmentIds(snp!)[0]).toBe('x1')
    expect(bubbleSegmentIds(snp!).at(-1)).toBe('x2')
    expect(classifyBubble(snp!).label).toBe('SNP')
  })

  it('keeps the outer superbubble at the top and its chain on the pop', () => {
    const top = graphBubbles(chain)
    expect(top.map(b => b.key)).toEqual(['p>q'])
    const popped = bubbleSubgraph(chain, bubbleSegmentIds(top[0]!))
    const inner = graphBubbles(popped, top[0])
    expect(inner.map(b => b.key)).toEqual(['a>d', 'd>g'])
    expect(inner.every(b => b.offReference && b.start === 10)).toBe(true)
  })

  it('a pop never derives the bubble it opened', () => {
    const gfa = readFileSync(
      join(__dirname, '../../test_data/ecoli_rgfa_slice.gfa'),
      'utf8',
    )
    const graph = convertGFAToGraph(parseGFA(gfa))
    let pops = 0
    const descend = (g: Graph, b: MinigraphBubble) => {
      const popped = bubbleSubgraph(g, bubbleSegmentIds(b))
      const inner = graphBubbles(popped, b)
      const own = segmentSet(b)
      pops++
      for (const x of inner) {
        const seg = segmentSet(x)
        expect(seg.size === own.size && [...seg].every(s => own.has(s))).toBe(
          false,
        )
        descend(popped, x)
      }
    }
    for (const b of graphBubbles(graph)) {
      descend(graph, b)
    }
    expect(pops).toBeGreaterThan(30)
  })

  it('reads every derived bubble from the same graph shuffled', () => {
    const shuffled = {
      ...chain,
      nodes: [...chain.nodes].reverse(),
      edges: [...chain.edges].reverse(),
    }
    const read = (g: Graph) =>
      graphBubbles(
        bubbleSubgraph(g, bubbleSegmentIds(graphBubbles(g)[0]!)),
        span,
      ).map(b => [b.key, bubbleSegmentIds(b)[0], bubbleSegmentIds(b).at(-1)])
    expect(read(shuffled)).toEqual(read(chain))
  })
})

describe('superbubblesFromGraph', () => {
  it('finds one between two nodes and not the frame around it', () => {
    const g = framed(
      [node('b', 1), node('c', 1)],
      ['s+b+', 's+c+', 'b+e+', 'c+e+'],
    )
    expect(superbubblesFromGraph(g, span).map(b => b.key)).toEqual(['s>e'])
  })

  it('a tip inside is not a superbubble', () => {
    const g = framed(
      [node('b', 1), node('c', 1), node('t', 1)],
      ['s+b+', 's+c+', 'b+e+', 'c+e+', 'b+t+'],
    )
    expect(superbubblesFromGraph(g, span)).toEqual([])
  })

  it('a link back to the source or a loop inside is not a superbubble', () => {
    const back = framed(
      [node('b', 1), node('c', 1)],
      ['s+b+', 's+c+', 'b+e+', 'c+e+', 'c+s+'],
    )
    expect(superbubblesFromGraph(back, span)).toEqual([])
    const loop = framed(
      [node('b', 1), node('c', 1), node('d', 1)],
      ['s+b+', 'b+c+', 'c+e+', 'c+b+', 's+d+', 'd+e+'],
    )
    expect(superbubblesFromGraph(loop, span).map(b => b.key)).not.toContain(
      's>e',
    )
  })

  it('follows a node read on its reverse strand', () => {
    const g = framed(
      [node('b', 3), node('c', 5)],
      ['s+b-', 'b-e+', 's+c+', 'c+e+'],
    )
    const [b] = superbubblesFromGraph(g, span)
    expect(b).toMatchObject({
      key: 's>e',
      pathCount: 2,
      shortestAlleleLength: 3,
      longestAlleleLength: 5,
    })
  })

  it('puts each walk on one route, and marks a walk that stops inside', () => {
    const walks = [
      ['r1', 'r2', 'r3'],
      ['r1', 'x1', 'y1', 'x2', 'r3'],
      ['r1', 'x1', 'y2', 'x2', 'r3'],
      ['r3', 'x2', 'y1', 'x1', 'r1'],
    ]
    const walked = { ...altSnp, paths: graphOf([], [], walks).paths }
    const [snp] = graphBubbles(walked)
    expect(snp!.partial).toBe(false)
    expect(
      snp!.routes!.map(r => [r.steps.map(s => s.slice(0, -1)), r.bp, r.walks]),
    ).toEqual([
      [['y1'], 1, ['hap1', 'hap3']],
      [['y2'], 1, ['hap2']],
    ])
    const stops = {
      ...altSnp,
      paths: graphOf([], [], [...walks, ['r1', 'x1', 'y1']]).paths,
    }
    expect(graphBubbles(stops)[0]!.partial).toBe(true)
  })

  it('drops a bubble off the reference with no span to place it', () => {
    const g = framed(
      [node('b', 1), node('c', 1)],
      ['s+b+', 's+c+', 'b+e+', 'c+e+'],
    )
    expect(superbubblesFromGraph(g)).toEqual([])
  })

  it(`keeps the ${MAX_SUPERBUBBLES} largest`, () => {
    const count = MAX_SUPERBUBBLES + 10
    const nodes = [node('src', 1), node('snk', 1)]
    const links: string[] = []
    for (let i = 0; i < count; i++) {
      const arms = i < 10 ? 3 : 2
      nodes.push(node(`s${i}`, 1), node(`e${i}`, 1))
      links.push(`src+s${i}+`, `e${i}+snk+`)
      for (let k = 0; k < arms; k++) {
        nodes.push(node(`m${i}_${k}`, 1))
        links.push(`s${i}+m${i}_${k}+`, `m${i}_${k}+e${i}+`)
      }
    }
    const kept = superbubblesFromGraph(graphOf(nodes, links), span)
    expect(kept).toHaveLength(MAX_SUPERBUBBLES)
    expect(kept.filter(b => b.segmentCount === 5)).toHaveLength(10)
  })

  it('searches 15k nodes well inside a frame', () => {
    const nodes = [node('src', 1), node('snk', 1)]
    const links: string[] = []
    let prev = 'src'
    for (let i = 0; i < 3750; i++) {
      nodes.push(
        node(`a${i}`, 1),
        node(`b${i}`, 1),
        node(`c${i}`, 1),
        node(`d${i}`, 1),
      )
      links.push(
        `${prev}+a${i}+`,
        `a${i}+b${i}+`,
        `a${i}+c${i}+`,
        `b${i}+d${i}+`,
        `c${i}+d${i}+`,
      )
      prev = `d${i}`
    }
    links.push(`${prev}+snk+`)
    const g = graphOf(nodes, links)
    const t = performance.now()
    expect(superbubblesFromGraph(g, span)).toHaveLength(MAX_SUPERBUBBLES)
    expect(performance.now() - t).toBeLessThan(1000)
  })
})

describe('bubble identity', () => {
  it('tells superbubbles sharing a span apart by key', () => {
    const top = graphBubbles(chain)
    const [ad, dg] = graphBubbles(
      bubbleSubgraph(chain, bubbleSegmentIds(top[0]!)),
      top[0],
    )
    expect(sameBubble(ad!, dg!)).toBe(false)
    expect(sameBubble(ad!, { ...dg!, key: ad!.key })).toBe(true)
    expect(sameBubble(ad!, { ...ad!, key: undefined })).toBe(false)
    expect(bubbleKey(ad!)).toBe('a>d')
    expect(bubbleKey(span)).toBe('chr:10-15')
  })
})
