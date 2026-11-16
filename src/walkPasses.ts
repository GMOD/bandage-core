import { formatBp } from './graphLabels'
import { abgrHex, hexAbgr } from './renderer/colorBits'
import { passPalette } from './walkEncoding'

import type { PassSpan } from './walkEncoding'
import type { RouteStep, WalkHighlight } from './walkHighlight'

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

type Stepped = Pick<WalkHighlight, 'routeSteps' | 'passes'>

type Placed = RouteStep & { within: number }

function assemble(
  placed: readonly (readonly Placed[])[],
  lengthOf: (id: string) => number,
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
  const visitPass = new Map<string, number[]>()
  const firstStrand = new Map<string, string>()
  const runs: WalkPasses['runs'] = []
  const stepPass = placed.map(piece =>
    Int32Array.from(piece, ({ id, strand, start, within }) => {
      const at = onPass(id) ? within : -1
      const bp = lengthOf(id)
      const run = runs.at(-1)
      if (at >= 0 && run?.pass === at && run.end === start) {
        run.end = start + bp
      } else if (at >= 0) {
        runs.push({ pass: at, start, end: start + bp })
      }
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
        pass.start = Math.min(pass.start, start)
        pass.end = Math.max(pass.end, start + bp)
        pass.steps++
        pass.repeatBp += at >= 0 ? bp : 0
        pass.againBp += at >= 0 && first !== undefined ? bp : 0
        pass.reversedBp +=
          at >= 0 && first !== undefined && first !== strand ? bp : 0
      }
      return at
    }),
  )
  return {
    passes: passes.map(pass => ({
      ...pass,
      reversed: pass.reversedBp * 2 > pass.againBp,
    })),
    withinPass: placed.map(piece => Int32Array.from(piece, s => s.within)),
    stepPass,
    visitPass,
    runs,
    bundled: count > MOST_PASS_THREADS,
    stated,
  }
}

export function passesOf(walk: Stepped, lengthOf: (id: string) => number) {
  const again = (id: string) => (walk.passes.get(id) ?? 0) > 1
  const placed = walk.routeSteps.map(piece =>
    piece.map(step => ({ ...step, within: -1 })),
  )
  let pass = -1
  let stepped = new Set<string>()
  let pending: Placed[] = []
  for (const piece of placed) {
    for (const step of piece) {
      if (again(step.id)) {
        if (pass < 0 || stepped.has(step.id)) {
          pass++
          stepped = new Set()
        } else {
          for (const between of pending) {
            between.within = pass
          }
        }
        pending = []
        stepped.add(step.id)
        step.within = pass
      } else if (pass >= 0) {
        pending.push(step)
      }
    }
  }
  return assemble(placed, lengthOf, pass + 1, again, false)
}

// Passes a host states in the walk's own bp, as another graph of the same
// haplotype that folds its copies gives them: each step takes the span its
// middle falls in
export function statedPasses(
  walk: Stepped,
  lengthOf: (id: string) => number,
  spans: readonly PassSpan[],
) {
  const placed = walk.routeSteps.map(piece =>
    piece.map(step => {
      const middle = step.start + lengthOf(step.id) / 2
      return {
        ...step,
        within: spans.findIndex(s => middle >= s.start && middle < s.end),
      }
    }),
  )
  return assemble(placed, lengthOf, spans.length, () => true, true)
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

// A lifted walk's pass as it is drawn: its name on the graph, its title in
// the key and along the bar, which adds the bp it steps again, and its ink;
// bundled passes share one of each
export interface LiftedPass extends WalkPass {
  label: string
  title: string
  ink: number
}

export interface LiftedPasses extends Omit<WalkPasses, 'passes'> {
  passes: LiftedPass[]
  ownInk: number
}

// `lanes` are the other lifted walks' lane colours and `taken` the pass
// colours of the walks lifted before this one, as hex
export function liftedPasses(
  found: WalkPasses,
  ownInk: number,
  names: readonly string[] = [],
  lanes: readonly string[] = [],
  taken: readonly string[] = [],
): LiftedPasses {
  const { passes, bundled } = found
  const inks = passPalette(
    abgrHex(ownInk),
    bundled ? 1 : passes.length,
    lanes,
    taken,
  ).map(hexAbgr)
  const bundle = `${passes.length} passes`
  return {
    ...found,
    passes: passes.map((pass, i) => {
      const label = bundled ? bundle : (names[i] ?? `pass ${i + 1}`)
      return {
        ...pass,
        label,
        title: bundled ? bundle : `${label} · ${formatBp(pass.repeatBp)}`,
        ink: inks[bundled ? 0 : i] ?? ownInk,
      }
    }),
    ownInk,
  }
}

// The ink of a visit on pass `pass`, -1 for none
export const passInk = (drawn: LiftedPasses, pass: number) =>
  drawn.passes[pass]?.ink ?? drawn.ownInk
