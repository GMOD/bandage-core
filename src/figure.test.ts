import { figureSvg } from './figure'
import { convertGFAToGraph } from './gfa/gfaConverter'
import { parseGFA } from './gfa-core/index'
import { walkRows } from './layout/walkRows'
import { layoutModeByValue } from './layoutModes'
import { anchorGraph } from './pathAnchoring'
import { graphBackbone } from './reference'
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
  expect(svg).toContain('not on these walks')
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
  expect(one![1]).toBeGreaterThan(ref![1])
  expect(svg).toContain('9 bp reversed')
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

test('the ramp key names the sample and contig, or what the host says', () => {
  const options = {
    width: 600,
    colorScheme: 'reference-position' as const,
    region: { refName: 'ref#0#chr', start: 0, end: 9 },
  }
  expect(figureSvg(graph, layout, options)).toContain('ref chr position')
  const named = figureSvg(graph, layout, {
    ...options,
    referenceName: 'hg38 chr6',
  })
  expect(named).toContain('hg38 chr6 position')
  expect(named).toMatch(/hg38 chr6:\d/)
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
  expect(svg).toContain("genes, each row's own annotation")
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
