import { WalkReader } from '@jbrowse/graph-walks'
import { LocalFile } from 'generic-filehandle2'

import { COLOR_SCHEMES } from './colorSchemes'
import { figureSvg } from './figure'
import { departureTable } from './gfa/departures'
import { graphFromTables, graphTablesGFA } from './gfa/graphTables'
import {
  NOT_LOADED,
  OFF_REFERENCE,
  coalesceRuns,
  runPaint,
  walkRowReadout,
  walkRowsKey,
  walkRowsTree,
} from './layout/walkRowDraw'
import { walkRowLayoutOf } from './layout/walkRowLayout'
import { walkRowBlocks, walkRowLinks } from './layout/walkRowLinks'
import { walkRowRuns, walkRowsOf } from './layout/walkRowRuns'
import { walkRows } from './layout/walkRows'
import { layoutModeByValue } from './layoutModes'
import { loadGraph } from './pipeline'
import {
  NOT_LOADED_COLOR,
  computeColorSchemeRange,
  getNodeColor,
} from './renderer/GeometryBuilder'
import { serializeEl } from './el'
import { walkLift } from './walkHighlight'
import { walkKey } from './walkKey'

import type { GraphTables } from './gfa/graphTables'
import type { WalkRow, WalkRun } from './layout/walkRows'

// Walk format 8 files built by test_data/walks8/build.sh, every piece
// abridged, cut by graph-walks 7 as the plugin cuts a walk-rows window: with
// nothing loaded, or with `loaded` every piece read in full
async function cut(
  name: string,
  contig: string,
  start: number,
  end: number,
  o: { loaded?: boolean; gaps?: boolean; context?: number } = {},
) {
  const reader = WalkReader.open(
    `test_data/walks8/${name}.R.walks.gz`,
    url => new LocalFile(url),
  )
  const {
    graph,
    kept,
    fragments,
    departures,
    gaps,
    placeholders,
  } = await reader.cut(
    `R#0#${contig}`,
    { start, end },
    {
      ...(o.context === undefined ? {} : { context: o.context }),
      ...(o.loaded ? { expand: () => true } : {}),
    },
  )
  const tables = o.gaps
    ? graph.tables(kept, fragments, departures, gaps)
    : graph.tables(kept, fragments, departures)
  const region = { start, end }
  const rows = walkRowsOf(walkRowRuns(tables, region)!)
  return {
    tables,
    region,
    rows,
    placeholders,
    row: (label: string) => rows.rows.find(r => r.label === label)!,
  }
}

const runText = (run: WalkRun) =>
  run.gap
    ? `gap${run.bp}`
    : run.onReference
      ? `R${run.reversed ? '<' : ''}${run.bp}@${run.referenceStart}`
      : `${run.unloaded ? '?' : 'o'}${run.bp}`

const runsText = (row: WalkRow) => row.runs.map(runText).join(' ')

// A row as the loaded cut must give it too: its runs with those off the
// reference as their bp alone, and everything else it states but what loading
// changes
const loadedShape = (row: WalkRow) => ({
  ...row,
  offReferenceBp: row.offReferenceBp + (row.unloadedBp ?? 0),
  unloadedBp: undefined,
  abridgedSteps: undefined,
  runs: runsText(row).replaceAll('?', 'o'),
})

// blocks.R.gfa: R walks twelve 10 bp nodes over c:0-120, in two tiles of 60.
// PARTIAL walks c:60-90, 50 bp off the reference and c:90-120. HAIRPIN walks
// c:60-100, 7 bp off it and back over c:100-60. MULTI's piece starts at c:60,
// goes back to c:0-20, on over c:80-90, 3 bp off the reference, c:90-100, back
// to c:20-30, and ends over c:100-120. JUMP walks c:60-80, 5 bp off the
// reference and c:110-120.
test("an unloaded piece's row is the loaded piece's row, its runs off the reference at their bp and not loaded", async () => {
  for (const [start, end] of [
    [60, 120],
    [80, 110],
    [0, 60],
    [70, 80],
  ] as const) {
    for (const gaps of [false, true]) {
      const unloaded = await cut('blocks', 'c', start, end, { gaps })
      const loaded = await cut('blocks', 'c', start, end, {
        gaps,
        loaded: true,
      })
      expect(unloaded.rows.rows.map(loadedShape)).toEqual(
        loaded.rows.rows.map(loadedShape),
      )
      expect(
        loaded.rows.rows.some(
          row =>
            row.unloadedBp !== undefined ||
            row.abridgedSteps !== undefined ||
            row.runs.some(run => run.unloaded),
        ),
      ).toBe(false)
    }
  }
})

test('an unloaded piece draws its stretches on the reference where they lie, in their direction, and each run off it at its bp', async () => {
  const { row } = await cut('blocks', 'c', 60, 120)
  expect(runsText(row('PARTIAL#1'))).toBe('R30@60 ?50 R30@90')
  expect(runsText(row('HAIRPIN#1'))).toBe('R40@60 ?7 R<40@60')
  expect(runsText(row('MULTI#1'))).toBe(
    'R20@60 R20@0 R10@80 ?3 R10@90 R10@20 R20@100',
  )
  expect(row('PARTIAL#1')).toMatchObject({
    bp: 110,
    offReferenceBp: 0,
    unloadedBp: 50,
    gapBp: 0,
  })
  expect(row('PARTIAL#1').runs[1]).toEqual({
    start: 30,
    bp: 50,
    onReference: false,
    referenceStart: undefined,
    unloaded: true,
  })
})

test('a row with a run not loaded states its bp exactly, and one without says nothing of loading', async () => {
  const { row, rows } = await cut('blocks', 'c', 80, 110)
  expect(walkRowReadout(row('PARTIAL#1'), rows.reference)).toBe(
    '0.1 kb (+50 bp) · 50 bp not loaded',
  )
  expect(walkRowReadout(row('LOWFIRST#1'), rows.reference)).toBe(
    '0.0 kb (−20 bp)',
  )
  for (const each of rows.rows) {
    expect(walkRowReadout(each, rows.reference)).not.toMatch(/≈|estimate/)
    expect(each).not.toHaveProperty('estimated')
  }
})

test("a row built from an unloaded piece states the piece's steps, whether or not the window holds one of its runs", async () => {
  const { row } = await cut('blocks', 'c', 80, 110)
  expect(row('PARTIAL#1')).toMatchObject({ abridgedSteps: 7, unloadedBp: 50 })
  expect(row('LOWFIRST#1').abridgedSteps).toBe(6)
  expect(row('LOWFIRST#1').unloadedBp).toBeUndefined()
})

// JUMP has no step on c:80-110. With no context the cut holds no step of it,
// only its departure from 80 to 110; with the default context it holds its
// steps either side and the 5 bp between
test('a walk with no step in the window is a row of its departure, loaded or not, and never for being unloaded', async () => {
  for (const loaded of [false, true]) {
    const bare = await cut('blocks', 'c', 80, 110, { context: 0, loaded })
    expect(bare.row('JUMP#1')).toMatchObject({
      stepless: true,
      bp: 0,
      departures: [{ leavePos: 80, rejoinPos: 110, ownBp: 5 }],
    })
    expect(bare.row('PARTIAL#1').stepless).toBeUndefined()
  }
  const { rows } = await cut('blocks', 'c', 60, 120)
  expect(rows.rows.some(row => row.stepless)).toBe(false)
})

test('a run not loaded paints in its own colour, flat or under the ramp, and the key names it', async () => {
  const { rows, row } = await cut('blocks', 'c', 60, 120)
  const [onPath, notLoaded] = row('PARTIAL#1').runs
  const ramp = { start: 60, end: 120 }
  expect(runPaint(notLoaded!, undefined)).toEqual({ fill: NOT_LOADED })
  expect(runPaint(notLoaded!, ramp)).toEqual({ fill: NOT_LOADED })
  expect(NOT_LOADED).not.toBe(OFF_REFERENCE)
  expect(runPaint(onPath!, undefined)).not.toEqual({ fill: NOT_LOADED })
  const key = walkRowsKey(rows)
  expect(key.map(entry => entry.label)).toEqual([
    "on R#0's path",
    "off R#0's path",
    'not loaded',
  ])
  expect(key[2]!.swatch).toEqual({ kind: 'bar', fill: NOT_LOADED })
  const loaded = await cut('blocks', 'c', 60, 120, { loaded: true })
  expect(walkRowsKey(loaded.rows).map(entry => entry.label)).toEqual([
    "on R#0's path",
    "off R#0's path",
  ])
  const svg = serializeEl(
    walkRowsTree(rows, {
      scaleX: 5,
      scaleY: 1,
      translateX: 0,
      translateY: 20,
      width: 800,
      height: 400,
    }),
  )
  expect(svg).toContain(`fill="${NOT_LOADED}"`)
})

test('runs under a pixel merge into the kind most of their bp is, a run not loaded among them', () => {
  const runs: WalkRun[] = [
    { start: 0, bp: 2, onReference: true, referenceStart: 100 },
    { start: 2, bp: 5, onReference: false, unloaded: true },
    { start: 7, bp: 1, onReference: false },
  ]
  expect(coalesceRuns(runs, 0.1)).toEqual([
    {
      start: 0,
      bp: 8,
      onReference: false,
      referenceStart: undefined,
      unloaded: true,
    },
  ])
  expect(coalesceRuns(runs, 1)).toEqual(runs)
})

// interleaved.R.gfa: X's pieces alternate loaded and abridged, so a run off
// the reference can lie part in a loaded piece and part in an unloaded one
test('a run not loaded stays apart from the loaded steps off the reference beside it, and their bp add up to the loaded run', async () => {
  const unloaded = await cut('interleaved', 'c', 0, 36)
  const loaded = await cut('interleaved', 'c', 0, 36, { loaded: true })
  const x = unloaded.row('X#1')
  const whole = loaded.row('X#1')
  expect(x.unloadedBp).toBeGreaterThan(0)
  expect(x.bp).toBe(whole.bp)
  expect(x.offReferenceBp + x.unloadedBp!).toBe(whole.offReferenceBp)
  const merged = (row: WalkRow) =>
    runsText(row)
      .replaceAll('?', 'o')
      .replaceAll(/o(\d+)(?: o(\d+))+/g, run =>
        `o${run
          .split(' ')
          .reduce((sum, part) => sum + Number(part.slice(1)), 0)}`,
      )
  expect(merged(x)).toBe(merged(whole))
})

// drawnedge.R.gfa at chr:6228-6233: H#1 walks the window twice, in two loaded
// fragments, and the 600 bp of its own between them lie in an abridged piece,
// which the cut attaches to the gap as one placeholder
test("a placeholder among a gap's attached steps draws as a run not loaded", async () => {
  const { row } = await cut('drawnedge', 'chr', 6228, 6233, { gaps: true })
  const h = row('H#1')
  expect(h.runs.filter(run => run.unloaded)).toEqual([
    {
      start: expect.any(Number),
      bp: 600,
      onReference: false,
      referenceStart: undefined,
      unloaded: true,
    },
  ])
  expect(h.unloadedBp).toBe(600)
  const loaded = await cut('drawnedge', 'chr', 6228, 6233, {
    gaps: true,
    loaded: true,
  })
  expect(loadedShape(h)).toEqual(loadedShape(loaded.row('H#1')))
})

// GRCh38 over three 1 kb nodes. A and B each leave it after the first for
// 500 bp not loaded, over the same stretch of their contigs, and rejoin at
// the third; C and D walk node 3, 500 bp off the reference, there instead
function twinTables(): GraphTables {
  const walks = [
    [0, 1, 2],
    [0, 4, 2],
    [0, 5, 2],
    [0, 3, 2],
    [0, 3, 2],
  ]
  const offsets = [0]
  for (const steps of walks) {
    offsets.push(offsets.at(-1)! + steps.length)
  }
  return {
    nodes: {
      names: ['0', '1', '2', '3', 'A#1#a:1000-1500', 'B#1#b:1000-1500'],
      lengths: Int32Array.of(1000, 1000, 1000, 500, 500, 500),
      refs: Int32Array.of(0, 0, 0, -1, 1, 2),
      starts: Float64Array.of(0, 1000, 2000, 0, 1000, 1000),
      ranks: Int32Array.of(0, 0, 0, 1, 1, 1),
      refNames: ['chr1', 'A#1#a', 'B#1#b'],
      placeholders: Uint8Array.of(0, 0, 0, 0, 1, 1),
    },
    links: {
      from: Int32Array.of(0, 1, 0, 3, 0, 4, 0, 5),
      to: Int32Array.of(1, 2, 3, 2, 4, 2, 5, 2),
      strands: new Uint8Array(8),
    },
    walks: {
      names: ['GRCh38#0#chr1', 'A#1#a', 'B#1#b', 'C#1#c', 'D#1#d'],
      starts: new Float64Array(5),
      ends: Float64Array.of(3000, 2500, 2500, 2500, 2500),
      offsets: Int32Array.from(offsets),
      steps: Int32Array.from(walks.flat()),
      reversed: new Uint8Array(offsets.at(-1)!),
      trimmedBefore: new Float64Array(5),
      trimmedAfter: new Float64Array(5),
      abridgedSteps: Float64Array.of(NaN, 40, 60, NaN, NaN),
    },
    departures: departureTable(),
  }
}

test('two runs not loaded are no node in common: no ribbon joins them, no block holds them and their visits name different things', () => {
  const rows = walkRowsOf(walkRowRuns(twinTables(), undefined, { visits: true })!)
  const byLabel = Object.fromEntries(rows.rows.map(row => [row.label, row]))
  const unloadedVisit = (label: string) =>
    byLabel[label]!.visits!.find(visit => visit.unloaded)!
  expect(unloadedVisit('A#1')).toMatchObject({ start: 1000, bp: 500 })
  expect(unloadedVisit('A#1').node).not.toBe(unloadedVisit('B#1').node)
  expect(byLabel['C#1']!.visits!.some(visit => visit.unloaded)).toBe(false)
  const order = ['A#1', 'B#1', 'C#1', 'D#1'].map(label => byLabel[label]!)
  const overRun = (pair: WalkRow[]) =>
    walkRowLinks(pair, 0).filter(link => link.a0 < 1500 && link.a1 > 1000)
  expect(overRun([order[0]!, order[1]!])).toEqual([])
  expect(overRun([order[2]!, order[3]!])).toHaveLength(1)
  const blockRows = new Set(walkRowBlocks(order).map(block => block.row))
  expect(blockRows).toEqual(new Set([2, 3]))
})

test('a Graph from the tables keeps its placeholders, and its walk rows are the tables\' rows', () => {
  const tables = twinTables()
  const graph = graphFromTables(tables)
  expect(graph.nodes.filter(node => node.placeholder).map(n => n.name)).toEqual(
    ['A#1#a:1000-1500', 'B#1#b:1000-1500'],
  )
  expect(graph.paths!.map(path => path.abridgedSteps)).toEqual([
    undefined,
    40,
    60,
    undefined,
    undefined,
  ])
  expect(walkRows(graph, undefined, undefined, { visits: true })).toEqual(
    walkRowsOf(walkRowRuns(tables, undefined, { visits: true })!),
  )
})

test('GFA text of the tables tags a placeholder, and loading it keeps the flag', () => {
  const gfa = graphTablesGFA(twinTables())
  expect(gfa).toContain(
    'S\tA#1#a:1000-1500\t*\tLN:i:500\tSN:Z:A#1#a\tSO:i:1000\tSR:i:1\tnl:i:1',
  )
  expect(gfa.match(/nl:i:1/g)).toHaveLength(2)
  expect(
    loadGraph(gfa, 'cut')
      .nodes.filter(node => node.placeholder)
      .map(node => node.name),
  ).toEqual(['A#1#a:1000-1500', 'B#1#b:1000-1500'])
})

test('a node layout draws a placeholder as a node of its bp in the not-loaded colour under every scheme, outside the colour ranges', () => {
  const graph = loadGraph(twinTables(), 'cut')
  const range = computeColorSchemeRange(graph)
  const placeholders = graph.nodes.filter(node => node.placeholder)
  const loadedOff = graph.nodes.find(node => node.name === '3')!
  expect(placeholders).toHaveLength(2)
  for (const { value } of COLOR_SCHEMES) {
    const scheme = value === 'auto' ? 'reference-position' : value
    for (const node of placeholders) {
      expect(getNodeColor(node, 0, scheme, range)).toBe(NOT_LOADED_COLOR)
    }
    expect(getNodeColor(loadedOff, 0, scheme, range)).not.toBe(
      NOT_LOADED_COLOR,
    )
  }
  const stretched = {
    ...graph,
    nodes: graph.nodes.map(node =>
      node.placeholder ? { ...node, length: 9_000_000 } : node,
    ),
  }
  expect(computeColorSchemeRange(stretched).maxLength).toBe(1000)
  const layout = layoutModeByValue('auto').run(graph, undefined)!
  for (const node of placeholders) {
    const [from, to] = layout.nodePositions[node.id]!
    expect(Math.abs(to!.x - from!.x)).toBeGreaterThan(0)
  }
  const svg = figureSvg(graph, layout, { width: 600 })
  expect(svg).toContain('>not loaded</text>')
  expect(svg).toContain('rgb(217, 164, 65)')
  const allLoaded = loadGraph(
    {
      ...twinTables(),
      nodes: { ...twinTables().nodes, placeholders: new Uint8Array(6) },
    },
    'cut',
  )
  expect(
    figureSvg(allLoaded, layoutModeByValue('auto').run(allLoaded, undefined)!, {
      width: 600,
    }),
  ).not.toContain('not loaded')
})

test('a graph over the node limit says how many of its nodes are runs not loaded', () => {
  expect(() => loadGraph(twinTables(), 'cut', { maxNodes: 5 })).toThrow(
    'Graph too large to draw: 6 nodes, 2 of them runs of steps not loaded (limit 5)',
  )
  expect(loadGraph(twinTables(), 'cut', { maxNodes: 6 }).nodes).toHaveLength(6)
})

test('a lifted walk keeps a run not loaded in its own colour, counts its bp apart from its steps and says so in its key', () => {
  const graph = loadGraph(twinTables(), 'cut', {
    referencePath: 'GRCh38#0#chr1',
  })
  const lift = walkLift(graph, [{ walk: 'A#1#a' }, { walk: 'C#1#c' }])!
  const [a, c] = lift.walks
  const placeholder = graph.nodes.find(node => node.placeholder)!
  expect(a!.colors.get(placeholder.id)).toBe(NOT_LOADED_COLOR)
  expect(a!.colors.get('0+')).not.toBe(NOT_LOADED_COLOR)
  expect(a).toMatchObject({ steps: 2, bp: 2500, unloadedBp: 500 })
  expect(c).toMatchObject({ steps: 3, bp: 2500, unloadedBp: 0 })
  expect(walkKey(a!).gaps).toBe(', 500 bp not loaded')
  expect(walkKey(c!).gaps).toBe('')
})

test('a walk-rows figure of an unloaded cut draws its runs not loaded and keys them', async () => {
  const { tables, region, rows } = await cut('blocks', 'c', 60, 120)
  const graph = loadGraph(tables, 'cut')
  const svg = figureSvg(graph, walkRowLayoutOf(graph, rows, region)!, {
    width: 900,
    region: { refName: 'c', ...region },
    walkRows: rows,
  })
  expect(svg).toContain(`fill="${NOT_LOADED}"`)
  expect(svg).toContain('>not loaded</text>')
  expect(svg).toContain('50 bp not loaded')
})

test('a cut says how many placeholders it returned, each a node of the tables', async () => {
  const { tables, placeholders } = await cut('blocks', 'c', 60, 120)
  expect(placeholders).toBeGreaterThan(0)
  expect(
    tables.nodes.placeholders!.reduce((sum, flagged) => sum + flagged, 0),
  ).toBe(placeholders)
})
