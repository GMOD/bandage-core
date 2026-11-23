import { COMPRESSED_KEY } from './bubbleSpreads'
import { FACET_TITLE_PX } from './facetGrid'
import { figureSvg } from './figure'
import { figureData } from './figureData'
import { figureScene } from './figureScene'
import { parseGFA } from './gfa-core/index'
import { convertGFAToGraph } from './gfa/gfaConverter'
import { walkRows } from './layout/walkRows'
import { layoutModeByValue } from './layoutModes'
import { anchorGraph } from './pathAnchoring'
import { graphBackbone } from './reference'
import * as geometryBuilder from './renderer/GeometryBuilder'
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

test('the faded key calls the faded nodes other haplotypes, or no walk where a path visits none of some', () => {
  const ref = [{ walk: 'ref#0#chr' }]
  expect(figureSvg(graph, layout, { width: 600, walks: ref })).toContain(
    'other haplotypes',
  )
  const loose = anchorGraph(
    convertGFAToGraph(parseGFA(`${GFA}\nS\tx1\tA\nL\tv3\t+\tx1\t+\t0M`)),
    'ref',
  )
  const looseLayout = layoutModeByValue('ordered').run(loose, undefined)!
  expect(figureSvg(loose, looseLayout, { width: 600, walks: ref })).toContain(
    'other haplotypes, or no walk',
  )
})

test("a lifted walk's scale is keyed by a gradient whose id holds none of its name, so a name with a quote still writes an SVG that parses", () => {
  const quoted = anchorGraph(
    convertGFAToGraph(parseGFA(`${GFA}\nP\ta"b\tv1+,a1+,v3+\t*`)),
    'ref',
  )
  const svg = figureSvg(
    quoted,
    layoutModeByValue('ordered').run(quoted, undefined)!,
    { width: 600, walks: [{ walk: 'a"b' }] },
  )
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
  expect(parsed.querySelector('parsererror')).toBeNull()
  const gradient = parsed.querySelector('linearGradient')
  expect(gradient?.id).toMatch(/^[\w-]+$/)
  expect(svg).toContain(`fill="url(#${gradient?.id})"`)
  expect(svg).toContain('a&quot;b')
})

test('a figure lays its drawing out once where the key leaves its pane as it was, and again only where the key takes room from it', () => {
  const built = vi.spyOn(geometryBuilder, 'buildGeometry')
  const builds = (
    drawn: Parameters<typeof figureSvg>[1],
    o: Parameters<typeof figureSvg>[2],
  ) => {
    built.mockClear()
    const svg = figureSvg(graph, drawn, o)
    return {
      builds: built.mock.calls.length,
      height: Number(/ height="(\d+)"/.exec(svg)?.[1]),
    }
  }
  expect(builds(layout, { width: 600 }).builds).toBe(1)
  expect(
    builds(layout, {
      width: 600,
      frame: { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 },
    }).builds,
  ).toBe(1)
  expect(builds(layout, { width: 600, walks, facet: 'walk' }).builds).toBe(
    walks.length,
  )
  const square = {
    nodePositions: {
      'v1+': [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      'v2+': [
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      'v3+': [
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      'a1+': [
        { x: 0, y: 100 },
        { x: 0, y: 50 },
      ],
    },
  }
  expect(builds(square, { width: 600, height: 400 })).toEqual({
    builds: 2,
    height: 400,
  })
  built.mockRestore()
})

test('a scene names the walks it was asked to lift that the graph holds none of, each once', () => {
  const asked = [
    { walk: 'ref#0#chr' },
    { walk: 'alt#1#chrTYPO' },
    { walk: 'alt#1#chrTYPO' },
    { walk: 'alt#2#chr' },
    { walk: 'HG002#1#chr' },
  ]
  expect(figureScene(graph, layout, { walks: asked }).unmatchedWalks).toEqual([
    'alt#1#chrTYPO',
    'HG002#1#chr',
  ])
  expect(figureScene(graph, layout, { walks }).unmatchedWalks).toEqual([])
  expect(figureScene(graph, layout, {}).unmatchedWalks).toEqual([])
  expect(
    figureScene(graph, layout, { walks: [{ walk: 'none#0#chr' }] })
      .unmatchedWalks,
  ).toEqual(['none#0#chr'])
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

// d719794 drew a skip whose span on screen holds fewer than three dashes as
// one plain stroke keyed "short skip"; it is dashed shorter, under the one
// entry, and the row is there only where a skip is drawn
test('a figure keys the dashed links it draws as skipped reference sequence, however short', () => {
  const skipped = anchorGraph(
    convertGFAToGraph(
      parseGFA(`${GFA}\nL\tv1\t+\tv3\t+\t0M\nW\tdel\t1\tchr\t0\t7\t>v1>v3`),
    ),
    'ref',
  )
  const skippedLayout = layoutModeByValue('ordered').run(skipped, undefined)!
  for (const width of [600, 120]) {
    const svg = figureSvg(skipped, skippedLayout, { width })
    expect(svg).toMatch(/stroke-dasharray="4 3"\/><text[^>]*>skips .+? sequence</)
    expect(svg).not.toContain('short skip')
  }
  const plain = figureSvg(graph, layout, { width: 600 })
  expect(plain).not.toMatch(/skips .+? sequence/)
})

test("at a host's frame a figure draws that pane: its height, the drawing where the frame puts it, and the key of what it shows", () => {
  const skipped = anchorGraph(
    convertGFAToGraph(
      parseGFA(`${GFA}\nL\tv1\t+\tv3\t+\t0M\nW\tdel\t1\tchr\t0\t7\t>v1>v3`),
    ),
    'ref',
  )
  const skippedLayout = layoutModeByValue('ordered').run(skipped, undefined)!
  const frame = { scaleX: 3, scaleY: 3, translateX: 40, translateY: 120 }
  const framed = figureSvg(skipped, skippedLayout, {
    width: 600,
    height: 300,
    frame,
  })
  expect(framed).toMatch(/<svg y="\d+(\.\d+)?" width="600" height="300">/)
  const [first] = skippedLayout.nodePositions['v1+']!
  expect(framed).toContain(
    `M${+(first!.x * 3 + 40).toFixed(1)} ${+(first!.y * 3 + 120).toFixed(1)}L`,
  )
  expect(framed).toMatch(/skips .+? sequence/)
  const past = figureSvg(skipped, skippedLayout, {
    width: 600,
    height: 300,
    frame: { ...frame, translateX: -10_000 },
  })
  expect(past).not.toMatch(/skips .+? sequence/)
  expect(figureSvg(skipped, skippedLayout, { width: 600 })).toMatch(
    /skips .+? sequence/,
  )
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

// the reference's lengths stood beside the variants as if they were theirs:
// "539 bp" beside a curl at SV-del-100k+ that was a 3 kb skip
test("a figure writes the length of every node but the reference's by default, and a placeholder's alone with node lengths off", () => {
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
  expect(written(true)).toEqual(['75 kb'])
})

// two haplotypes' 75 kb placeholders, laid on one loop 30 px over the
// reference: one length names it, and where the loop is too short to hold
// the length, stands off it with a leader to it
test('a figure writes one length for two placeholders drawn on one loop, with a leader where the loop is too short to hold it, and its key counts the other', () => {
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
  const drawn = (units: number) =>
    figureSvg(twin, {
      ...laid,
      nodePositions: {
        ...laid.nodePositions,
        ...Object.fromEntries(
          ids
            .filter(id => id.startsWith('p'))
            .map(id => [
              id,
              [
                { x: start!.x, y: start!.y - 30 },
                { x: start!.x + units, y: start!.y - 30 },
              ],
            ]),
        ),
      },
    })
  const leader =
    /<line [^>]*stroke="#18181c" stroke-width="0.8" stroke-opacity="0.6"\/>/
  const loop = drawn(6000)
  expect([...loop.matchAll(/>75 kb<\/text>/g)]).toHaveLength(1)
  expect(loop).not.toMatch(leader)
  expect(loop).toContain('>1 unlabelled, 75 kb<')
  const speck = drawn(30)
  expect([...speck.matchAll(/>75 kb<\/text>/g)]).toHaveLength(1)
  expect(speck).toMatch(leader)
  expect(speck).toContain('>1 unlabelled, 75 kb<')
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

// A 1 bp SNP, a 1 bp deletion and a 2 bp insertion beside a 300 bp allele, on
// a straight reference at 1 bp a layout unit: at a 1200 px figure the three
// small ones are under 3 px and the allele is over a hundred
const SITES = [
  `S\tr1\t${'A'.repeat(1000)}`,
  'S\tr2\tC',
  `S\tr3\t${'A'.repeat(500)}`,
  'S\tr4\tG',
  `S\tr5\t${'A'.repeat(498)}`,
  `S\tr6\t${'A'.repeat(400)}`,
  `S\tr7\t${'A'.repeat(300)}`,
  'S\ta1\tT',
  'S\ti1\tTT',
  `S\tb1\t${'T'.repeat(300)}`,
  'L\tr1\t+\tr2\t+\t0M',
  'L\tr2\t+\tr3\t+\t0M',
  'L\tr3\t+\tr4\t+\t0M',
  'L\tr4\t+\tr5\t+\t0M',
  'L\tr5\t+\tr6\t+\t0M',
  'L\tr6\t+\tr7\t+\t0M',
  'L\tr1\t+\ta1\t+\t0M',
  'L\ta1\t+\tr3\t+\t0M',
  'L\tr3\t+\tr5\t+\t0M',
  'L\tr5\t+\ti1\t+\t0M',
  'L\ti1\t+\tr6\t+\t0M',
  'L\tr5\t+\tb1\t+\t0M',
  'L\tb1\t+\tr7\t+\t0M',
  'W\tref\t0\tchr\t0\t2700\t>r1>r2>r3>r4>r5>r6>r7',
  'W\tw\t1\tchr\t0\t*\t>r1>a1>r3>r5>i1>r6>r7',
  'W\tw\t2\tchr\t0\t*\t>r1>r2>r3>r5>b1>r7',
].join('\n')

const at = (x0: number, x1: number, y = 0) => [
  { x: x0, y },
  { x: x1, y },
]

const sites = anchorGraph(convertGFAToGraph(parseGFA(SITES)), 'ref')
const sitesLayout = {
  nodePositions: {
    'r1+': at(0, 1000),
    'r2+': at(1000, 1001),
    'r3+': at(1001, 1501),
    'r4+': at(1501, 1502),
    'r5+': at(1502, 2000),
    'r6+': at(2000, 2400),
    'r7+': at(2400, 2700),
    'a1+': at(1000, 1001, 20),
    'i1+': at(2000, 2002, 20),
    'b1+': at(2000, 2400, 40),
  },
}

test.each([
  ['bare', undefined, '__snapshots__/figure_lod_off.svg'],
  [
    'with two walks lifted',
    [{ walk: 'w#1#chr' }, { walk: 'w#2#chr' }],
    '__snapshots__/figure_lod_off_lifted.svg',
  ],
])(
  'with small sites drawn as nodes, a figure %s draws every node',
  async (_, lifted, file) => {
    const svg = figureSvg(sites, sitesLayout, {
      walks: lifted,
      smallSites: 'nodes',
    })
    await expect(
      svg.replace(/bandage-core@[^&]+/, 'bandage-core@VERSION'),
    ).toMatchFileSnapshot(file)
  },
)

test('by default a figure folds its small sites, draws the allele, and says how many it folded in a last key line', () => {
  // the 1 bp allele and the 2 bp insertion laid beside the reference, so
  // they are drawn small
  const beside = {
    nodePositions: {
      ...sitesLayout.nodePositions,
      'a1+': at(1000, 1001, 1),
      'i1+': at(2000, 2002, 1),
    },
  }
  const folded = figureSvg(sites, beside)
  const drawn = figureSvg(sites, beside, { smallSites: 'nodes' })
  const line = /<text y="13">2 nodes and 1 skip under (\d+) bp not drawn<\/text>/
    .exec(folded)?.[0]
  expect(line).toBeDefined()
  expect(drawn).not.toContain('not drawn')
  const key = folded.slice(0, folded.indexOf(line!))
  expect(key).not.toMatch(/Tick/)
  const strokes = (svg: string) =>
    svg
      .match(/ d="[^"]*"/g)
      ?.join('')
      .match(/M/g)?.length ?? 0
  expect(strokes(folded)).toBeLessThan(strokes(drawn))
  expect(folded).not.toContain('<line x1="9" x2="9"')
})

// A 5 bp loop the cut did not load, a placeholder, between 10 kb flanks: at
// a 1200 px figure it is well under SMALL_SITE_PX
const SMALL_LOOP = [
  `S\tr1\t${'A'.repeat(10_000)}`,
  'S\tr2\tC',
  `S\tr3\t${'A'.repeat(10_000)}`,
  'S\tp1\t*\tLN:i:5\tnl:i:1',
  'L\tr1\t+\tr2\t+\t0M',
  'L\tr2\t+\tr3\t+\t0M',
  'L\tr1\t+\tp1\t+\t0M',
  'L\tp1\t+\tr3\t+\t0M',
  'W\tR\t0\tchr\t0\t20001\t>r1>r2>r3',
  'W\tA\t1\tchr\t0\t*\t>r1>p1>r3',
].join('\n')
const smallLoopLayout = {
  nodePositions: {
    'r1+': [
      { x: 0, y: 0 },
      { x: 10_000, y: 0 },
    ],
    'r2+': [
      { x: 10_000, y: 0 },
      { x: 10_001, y: 0 },
    ],
    'r3+': [
      { x: 10_001, y: 0 },
      { x: 20_001, y: 0 },
    ],
    'p1+': [
      { x: 10_000, y: 200 },
      { x: 10_001, y: 200 },
    ],
  },
}

test('a figure writes no length for a placeholder it folded, and writes it with small sites drawn as nodes', () => {
  const loop = anchorGraph(convertGFAToGraph(parseGFA(SMALL_LOOP)), 'R')
  expect(loop.nodes.find(n => n.id === 'p1+')?.placeholder).toBe(true)
  const lengths = (svg: string) =>
    [...svg.matchAll(/>(\d+ bp)<\/text>/g)].map(m => m[1])
  expect(
    lengths(figureSvg(loop, smallLoopLayout, { smallSites: 'nodes' })),
  ).toEqual(['5 bp'])
  const folded = figureSvg(loop, smallLoopLayout)
  expect(folded).toContain('1 node')
  expect(lengths(folded)).toEqual([])
})

test('a figure outlines no exon on a node it folded, and outlines it with small sites drawn as nodes', () => {
  const allele = anchorGraph(
    convertGFAToGraph(
      parseGFA(
        [
          `S\tr1\t${'A'.repeat(10_000)}`,
          'S\tr2\tC',
          `S\tr3\t${'A'.repeat(10_000)}`,
          'S\ta1\tT',
          'L\tr1\t+\tr2\t+\t0M',
          'L\tr2\t+\tr3\t+\t0M',
          'L\tr1\t+\ta1\t+\t0M',
          'L\ta1\t+\tr3\t+\t0M',
          'W\tR\t0\tchr\t0\t20001\t>r1>r2>r3',
          'W\tA\t1\tchr\t0\t20001\t>r1>a1>r3',
        ].join('\n'),
      ),
    ),
    'R',
  )
  const laid = {
    nodePositions: {
      'r1+': at(0, 10_000),
      'r2+': at(10_000, 10_001),
      'r3+': at(10_001, 20_001),
      'a1+': at(10_000, 10_001, 2),
    },
  }
  const onAllele = [
    {
      name: 'ONA1',
      refName: 'A#1#chr',
      start: 10_000,
      end: 10_001,
      strand: 1,
      exons: [{ start: 10_000, end: 10_001 }],
    },
  ]
  const masks = (svg: string) => svg.match(/<mask /g)?.length ?? 0
  expect(
    masks(figureSvg(allele, laid, { genes: onAllele, smallSites: 'nodes' })),
  ).toBe(1)
  expect(masks(figureSvg(allele, laid, { genes: onAllele }))).toBe(0)
})
