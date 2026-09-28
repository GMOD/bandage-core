/// <reference types="node" />

import { open, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { gunzipSync } from 'node:zlib'

import { GBZBase } from '@gmod/gbz-base'

import { figureSvg } from '../figure'
import {
  cutWindowGFA,
  haplotypeWanted,
  referencePathQuery,
  referenceSamplesOf,
  resolveReferenceSample,
} from '../gbzWindow'
import { layoutModeByValue } from '../layoutModes'
import loadBandage from '../loadBandage'
import { forceLayout, loadGraph } from '../pipeline'

import type { BubbleSpread } from '../bubbleSpreads'
import type { FigureOptions } from '../figure'
import type { LayoutModeValue } from '../layoutModes'
import type { LayoutEngine } from '../pipeline'
import type { WalkLayer } from '../walkEncoding'
import type { ByteSource } from '@gmod/gbz-base'

// bandage-figure: a pangenome graph figure from a spec, as SVG, with no browser.
// The spec names the graph (a GFA file or url, or a window cut from a gbz-base
// database), the layout, the walks to lift and how to facet them, so the figure
// can be made again from the spec alone; the SVG carries its spec.
//
//   bandage-figure mapt.json -o mapt.svg

export interface FigureSpec extends Omit<FigureOptions, 'walks' | 'region'> {
  gfa?: string
  gbz?: {
    // a gbz-base database, or `hprc` for the HPRC release 2 graph
    db: string
    index?: string
    region: string
    haplotypes?: string[]
    referenceSample?: string
  }
  // the reference window a GFA was cut for
  region?: string
  referencePath?: string
  layout?: LayoutModeValue
  quality?: number
  bubbleSpread?: BubbleSpread
  walks?: (string | WalkLayer)[]
}

const HPRC = {
  db: 'https://s3-us-west-2.amazonaws.com/human-pangenomics/pangenomes/freeze/release2/minigraph-cactus/v2.1/hprc-v2.1-mc-grch38/hprc-v2.1-mc-grch38.gbz.db',
  index:
    'https://jbrowse.org/demos/hprc/hprc-v2.1-mc-grch38.haplotype-index.anchored.db',
}

// the most nodes a gbz-base cut walks, which runs well past those it keeps
const WALK_LIMIT = 100_000

function parseRegion(text: string) {
  const m = /^\s*([^:\s]+):([\d,]+)-([\d,]+)\s*$/.exec(text)
  if (!m) {
    throw new Error(
      `"${text}" is not a region like chr6:160,614,798-160,647,758`,
    )
  }
  const n = (s: string) => Number(s.replaceAll(',', ''))
  return { refName: m[1]!, start: n(m[2]!), end: n(m[3]!) }
}

const isUrl = (s: string) => /^https?:\/\//.test(s)

// a file or url read by range, which is all gbz-base asks of one
function byteSource(location: string): ByteSource {
  if (isUrl(location)) {
    return {
      async read(length, position) {
        const res = await fetch(location, {
          headers: { range: `bytes=${position}-${position + length - 1}` },
        })
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} reading ${location}`)
        }
        return new Uint8Array(await res.arrayBuffer())
      },
      async stat() {
        const res = await fetch(location, { method: 'HEAD' })
        return { size: Number(res.headers.get('content-length')) }
      },
    }
  }
  const handle = open(location)
  return {
    async read(length, position) {
      const buffer = new Uint8Array(length)
      const { bytesRead } = await (
        await handle
      ).read(buffer, 0, length, position)
      return buffer.subarray(0, bytesRead)
    },
    async stat() {
      return { size: (await (await handle).stat()).size }
    },
  }
}

async function gfaText(location: string) {
  const bytes = isUrl(location)
    ? new Uint8Array(await (await fetch(location)).arrayBuffer())
    : await readFile(location)
  const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b
  return new TextDecoder().decode(gzipped ? gunzipSync(bytes) : bytes)
}

async function cutGbz(gbz: NonNullable<FigureSpec['gbz']>) {
  const { db, index } = gbz.db === 'hprc' ? HPRC : gbz
  const base = await GBZBase.open(
    byteSource(db),
    index ? { haplotypeIndex: byteSource(index) } : {},
  )
  const samples = await referenceSamplesOf(base)
  const sample = resolveReferenceSample({
    configured: '',
    anchorPrefix: gbz.referenceSample ?? samples[0] ?? '',
    referenceSamples: samples,
  })
  const region = parseRegion(gbz.region)
  const query = await referencePathQuery(base, sample, region.refName)
  if (!query) {
    throw new Error(`${sample} has no indexed path named ${region.refName}`)
  }
  const wanted = gbz.haplotypes?.length ? gbz.haplotypes : undefined
  const text = await cutWindowGFA(base, query, region.start, region.end, {
    context: 1000,
    snarls: 'contained',
    limit: WALK_LIMIT,
    ...(wanted ? { keep: name => haplotypeWanted(name, wanted) } : {}),
  })
  return { text, region, name: `${sample} ${gbz.region}` }
}

const engine: LayoutEngine = async request => {
  const bandage = await loadBandage()
  const start = performance.now()
  const result = bandage.computeLayout(request.graph, request.options)
  return { result, duration: performance.now() - start }
}

async function renderSpec(spec: FigureSpec, base = '.') {
  const source = spec.gbz
    ? await cutGbz(spec.gbz)
    : spec.gfa
      ? {
          text: await gfaText(
            isUrl(spec.gfa) ? spec.gfa : path.resolve(base, spec.gfa),
          ),
          region: spec.region ? parseRegion(spec.region) : undefined,
          name: path.basename(spec.gfa),
        }
      : undefined
  if (!source) {
    throw new Error('a spec names its graph as `gfa` or `gbz`')
  }
  const graph = loadGraph(source.text, source.name, {
    referencePath: spec.referencePath,
  })
  const layout =
    layoutModeByValue(spec.layout ?? 'force').run(graph, source.region) ??
    (
      await forceLayout(
        graph,
        {
          quality: spec.quality ?? 2,
          linearLayout: false,
          bubbleSpread: spec.bubbleSpread ?? 'auto',
        },
        engine,
      )
    ).result
  return figureSvg(graph, layout, {
    ...spec,
    walks: spec.walks?.map(w => (typeof w === 'string' ? { walk: w } : w)),
    region: source.region,
    metadata: JSON.stringify(spec),
  })
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { out: { type: 'string', short: 'o' } },
  })
  const file = positionals[0]
  if (!file) {
    console.error('usage: bandage-figure <spec.json> [-o figure.svg]')
    process.exit(2)
  }
  const spec = JSON.parse(await readFile(file, 'utf8')) as FigureSpec
  const svg = await renderSpec(spec, path.dirname(file))
  if (values.out) {
    await writeFile(values.out, svg)
  } else {
    process.stdout.write(svg)
  }
}

await main()
