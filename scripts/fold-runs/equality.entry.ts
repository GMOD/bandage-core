// Holds a fold read from runs equal to the fold of the same window's cut, on
// a walk file: graph-walks' `WalkReader.runs` then foldThreadRuns against
// `cutRegion`, loadGraph and foldThreads, both with the walks' ends, by
// drawn() and by the ordered figure. Mutants broken at the seam between the
// runs and graph-fold's input must each fail that equality.
//
//   node_modules/.bin/esbuild scripts/fold-runs/equality.entry.ts --bundle \
//     --format=esm --platform=node --outfile=/tmp/fold-runs.mjs
//   node /tmp/fold-runs.mjs <walks.gz> <chr:start-end>[,...]
//     [--presets browser,contained] [--bp 236,1000]
//     [--path both|steps|runs|before] [--mutants] [--figures <dir>]
//
// `--path steps`, `runs` or `before` folds one way alone, for its time, its
// peak memory and the bytes it reads; `before` is the steps path without
// ends, as 14.9.0 folds. Prints a JSON line per window, preset and threshold
// and exits 1 on any difference or any mutant that passes.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { foldRuns } from '@jbrowse/graph-fold'
import { CUT_PRESETS, WalkReader } from '@jbrowse/graph-walks'
import { LocalFile } from 'generic-filehandle2'

import { loadGraph } from '../../src/pipeline'
import { foldThreads } from '../../src/threadFold'
import {
  foldThreadRuns,
  foldThreadRunsInput,
  threadRunsInput,
} from '../../src/threadFoldRuns'
import { drawn, firstDifference, orderedFigure } from './drawn'

import type { WalkRunsTables } from '../../src/gfa/walkRuns'
import type { Graph } from '../../src/types'

const [path = '', windowList = '', ...rest] = process.argv.slice(2)
const flag = (name: string) => {
  const at = rest.indexOf(`--${name}`)
  return at < 0 ? undefined : rest[at + 1]
}
const presets = (flag('presets') ?? 'browser,contained').split(',')
const thresholds = (flag('bp') ?? '236,1000').split(',').map(Number)
const mode = flag('path') ?? 'both'
const figures = flag('figures')
const withMutants = rest.includes('--mutants')

let bytesRead = 0
class CountedFile extends LocalFile {
  override async read(length: number, position: number) {
    bytesRead += length
    return super.read(length, position)
  }
}
const openReader = () => WalkReader.open(path, url => new CountedFile(url))

const now = () => performance.now() / 1000
const peakMB = () => Math.round(process.resourceUsage().maxRSS / 1024)
const print = (record: object) => {
  process.stdout.write(`${JSON.stringify(record)}\n`)
}

const parseWindow = (text: string) => {
  const [refName = '', span = ''] = text.split(':')
  const [start = 0, end = 0] = span.replaceAll(',', '').split('-').map(Number)
  return { refName, start, end }
}

const NO_LIMITS = {
  stepBudget: Infinity,
  byteBudget: Infinity,
  departureByteBudget: Infinity,
  nodeLimit: Infinity,
  placeholderLimit: Infinity,
}

const presetOptions = (preset: string) =>
  preset === 'contained'
    ? { context: 1000, contained: true }
    : { context: CUT_PRESETS.browser.context, contained: false }

const withoutEnds = (graph: Graph): Graph => ({
  ...graph,
  paths: graph.paths?.map(path => ({ ...path, ends: undefined })),
})

// the steps path as a host cutting the window takes it
async function cutGraph(
  reader: WalkReader,
  region: ReturnType<typeof parseWindow>,
  preset: string,
) {
  const { tables } = await reader.cutRegion(region, {
    ...CUT_PRESETS.browser,
    ...NO_LIMITS,
    ...presetOptions(preset),
  })
  return loadGraph(
    tables,
    `${region.refName}:${region.start}-${region.end}`,
  )
}

async function readRuns(
  reader: WalkReader,
  region: ReturnType<typeof parseWindow>,
  preset: string,
) {
  const { runs } = await reader.runsRegion(region, {
    byteBudget: Infinity,
    departureByteBudget: Infinity,
    ...presetOptions(preset),
  })
  return runs
}

type Read = ReturnType<typeof threadRunsInput>
type Ready = Extract<Read, { input: unknown }>

// every end's kind moved `by` along END_KINDS, wrapping
function shiftKinds({ ends, tracks }: Ready['input'], by: number) {
  const shift = (kinds: ArrayLike<number> | ArrayLike<string>) =>
    Uint8Array.from({ length: kinds.length }, (_, i) => {
      const kind = kinds[i]
      return typeof kind === 'number' ? (kind + by) % 4 : 0
    })
  if (ends) {
    ends.before = { ...ends.before, kinds: shift(ends.before.kinds) }
    ends.after = { ...ends.after, kinds: shift(ends.after.kinds) }
  }
  return tracks.length > 0
}

// Each mutant breaks the runs' hand-off to graph-fold one way
const MUTANTS: Record<string, (read: Ready) => boolean> = {
  leadDropped: ({ input }) => {
    const changed = input.leadBp.some(bp => bp > 0)
    input.leadBp = new Float64Array(input.leadBp.length)
    return changed
  },
  kindsOffByOne: ({ input }) => shiftKinds(input, 1),
  kindsOffByOneDown: ({ input }) => shiftKinds(input, 3),
  againstInverted: ({ input }) => {
    input.stretches = {
      ...input.stretches,
      against: Uint8Array.from(
        { length: input.stretches.against.length },
        (_, k) => (input.stretches.against[k] === 1 ? 0 : 1),
      ),
    }
    return input.stretches.against.length > 0
  },
  // one of two walks of a haplotype that share a thread or a branch given
  // another haplotype's, which changes a count; a swap between walks that
  // share nothing counts the same
  haplotypeSwapped: ({ input, walks }) => {
    const fold = foldRuns(input, { threshold: 236, cluster: true })
    const trackOf = fold.walks.map(walk => walk.track)
    const together = (i: number, j: number) =>
      trackOf[i] === trackOf[j] ||
      fold.branches.some(
        branch =>
          branch.tracks.includes(trackOf[i]!) &&
          branch.tracks.includes(trackOf[j]!),
      )
    const { tracks } = input
    const a = tracks.findIndex((t, i) =>
      tracks.some((u, j) => j !== i && u.haplotype === t.haplotype && together(i, j)),
    )
    const b = tracks.findIndex(t => t.haplotype !== tracks[a]?.haplotype)
    const found = a >= 0 && b >= 0
    if (found) {
      const [ta, tb] = [tracks[a]!, tracks[b]!]
      tracks[a] = { ...ta, haplotype: tb.haplotype }
      tracks[b] = { ...tb, haplotype: ta.haplotype }
      walks[a + 1] = tracks[a]
      walks[b + 1] = tracks[b]
    }
    return found
  },
}

const failures: string[] = []

async function both(
  region: ReturnType<typeof parseWindow>,
  preset: string,
  where: string,
) {
  const t0 = now()
  const graph = await cutGraph(openReader(), region, preset)
  const tCut = now() - t0
  const t1 = now()
  const runs = await readRuns(openReader(), region, preset)
  const tRuns = now() - t1
  const departing = [...new Set(graph.departures?.names ?? [])]
  const fragments = new Set(runs.walks.names)
  for (const bp of thresholds) {
    const label = `${where} ${preset} ${bp}`
    const steps = foldThreads(graph, bp)
    const before = foldThreads(withoutEnds(graph), bp)
    const fromRuns = foldThreadRuns(runs, bp, { name: graph.name })
    const record: Record<string, unknown> = {
      where,
      preset,
      bp,
      cutS: tCut,
      runsS: tRuns,
      folded: [steps.folded, fromRuns.folded],
      departing: departing.length,
      departingWithoutFragment: departing.filter(n => !fragments.has(n))
        .length,
    }
    if (steps.folded && fromRuns.folded) {
      const a = drawn(steps.graph, steps.events)
      const b = drawn(fromRuns.graph, fromRuns.events)
      const drawnDiff = firstDifference(a, b)
      const figureEqual =
        orderedFigure(steps.graph) === orderedFigure(fromRuns.graph)
      record.nodes = steps.graph.nodes.length
      record.edges = steps.graph.edges.length
      record.threads = steps.graph.paths?.length
      record.events = steps.events.length
      record.drawnEqual = drawnDiff === undefined
      record.drawnDiff = drawnDiff
      record.figureEqual = figureEqual
      record.walksEqual =
        JSON.stringify(steps.walks) === JSON.stringify(fromRuns.walks)
      if (drawnDiff !== undefined || !figureEqual || !record.walksEqual) {
        failures.push(label)
      }
      const kinds = (events: { text: string }[]) => {
        const counts: Record<string, number> = {}
        for (const { text } of events) {
          const key = text.includes('continues past the window')
            ? 'continues past the window'
            : text.includes('inside the window')
              ? text.replace(/^.*?(walk (starts|ends) inside the window).*$/, '$1')
              : text.includes('outside the window')
                ? 'joins outside the window'
                : 'other'
          counts[key] = (counts[key] ?? 0) + 1
        }
        return counts
      }
      record.before = before.folded
        ? {
            nodes: before.graph.nodes.length,
            edges: before.graph.edges.length,
            threads: before.graph.paths?.length,
            events: kinds(before.events),
          }
        : { reason: before.reason }
      record.after = kinds(steps.events)
      if (withMutants) {
        record.mutants = Object.fromEntries(
          Object.entries(MUTANTS).map(([name, mutate]) => {
            const read = threadRunsInput(runs)
            const ready = 'input' in read ? read : undefined
            const applies = ready ? mutate(ready) : false
            const broken = foldThreadRunsInput(read, bp, { name: graph.name })
            const difference = broken.folded
              ? firstDifference(a, drawn(broken.graph, broken.events))
              : `refused: ${broken.reason}`
            if (applies && difference === undefined) {
              failures.push(`${label} mutant ${name}`)
            }
            return [
              name,
              applies
                ? (difference?.slice(0, 200) ?? 'PASSES')
                : 'does not apply',
            ]
          }),
        )
      }
      if (figures && bp === thresholds[0] && preset === presets[0]) {
        const stem = join(figures, where.replaceAll(/[:,]/g, '_'))
        writeFileSync(
          `${stem}-before.svg`,
          before.folded ? orderedFigure(before.graph) : '',
        )
        writeFileSync(`${stem}-after.svg`, orderedFigure(fromRuns.graph))
      }
    } else if (steps.folded !== fromRuns.folded) {
      failures.push(label)
      record.reasons = [
        steps.folded ? undefined : steps.reason,
        fromRuns.folded ? undefined : fromRuns.reason,
      ]
    } else {
      record.reasons = [steps.reason, fromRuns.reason]
    }
    print(record)
  }
}

async function alone(
  region: ReturnType<typeof parseWindow>,
  preset: string,
  where: string,
) {
  const reader = openReader()
  const t0 = now()
  const folds = []
  if (mode === 'runs') {
    const runs: WalkRunsTables = await readRuns(reader, region, preset)
    const tRead = now() - t0
    for (const bp of thresholds) {
      const t1 = now()
      const fold = foldThreadRuns(runs, bp)
      folds.push({ bp, foldS: now() - t1, folded: fold.folded })
    }
    print({ where, preset, path: mode, readS: tRead, folds, bytes: bytesRead, peakMB: peakMB() })
  } else {
    const cut = await cutGraph(reader, region, preset)
    const graph = mode === 'before' ? withoutEnds(cut) : cut
    const tRead = now() - t0
    for (const bp of thresholds) {
      const t1 = now()
      const fold = foldThreads(graph, bp)
      folds.push({ bp, foldS: now() - t1, folded: fold.folded })
    }
    print({ where, preset, path: mode, readS: tRead, folds, bytes: bytesRead, peakMB: peakMB() })
  }
}

for (const where of windowList.split(',')) {
  const region = parseWindow(where)
  for (const preset of presets) {
    await (mode === 'both'
      ? both(region, preset, where)
      : alone(region, preset, where))
  }
}
if (failures.length > 0) {
  process.stdout.write(`FAILED ${failures.join('; ')}\n`)
  process.exitCode = 1
}
