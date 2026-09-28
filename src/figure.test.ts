import { figureSvg } from './figure'
import { convertGFAToGraph } from './gfa/gfaConverter'
import { parseGFA } from './gfa-core/index'
import { layoutModeByValue } from './layoutModes'
import { anchorGraph } from './pathAnchoring'

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
