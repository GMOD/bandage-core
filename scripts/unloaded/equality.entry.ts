// Holds the walk rows of a cut with nothing loaded equal to the rows of the
// same cut with every abridged piece loaded, over a list of windows of a walk
// file: each row's bp, gaps, runs (position, direction, bp, on or off the
// reference), completeness, stop, axis and departures, and its readout but
// for its "not loaded" part. Consecutive runs off the reference compare as
// one run of their bp, loaded or not.
//
// Each run not loaded is then held to what it stands for, apart from that
// merge:
// - it lies inside a run off the reference of the same row loaded
// - the row's runs not loaded cover exactly the bp of its visits to the
//   tables' placeholders, and `unloadedBp` is their sum
// - the readout states `· <bp> not loaded` where and only where the row has
//   such a run, and that bp is their sum
// - drawn, flat and under the reference ramp, a run carries the not-loaded
//   rim where and only where it is not loaded
// - a loaded row holds no run not loaded and no placeholder
//
// Checked beside that: a row that holds a run not loaded, in its bar or among
// the steps the cut attached to one of its departures or gaps, states its
// `abridgedSteps`, which a host offers to load. A row that does not is
// printed as NOCOUNT and counted apart from the differences.
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
// every difference and then the counts, and exits 1 on any difference or any
// row without its count.
import { NOT_LOADED_TEXT } from '../../src/gfa/departures'
import { tableNodeIds } from '../../src/gfa/graphTables'
import {
  NOT_LOADED,
  walkRowReadout,
  walkRowsTree,
} from '../../src/layout/walkRowDraw'
import { walkRowRuns, walkRowsOf } from '../../src/layout/walkRowRuns'
import { cutTables, flag, openWalks, parseWindow, windowText } from './cut'

import type { El } from '../../src/el'
import type { GraphTables } from '../../src/gfa/graphTables'
import type { WalkRow, WalkRows, WalkRun } from '../../src/layout/walkRows'
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

interface Span {
  start: number
  end: number
}

function mergedSpans(spans: Span[]) {
  const out: Span[] = []
  for (const span of spans) {
    const last = out.at(-1)
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end)
    } else {
      out.push({ ...span })
    }
  }
  return out
}

const spansText = (spans: Span[]) =>
  spans.map(({ start, end }) => `${start}-${end}`).join(',')

const runSpan = (run: { start: number; bp: number }) => ({
  start: run.start,
  end: run.start + run.bp,
})

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

const NOT_LOADED_PART = new RegExp(
  ` · ([0-9.]+) (kb|bp) ${NOT_LOADED_TEXT}`,
  'g',
)

const withoutNotLoaded = (readout: string) =>
  readout.replace(NOT_LOADED_PART, '')

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

const bpOf = (spans: { bp: number }[]) =>
  spans.reduce((sum, span) => sum + span.bp, 0)

// The bp a readout's `kb` or `bp` figure may stand for, as its rounding
// leaves it
function statedRange(value: number, unit: string) {
  const half = unit === 'bp' ? 0 : value < 10 ? 50 : 500
  const bp = unit === 'bp' ? value : value * 1000
  return { low: bp - half, high: bp + half }
}

// The walks with a placeholder among the steps the cut attached to a
// departure or a gap
function attachedPlaceholders({ nodes, departures, gaps }: GraphTables) {
  const names = new Set<string>()
  const flagged = (node: number) => nodes.placeholders?.[node] === 1
  for (let k = 0; k < departures.names.length; k++) {
    for (let j = departures.offsets[k]!; j < departures.offsets[k + 1]!; j++) {
      if (flagged(departures.steps[j]!)) {
        names.add(departures.names[k]!)
      }
    }
  }
  if (gaps) {
    const { stepOffsets, steps } = gaps.segments
    for (let g = 0; g < gaps.names.length; g++) {
      const from = stepOffsets[gaps.segmentOffsets[g]!]!
      const to = stepOffsets[gaps.segmentOffsets[g + 1]!]!
      for (let j = from; j < to; j++) {
        if (flagged(steps[j]!)) {
          names.add(gaps.names[g]!)
        }
      }
    }
  }
  return names
}

function placeholderIds(tables: GraphTables) {
  const ids = tableNodeIds(tables)
  return new Set(ids.filter((_, i) => tables.nodes.placeholders?.[i] === 1))
}

const rimmed = (rect: El) =>
  rect.attrs.stroke === NOT_LOADED || rect.attrs.fill === NOT_LOADED

// Each row's bars drawn a bp to the pixel, where no run is under a pixel and
// so none merges with another, flat and under the ramp: per row, whether each
// drawn bar carries the not-loaded rim
function drawnRims(rows: WalkRows, region: Window) {
  const frame = {
    scaleX: 1,
    scaleY: 1,
    translateX: -rows.origin,
    translateY: 0,
    width: Infinity,
    height: Infinity,
  }
  return [undefined, region].map(ramp =>
    walkRowsTree(rows, frame, { ramp }).children.map(group =>
      typeof group === 'string'
        ? []
        : group.children.flatMap(child =>
            typeof child !== 'string' && child.tag === 'rect'
              ? [rimmed(child)]
              : [],
          ),
    ),
  )
}

const counts = {
  windows: 0,
  cuts: 0,
  rows: 0,
  rowsNotLoaded: 0,
  runsNotLoaded: 0,
  bpNotLoaded: 0,
  rowsWithLoad: 0,
  differences: 0,
  withoutCount: 0,
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
  const runs = walkRowRuns(tables, region, { visits: true })
  return {
    rows: runs ? walkRowsOf(runs) : undefined,
    attached: attachedPlaceholders(tables),
    placeholders: placeholderIds(tables),
  }
}

// What a row's runs not loaded must be, apart from the merged comparison
function checkNotLoaded(
  where: string,
  row: WalkRow,
  loadedRow: WalkRow,
  reference: WalkRow | undefined,
  placeholders: Set<string>,
) {
  const notLoaded = unloadedRuns(row)
  const loadedOff = mergedSpans(
    loadedRow.runs.filter(offReference).map(runSpan),
  )
  for (const run of notLoaded) {
    const { start, end } = runSpan(run)
    if (!loadedOff.some(span => span.start <= start && end <= span.end)) {
      differ(where, `run not loaded ${start}-${end} is off no loaded run`)
    }
  }
  const visited = (row.visits ?? []).filter(visit =>
    placeholders.has(visit.node),
  )
  const visitSpans = spansText(mergedSpans(visited.map(runSpan)))
  const runSpans = spansText(mergedSpans(notLoaded.map(runSpan)))
  if (visitSpans !== runSpans) {
    differ(
      where,
      `placeholders visited over ${visitSpans || 'nothing'}, runs not loaded over ${runSpans || 'nothing'}`,
    )
  }
  const runBp = bpOf(notLoaded)
  if ((row.unloadedBp ?? 0) !== runBp || bpOf(visited) !== runBp) {
    differ(
      where,
      `unloadedBp ${row.unloadedBp ?? 0}, runs not loaded ${runBp} bp, placeholder visits ${bpOf(visited)} bp`,
    )
  }
  const readout = walkRowReadout(row, reference)
  const stated = [...readout.matchAll(NOT_LOADED_PART)]
  const range = stated[0] && statedRange(Number(stated[0][1]), stated[0][2]!)
  if (
    row.stepless
      ? stated.length > 0
      : runBp > 0
        ? stated.length !== 1 ||
          !range ||
          runBp < range.low ||
          runBp > range.high
        : stated.length > 0
  ) {
    differ(where, `readout "${readout}" for ${runBp} bp not loaded`)
  }
}

function checkRims(where: string, rows: WalkRows, region: Window) {
  const all = [rows.reference, ...rows.rows]
  for (const [mode, drawn] of drawnRims(rows, region).entries()) {
    all.forEach((row, i) => {
      const want = row.runs.map(run => run.unloaded === true)
      const got = drawn[i] ?? []
      if (want.join() !== got.join()) {
        differ(
          `${where} ${row.name} ${mode === 0 ? 'flat' : 'ramp'}`,
          `rims drawn [${got.map(Number).join('')}] for runs not loaded [${want.map(Number).join('')}]`,
        )
      }
    })
  }
}

async function compare(
  reader: Reader,
  region: Window,
  haplotypes: string[] | undefined,
  gaps: boolean,
) {
  const where = `${refName}:${windowText(region)}${gaps ? ' gaps' : ''}`
  const {
    rows: unloaded,
    attached,
    placeholders,
  } = await rowsOf(reader, region, haplotypes, false, gaps)
  const { rows: loaded, placeholders: loadedPlaceholders } = await rowsOf(
    reader,
    region,
    haplotypes,
    true,
    gaps,
  )
  counts.cuts++
  if (loadedPlaceholders.size > 0) {
    differ(
      where,
      `the loaded cut holds ${loadedPlaceholders.size} placeholders`,
    )
  }
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
    checkRims(where, unloaded, region)
    for (const [i, row] of [unloaded.reference, ...unloaded.rows].entries()) {
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
      if (
        row.abridgedSteps === undefined &&
        (notLoaded.length > 0 || attached.has(row.name))
      ) {
        counts.withoutCount++
        print(
          `NOCOUNT ${where} ${row.name}: a run not loaded ${notLoaded.length > 0 ? 'in its bar' : "among a departure's or a gap's steps"} and no abridgedSteps`,
        )
      }
      if (other) {
        if (
          unloadedRuns(other).length > 0 ||
          other.unloadedBp !== undefined ||
          other.abridgedSteps !== undefined
        ) {
          differ(
            `${where} ${row.name}`,
            'the loaded row holds a run not loaded',
          )
        }
        checkNotLoaded(
          `${where} ${row.name}`,
          row,
          other,
          i === 0 ? undefined : unloaded.reference,
          placeholders,
        )
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
print(
  `${counts.differences} differences, ${counts.withoutCount} rows holding a run not loaded without abridgedSteps`,
)
process.exitCode = counts.differences + counts.withoutCount > 0 ? 1 : 0
