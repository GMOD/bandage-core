// Render a vg JSON through sequenceTubeMapModern's layout headlessly, the way
// its own scripts/tubemap-cli.ts does. Run from that repo's directory so its
// imports resolve, with TUBEMAP pointing at the checkout:
//   TUBEMAP=~/src/vendor/sequenceTubeMapModern node --experimental-strip-types \
//     tubemap-render.mts <vg.json> <out.svg> [normal]
import { readFileSync, writeFileSync } from 'node:fs'
const TUBEMAP =
  process.env.TUBEMAP ?? `${process.env.HOME}/src/vendor/sequenceTubeMapModern`
const { JSDOM } = await import(`${TUBEMAP}/node_modules/jsdom/lib/api.js`)
const [file, out, mode] = process.argv.slice(2)
const dom = new JSDOM(
  '<!doctype html><html><body><div id="container"><svg id="tubemap"></svg></div></body></html>',
  { pretendToBeVisual: true, url: 'http://localhost/' },
)
const { window } = dom
const parent = window.document.getElementById('container')!
Object.defineProperty(parent, 'clientWidth', { value: 2400 })
Object.defineProperty(parent, 'clientHeight', { value: 800 })
const g = globalThis as any
g.window = window
g.document = window.document
Object.defineProperty(g, 'navigator', {
  value: window.navigator,
  configurable: true,
})
for (const k of [
  'HTMLElement',
  'SVGElement',
  'Node',
  'Element',
  'Event',
  'MouseEvent',
  'File',
  'Blob',
  'FileReader',
  'XMLSerializer',
])
  g[k] = (window as any)[k]
g.getComputedStyle = window.getComputedStyle.bind(window)
g.requestAnimationFrame = window.requestAnimationFrame.bind(window)
g.cancelAnimationFrame = window.cancelAnimationFrame.bind(window)
const tubeMap =
  await import('/home/cdiesh/src/vendor/sequenceTubeMapModern/src/util/tubemap.ts')
const { exportSvg } =
  await import('/home/cdiesh/src/vendor/sequenceTubeMapModern/src/util/svgExport.ts')
const vg = JSON.parse(readFileSync(file, 'utf8'))
const nodes = tubeMap.vgExtractNodes(vg)
const tracks = tubeMap.vgExtractTracks(vg, 0, 0)
tubeMap.setNodeWidthOption(mode === 'normal' ? 'normal' : 'compressed')
tubeMap.setMergeNodesFlag(true)
tubeMap.setShowReadsFlag(false)
const t0 = performance.now()
tubeMap.create({
  svgID: '#tubemap',
  nodes,
  tracks,
  reads: [],
  region: undefined,
})
console.log(
  `tube map layout+draw ${(performance.now() - t0).toFixed(0)} ms, ${nodes.length} nodes, ${tracks.length} tracks`,
)
const svg = window.document.getElementById('tubemap')!
const { xml } = exportSvg(svg, { crop: true })
writeFileSync(out, xml)
