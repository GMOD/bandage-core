import type { PathStop } from '../types'

// W-line tags a walk-file cut writes: the fragment's W record start on the
// contig, and why the fragment stops at its start and at its end
export const FRAG_START_TAG = 'fs'
export const START_STOP_TAG = 'ws'
export const END_STOP_TAG = 'we'

// The kinds a PathStop names, coded by index, as @jbrowse/graph-walks codes
// its WalkStop
export const WALK_STOP_KINDS = [
  'window',
  'elsewhere',
  'break',
  'end',
  'recordEnd',
] as const

// A PathStop per walk: its kind's index in WALK_STOP_KINDS, `bp` NaN where the
// stop states none, and the chunk as an index into `chunkRefNames`, -1 for none
export interface WalkStopTable {
  kinds: Uint8Array
  bp: Float64Array
  chunkRefs: Int32Array
  chunkStarts: Float64Array
  chunkRefNames: string[]
}

export function stopAt(table: WalkStopTable, i: number): PathStop {
  const kind = WALK_STOP_KINDS[table.kinds[i]!] ?? 'recordEnd'
  const bp = table.bp[i]!
  const ref = table.chunkRefs[i]!
  const chunk =
    ref < 0
      ? undefined
      : { refName: table.chunkRefNames[ref]!, start: table.chunkStarts[i]! }
  return withStopFields(kind, Number.isNaN(bp) ? undefined : bp, chunk)
}

function withStopFields(
  kind: PathStop['kind'],
  bp: number | undefined,
  chunk: { refName: string; start: number } | undefined,
): PathStop {
  if (kind === 'elsewhere' && chunk) {
    return bp === undefined ? { kind, chunk } : { kind, chunk, bp }
  }
  if (kind === 'break' && bp !== undefined) {
    return chunk ? { kind, bp, chunk } : { kind, bp }
  }
  return kind === 'window' || kind === 'end' ? { kind } : { kind: 'recordEnd' }
}

/**
 * A stop as a Z tag's value: its kind, then `bp=` and `chunk=refName:start`
 * where it states them, comma-joined: `break,bp=19021`,
 * `elsewhere,bp=34110,chunk=GRCh38#0#chr22:20316160`
 */
export function stopTag(stop: PathStop) {
  const parts: string[] = [stop.kind]
  if ('bp' in stop && stop.bp !== undefined) {
    parts.push(`bp=${stop.bp}`)
  }
  if ('chunk' in stop && stop.chunk) {
    parts.push(`chunk=${stop.chunk.refName}:${stop.chunk.start}`)
  }
  return parts.join(',')
}

// The stop a Z tag's value states, undefined for one this reader does not know
export function parseStopTag(value: string): PathStop | undefined {
  const [kind, ...fields] = value.split(',')
  if (!WALK_STOP_KINDS.includes(kind as PathStop['kind'])) {
    return undefined
  }
  let bp: number | undefined
  let chunk: { refName: string; start: number } | undefined
  for (const field of fields) {
    if (field.startsWith('bp=')) {
      bp = +field.slice(3)
    } else if (field.startsWith('chunk=')) {
      const at = field.lastIndexOf(':')
      chunk = { refName: field.slice(6, at), start: +field.slice(at + 1) }
    }
  }
  return withStopFields(kind as PathStop['kind'], bp, chunk)
}

// The fragment fields a W line's tags state, as GraphPath holds them
export function walkStopFields(tags: Record<string, string | number>) {
  const fragStart = tags[FRAG_START_TAG]
  const before = tags[START_STOP_TAG]
  const after = tags[END_STOP_TAG]
  return stopFields(
    typeof fragStart === 'number' ? fragStart : undefined,
    typeof before === 'string' ? parseStopTag(before) : undefined,
    typeof after === 'string' ? parseStopTag(after) : undefined,
  )
}

export function stopFields(
  fragStart: number | undefined,
  before: PathStop | undefined,
  after: PathStop | undefined,
) {
  return {
    ...(fragStart === undefined ? {} : { fragStart }),
    ...(before ? { before } : {}),
    ...(after ? { after } : {}),
  }
}

// A walk's W-line tags from the tables' columns, '' when they have none
export function walkStopTags(
  walks: {
    fragStarts?: Float64Array
    before?: WalkStopTable
    after?: WalkStopTable
  },
  p: number,
) {
  const tags: string[] = []
  if (walks.fragStarts) {
    tags.push(`${FRAG_START_TAG}:i:${walks.fragStarts[p]}`)
  }
  if (walks.before) {
    tags.push(`${START_STOP_TAG}:Z:${stopTag(stopAt(walks.before, p))}`)
  }
  if (walks.after) {
    tags.push(`${END_STOP_TAG}:Z:${stopTag(stopAt(walks.after, p))}`)
  }
  return tags.map(t => `\t${t}`).join('')
}

// Columns a reader fills a W line at a time
export class StopColumns {
  kinds: number[] = []
  bp: number[] = []
  chunkRefs: number[] = []
  chunkStarts: number[] = []
  chunkRefNames: string[] = []
  private refIndex = new Map<string, number>()

  push(stop: PathStop | undefined) {
    const kind = stop ? stop.kind : 'recordEnd'
    this.kinds.push(WALK_STOP_KINDS.indexOf(kind))
    this.bp.push(stop && 'bp' in stop && stop.bp !== undefined ? stop.bp : NaN)
    const chunk = stop && 'chunk' in stop ? stop.chunk : undefined
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
      bp: Float64Array.from(this.bp),
      chunkRefs: Int32Array.from(this.chunkRefs),
      chunkStarts: Float64Array.from(this.chunkStarts),
      chunkRefNames: this.chunkRefNames,
    }
  }
}
