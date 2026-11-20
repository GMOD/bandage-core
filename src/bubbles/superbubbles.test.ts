import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

import { parseGFA } from '../gfa-core/index'
import { convertGFAToGraph } from '../gfa/gfaConverter'
import { bubbleLabel, bubbleSegmentIds } from './bubbleLabel'
import { bubbleKey, sameBubble } from './bubbleLine'
import { bubbleSubgraph } from './popBubble'
import { graphBubbles, superbubblesFromGraph } from './superbubbles'

import type { Graph, GraphEdge, GraphNode } from '../types'
import type { MinigraphBubble } from './bubbleLine'

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
    const bubbles = graphBubbles(altSnp)
    const [snp, ...rest] = bubbles.filter(b => !b.covering)
    expect(rest).toEqual([])
    expect(bubbles.filter(b => b.covering).map(b => b.segmentCount)).toEqual([
      7,
    ])
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
    expect(bubbleLabel(snp!)).toBe('SNP')
  })

  it('keeps the outer superbubble at the top and its chain on the pop', () => {
    const top = graphBubbles(chain).filter(b => !b.covering)
    expect(top.map(b => b.key)).toEqual(['p>q'])
    const popped = bubbleSubgraph(chain, bubbleSegmentIds(top[0]!))
    const inner = graphBubbles(popped, top[0])
    expect(inner.map(b => [b.key, b.covering])).toEqual([
      ['a>d', undefined],
      ['d>g', undefined],
      ['p>q', true],
    ])
    inner.pop()
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
      const inner = graphBubbles(popped, b).filter(x => !x.covering)
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
    for (const b of graphBubbles(graph).filter(x => !x.covering)) {
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

  it('keeps every outermost superbubble however many there are', () => {
    const count = 60
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
    expect(kept).toHaveLength(count)
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
    expect(superbubblesFromGraph(g, span)).toHaveLength(3750)
    expect(performance.now() - t).toBeLessThan(1000)
  })
})

// A on chr at 0 and B at 20, with x y between them and p q from B back round
// to A: two superbubbles between the same two nodes
function ring(links: string[] = [], walks?: string[][]) {
  return graphOf(
    [
      node('A', 10, 0),
      node('B', 10, 20),
      node('x', 3),
      node('y', 5),
      node('p', 7),
      node('q', 11),
    ],
    ['A+x+', 'A+y+', 'x+B+', 'y+B+', 'B+p+', 'B+q+', 'p+A+', 'q+A+', ...links],
    walks,
  )
}

const twinsOf = (g: Graph) =>
  new Map(superbubblesFromGraph(g, span).map(b => [b.key, b]))

const routesOf = (b: MinigraphBubble) =>
  b.routes!.map(r => [r.steps.map(s => s.slice(0, -1)), r.bp, r.walks])

describe('superbubbles round a ring', () => {
  it('keeps both of two between the same two nodes, the one round off the reference', () => {
    const bubbles = graphBubbles(ring()).filter(b => !b.covering)
    expect(
      bubbles.map(b => [b.key, b.segments, b.start, b.end, b.offReference]),
    ).toEqual([
      ['A>B', 'A,y,x,B', 10, 20, undefined],
      ['B>A', 'B,q,p,A', 10, 20, true],
    ])
    expect(sameBubble(bubbles[0]!, bubbles[1]!)).toBe(false)
    expect(superbubblesFromGraph(ring()).map(b => b.key)).toEqual(['A>B'])
  })

  it('places no bubble of a ring of three across the ring', () => {
    const g = graphOf(
      [
        node('A', 10, 0),
        node('B', 10, 20),
        node('C', 10, 40),
        ...['x', 'y', 'u', 'v', 'p', 'q'].map(n => node(n, 2)),
      ],
      [
        'A+x+',
        'A+y+',
        'x+B+',
        'y+B+',
        'B+u+',
        'B+v+',
        'u+C+',
        'v+C+',
        'C+p+',
        'C+q+',
        'p+A+',
        'q+A+',
      ],
    )
    expect(
      graphBubbles(g)
        .filter(b => !b.covering)
        .map(b => [b.key, b.start, b.end, b.offReference]),
    ).toEqual([
      ['A>B', 10, 20, undefined],
      ['C>A', 10, 40, true],
      ['B>C', 30, 40, undefined],
    ])
  })

  it('reads which way round the ring the reference runs from its strand', () => {
    const reversedB = {
      ...node('B', 10, 20),
      stable: { refName: 'chr', start: 20, rank: 0, strand: '-' as const },
    }
    const g = graphOf(
      [reversedB, ...ring().nodes.filter(n => n.name !== 'B')],
      ['A+x+', 'A+y+', 'x+B-', 'y+B-', 'B-p+', 'B-q+', 'p+A+', 'q+A+'],
    )
    expect(
      graphBubbles(g)
        .filter(b => !b.covering)
        .map(b => [
          b.key,
          bubbleSegmentIds(b).slice(1, -1).sort(),
          b.offReference,
        ]),
    ).toEqual([
      ['A>B', ['x', 'y'], undefined],
      ['B>A', ['p', 'q'], true],
    ])
  })

  it('reads two off the reference one each way where their sides alone do not', () => {
    const g = graphOf(
      ['s', 'e', 'b', 'c', 'd', 'f'].map(n => node(n, 1)),
      ['s+b+', 's+c+', 'b+e-', 'c+e-', 's-d+', 's-f+', 'd+e+', 'f+e+'],
    )
    const keys = superbubblesFromGraph(g, span).map(b => b.key)
    expect(new Set(keys)).toEqual(new Set(['e>s', 's>e']))
  })

  it('reads each walk through the twin whose interior it takes', () => {
    const walks = [
      ['A', 'x', 'B', 'p', 'A'],
      ['B', 'q', 'A', 'y', 'B'],
      ['A', 'q', 'B', 'x', 'A'],
    ]
    const twins = twinsOf(ring([], walks))
    expect(twins.get('A>B')).toMatchObject({
      partial: false,
      shortestAlleleLength: 3,
      longestAlleleLength: 5,
    })
    expect(routesOf(twins.get('A>B')!)).toEqual([
      [['x'], 3, ['hap0', 'hap2']],
      [['y'], 5, ['hap1']],
    ])
    expect(twins.get('B>A')).toMatchObject({
      partial: false,
      shortestAlleleLength: 7,
      longestAlleleLength: 11,
    })
    expect(routesOf(twins.get('B>A')!)).toEqual([
      [['p'], 7, ['hap0']],
      [['q'], 11, ['hap1', 'hap2']],
    ])
    const linear = twinsOf(ring([], [['A', 'x', 'B', 'p']]))
    expect([linear.get('A>B')!.partial, linear.get('B>A')!.partial]).toEqual([
      false,
      true,
    ])
  })

  it('gives a step straight between the ends to the twin that links them', () => {
    const walks = [['A', 'B', 'p', 'A']]
    const one = twinsOf(ring(['A+B+'], walks))
    expect(routesOf(one.get('A>B')!)).toEqual([[[], 0, ['hap0']]])
    expect(routesOf(one.get('B>A')!)).toEqual([[['p'], 7, ['hap0']]])
    const both = twinsOf(ring(['A+B+', 'B+A+'], walks))
    expect(both.get('A>B')!.partial).toBe(true)
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
