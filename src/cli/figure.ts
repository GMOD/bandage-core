/// <reference types="node" />

import { open, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { gunzipSync } from 'node:zlib'

import { TabixIndexedFile } from '@gmod/tabix'

import { figureSvg } from '../figure'
import { HPRC_GBZ, cutGbzRegion, openGbz, parseRegion } from '../gbzCut'
import {
  genesFromBed,
  genesFromGff3Lines,
  genesFromText,
} from '../genes/geneFiles'
import { layoutModeByValue } from '../layoutModes'
import loadBandage from '../loadBandage'
import { forceLayout, loadGraph } from '../pipeline'
import { featuresOnBackbone, graphBackbone } from '../reference'

import type { BubbleSpread } from '../bubbleSpreads'
import type { FigureOptions } from '../figure'
import type { GbzSource } from '../gbzCut'
import type { GeneModel } from '../genes/genePins'
import type { LayoutModeValue } from '../layoutModes'
import type { LayoutEngine } from '../pipeline'
import type { Graph } from '../types'
import type { WalkLayer } from '../walkEncoding'
import type { ByteSource } from '@gmod/gbz-base'

// bandage-figure: a pangenome graph figure from a spec, as SVG, with no browser.
// The spec names the graph (a GFA file or url, or a window cut from a gbz-base
// database), the genes to pin on its backbone, the layout, the walks to lift
// and how to facet them, so the figure can be made again from the spec alone;
// the SVG carries its spec and the version that drew it.
//
//   bandage-figure mapt.json -o mapt.svg

export interface FigureSpec extends Omit<
  FigureOptions,
  'walks' | 'region' | 'genes' | 'spec'
> {
  gfa?: string
  // `db` is a gbz-base database, or `hprc` for the HPRC release 2 graph
  gbz?: GbzSource
  // the reference window a GFA was cut for
  region?: string
  referencePath?: string
  layout?: LayoutModeValue
  quality?: number
  bubbleSpread?: BubbleSpread
  walks?: (string | WalkLayer)[]
  // a GFF3 or BED file or url, read by range through `index` (.tbi or .csi)
  // where there is one, for the genes on the backbone's contigs
  genes?: { file: string; index?: string; format?: 'gff3' | 'bed' }
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

async function text(location: string) {
  const bytes = isUrl(location)
    ? new Uint8Array(await (await fetch(location)).arrayBuffer())
    : await readFile(location)
  const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b
  return new TextDecoder().decode(gzipped ? gunzipSync(bytes) : bytes)
}

async function readGenes(
  genes: NonNullable<FigureSpec['genes']>,
  graph: Graph,
  resolve: (location: string) => string,
): Promise<GeneModel[]> {
  const backbone = graphBackbone(graph)
  if (!backbone) {
    return []
  }
  const file = resolve(genes.file)
  const format =
    genes.format ?? (/\.bed(\.gz)?$/i.test(genes.file) ? 'bed' : 'gff3')
  if (!genes.index) {
    return featuresOnBackbone(genesFromText(await text(file)), backbone)
  }
  const index = resolve(genes.index)
  const csi = index.endsWith('.csi')
  const tabix = new TabixIndexedFile(
    isUrl(file)
      ? { url: file, ...(csi ? { csiUrl: index } : { tbiUrl: index }) }
      : { path: file, ...(csi ? { csiPath: index } : { tbiPath: index }) },
  )
  const indexed = new Set(await tabix.getReferenceSequenceNames())
  const lines: string[] = []
  for (const contig of backbone.contigs) {
    const refName = [contig.contig, contig.refName].find(n => indexed.has(n))
    if (refName !== undefined) {
      await tabix.getLines(refName, contig.start, contig.end, {
        lineCallback: line => lines.push(line),
      })
    }
  }
  return featuresOnBackbone(
    format === 'gff3'
      ? genesFromGff3Lines(lines)
      : genesFromBed(lines.join('\n')),
    backbone,
  )
}

const engine: LayoutEngine = async request => {
  const bandage = await loadBandage()
  const start = performance.now()
  const result = bandage.computeLayout(request.graph, request.options)
  return { result, duration: performance.now() - start }
}

async function renderSpec(spec: FigureSpec, base: string) {
  const resolve = (location: string) =>
    isUrl(location) ? location : path.resolve(base, location)
  let source: {
    text: string
    name: string
    region?: ReturnType<typeof parseRegion>
  }
  if (spec.gbz) {
    const { db, index } = spec.gbz.db === 'hprc' ? HPRC_GBZ : spec.gbz
    const cut = await cutGbzRegion(
      await openGbz(
        byteSource(resolve(db)),
        index ? byteSource(resolve(index)) : undefined,
      ),
      spec.gbz,
    )
    source = { ...cut, name: `${cut.sample} ${spec.gbz.region}` }
  } else if (spec.gfa) {
    source = {
      text: await text(resolve(spec.gfa)),
      name: path.basename(spec.gfa),
      region: spec.region ? parseRegion(spec.region) : undefined,
    }
  } else {
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
    genes: spec.genes ? await readGenes(spec.genes, graph, resolve) : undefined,
    spec,
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
