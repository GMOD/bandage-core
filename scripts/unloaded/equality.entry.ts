// Holds the walk rows of a cut with nothing loaded equal to the rows of the
// same cut with every abridged piece loaded, over a list of windows of a walk
// file: each row's bp, gaps, runs (position, direction, bp, on or off the
// reference), completeness, stop, axis and departures, and its readout. A
// loaded row's run of steps off the reference counts as one run of its bp,
// and so does a run not loaded with the loaded steps beside it. What may
// differ is the "not loaded" flag, which nodes a run holds, and the readout's
// "not loaded" part.
//
// Checked beside that: a loaded row holds nothing unloaded, and a row with a
// run not loaded states its `abridgedSteps`.
//
//   node_modules/.bin/esbuild scripts/unloaded/equality.entry.ts --bundle \
//     --format=esm --platform=node --outfile=/tmp/equality.mjs
//   node /tmp/equality.mjs <walks.gz> <sequence> [start-end ...]
//     [--tiles 11796480,11862016 --random 100 --width 1000 --seed 1]
//     [--haplotypes 64] [--gaps both|on|off]
//
// `--tiles` with `--random` adds that many windows of `--width` bp at random
// over those tiles. Each window is cut once per `--haplotypes` haplotypes of
// the file, 0 for all at once, with and without the cut's gap table. Prints
// every difference and then the counts, and exits 1 on any difference.
import { NOT_LOADED_TEXT } from '../../src/gfa/departures'
import { walkRowReadout } from '../../src/layout/walkRowDraw'
import { walkRowRuns, walkRowsOf } from '../../src/layout/walkRowRuns'
import { cutTables, flag, openWalks, parseWindow, windowText } from './cut'

import type { WalkRow, WalkRun } from '../../src/layout/walkRows'
import type { Reader, Window } from './cut'

const [path = '', refName = '', ...rest] = process.argv.slice(2)
const stated = rest.slice(
  0,
  rest.findIndex(arg => arg.startsWith('--')) < 0
    ? rest.length
    : rest.findIndex(arg => arg.startsWith('--')),
)
const tiles = (flag('tiles') ?? '').split(',').filter(Boolean).map(Number)
const randomCount = Number(flag('random') ?? 0)
const width = Number(flag('width') ?? 1000)
const seed = Number(flag('seed') ?? 1)
const perCut = Number(flag('haplotypes') ?? 64)
const gapModes = { both: [false, true], on: [true], off: [false] }[
  flag('gaps') ?? 'both'
] ?? [false, true]

const print = (line: string) => {
  process.stdout.write(`${line}\n`)
}

// mulberry32
function random(from: number) {
  let state = from >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const offReference = (run: WalkRun) => !run.gap && !run.onReference

// A row's runs as compared: consecutive runs off the reference as one of
// their bp, loaded or not
function runsOf(runs: WalkRun[]) {
  const out: string[] = []
  let offStart = 0
  let offBp = 0
  const flush = () => {
    if (offBp > 0) {
      out.push(`off@${offStart}:${offBp}`)
    }
    offBp = 0
  }
  for (const run of runs) {
    if (offReference(run)) {
      offStart = offBp > 0 ? offStart : run.start
      offBp += run.bp
    } else {
      flush()
      out.push(
        run.gap
          ? `gap@${run.start}:${run.bp}:${run.cause ?? 'outside'}:${run.near ?? ''}:${run.missingBp ?? ''}`
          : `on@${run.start}:${run.bp}:${run.referenceStart}${run.reversed ? '<' : '>'}`,
      )
    }
  }
  flush()
  return out
}

const withoutNotLoaded = (readout: string) =>
  readout.replace(new RegExp(` · [0-9.]+ (?:kb|bp) ${NOT_LOADED_TEXT}`), '')

function shapeOf(row: WalkRow, reference: WalkRow | undefined) {
  return new Map(
    Object.entries({
      label: row.label,
      bp: row.bp,
      gapBp: row.gapBp,
      offReferenceBp: row.offReferenceBp + (row.unloadedBp ?? 0),
      complete: row.complete,
      stepless: row.stepless ?? false,
      stop: row.stop,
      axis: row.axis,
      departures: row.departures ?? [],
      placementChoice: row.placementChoice ?? false,
      outsideRow: row.outsideRow,
      runs: runsOf(row.runs),
      readout: withoutNotLoaded(walkRowReadout(row, reference)),
    }).map(([key, value]) => [key, JSON.stringify(value)]),
  )
}

const unloadedRuns = (row: WalkRow) => row.runs.filter(run => run.unloaded)

const counts = {
  windows: 0,
  cuts: 0,
  rows: 0,
  rowsNotLoaded: 0,
  runsNotLoaded: 0,
  bpNotLoaded: 0,
  rowsWithLoad: 0,
  differences: 0,
}

const differ = (where: string, what: string) => {
  counts.differences++
  print(`DIFF ${where}: ${what}`)
}

async function rowsOf(
  reader: Reader,
  region: Window,
  haplotypes: string[] | undefined,
  loaded: boolean,
  gaps: boolean,
) {
  const tables = await cutTables(reader, refName, region, {
    haplotypes,
    loaded,
    gaps,
  })
  const runs = walkRowRuns(tables, region)
  return runs ? walkRowsOf(runs) : undefined
}

async function compare(
  reader: Reader,
  region: Window,
  haplotypes: string[] | undefined,
  gaps: boolean,
) {
  const where = `${refName}:${windowText(region)}${gaps ? ' gaps' : ''}`
  const unloaded = await rowsOf(reader, region, haplotypes, false, gaps)
  const loaded = await rowsOf(reader, region, haplotypes, true, gaps)
  counts.cuts++
  if (!unloaded || !loaded) {
    if (unloaded || loaded) {
      differ(where, `rows ${unloaded ? 'unloaded' : 'loaded'} alone`)
    }
  } else {
    const others = new Map(
      [loaded.reference, ...loaded.rows].map(row => [row.name, row]),
    )
    const order = (rows: WalkRow[]) => rows.map(row => row.name).join(' ')
    if (order(unloaded.rows) !== order(loaded.rows)) {
      differ(where, 'the rows come in another order')
    }
    for (const row of [unloaded.reference, ...unloaded.rows]) {
      const other = others.get(row.name)
      others.delete(row.name)
      counts.rows++
      const notLoaded = unloadedRuns(row)
      if (notLoaded.length > 0) {
        counts.rowsNotLoaded++
        counts.runsNotLoaded += notLoaded.length
        counts.bpNotLoaded += row.unloadedBp ?? 0
      }
      counts.rowsWithLoad += row.abridgedSteps === undefined ? 0 : 1
      if (notLoaded.length > 0 && row.abridgedSteps === undefined) {
        differ(
          `${where} ${row.name}`,
          'a run not loaded and no abridgedSteps',
        )
      }
      if (other) {
        if (
          unloadedRuns(other).length > 0 ||
          other.unloadedBp !== undefined ||
          other.abridgedSteps !== undefined
        ) {
          differ(`${where} ${row.name}`, 'the loaded row holds a run not loaded')
        }
        const full = shapeOf(other, loaded.reference)
        for (const [key, mine] of shapeOf(row, unloaded.reference)) {
          const theirs = full.get(key)
          if (mine !== theirs) {
            differ(
              `${where} ${row.name} ${key}`,
              `unloaded ${mine} loaded ${theirs}`,
            )
          }
        }
      } else {
        differ(`${where} ${row.name}`, 'a row of the unloaded cut alone')
      }
    }
    for (const name of others.keys()) {
      differ(`${where} ${name}`, 'a row of the loaded cut alone')
    }
  }
}

const reader = openWalks(path)
const header = await reader.header()
const windows = stated.map(parseWindow)
const next = random(seed)
for (let k = 0; k < randomCount && tiles.length > 0; k++) {
  const tile = tiles[Math.floor(next() * tiles.length)]!
  const start = tile + Math.floor(next() * Math.max(1, header.tile - width))
  windows.push({ start, end: start + width })
}
const batches: (string[] | undefined)[] = []
if (perCut > 0) {
  for (let i = 0; i < header.haplotypes.length; i += perCut) {
    batches.push(header.haplotypes.slice(i, i + perCut))
  }
} else {
  batches.push(undefined)
}
for (const region of windows) {
  counts.windows++
  for (const haplotypes of batches) {
    for (const gaps of gapModes) {
      await compare(reader, region, haplotypes, gaps)
    }
  }
  process.stderr.write(
    `${counts.windows}/${windows.length} ${windowText(region)}: ${counts.differences} differences\n`,
  )
}
print(
  `${counts.windows} windows, ${counts.cuts} cuts each unloaded and loaded, ${counts.rows} rows compared`,
)
print(
  `${counts.rowsNotLoaded} rows with runs not loaded: ${counts.runsNotLoaded} runs, ${counts.bpNotLoaded} bp; ${counts.rowsWithLoad} rows state abridgedSteps`,
)
print(`${counts.differences} differences`)
process.exitCode = counts.differences > 0 ? 1 : 0
