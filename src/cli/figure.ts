/// <reference types="node" />

import { access, open, readFile, writeFile } from 'node:fs/promises'
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
import { LAYOUT_MODE_VALUES, layoutModeByValue } from '../layoutModes'
import loadBandage from '../loadBandage'
import { forceLayout, loadGraph } from '../pipeline'
import { featuresOnBackbone, graphBackbone, refNameBinding } from '../reference'

import type { BubbleSpread } from '../bubbleSpreads'
import type { FigureOptions } from '../figure'
import type { GbzSource } from '../gbzCut'
import type { GeneModel } from '../genes/genePins'
import type { LayoutModeValue } from '../layoutModes'
import type { LayoutEngine } from '../pipeline'
import type { BackboneContig } from '../reference'
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
  // where there is one, for the genes on the backbone's contigs. A file that
  // names a contig other than as the graph does, with or without `chr`, says
  // how under `refNames`: `{ "chr6": "NC_000006.12" }`
  genes?: {
    file: string
    index?: string
    format?: 'gff3' | 'bed'
    refNames?: Record<string, string>
  }
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
        const res = await fetchOk(location, { method: 'HEAD' })
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

async function fetchOk(location: string, init?: RequestInit) {
  const res = await fetch(location, init)
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} reading ${location}`)
  }
  return res
}

async function text(location: string) {
  const bytes = isUrl(location)
    ? new Uint8Array(await (await fetchOk(location)).arrayBuffer())
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
  const bind = refNameBinding(
    backbone.contigs.map(c => c.refName),
    genes.refNames,
  )
  const { names, features } = genes.index
    ? await indexedGenes(genes, resolve, backbone.contigs, bind)
    : wholeFileGenes(await text(resolve(genes.file)))
  if (!names.some(name => bind(name) !== undefined)) {
    const shown = names.slice(0, 4).join(', ')
    console.warn(
      `bandage-figure: no sequence in ${genes.file} names ${backbone.contigs.map(c => c.contig).join(', ')}` +
        (names.length
          ? `; it has ${shown}${names.length > 4 ? ', …' : ''}`
          : '') +
        `. Give the file's name under genes.refNames, as { "chr6": "NC_000006.12" }`,
    )
  }
  return featuresOnBackbone(features, backbone, genes.refNames)
}

function wholeFileGenes(contents: string) {
  const features = genesFromText(contents)
  return { names: [...new Set(features.map(f => f.refName))], features }
}

// Each backbone contig read under the name the index binds to it
async function indexedGenes(
  genes: NonNullable<FigureSpec['genes']>,
  resolve: (location: string) => string,
  contigs: BackboneContig[],
  bind: (name: string) => string | undefined,
) {
  const file = resolve(genes.file)
  const index = resolve(genes.index!)
  const csi = index.endsWith('.csi')
  const tabix = new TabixIndexedFile(
    isUrl(file)
      ? { url: file, ...(csi ? { csiUrl: index } : { tbiUrl: index }) }
      : { path: file, ...(csi ? { csiPath: index } : { tbiPath: index }) },
  )
  const names = await tabix.getReferenceSequenceNames()
  const lines: string[] = []
  for (const contig of contigs) {
    const name = names.find(n => bind(n) === contig.refName)
    if (name !== undefined) {
      await tabix.getLines(name, contig.start, contig.end, {
        lineCallback: line => lines.push(line),
      })
    }
  }
  const format =
    genes.format ?? (/\.bed(\.gz)?$/i.test(genes.file) ? 'bed' : 'gff3')
  return {
    names,
    features:
      format === 'gff3'
        ? genesFromGff3Lines(lines)
        : genesFromBed(lines.join('\n')),
  }
}

const engine: LayoutEngine = async request => {
  const bandage = await loadBandage()
  const start = performance.now()
  const result = bandage.computeLayout(request.graph, request.options)
  return { result, duration: performance.now() - start }
}

async function exists(location: string) {
  try {
    await (isUrl(location)
      ? fetchOk(location, { method: 'HEAD' })
      : access(location))
    return true
  } catch {
    return false
  }
}

// As the plugin's adapter does, a database with no index named takes the
// haplotype index beside it, which is what names its walks by sample
async function siblingIndex(db: string) {
  const sibling = db.replace(/\.gbz\.db$/i, '.haplotype-index.db')
  return sibling !== db && (await exists(sibling)) ? sibling : undefined
}

// figureSvg draws the canvas's nodes, and these layouts draw theirs over it
const UNDRAWABLE = new Set(['walkrows', 'tubemap', 'tubemapref'])

function checkLayout(layout: string | undefined) {
  if (layout === undefined) {
    return
  }
  if (!(LAYOUT_MODE_VALUES as string[]).includes(layout)) {
    throw new Error(
      `unknown layout "${layout}": one of ${LAYOUT_MODE_VALUES.filter(v => !UNDRAWABLE.has(v)).join(', ')}`,
    )
  }
  if (UNDRAWABLE.has(layout)) {
    throw new Error(`a figure cannot draw the "${layout}" layout yet`)
  }
}

async function renderSpec(spec: FigureSpec, base: string) {
  checkLayout(spec.layout)
  const resolve = (location: string) =>
    isUrl(location) ? location : path.resolve(base, location)
  let source: {
    text: string
    name: string
    region?: ReturnType<typeof parseRegion>
  }
  if (spec.gbz) {
    const { db, index } = spec.gbz.db === 'hprc' ? HPRC_GBZ : spec.gbz
    const indexLocation = index
      ? resolve(index)
      : await siblingIndex(resolve(db))
    const cut = await cutGbzRegion(
      await openGbz(
        byteSource(resolve(db)),
        indexLocation ? byteSource(indexLocation) : undefined,
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

const USAGE = 'usage: bandage-figure <spec.json> [-o figure.svg]'

function args() {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        out: { type: 'string', short: 'o' },
        help: { type: 'boolean', short: 'h' },
      },
    })
  } catch (e) {
    console.error(`${e instanceof Error ? e.message : String(e)}\n${USAGE}`)
    process.exit(2)
  }
}

async function main() {
  const { positionals, values } = args()
  if (values.help) {
    process.stdout.write(`${USAGE}\n`)
    return
  }
  const file = positionals[0]
  if (!file) {
    console.error(USAGE)
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

try {
  await main()
} catch (e) {
  console.error(`bandage-figure: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}
