import { COMPRESSED_KEY } from './bubbleSpreads'
import { SHORT_SKIP_KEY } from './deletionEdges'
import { FACET_TITLE_PX } from './facetGrid'
import { figureSvg } from './figure'
import { figureData } from './figureData'
import { parseGFA } from './gfa-core/index'
import { convertGFAToGraph } from './gfa/gfaConverter'
import { walkRows } from './layout/walkRows'
import { layoutModeByValue } from './layoutModes'
import { anchorGraph } from './pathAnchoring'
import { graphBackbone } from './reference'
import { LANE_HEADS_AGAINST_KEY } from './renderer/laneHeads'
import { version } from './version'

const GFA = `S\tv1\tAAAA
S\tv2\tCC
S\tv3\tGGG
S\ta1\tTTTTTT
L\tv1\t+\tv2\t+\t0M
L\tv2\t+\tv3\t+\t0M
L\tv1\t+\ta1\t+\t0M
L\ta1\t+\tv3\t+\t0M
W\tref\t0\tchr\t0\t9\t>v1>v2>v3
W\talt\t1\tchr\t0\t13\t>v1>a1>v3
W\talt\t2\tchr\t0\t9\t<v3<v2<v1`

const graph = anchorGraph(convertGFAToGraph(parseGFA(GFA)), 'ref')
const layout = layoutModeByValue('ordered').run(graph, undefined)!
const walks = [
  { walk: 'ref#0#chr' },
  { walk: 'alt#1#chr' },
  { walk: 'alt#2#chr' },
]

test('a figure is one standalone SVG of the drawing', () => {
  const svg = figureSvg(graph, layout, { width: 600 })
  expect(svg).toMatch(
    /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="600"/,
  )
  expect(svg).toContain('<path d="M')
  expect(svg).not.toContain('rgba(')
})

test('lifted walks are keyed above the drawing, one short entry each', () => {
  const svg = figureSvg(graph, layout, { width: 600, walks: walks.slice(0, 2) })
  expect(svg).toMatch(/<tspan font-weight="bold">ref[^<]*<\/tspan>/)
})

test('the faded key calls the faded nodes other haplotypes only when a path visits each one', () => {
  const ref = [{ walk: 'ref#0#chr' }]
  expect(figureSvg(graph, layout, { width: 600, walks: ref })).toContain(
    'only in other haplotypes',
  )
  const loose = anchorGraph(
    convertGFAToGraph(parseGFA(`${GFA}\nS\tx1\tA\nL\tv3\t+\tx1\t+\t0M`)),
    'ref',
  )
  const looseLayout = layoutModeByValue('ordered').run(loose, undefined)!
  expect(figureSvg(loose, looseLayout, { width: 600, walks: ref })).toContain(
    'nodes and links not on ref',
  )
})

test('a key too wide for the figure wraps onto more lines above the drawing', () => {
  const svg = figureSvg(graph, layout, { width: 200, walks })
  const header = svg.slice(0, svg.indexOf('<svg y="'))
  const keys = [
    ...header.matchAll(/<g transform="translate\(([\d.]+) ([\d.]+)\)"/g),
  ].map(m => ({ x: Number(m[1]), y: Number(m[2]) }))
  expect(header).toContain(LANE_HEADS_AGAINST_KEY)
  expect(keys).toHaveLength(walks.length + 1)
  expect(new Set(keys.map(k => k.y)).size).toBeGreaterThan(1)
  expect(Math.max(...keys.map(k => k.x))).toBeLessThan(200)
  const drawingAt = Number(/<svg y="([\d.]+)"/.exec(svg)![1])
  expect(drawingAt).toBeGreaterThanOrEqual(Math.max(...keys.map(k => k.y)) + 16)
})

test('by sample, a sample takes a row and its haplotypes the columns', () => {
  const svg = figureSvg(graph, layout, {
    width: 600,
    walks,
    facet: 'sample',
  })
  const panels = [...svg.matchAll(/<svg x="(\d+)" y="(\d+)"/g)].map(m => [
    Number(m[1]),
    Number(m[2]),
  ])
  expect(panels).toHaveLength(3)
  const [ref, one, two] = panels
  expect(ref![0]).toBe(0)
  expect(one![0]).toBe(0)
  expect(two![0]).toBeGreaterThan(0)
  expect(one![1]).toBe(two![1])
  expect(one![1]).toBeGreaterThan(ref![1]!)
  expect(svg).not.toContain('reversed')
})

const backbone = graphBackbone(graph)!.contigs[0]!.refName
const genes = [
  {
    name: 'GENE1',
    refName: backbone,
    start: 1,
    end: 8,
    strand: 1,
    exons: [
      { start: 1, end: 3 },
      { start: 5, end: 8 },
    ],
  },
]

// the screen x of every point the drawing's paths visit
function inkSpan(svg: string) {
  const xs = [...svg.matchAll(/<path d="([^"]+)"/g)].flatMap(m =>
    [...m[1]!.matchAll(/[ML](-?[\d.]+) /g)].map(p => Number(p[1])),
  )
  return Math.max(...xs) - Math.min(...xs)
}

// A popped bubble is a sliver of the window it was cut from, and only a
// layout whose x is reference bp fits to the window at all
test('fitted to the drawing, a figure ignores how wide the window was', () => {
  const region = { refName: 'chr', start: 0, end: 900 }
  const anchored = layoutModeByValue('auto').run(graph, region)!
  expect(anchored.referenceAxis).toBe(true)
  const windowed = figureSvg(graph, anchored, { width: 600, region })
  const fitted = figureSvg(graph, anchored, {
    width: 600,
    region,
    fitToDrawing: true,
  })
  expect(inkSpan(fitted)).toBeGreaterThan(3 * inkSpan(windowed))
})

test("the ramp spans a view's colour domain where it states one", () => {
  const options = {
    width: 600,
    colorScheme: 'reference-position' as const,
    region: { refName: 'chr', start: 0, end: 9 },
  }
  expect(
    figureSvg(graph, layout, {
      ...options,
      colorDomain: { start: 0, end: 900 },
    }),
  ).not.toBe(figureSvg(graph, layout, options))
})

test('the ramp key names the sample and contig, or what the host says, over the span it runs', () => {
  const options = {
    width: 600,
    colorScheme: 'reference-position' as const,
    region: { refName: 'ref#0#chr', start: 0, end: 9 },
  }
  const svg = figureSvg(graph, layout, options)
  expect(svg).toContain('position on ref chr')
  expect(svg).toContain('<text y="28">1-9 (9 bp)</text>')
  expect(
    figureSvg(graph, layout, { ...options, referenceName: 'hg38 chr6' }),
  ).toContain('position on hg38 chr6')
})

test('genes outline their exons, are named under their pins and keyed', () => {
  const svg = figureSvg(graph, layout, { width: 600, genes })
  expect(svg).toContain('mask="url(#exons0)"')
  expect(svg).toContain(
    '<tspan font-style="italic" font-weight="600">GENE1</tspan>',
  )
  expect(svg).toContain('>exon</text>')
  expect(figureSvg(graph, layout, { width: 600 })).not.toContain('>exon<')
})

test('a walk-rows key too wide for the figure wraps entry by entry', () => {
  const svg = figureSvg(graph, layout, {
    width: 200,
    walkRows: walkRows(graph, undefined)!,
  })
  const header = svg.slice(0, svg.indexOf('<svg y="'))
  const keys = [
    ...header.matchAll(/<g transform="translate\(([\d.]+) ([\d.]+)\)"/g),
  ].map(m => ({ x: Number(m[1]), y: Number(m[2]) }))
  expect(keys.length).toBeGreaterThan(1)
  expect(new Set(keys.map(k => k.y)).size).toBeGreaterThan(1)
  expect(Math.max(...keys.map(k => k.x))).toBeLessThan(200)
})

test('walk rows in a strip sit under the drawing, labelled and keyed', () => {
  const plain = figureSvg(graph, layout, { width: 600 })
  const rows = walkRows(graph, undefined)!
  const svg = figureSvg(graph, layout, {
    width: 600,
    walks: [{ walk: 'alt#1#chr' }],
    walkStrip: {
      rows,
      rowGenes: new Map([
        [
          rows.rows[0]!.name,
          [{ name: 'ALTGENE', start: 0, end: 6, exons: [] }],
        ],
      ]),
      rowGeneGaps: { untracked: 1, unread: 0 },
    },
  })
  const height = (s: string) => Number(/height="(\d+)"/.exec(s)![1])
  expect(height(svg)).toBeGreaterThan(height(plain))
  expect(svg.match(/data-testid="graph-walk-row"/g)).toHaveLength(2)
  expect(svg).toContain('<title>ALTGENE</title>')
  expect(svg).toMatch(/font-weight="600">alt#1<\/text>/)
  expect(svg).toMatch(/>gene<\/text>/)
  expect(svg).toMatch(
    /<linearGradient id="strip-\d+-ink" gradientUnits="userSpaceOnUse"/,
  )
})

test('the walk-rows key names the boxes by the annotation given', () => {
  const rows = walkRows(graph, undefined)!
  const svg = figureSvg(graph, layout, {
    width: 600,
    walkRows: rows,
    rowGenes: new Map([
      [rows.rows[0]!.name, [{ name: 'ALTTE', start: 0, end: 6, exons: [] }]],
    ]),
    rowGeneGaps: { untracked: 1, unread: 0 },
    rowAnnotation: 'TE',
  })
  expect(svg).toMatch(/>TE<\/text>/)
  expect(svg).toMatch(/>no TE track for 1 row<\/text>/)
})

test('the SVG names the version that drew it and the spec it drew', () => {
  const spec = { gfa: 'walks.gfa', layout: 'ordered' }
  const svg = figureSvg(graph, layout, { width: 600, spec })
  const metadata = /<metadata>(.*?)<\/metadata>/.exec(svg)![1]!
  expect(JSON.parse(metadata.replaceAll('&quot;', '"'))).toEqual({
    generator: `@jbrowse/bandage-core@${version}`,
    spec,
  })
})

// A change to what a figure draws shows here as a diff of the saved figure,
// to be accepted with `vitest -u` when it is meant
test('one figure draws as it did', async () => {
  const svg = figureSvg(graph, layout, {
    width: 600,
    walks,
    facet: 'sample',
    genes,
    spec: { fixture: 'walks' },
  })
  await expect(
    svg.replace(/bandage-core@[^&]+/, 'bandage-core@VERSION'),
  ).toMatchFileSnapshot('__snapshots__/figure_walks.svg')
})

// d719794 draws a skip whose span on screen holds fewer than three dashes as
// one plain stroke, which the key left out; each row is there only where
// its mark is drawn
test('a figure keys the dashed links it draws as skipped reference sequence, and the plain stroke of a skip too short to dash', () => {
  const skipped = anchorGraph(
    convertGFAToGraph(
      parseGFA(`${GFA}\nL\tv1\t+\tv3\t+\t0M\nW\tdel\t1\tchr\t0\t7\t>v1>v3`),
    ),
    'ref',
  )
  const skippedLayout = layoutModeByValue('ordered').run(skipped, undefined)!
  const wide = figureSvg(skipped, skippedLayout, { width: 600 })
  expect(wide).toMatch(
    /stroke-dasharray="4 3"\/><text[^>]*>skips .+? sequence</,
  )
  expect(wide).not.toContain(SHORT_SKIP_KEY)
  const narrow = figureSvg(skipped, skippedLayout, { width: 120 })
  expect(narrow).toMatch(
    /<line [^>]*stroke-width="1.5"\/><text[^>]*>short skip</,
  )
  expect(narrow).not.toMatch(/skips .+? sequence/)
  const plain = figureSvg(graph, layout, { width: 600 })
  expect(plain).not.toMatch(/skips .+? sequence/)
  expect(plain).not.toContain(SHORT_SKIP_KEY)
})

test('a figure keys a layout whose lengths are compressed as not to scale, once', () => {
  const compressed = figureSvg(
    graph,
    { ...layout, compressed: true },
    { width: 600 },
  )
  expect(compressed).toMatch(
    new RegExp(`<text y="13">${COMPRESSED_KEY}</text>`),
  )
  expect(compressed.split(COMPRESSED_KEY)).toHaveLength(2)
  expect(figureSvg(graph, layout, { width: 600 })).not.toContain(COMPRESSED_KEY)
  const panels = figureSvg(
    graph,
    { ...layout, compressed: true },
    { width: 600, walks: walks.slice(0, 2), facet: 'sample' },
  )
  expect(panels.split(COMPRESSED_KEY)).toHaveLength(2)
  expect(panels.indexOf(COMPRESSED_KEY)).toBeLessThan(
    panels.indexOf('<svg x="'),
  )
})

test('a figure split into panels keys the dashed links once, above the grid, only when a panel draws one', () => {
  const skipped = anchorGraph(
    convertGFAToGraph(
      parseGFA(
        `${GFA}\nL\tv1\t+\tv3\t+\t0M\nW\tdel\t1\tchr\t0\t7\t>v1>v3\nW\tdel\t2\tchr\t0\t7\t>v1>v3`,
      ),
    ),
    'ref',
  )
  const skippedLayout = layoutModeByValue('ordered').run(skipped, undefined)!
  const svg = figureSvg(skipped, skippedLayout, {
    width: 600,
    walks: [{ walk: 'ref#0#chr' }, { walk: 'del#1#chr' }],
    facet: 'sample',
  })
  expect(svg.match(/skips .+? sequence/g)).toHaveLength(1)
  const keyAt = svg.search(/skips .+? sequence/)
  expect(keyAt).toBeLessThan(svg.indexOf('<svg x="'))
  expect(
    Math.min(
      ...[...svg.matchAll(/<svg x="\d+" y="(\d+)"/g)].map(m => Number(m[1])),
    ),
  ).toBeGreaterThan(FACET_TITLE_PX)

  const allTake = figureSvg(skipped, skippedLayout, {
    width: 600,
    walks: [{ walk: 'del#1#chr' }, { walk: 'del#2#chr' }],
    facet: 'walk',
  })
  expect(allTake).toContain('<svg x="')
  expect(allTake).not.toMatch(/skips .+? sequence/)
  expect(
    figureSvg(graph, layout, { width: 600, walks, facet: 'sample' }),
  ).not.toMatch(/skips .+? sequence/)
})

// R walks three reference nodes; A leaves it for a 75 kb loop the cut did not
// load, a placeholder, and comes back
const UNLOADED = `S\tr1\t*\tLN:i:20000
S\tr2\t*\tLN:i:30000
S\tr3\t*\tLN:i:25000
S\tp1\t*\tLN:i:75000\tnl:i:1
L\tr1\t+\tr2\t+\t0M
L\tr2\t+\tr3\t+\t0M
L\tr1\t+\tp1\t+\t0M
L\tp1\t+\tr3\t+\t0M
W\tR\t0\tchr\t0\t75000\t>r1>r2>r3
W\tA\t1\tchr\t0\t120000\t>r1>p1>r3`

test("a figure writes a placeholder's length whether or not node lengths are on, and every node's only when they are", () => {
  const unloaded = anchorGraph(convertGFAToGraph(parseGFA(UNLOADED)), 'R')
  const unloadedLayout = layoutModeByValue('auto').run(unloaded, undefined)!
  expect(figureSvg(unloaded, unloadedLayout)).toContain(
    '>nodes not shown</text>',
  )
  const written = (nodeLengths?: boolean) =>
    [
      ...figureSvg(unloaded, unloadedLayout, {
        width: 900,
        nodeLengths,
      }).matchAll(/>(\d+ kb)<\/text>/g),
    ].map(m => m[1])
  expect(written()).toEqual(['75 kb'])
  expect(written(false)).toEqual(['75 kb'])
  expect(written(true)).toEqual(['75 kb', '30 kb', '25 kb', '20 kb'])
})

test("a figure stacks a placeholder's length whose loop another's covers, with a leader to its loop", () => {
  const twin = anchorGraph(
    convertGFAToGraph(
      parseGFA(
        `${UNLOADED}\nS\tp2\t*\tLN:i:75000\tnl:i:1\nL\tr1\t+\tp2\t+\t0M\nL\tp2\t+\tr3\t+\t0M`,
      ),
    ),
    'R',
  )
  const laid = layoutModeByValue('auto').run(twin, undefined)!
  const ids = Object.keys(laid.nodePositions)
  const [start] = laid.nodePositions[ids.find(id => id.startsWith('r2'))!]!
  const short = [start!, { ...start!, x: start!.x + 3000 }]
  const svg = figureSvg(twin, {
    ...laid,
    nodePositions: {
      ...laid.nodePositions,
      ...Object.fromEntries(
        ids.filter(id => id.startsWith('p')).map(id => [id, short]),
      ),
    },
  })
  expect([...svg.matchAll(/>75 kb<\/text>/g)]).toHaveLength(2)
  expect(svg).toMatch(
    /<line [^>]*stroke="#18181c" stroke-width="0.8" stroke-opacity="0.6"\/>/,
  )
})

test("a lifted walk's own copy of a gene is named with its haplotype, and a gene with no symbol beside one that has is named nowhere", () => {
  const gene = (name: string, refName: string, start: number, end: number) => ({
    name,
    refName,
    start,
    end,
    strand: 1,
    exons: [{ start, end }],
  })
  const drawn = [
    gene('REFG', 'ref#0#chr', 0, 9),
    gene('LOC100130417', 'ref#0#chr', 2, 5),
    gene('OWNG', 'alt#1#chr', 4, 10),
  ]
  const lifted = { genes: drawn, walks: [{ walk: 'alt#1#chr' }] }
  const svg = figureSvg(graph, layout, { width: 600, ...lifted })
  expect(svg).toContain('>OWNG · alt#1</tspan>')
  expect(svg).toContain('>REFG</tspan>')
  expect(svg).not.toContain('>LOC100130417</tspan>')
  const d = figureData(graph, layout, lifted)
  expect(d.pins.gene).toEqual(['REFG', 'LOC100130417', 'OWNG'])
  expect(d.pins.label).toEqual(['REFG', null, 'OWNG · alt#1'])
  expect(
    d.labels.text.filter((_, i) => d.labels.kind[i] === 'gene').sort(),
  ).toEqual(['OWNG · alt#1', 'REFG'])
})
