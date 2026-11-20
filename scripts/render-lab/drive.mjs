// node drive.mjs <scene-dir> [--amd] [--headless]
// Serves lab.js and the scene JSON from <scene-dir>, opens Chrome on the GPU
// with vsync on, and prints one JSON line per scene and painter. Writes the
// diff PNGs to <scene-dir>/shots. PLAYWRIGHT names playwright-core's
// index.mjs where it is not installed beside this script.
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'

const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright-core')

const [dir, ...flags] = process.argv.slice(2)
const here = new URL('.', import.meta.url).pathname
const server = createServer((req, res) => {
  const path = req.url === '/lab.js' ? `${here}out/lab.js` : `${dir}${req.url}`
  if (req.url === '/') {
    res.setHeader('content-type', 'text/html')
    res.end('<!doctype html><body style="margin:0;overflow:hidden"></body>')
  } else if (existsSync(path)) {
    res.setHeader(
      'content-type',
      path.endsWith('.js') ? 'text/javascript' : 'application/json',
    )
    res.end(readFileSync(path))
  } else {
    res.statusCode = 404
    res.end()
  }
}).listen(0)

const args = [
  '--window-size=1300,860',
  '--enable-gpu',
  '--ignore-gpu-blocklist',
  ...(flags.includes('--amd')
    ? ['--use-angle=vulkan', '--enable-features=Vulkan']
    : []),
]
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  headless: flags.includes('--headless'),
  args,
})
const page = await browser.newPage({ viewport: { width: 1290, height: 810 } })
await page.goto(`http://localhost:${server.address().port}/`)
await page.addScriptTag({ url: '/lab.js' })

mkdirSync(`${dir}/shots`, { recursive: true })
const scenes = ['doc1500', 'doc15k', 'kiv2', 'rhd', 'fm15k', 'fm50k'].filter(
  s => existsSync(`${dir}/${s}.json`),
)
for (const scene of scenes) {
  for (const r of await page.evaluate(
    s => window.diff(s, ['canvas', 'gl']),
    scene,
  )) {
    writeFileSync(
      `${dir}/shots/${scene}-${r.painter}.png`,
      Buffer.from(r.png.split(',')[1], 'base64'),
    )
    delete r.png
    console.log(JSON.stringify(r))
  }
  for (const r of await page.evaluate(
    s => window.raf(s, ['canvas', 'gl']),
    scene,
  )) {
    console.log(JSON.stringify(r))
  }
}
await browser.close()
server.close()
