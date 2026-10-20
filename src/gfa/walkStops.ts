import type { PathStop, StopChunk } from '../types'

// W-line tags a walk-file cut writes: what lies past the fragment's start and
// past its end
export const START_STOP_TAG = 'ws'
export const END_STOP_TAG = 'we'

const STOP_KINDS = ['elsewhere', 'break', 'end'] as const

// why a walk-row gap is empty (layout/walkRows.ts WalkRun)
export type GapCause = 'missing' | 'elsewhere' | 'unknown' | 'abridged'

// What a gap's cause says of its bp, and the key's words for it
export const GAP_CAUSE_TEXT: Record<GapCause, string> = {
  missing: 'not in the graph',
  elsewhere: 'on nodes filed elsewhere',
  unknown: 'gap, cause unknown',
  abridged: 'abridged: steps not loaded',
}

// a gap with no cause: graph sequence the cut did not keep
export const OUTSIDE_TEXT = 'outside the extracted subgraph'

export interface GapPart {
  bp: number
  cause?: GapCause
  chunk?: StopChunk
}

/**
 * A gap of `bp` in contig order, split by the stops either side: the bp each
 * side's cut trimmed, outside the extracted subgraph, then the bp a record
 * break beside either side says the graph lacks, and the rest between, on
 * nodes filed elsewhere when either side goes on in a chunk the cut did not
 * read. A gap neither side states a stop for stays whole, with no cause.
 */
export function gapParts(
  bp: number,
  after: PathStop | undefined,
  before: PathStop | undefined,
): GapPart[] {
  if (!after && !before) {
    return [{ bp }]
  }
  const left = Math.min(after?.trimmed ?? 0, bp)
  const right = Math.min(before?.trimmed ?? 0, bp - left)
  let rest = bp - left - right
  const lead = after?.kind === 'break' ? Math.min(after.bp, rest) : 0
  rest -= lead
  const trail = before?.kind === 'break' ? Math.min(before.bp, rest) : 0
  rest -= trail
  const elsewhere = [after, before].find(s => s?.kind === 'elsewhere')
  const parts: GapPart[] = [
    { bp: left },
    { bp: lead, cause: 'missing' },
    elsewhere?.kind === 'elsewhere'
      ? { bp: rest, cause: 'elsewhere', chunk: elsewhere.chunk }
      : { bp: rest, cause: 'unknown' },
    { bp: trail, cause: 'missing' },
    { bp: right },
  ]
  return parts.filter(part => part.bp > 0)
}

// A PathStop per walk, as @jbrowse/graph-walks' tables hold it: `kinds`
// indexes `kindNames`, `bp` is NaN where the stop states none, `trimmed` is 0
// where it states none, and `chunkRefs` indexes `chunkRefNames`, -1 for none
export interface WalkStopTable {
  kinds: Uint8Array
  kindNames: string[]
  bp: Float64Array
  trimmed: Float64Array
  chunkRefs: Int32Array
  chunkStarts: Float64Array
  chunkRefNames: string[]
}

export function stopAt(table: WalkStopTable, i: number) {
  const bp = table.bp[i]!
  const ref = table.chunkRefs[i]!
  return stopOf(
    table.kindNames[table.kinds[i]!],
    Number.isNaN(bp) ? undefined : bp,
    table.trimmed[i]!,
    ref < 0
      ? undefined
      : { refName: table.chunkRefNames[ref]!, start: table.chunkStarts[i]! },
  )
}

// undefined for a kind this reader does not know, or one missing its fields
function stopOf(
  kind: string | undefined,
  bp: number | undefined,
  trimmed: number,
  chunk: StopChunk | undefined,
): PathStop | undefined {
  const cut = trimmed > 0 ? { trimmed } : {}
  if (kind === 'elsewhere' && chunk) {
    return { kind, chunk, ...(bp === undefined ? {} : { bp }), ...cut }
  }
  if (kind === 'break' && bp !== undefined) {
    return { kind, bp, ...(chunk ? { chunk } : {}), ...cut }
  }
  return kind === 'end' ? { kind, ...cut } : undefined
}

/**
 * A stop as a Z tag's value: its kind, then `bp=`, `trimmed=` and
 * `chunk=refName:start` where it states them, comma-joined:
 * `break,bp=19021`, `elsewhere,bp=34110,chunk=GRCh38#0#chr22:20316160`
 */
export function stopTag(stop: PathStop) {
  const parts: string[] = [stop.kind]
  if ('bp' in stop && stop.bp !== undefined) {
    parts.push(`bp=${stop.bp}`)
  }
  if (stop.trimmed) {
    parts.push(`trimmed=${stop.trimmed}`)
  }
  if ('chunk' in stop && stop.chunk) {
    parts.push(`chunk=${stop.chunk.refName}:${stop.chunk.start}`)
  }
  return parts.join(',')
}

// The stop a Z tag's value states, undefined for one this reader does not know
export function parseStopTag(value: string) {
  const [kind, ...fields] = value.split(',')
  let bp: number | undefined
  let trimmed = 0
  let chunk: StopChunk | undefined
  for (const field of fields) {
    if (field.startsWith('bp=')) {
      bp = +field.slice(3)
    } else if (field.startsWith('trimmed=')) {
      trimmed = +field.slice(8)
    } else if (field.startsWith('chunk=')) {
      const at = field.lastIndexOf(':')
      chunk = { refName: field.slice(6, at), start: +field.slice(at + 1) }
    }
  }
  return stopOf(kind, bp, trimmed, chunk)
}

export function stopFields(
  before: PathStop | undefined,
  after: PathStop | undefined,
) {
  return {
    ...(before ? { before } : {}),
    ...(after ? { after } : {}),
  }
}

// The stops a W line's tags state, as GraphPath holds them
export function walkStopFields(tags: Record<string, string | number>) {
  const before = tags[START_STOP_TAG]
  const after = tags[END_STOP_TAG]
  return stopFields(
    typeof before === 'string' ? parseStopTag(before) : undefined,
    typeof after === 'string' ? parseStopTag(after) : undefined,
  )
}

// A walk's W-line tags from the tables' columns, '' when they have none
export function walkStopTags(
  walks: { before?: WalkStopTable; after?: WalkStopTable },
  p: number,
) {
  const tags: string[] = []
  for (const [tag, table] of [
    [START_STOP_TAG, walks.before],
    [END_STOP_TAG, walks.after],
  ] as const) {
    const stop = table && stopAt(table, p)
    if (stop) {
      tags.push(`\t${tag}:Z:${stopTag(stop)}`)
    }
  }
  return tags.join('')
}

// Columns a reader fills a W line at a time
export class StopColumns {
  kinds: number[] = []
  bp: number[] = []
  trimmed: number[] = []
  chunkRefs: number[] = []
  chunkStarts: number[] = []
  chunkRefNames: string[] = []
  private refIndex = new Map<string, number>()

  push(stop: PathStop) {
    this.kinds.push(STOP_KINDS.indexOf(stop.kind))
    this.bp.push('bp' in stop && stop.bp !== undefined ? stop.bp : NaN)
    this.trimmed.push(stop.trimmed ?? 0)
    const chunk = 'chunk' in stop ? stop.chunk : undefined
    if (chunk) {
      let ref = this.refIndex.get(chunk.refName)
      if (ref === undefined) {
        ref = this.chunkRefNames.length
        this.refIndex.set(chunk.refName, ref)
        this.chunkRefNames.push(chunk.refName)
      }
      this.chunkRefs.push(ref)
      this.chunkStarts.push(chunk.start)
    } else {
      this.chunkRefs.push(-1)
      this.chunkStarts.push(NaN)
    }
  }

  table(): WalkStopTable {
    return {
      kinds: Uint8Array.from(this.kinds),
      kindNames: [...STOP_KINDS],
      bp: Float64Array.from(this.bp),
      trimmed: Float64Array.from(this.trimmed),
      chunkRefs: Int32Array.from(this.chunkRefs),
      chunkStarts: Float64Array.from(this.chunkStarts),
      chunkRefNames: this.chunkRefNames,
    }
  }
}
