import type { PathVisit } from './types'

/**
 * Every visit each path makes to each segment, as columns rather than an
 * object per visit: a gbz-base cut of every haplotype is millions of them.
 * A segment's visits are contiguous and in walk order, and segments iterate in
 * the order they were first visited. Reads as a map from segment name to its
 * visits, each built when asked for; a pass over every segment reads the
 * columns instead.
 */
export class PathVisits {
  readonly segments: string[]
  // segment s's visits are offsets[s] up to offsets[s + 1]
  readonly offsets: Int32Array
  // per visit, an index into `paths`
  readonly path: Int32Array
  readonly start: Float64Array
  readonly reversed: Uint8Array
  readonly paths: string[]
  // per path, its PanSN sample
  readonly samples: string[]
  private readonly slots: Map<string, number>

  constructor(columns: {
    segments: string[]
    offsets: Int32Array
    path: Int32Array
    start: Float64Array
    reversed: Uint8Array
    paths: string[]
    samples: string[]
  }) {
    this.segments = columns.segments
    this.offsets = columns.offsets
    this.path = columns.path
    this.start = columns.start
    this.reversed = columns.reversed
    this.paths = columns.paths
    this.samples = columns.samples
    this.slots = new Map(this.segments.map((s, i) => [s, i]))
  }

  static from(entries: Iterable<readonly [string, readonly PathVisit[]]>) {
    const builder = new PathVisitsBuilder()
    for (const [segment, visits] of entries) {
      builder.declare(segment)
      for (const v of visits) {
        builder.add(segment, v.path, v.sample, v.start, v.strand === '-')
      }
    }
    return builder.build()
  }

  get size() {
    return this.segments.length
  }

  // the segment's index into `segments` and `offsets`, -1 when unvisited
  slot(segment: string): number {
    return this.slots.get(segment) ?? -1
  }

  pathIndex(path: string): number {
    return this.paths.indexOf(path)
  }

  // the first of `slot`'s visits by path `p`, -1 for none
  firstBy(slot: number, p: number): number {
    for (let i = this.offsets[slot]!; i < this.offsets[slot + 1]!; i++) {
      if (this.path[i] === p) {
        return i
      }
    }
    return -1
  }

  // Paths' steps replayed in walk order against their visits: the k-th call
  // for one path and segment answers that path's k-th visit there, -1 past
  // its last. A walk in pieces lists its pieces in path order, so replaying
  // the pieces in order reads each step's own visit.
  replay() {
    const cursor = new Map<number, number>()
    return (slot: number, p: number) => {
      if (slot < 0 || p < 0) {
        return -1
      }
      const key = slot * this.paths.length + p
      const end = this.offsets[slot + 1]!
      let at = cursor.get(key) ?? this.offsets[slot]!
      while (at < end && this.path[at] !== p) {
        at++
      }
      cursor.set(key, at + 1)
      return at < end ? at : -1
    }
  }

  // the visits of paths `keepPath` accepts, at segments `keepSegment` does
  filter(
    keepPath: (path: string) => boolean,
    keepSegment: (segment: string) => boolean = () => true,
  ) {
    const kept = this.paths.map(keepPath)
    const builder = new PathVisitsBuilder()
    this.segments.forEach((segment, s) => {
      if (!keepSegment(segment)) {
        return
      }
      const slot = builder.declare(segment)
      for (let i = this.offsets[s]!; i < this.offsets[s + 1]!; i++) {
        const p = this.path[i]!
        if (kept[p]) {
          builder.addAt(
            slot,
            builder.pathOf(this.paths[p]!, this.samples[p]!),
            this.start[i]!,
            this.reversed[i] === 1,
          )
        }
      }
    })
    return builder.build()
  }

  strand(i: number): '+' | '-' {
    return this.reversed[i] ? '-' : '+'
  }

  visit(i: number): PathVisit {
    const p = this.path[i]!
    return {
      path: this.paths[p]!,
      sample: this.samples[p]!,
      start: this.start[i]!,
      strand: this.strand(i),
    }
  }

  private visitsAt(slot: number) {
    const out: PathVisit[] = []
    for (let i = this.offsets[slot]!; i < this.offsets[slot + 1]!; i++) {
      out.push(this.visit(i))
    }
    return out
  }

  get(segment: string) {
    const slot = this.slot(segment)
    return slot < 0 ? undefined : this.visitsAt(slot)
  }

  has(segment: string) {
    return this.slots.has(segment)
  }

  keys() {
    return this.segments[Symbol.iterator]()
  }

  *values() {
    for (let s = 0; s < this.segments.length; s++) {
      yield this.visitsAt(s)
    }
  }

  *entries(): Generator<[string, PathVisit[]]> {
    for (let s = 0; s < this.segments.length; s++) {
      yield [this.segments[s]!, this.visitsAt(s)]
    }
  }

  [Symbol.iterator]() {
    return this.entries()
  }
}

// Growable typed columns
class Column<T extends Int32Array | Float64Array | Uint8Array> {
  length = 0
  constructor(public data: T) {}

  push(value: number) {
    if (this.length === this.data.length) {
      const grown = new (this.data.constructor as new (n: number) => T)(
        this.data.length * 2,
      )
      grown.set(this.data)
      this.data = grown
    }
    this.data[this.length++] = value
  }
}

/**
 * Visits added in any order, grouped by segment on `build`, each segment's
 * keeping the order they were added in
 */
export class PathVisitsBuilder {
  private segments: string[] = []
  private slots = new Map<string, number>()
  private paths: string[] = []
  private samples: string[] = []
  private pathIndex = new Map<string, number>()
  private slot = new Column(new Int32Array(1024))
  private path = new Column(new Int32Array(1024))
  private start = new Column(new Float64Array(1024))
  private reversed = new Column(new Uint8Array(1024))

  // a segment's place in iteration order, though it has no visits yet
  declare(segment: string) {
    let s = this.slots.get(segment)
    if (s === undefined) {
      s = this.segments.length
      this.slots.set(segment, s)
      this.segments.push(segment)
    }
    return s
  }

  // a path's index, so a caller adding many of its visits names it once
  pathOf(path: string, sample: string) {
    let p = this.pathIndex.get(path)
    if (p === undefined) {
      p = this.paths.length
      this.pathIndex.set(path, p)
      this.paths.push(path)
      this.samples.push(sample)
    }
    return p
  }

  add(
    segment: string,
    path: string,
    sample: string,
    start: number,
    reversed: boolean,
  ) {
    this.addAt(
      this.declare(segment),
      this.pathOf(path, sample),
      start,
      reversed,
    )
  }

  addAt(slot: number, path: number, start: number, reversed: boolean) {
    this.slot.push(slot)
    this.path.push(path)
    this.start.push(start)
    this.reversed.push(reversed ? 1 : 0)
  }

  build() {
    const n = this.slot.length
    const segments = this.segments.length
    const offsets = new Int32Array(segments + 1)
    const slot = this.slot.data
    for (let i = 0; i < n; i++) {
      offsets[slot[i]! + 1]!++
    }
    for (let s = 0; s < segments; s++) {
      offsets[s + 1]! += offsets[s]!
    }
    const fill = offsets.slice(0, segments)
    const path = new Int32Array(n)
    const start = new Float64Array(n)
    const reversed = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      const at = fill[slot[i]!]!++
      path[at] = this.path.data[i]!
      start[at] = this.start.data[i]!
      reversed[at] = this.reversed.data[i]!
    }
    return new PathVisits({
      segments: this.segments,
      offsets,
      path,
      start,
      reversed,
      paths: this.paths,
      samples: this.samples,
    })
  }
}
