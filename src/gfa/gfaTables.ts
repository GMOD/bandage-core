import type { GraphTables } from './graphTables'

const GT = 62 // '>'
const LT = 60 // '<'
const TAB = 9
const ZERO = 48
const NINE = 57
const TABLE_TAG = /^(?:LN:i|SN:Z|SO:i|SR:i):/
const UNTABLED_RECORD = /^[PEOUFG]\t/

const trimCR = (line: string) =>
  line.endsWith('\r') ? line.slice(0, -1) : line

// Growable step columns: a cut's step count is unknown until its last W line
class Steps {
  nodes = new Int32Array(1 << 16)
  reversed = new Uint8Array(1 << 16)
  length = 0

  push(node: number, reversed: number) {
    if (this.length === this.nodes.length) {
      const nodes = new Int32Array(this.length * 2)
      nodes.set(this.nodes)
      this.nodes = nodes
      const rev = new Uint8Array(this.length * 2)
      rev.set(this.reversed)
      this.reversed = rev
    }
    this.nodes[this.length] = node
    this.reversed[this.length++] = reversed
  }
}

class SegmentIndex {
  names: string[] = []
  private byName = new Map<string, number>()
  // ids that are plain decimal, so a walk step finds its segment without
  // slicing a string out of the body
  private byNumber = new Map<number, number>()

  has(name: string) {
    return this.byName.has(name)
  }

  add(name: string) {
    const i = this.names.length
    this.byName.set(name, i)
    this.names.push(name)
    const n = +name
    if (Number.isSafeInteger(n) && String(n) === name) {
      this.byNumber.set(n, i)
    }
    return i
  }

  of(name: string) {
    return this.byName.get(name) ?? this.add(name)
  }

  ofNumber(n: number) {
    return this.byNumber.get(n)
  }
}

function readSegment(line: string) {
  const [, name, sequence = '*', ...tags] = line.split('\t')
  // a GFA2 S line states a length where GFA1 has the sequence
  if (!name || /^\d+$/.test(sequence)) {
    return undefined
  }
  let length = sequence === '*' ? 0 : sequence.length
  let refName: string | undefined
  let start: number | undefined
  let rank: number | undefined
  for (const tag of tags) {
    if (!TABLE_TAG.test(tag)) {
      return undefined
    }
    const value = tag.slice(5)
    const key = tag.slice(0, 2)
    if (key === 'LN') {
      length = +value
    } else if (key === 'SN') {
      refName = value
    } else if (key === 'SO') {
      start = +value
    } else {
      rank = +value
    }
  }
  const stable =
    refName !== undefined && start !== undefined && rank !== undefined
      ? { refName, start, rank }
      : undefined
  return { name, length, stable }
}

// `>s1<s2…` from `from` to the line's end or next tab, each step's id read
// as a number when it is one
function readWalkBody(
  line: string,
  from: number,
  segments: SegmentIndex,
  steps: Steps,
) {
  let reversed = 0
  let start = -1
  let value = 0
  let decimal = true
  const finish = (end: number) => {
    if (start >= 0 && end > start) {
      const node =
        decimal &&
        end - start < 16 &&
        (end - start === 1 || line.charCodeAt(start) !== ZERO)
          ? segments.ofNumber(value)
          : undefined
      steps.push(node ?? segments.of(line.slice(start, end)), reversed)
    }
  }
  let i = from
  for (; i < line.length; i++) {
    const ch = line.charCodeAt(i)
    if (ch === GT || ch === LT) {
      finish(i)
      reversed = ch === LT ? 1 : 0
      start = i + 1
      value = 0
      decimal = true
    } else if (ch === TAB) {
      break
    } else if (decimal && ch >= ZERO && ch <= NINE) {
      value = value * 10 + ch - ZERO
    } else {
      decimal = false
    }
  }
  finish(i)
}

// The first six tab-separated fields of a W line and where its body starts
function walkFields(line: string) {
  const fields: string[] = []
  let at = 0
  while (fields.length < 6) {
    const tab = line.indexOf('\t', at)
    if (tab === -1) {
      return undefined
    }
    fields.push(line.slice(at, tab))
    at = tab + 1
  }
  const [, sample, haplotype, contig, start, end] = fields
  return sample && haplotype && contig && start && end && at < line.length
    ? { sample, haplotype, contig, start, end, body: at }
    : undefined
}

/**
 * The tables a GFA of S, L and W lines stands for, which `graphFromTables`
 * turns into the Graph `convertGFAToGraph` makes of the text. No string or
 * object is made per walk step: a gbz-base cut of every haplotype is millions
 * of steps, which the text route took seconds over. Undefined for a GFA the
 * tables cannot hold (P or GFA2 records, a segment declared twice, an S tag
 * other than LN/SN/SO/SR), which converts as text instead.
 */
export function gfaTables(text: string): GraphTables | undefined {
  const lines = text.split('\n')
  const segments = new SegmentIndex()
  const lengths: number[] = []
  const refs: number[] = []
  const starts: number[] = []
  const ranks: number[] = []
  const refNames: string[] = []
  const refIndex = new Map<string, number>()
  // every S line first, so declared segments take the first indexes whatever
  // order the file writes its records in
  for (const raw of lines) {
    if (UNTABLED_RECORD.test(raw)) {
      return undefined
    }
    if (raw.startsWith('S\t')) {
      const s = readSegment(trimCR(raw))
      if (!s || segments.has(s.name)) {
        return undefined
      }
      segments.add(s.name)
      lengths.push(s.length)
      let ref = -1
      if (s.stable) {
        ref = refIndex.get(s.stable.refName) ?? refNames.length
        if (ref === refNames.length) {
          refNames.push(s.stable.refName)
          refIndex.set(s.stable.refName, ref)
        }
      }
      refs.push(ref)
      starts.push(s.stable?.start ?? 0)
      ranks.push(s.stable?.rank ?? 0)
    }
  }

  const from: number[] = []
  const to: number[] = []
  const strands: number[] = []
  const names: string[] = []
  const walkStarts: number[] = []
  const walkEnds: number[] = []
  const offsets = [0]
  const steps = new Steps()
  for (const raw of lines) {
    if (raw.startsWith('L\t')) {
      const [, source, strand1, target, strand2] = trimCR(raw).split('\t')
      if (source && target && strand2) {
        from.push(segments.of(source))
        to.push(segments.of(target))
        strands.push((strand1 === '-' ? 1 : 0) | (strand2 === '-' ? 2 : 0))
      }
    } else if (raw.startsWith('W\t')) {
      const line = trimCR(raw)
      const w = walkFields(line)
      if (w) {
        names.push(`${w.sample}#${w.haplotype}#${w.contig}`)
        walkStarts.push(w.start === '*' ? 0 : +w.start)
        walkEnds.push(w.end === '*' ? -1 : +w.end)
        readWalkBody(line, w.body, segments, steps)
        // a stepless walk is still a path to the text route, and no row here
        if (steps.length === offsets.at(-1)) {
          return undefined
        }
        offsets.push(steps.length)
      }
    }
  }

  return {
    nodes: {
      names: segments.names,
      lengths: Int32Array.from(lengths),
      refs: Int32Array.from(refs),
      starts: Float64Array.from(starts),
      ranks: Int32Array.from(ranks),
      refNames,
    },
    links: {
      from: Int32Array.from(from),
      to: Int32Array.from(to),
      strands: Uint8Array.from(strands),
    },
    walks: {
      names,
      starts: Float64Array.from(walkStarts),
      ends: Float64Array.from(walkEnds),
      offsets: Int32Array.from(offsets),
      steps: steps.nodes.slice(0, steps.length),
      reversed: steps.reversed.slice(0, steps.length),
    },
  }
}
