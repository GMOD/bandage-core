import { GBZBase } from '@gmod/gbz-base'

import {
  GBZ_CUT_DEFAULTS,
  NoReferenceSampleError,
  aliasedSample,
  cutWindowGFA,
  haplotypeWanted,
  referencePathQuery,
  referenceSamplesOf,
} from './gbzWindow'
import { panSNSample } from './pansn'

import type { ByteSource, SnarlOutput } from '@gmod/gbz-base'

// A window of a gbz-base database cut to GFA from a standalone page or a
// script, which open the database by range requests their own way: BandageJS
// in the browser, bandage-figure in Node.

export interface GbzSource {
  db: string
  index?: string
  region: string
  haplotypes?: string[]
  referenceSample?: string
  // bp of graph past the window's ends, and which snarls the cut keeps whole:
  // a gbz-base track's `context` and `subgraphSnarls`
  context?: number
  snarls?: SnarlOutput
}

// the HPRC release 2 Minigraph-Cactus graph, with the haplotype index that
// names its walks
export const HPRC_GBZ = {
  db: 'https://s3-us-west-2.amazonaws.com/human-pangenomics/pangenomes/freeze/release2/minigraph-cactus/v2.1/hprc-v2.1-mc-grch38/hprc-v2.1-mc-grch38.gbz.db',
  index:
    'https://jbrowse.org/demos/hprc/hprc-v2.1-mc-grch38.haplotype-index.f3.db',
}

// `hprc` as a source's `db` stands for HPRC_GBZ, whose index fills in for one
// the source leaves out
export function gbzLocations({ db, index }: Pick<GbzSource, 'db' | 'index'>) {
  return db === 'hprc'
    ? { db: HPRC_GBZ.db, index: index ?? HPRC_GBZ.index }
    : { db, index }
}

// The haplotype index beside a `.gbz.db`, which names its walks by sample
export function haplotypeIndexBeside(db: string) {
  const GBZ_DB = /\.gbz\.db$/i
  return GBZ_DB.test(db) ? db.replace(GBZ_DB, '.haplotype-index.db') : undefined
}

export function parseRegion(text: string) {
  const m = /^\s*([^:\s]+):([\d,]+)-([\d,]+)\s*$/.exec(text)
  if (!m) {
    throw new Error(
      `"${text}" is not a region like chr6:160,614,798-160,647,758`,
    )
  }
  const n = (s: string) => Number(s.replaceAll(',', ''))
  const region = { refName: m[1]!, start: n(m[2]!), end: n(m[3]!) }
  if (region.end <= region.start) {
    throw new Error(`"${text}" ends at or before it starts`)
  }
  return region
}

export async function openGbz(db: ByteSource, index?: ByteSource) {
  const base = await GBZBase.open({ source: db, haplotypeIndex: index })
  return { base, referenceSamples: await referenceSamplesOf(base) }
}

// `ref` through the aliases the plugin resolves an anchor with (hg38 is
// GRCh38, hs1 is CHM13), else as the sample it names, such as gbz-base's
// `_gbwt_ref` for a graph with no named reference
function referenceSample(ref: string | undefined, samples: string[]) {
  if (ref) {
    return aliasedSample(panSNSample(ref), samples) ?? ref
  }
  const first = samples[0]
  if (first === undefined) {
    throw new NoReferenceSampleError('', samples)
  }
  return first
}

export async function cutGbzRegion(
  { base, referenceSamples }: Awaited<ReturnType<typeof openGbz>>,
  src: Omit<GbzSource, 'db' | 'index'>,
  signal?: AbortSignal,
) {
  const region = parseRegion(src.region)
  const sample = referenceSample(src.referenceSample, referenceSamples)
  const query = await referencePathQuery(base, sample, region.refName)
  if (!query) {
    throw new Error(`${sample} has no indexed path named ${region.refName}`)
  }
  signal?.throwIfAborted()
  const wanted = src.haplotypes?.length ? src.haplotypes : undefined
  const text = await cutWindowGFA(base, query, region.start, region.end, {
    context: src.context ?? GBZ_CUT_DEFAULTS.context,
    snarls: src.snarls ?? GBZ_CUT_DEFAULTS.snarls,
    limit: GBZ_CUT_DEFAULTS.limit,
    signal,
    keep: wanted ? name => haplotypeWanted(name, wanted) : undefined,
  })
  return { text, region, sample }
}
