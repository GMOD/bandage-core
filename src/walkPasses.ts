import { formatBp } from './graphLabels'
import { abgrHex, hexAbgr } from './renderer/colorBits'
import { pushTo } from './util/groups'
import { passPalette } from './walkEncoding'

import type { PassSpan } from './walkEncoding'
import type { RouteStep, WalkHighlight } from './walkHighlight'

export interface WalkPass {
  // bp from the walk's first base
  start: number
  end: number
  steps: number
  repeatBp: number
  againBp: number
  // against the walk's first read of each node
  reversedBp: number
  reversed: boolean
}

export interface WalkPasses {
  passes: WalkPass[]
  // -1 for none
  withinPass: readonly Int32Array[]
  stepPass: readonly Int32Array[]
  visitPass: Map<string, number[]>
  runs: { pass: number; start: number; end: number }[]
  bundled: boolean
  stated: boolean
}

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
      pushTo(visitPass, id, at)
      if (first === undefined) {
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

// each step takes the stated span its middle falls in
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

export interface LiftedPass extends WalkPass {
  label: string
  title: string
  ink: number
}

export interface LiftedPasses extends Omit<WalkPasses, 'passes'> {
  passes: LiftedPass[]
  ownInk: number
}

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

export const passInk = (drawn: LiftedPasses, pass: number) =>
  drawn.passes[pass]?.ink ?? drawn.ownInk
