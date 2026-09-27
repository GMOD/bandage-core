// Saves the GFA a gbz-base graph track cuts for a window, walks included, from
// jbrowse.org's hosted HPRC demo. cut-hprc.ts reads the rGFA tabix pair, which
// has no walks, so a tube map needs this one.
//
//   node scripts/layout-lab/cut-gbz.mjs out/ micb=chr6:31492000-31514000 \
//     kiv2=chr6:160614798-160647758
//
// Each window is cut as the track cuts it for a tube map: the window alone, one
// hop of context, the eight haplotypes of the README's figures.
import fs from 'node:fs'
import path from 'node:path'

import puppeteer from 'puppeteer'

const CONFIG = 'https://jbrowse.org/demos/hprc/config.json'
const TRACK = 'hprc_v2_1_gbz_lanes'
const HAPLOTYPES = [
  'HG00097.1',
  'HG00099.1',
  'HG00128.1',
  'HG00133.1',
  'HG01109.1',
  'HG01123.1',
  'HG01960.1',
  'HG02055.1',
]

const [outDir, ...windows] = process.argv.slice(2)
if (!outDir || windows.length === 0) {
  throw new Error('usage: cut-gbz.mjs <outDir> name=chr:start-end ...')
}
fs.mkdirSync(outDir, { recursive: true })

const session = {
  views: [
    {
      type: 'LinearGenomeView',
      assembly: 'hg38',
      loc: 'chr6:31,505,400-31,507,400',
      tracks: [
        {
          trackId: TRACK,
          type: 'LinearGraphDisplay',
          layoutMode: 'tubemap',
          subgraphHaplotypes: HAPLOTYPES,
        },
      ],
    },
  ],
}

const browser = await puppeteer.launch({
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
})
try {
  const page = await browser.newPage()
  await page.goto(
    `https://jbrowse.org/code/jb2/main/?config=${encodeURIComponent(CONFIG)}&session=spec-${encodeURIComponent(JSON.stringify(session))}`,
    { waitUntil: 'domcontentloaded', timeout: 60_000 },
  )
  await page.waitForFunction(
    () => window.JBrowseSession?.views[0]?.tracks[0]?.displays[0]?.hasGraph,
    { timeout: 180_000, polling: 500 },
  )
  for (const arg of windows) {
    const [name, loc] = arg.split('=')
    const [, refName, start, end] = /^(.+):(\d+)-(\d+)$/.exec(
      loc.replaceAll(',', ''),
    )
    const gfa = await page.evaluate(
      async (region, haplotypes) => {
        const display = window.JBrowseSession.views[0].tracks[0].displays[0]
        return window.JBrowseSession.rpcManager.call('cut-gbz', 'GetSubgraph', {
          adapterConfig: display.adapterConfig,
          region,
          opts: { hops: 1, haplotypes },
        })
      },
      { refName, assemblyName: 'hg38', start: +start, end: +end },
      HAPLOTYPES,
    )
    const file = path.join(outDir, `${name}.gfa`)
    fs.writeFileSync(file, gfa)
    console.log(`wrote ${file}: ${gfa.split('\n').length} lines`)
  }
} finally {
  await browser.close()
}
