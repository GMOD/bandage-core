import type { PassSpan } from './walkEncoding'
import type { WalkHighlight } from './walkHighlight'

// A walk's passes through the nodes it steps more than once, read off the walk
// alone. The first pass starts at the first node the walk steps again later; a
// new pass starts wherever the walk re-enters a node it has stepped during the
// pass it is on; a pass ends at its last step on a node the walk steps more
// than once. Only a step on such a node is on a pass:
// a node the walk steps once is on none, on a flank, between two passes or
// inside one.
//
// The walk does not say where a unit of a repeat starts, so a copy missing its
// first nodes shifts the boundaries after it (walkPasses.test.ts pins this).
export interface WalkPass {
  // bp from the walk's first base
  start: number
  end: number
  steps: number
  // bp of its steps on nodes the walk steps more than once
  repeatBp: number
  // of those, bp on nodes an earlier step of the walk read, and bp of that
  // read on the other strand than the walk first read it
  againBp: number
  reversedBp: number
  // most of what it reads again it reads on the other strand
  reversed: boolean
}

export interface WalkPasses {
  passes: WalkPass[]
  // beside each step of the route: the pass whose stretch holds it, and the
  // pass it is on, -1 for none
  withinPass: readonly Int32Array[]
  stepPass: readonly Int32Array[]
  // each node's pass at every visit, in walk order, -1 for none
  visitPass: Map<string, number[]>
  // stretches of consecutive steps on one pass, in bp from the walk's first
  // base
  runs: { pass: number; start: number; end: number }[]
  // more passes than take a thread and a colour each
  bundled: boolean
  // the passes were stated for a walk that steps no node twice here
  stated: boolean
}

// The most passes that each take a thread, a colour and a label of their own;
// a walk with more draws them in one colour under one count
export const MOST_PASS_THREADS = 6

type Stepped = Pick<
  WalkHighlight,
  'route' | 'routeStrands' | 'routeStarts' | 'passes'
>

function assemble(
  walk: Stepped,
  lengthOf: (id: string) => number,
  withinPass: readonly Int32Array[],
  count: number,
  onPass: (id: string) => boolean,
  stated: boolean,
): WalkPasses {
  const passes = Array.from({ length: count }, () => ({
    start: Infinity,
    end: -Infinity,
    steps: 0,
    repeatBp: 0,
    againBp: 0,
    reversedBp: 0,
  }))
  const stepPass = withinPass.map(piece => piece.slice())
  const visitPass = new Map<string, number[]>()
  const firstStrand = new Map<string, string>()
  const runs: WalkPasses['runs'] = []
  walk.route.forEach((piece, p) => {
    piece.forEach((id, i) => {
      const within = withinPass[p]![i]!
      const at = onPass(id) ? within : -1
      stepPass[p]![i] = at
      const from = walk.routeStarts[p]![i]!
      const bp = lengthOf(id)
      const run = runs.at(-1)
      if (at >= 0 && run?.pass === at && run.end === from) {
        run.end = from + bp
      } else if (at >= 0) {
        runs.push({ pass: at, start: from, end: from + bp })
      }
      const strand = walk.routeStrands[p]?.[i] ?? '+'
      const first = firstStrand.get(id)
      const visits = visitPass.get(id)
      if (visits) {
        visits.push(at)
      } else {
        visitPass.set(id, [at])
        firstStrand.set(id, strand)
      }
      const pass = passes[within]
      if (pass) {
        pass.start = Math.min(pass.start, from)
        pass.end = Math.max(pass.end, from + bp)
        pass.steps++
        pass.repeatBp += at >= 0 ? bp : 0
        pass.againBp += at >= 0 && first !== undefined ? bp : 0
        pass.reversedBp +=
          at >= 0 && first !== undefined && first !== strand ? bp : 0
      }
    })
  })
  return {
    passes: passes.map(pass => ({
      ...pass,
      reversed: pass.reversedBp * 2 > pass.againBp,
    })),
    withinPass,
    stepPass,
    visitPass,
    runs,
    bundled: count > MOST_PASS_THREADS,
    stated,
  }
}

export function passesOf(walk: Stepped, lengthOf: (id: string) => number) {
  const again = (id: string) => (walk.passes.get(id) ?? 0) > 1
  const withinPass = walk.route.map(piece =>
    new Int32Array(piece.length).fill(-1),
  )
  let pass = -1
  let stepped = new Set<string>()
  let pending: [number, number][] = []
  walk.route.forEach((piece, p) => {
    piece.forEach((id, i) => {
      if (again(id)) {
        if (pass < 0 || stepped.has(id)) {
          pass++
          stepped = new Set()
        } else {
          for (const [q, j] of pending) {
            withinPass[q]![j] = pass
          }
        }
        pending = []
        stepped.add(id)
        withinPass[p]![i] = pass
      } else if (pass >= 0) {
        pending.push([p, i])
      }
    })
  })
  return assemble(walk, lengthOf, withinPass, pass + 1, again, false)
}

// Passes a host states in the walk's own bp, as another graph of the same
// haplotype that folds its copies gives them: each step takes the span its
// middle falls in
export function statedPasses(
  walk: Stepped,
  lengthOf: (id: string) => number,
  spans: readonly PassSpan[],
) {
  const withinPass = walk.route.map((piece, p) =>
    Int32Array.from(piece, (id, i) => {
      const middle = walk.routeStarts[p]![i]! + lengthOf(id) / 2
      return spans.findIndex(s => middle >= s.start && middle < s.end)
    }),
  )
  return assemble(walk, lengthOf, withinPass, spans.length, () => true, true)
}

// The passes a lifted walk draws: detected where the walk steps a node again,
// else the ones its layer states
export function walkPassesOf(
  walk: Stepped,
  lengthOf: (id: string) => number,
  spans: readonly PassSpan[] | undefined,
) {
  const found = passesOf(walk, lengthOf)
  return found.passes.length === 0 && spans?.length
    ? statedPasses(walk, lengthOf, spans)
    : found
}
