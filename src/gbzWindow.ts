import { isReverse, nodeId } from '@gmod/gbz-base'

import { joinCuts } from './gbzJoin.ts'
import { gfaTables } from './gfa/gfaTables.ts'
import { panSNMatchesPrefix, panSNSample } from './pansn.ts'
import { wellKnownSample } from './reference.ts'

import type { GraphTables } from './gfa/graphTables.ts'
import type {
  CompactSubgraph,
  GBZBase,
  PathName,
  PathQuery,
  SnarlOutput,
  Subgraph,
} from '@gmod/gbz-base'

// A window of a gbz-base graph cut to GFA, with no host in it: the adapter
// and a standalone page open the database their own way and share this.

export class NoReferenceSampleError extends Error {
  override name = 'NoReferenceSampleError'

  constructor(anchor: string, referenceSamples: string[]) {
    super(
      referenceSamples.length === 0
        ? `the graph names no reference sample (gbwt_reference_samples) and the anchor "${anchor}" maps to none; set referenceSample`
        : `the anchor "${anchor}" is none of the graph's reference samples (${referenceSamples.join(', ')}); set referenceSample or map it through assemblyNameToPanSN`,
    )
  }
}

export class NodeLimitError extends Error {
  override name = 'NodeLimitError'
  readonly regionTooLarge = true

  constructor(
    limit: number,
    windowBp: number,
    readonly fitsBp: number,
  ) {
    super(
      `this ${windowBp.toLocaleString()} bp window reads more than nodeLimit (${limit.toLocaleString()}) graph nodes; zoom in to about ${fitsBp.toLocaleString()} bp or raise nodeLimit`,
    )
  }
}

export function haplotypePrefix(name: Pick<PathName, 'sample' | 'haplotype'>) {
  return `${name.sample}#${name.haplotype}`
}

// Whether a walk is one of the haplotypes asked for, by PanSN prefix at sample
// (`HG002`) or haplotype (`HG002#1`) depth; undefined wants every one.
export function haplotypeWanted(name: PathName, wanted: string[] | undefined) {
  const prefix = haplotypePrefix(name)
  return (
    wanted === undefined ||
    wanted.some(candidate => panSNMatchesPrefix(prefix, candidate))
  )
}

export async function referenceSamplesOf(db: GBZBase) {
  return ((await db.tag('gbwt_reference_samples')) ?? '')
    .split(/\s+/)
    .filter(sample => sample !== '')
}

function aliasedSample(anchorSample: string, referenceSamples: string[]) {
  const lower = anchorSample.toLowerCase()
  const alias = wellKnownSample(anchorSample)?.toLowerCase()
  return (
    referenceSamples.find(s => s === anchorSample) ??
    referenceSamples.find(s => s.toLowerCase() === lower) ??
    referenceSamples.find(s => s.toLowerCase() === alias)
  )
}

export function resolveReferenceSample({
  configured,
  anchorPrefix,
  referenceSamples,
}: {
  configured: string
  anchorPrefix: string
  referenceSamples: string[]
}) {
  if (configured !== '') {
    return configured
  }
  const sample =
    aliasedSample(panSNSample(anchorPrefix), referenceSamples) ??
    (referenceSamples.length === 1 ? referenceSamples[0] : undefined)
  if (sample === undefined) {
    throw new NoReferenceSampleError(anchorPrefix, referenceSamples)
  }
  return sample
}

// The indexed reference path a window on `refName` resolves against, or
// undefined when the reference sample has no indexed path by that contig.
export async function referencePathQuery(
  db: GBZBase,
  referenceSample: string,
  refName: string,
): Promise<PathQuery | undefined> {
  const path = (await db.paths()).find(
    p =>
      p.isIndexed &&
      p.name.sample === referenceSample &&
      p.name.contig === refName,
  )
  return path
    ? {
        sample: path.name.sample,
        contig: refName,
        haplotype: path.name.haplotype,
      }
    : undefined
}

// gbz-base reports the node limit with how far along the reference the walk
// had got when it tripped, counted from the window's start; a window that fits
// is that far, with a margin, or half the window when the limit tripped past
// the reference.
export function nodeLimitError(
  error: unknown,
  limit: number,
  windowBp: number,
) {
  const isLimit =
    error instanceof Error &&
    (error.name === 'SubgraphLimitError' ||
      /^Subgraph size limit of \d+ nodes exceeded/.test(error.message))
  if (!isLimit) {
    return undefined
  } else {
    const walked = (error as { walkedBp?: unknown }).walkedBp
    const fits =
      typeof walked === 'number' && walked > 0
        ? Math.floor(walked * 0.8)
        : Math.floor(windowBp / 2)
    return new NodeLimitError(limit, windowBp, Math.max(fits, 1))
  }
}

export interface GbzWindowOptions {
  context: number
  snarls: SnarlOutput
  limit: number
  keep?: ((name: PathName) => boolean) | undefined
  signal?: AbortSignal | undefined
}

// A cut's context and snarls unless told otherwise, and the nodes past which a
// window fails rather than read a whole chromosome: what a gbz-base track's
// slots default to, so a page or a script cuts the window the viewer would.
// gbz-base counts every node it walks, which runs well past the nodes a cut
// keeps.
export const GBZ_CUT_DEFAULTS = {
  context: 1000,
  snarls: 'contained',
  limit: 100_000,
} as const satisfies Pick<GbzWindowOptions, 'context' | 'snarls' | 'limit'>

async function windowCuts(
  db: GBZBase,
  query: PathQuery,
  start: number,
  end: number,
  opts: GbzWindowOptions,
) {
  return db
    .getSubgraphs({ ...opts, path: query, start, end, haplotypes: 'all' })
    .catch((error: unknown) => {
      throw nodeLimitError(error, opts.limit, end - start) ?? error
    })
}

async function joinedGFA(db: GBZBase, subgraphs: Subgraph[]) {
  const paths = await db.paths()
  return joinCuts(
    await Promise.all(subgraphs.map(subgraph => subgraph.toGFA())),
    (sample, haplotype, contig, at) =>
      paths.some(
        ({ name }) =>
          name.sample === sample &&
          name.haplotype === haplotype &&
          name.contig === contig &&
          name.fragment === at,
      ),
  )
}

// The reference walk, the snarls in the window, and one W line per haplotype
// walk (the reference walk first), PanSN-named when the database carries the
// haplotype index. Empty when the query names no indexed path.
export async function cutWindowGFA(
  db: GBZBase,
  query: PathQuery | undefined,
  start: number,
  end: number,
  opts: GbzWindowOptions,
) {
  return query
    ? joinedGFA(db, await windowCuts(db, query, start, end, opts))
    : ''
}

/**
 * The cut `cutWindowGFA` writes, as the tables `gfaTables` would read from
 * it. A window on one reference fragment is one cut, whose typed arrays
 * become the tables with no GFA written or read: writing an every-haplotype
 * KIV-2 cut out and parsing it back was 2 s. A window over several
 * fragments joins their GFA as text. Empty text for no indexed path.
 */
export async function cutWindowTables(
  db: GBZBase,
  query: PathQuery | undefined,
  start: number,
  end: number,
  opts: GbzWindowOptions,
): Promise<GraphTables | string> {
  if (!query) {
    return ''
  }
  const subgraphs = await windowCuts(db, query, start, end, opts)
  if (subgraphs.length === 1) {
    return compactTables(subgraphs[0]!.toCompactSubgraph())
  }
  const text = await joinedGFA(db, subgraphs)
  return (text && gfaTables(text)) || text
}

// `sample#haplotype#contig[start-end]`, the name gbz-base gives a cut's walk
const WALK_NAME = /^(.*)\[(\d+)-(\d+)\]$/

/**
 * A gbz-base cut's typed arrays as the tables of the GFA `toGFA` writes for
 * it: its segments, its links, and its walks in order, steps by GBWT handle
 */
export function compactTables(cut: CompactSubgraph): GraphTables {
  const names = Array.from(cut.nodeIds, String)
  const index = new Map<number, number>()
  cut.nodeIds.forEach((id, i) => index.set(id, i))
  const indexOf = (handle: number) => {
    const id = nodeId(handle)
    let i = index.get(id)
    if (i === undefined) {
      i = names.length
      index.set(id, i)
      names.push(String(id))
    }
    return i
  }
  const declared = cut.nodeIds.length
  const linkCount = cut.edges.length / 2
  const from = new Int32Array(linkCount)
  const to = new Int32Array(linkCount)
  const strands = new Uint8Array(linkCount)
  for (let k = 0; k < linkCount; k++) {
    const a = cut.edges[2 * k]!
    const b = cut.edges[2 * k + 1]!
    from[k] = indexOf(a)
    to[k] = indexOf(b)
    strands[k] = (isReverse(a) ? 1 : 0) | (isReverse(b) ? 2 : 0)
  }
  const walks = cut.paths.filter(path => path.steps.length > 0)
  const offsets = new Int32Array(walks.length + 1)
  walks.forEach((walk, p) => {
    offsets[p + 1] = offsets[p]! + walk.steps.length
  })
  const steps = new Int32Array(offsets[walks.length]!)
  const reversed = new Uint8Array(steps.length)
  const starts = new Float64Array(walks.length)
  const ends = new Float64Array(walks.length)
  const walkNames = walks.map((walk, p) => {
    const named = WALK_NAME.exec(walk.name)
    starts[p] = named ? +named[2]! : 0
    ends[p] = named ? +named[3]! : -1
    let at = offsets[p]!
    for (const handle of walk.steps) {
      steps[at] = indexOf(handle)
      reversed[at++] = isReverse(handle) ? 1 : 0
    }
    return named ? named[1]! : walk.name
  })
  return {
    nodes: {
      names,
      lengths: Int32Array.from(cut.nodeSequences, s => s.length),
      refs: new Int32Array(declared).fill(-1),
      starts: new Float64Array(declared),
      ranks: new Int32Array(declared),
      refNames: [],
    },
    links: { from, to, strands },
    walks: {
      names: walkNames,
      starts,
      ends,
      offsets,
      steps,
      reversed,
    },
  }
}
