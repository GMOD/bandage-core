import { WalkFile } from '@gmod/gfa-tabix'

import { isOffReference } from './anchoredNodes'
import { bubbleLabel } from './bubbles/bubbleLabel'
import { graphBubbles } from './bubbles/superbubbles'
import { COLOR_SCHEMES } from './colorSchemes'
import { serializeEl } from './el'
import { figureSvg } from './figure'
import { NOT_LOADED_TEXT, departureTable } from './gfa/departures'
import { graphFromTables, graphTablesGFA } from './gfa/graphTables'
import { writeRgfa } from './gfa/writeRgfa'
import { placeholderHoverText } from './hoverText'
import { ROW_HEIGHT_PX } from './layout/rowSpacing'
import { sampleRowLayout } from './layout/sampleRowLayout'
import {
  OFF_REFERENCE,
  coalesceRuns,
  runPaint,
  walkRowReadout,
  walkRowsKey,
  walkRowsTree,
} from './layout/walkRowDraw'
import { walkRowLayoutOf } from './layout/walkRowLayout'
import {
  rowsNeedingRoutes,
  sharedRowOrder,
  walkRowBlocks,
  walkRowLinks,
} from './layout/walkRowLinks'
import { walkRowRuns, walkRowsOf } from './layout/walkRowRuns'
import { walkRows } from './layout/walkRows'
import { layoutModeByValue } from './layoutModes'
import { LABEL_CHAR_PX } from './overlayLabels'
import { loadGraph } from './pipeline'
import {
  NOT_LOADED_COLOR,
  NOT_LOADED_CSS,
  NOT_LOADED_FILL_COLOR,
  NOT_LOADED_FILL_CSS,
  REFERENCE_RAMP_ALT_CSS,
  buildGeometry,
  computeColorSchemeRange,
  getNodeColor,
} from './renderer/GeometryBuilder'
import { abgrHex } from './renderer/colorBits'
import { foldThreads } from './threadFold'
import { coarsenTubeMap } from './tubeMap/coarsen'
import { drawTubeMap, notShownCaption, tubeMapPicture } from './tubeMap/draw'
import { tubeMapNodeColors } from './tubeMap/nodeColors'
import { walkLift } from './walkHighlight'
import { walkKey } from './walkKey'

import type { GraphTables } from './gfa/graphTables'
import type { WalkRow, WalkRows, WalkRun } from './layout/walkRows'
import type { TubeMapContext } from './tubeMap/draw'

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
  const reader = new WalkFile({
    walksPath: `test_data/walks8/${name}.R.walks.gz`,
  })
  const { graph, kept, fragments, departures, gaps, placeholders } =
    await reader.getCutForRange(`R#0#${contig}`, start, end, {
      ...(o.context === undefined ? {} : { context: o.context }),
      ...(o.loaded ? { expand: () => true } : {}),
    })
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
// reference as their bp alone, a run not loaded and the loaded steps beside
// it as one, and everything else it states but what loading changes
const loadedShape = (row: WalkRow) => ({
  ...row,
  offReferenceBp: row.offReferenceBp + (row.unloadedBp ?? 0),
  unloadedBp: undefined,
  abridgedSteps: undefined,
  runs: runsText(row)
    .replaceAll('?', 'o')
    .replaceAll(
      /o\d+(?: o\d+)+/g,
      run =>
        `o${run
          .split(' ')
          .reduce((sum, part) => sum + Number(part.slice(1)), 0)}`,
    ),
})

// blocks.R.gfa: R walks twelve 10 bp nodes over c:0-120, in two tiles of 60.
// PARTIAL walks c:60-90, 50 bp off the reference and c:90-120. HAIRPIN walks
// c:60-100, 7 bp off it and back over c:100-60. MULTI's piece starts at c:60,
// goes back to c:0-20, on over c:80-90, 3 bp off the reference, c:90-100, back
// to c:20-30, and ends over c:100-120. JUMP walks c:60-80, 5 bp off the
// reference and c:110-120.
test("an unloaded piece's row is the loaded piece's row, its runs off the reference at their bp and not loaded", async () => {
  for (const [name, contig, start, end] of [
    ['blocks', 'c', 60, 120],
    ['blocks', 'c', 80, 110],
    ['blocks', 'c', 0, 60],
    ['blocks', 'c', 70, 80],
    ['interleaved', 'c', 0, 36],
    ['interleaved', 'c', 6, 12],
    ['drawnedge', 'chr', 6228, 6233],
    ['drawnedge', 'chr', 10_500, 13_500],
  ] as const) {
    for (const gaps of [false, true]) {
      const unloaded = await cut(name, contig, start, end, { gaps })
      const loaded = await cut(name, contig, start, end, {
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
  // the bar starts at the left, its first run 30 bp long
  expect(row('PARTIAL#1').runs[1]).toEqual({
    start: 30,
    bp: 50,
    onReference: false,
    referenceStart: undefined,
    unloaded: true,
  })
})

test('a row with a run not loaded reads as the loaded row, saying nothing of loading', async () => {
  const { row, rows } = await cut('blocks', 'c', 80, 110)
  const loaded = await cut('blocks', 'c', 80, 110, { loaded: true })
  expect(walkRowReadout(row('PARTIAL#1'), rows.reference)).toBe(
    '80 bp (+50 bp)',
  )
  expect(walkRowReadout(loaded.row('PARTIAL#1'), loaded.rows.reference)).toBe(
    '80 bp (+50 bp)',
  )
  // it jumps from right of the window back to its left, the stretch between
  // away from the window
  expect(walkRowReadout(row('LOWFIRST#1'), rows.reference)).toBe(
    '60 bp of its contig, of which 30 bp away from the window · contig starts inside the window · no more of the contig on R c',
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

test('a run not loaded draws as a loaded run off the path, flat or under the ramp, and the key has no entry for it', async () => {
  const unloaded = await cut('blocks', 'c', 60, 120)
  const loaded = await cut('blocks', 'c', 60, 120, { loaded: true })
  const notLoaded = unloaded.row('PARTIAL#1').runs[1]!
  const ramp = { start: 60, end: 120 }
  expect(notLoaded.unloaded).toBe(true)
  expect(runPaint(notLoaded, undefined)).toEqual({ fill: OFF_REFERENCE })
  expect(runPaint(notLoaded, ramp)).toEqual({ fill: REFERENCE_RAMP_ALT_CSS })
  expect(walkRowsKey(unloaded.rows)).toEqual(walkRowsKey(loaded.rows))
  for (const scaleX of [5, 0.05]) {
    for (const each of [undefined, ramp]) {
      const drawn = ({ rows }: typeof unloaded) =>
        serializeEl(
          walkRowsTree(
            rows,
            {
              scaleX,
              scaleY: 1,
              translateX: 0,
              translateY: 20,
              width: 800,
              height: 400,
            },
            { ramp: each },
          ),
        )
      expect(drawn(unloaded)).toBe(drawn(loaded))
    }
  }
})

test('under a node layout the walk strip draws a run not loaded hollow, as the graph draws its placeholder, and keys it', async () => {
  const { rows, row } = await cut('blocks', 'c', 60, 120)
  const notLoaded = row('PARTIAL#1').runs[1]!
  expect(runPaint(notLoaded, undefined, true)).toEqual({
    fill: NOT_LOADED_FILL_CSS,
    rim: NOT_LOADED_CSS,
  })
  const frame = {
    scaleX: 5,
    scaleY: 1,
    translateX: 0,
    translateY: 20,
    width: 800,
    height: 400,
  }
  expect(
    serializeEl(walkRowsTree(rows, frame, { markUnloaded: true })),
  ).toContain(`fill="${NOT_LOADED_FILL_CSS}" stroke="${NOT_LOADED_CSS}"`)
  expect(serializeEl(walkRowsTree(rows, frame))).not.toContain(NOT_LOADED_CSS)
  expect(
    walkRowsKey(rows, { markUnloaded: true }).map(entry => entry.label),
  ).toContain(NOT_LOADED_TEXT)
})

test('a placeholder hovered says whose route it stands in for, and no depth', () => {
  const graph = loadGraph(twinTables(), 'cut')
  const [a] = graph.nodes.filter(node => node.placeholder)
  expect(placeholderHoverText(a!)).toBe(
    "500 bp of A#1's route, nodes not shown",
  )
  expect(placeholderHoverText(graph.nodes[0]!)).toBeUndefined()
})

test('a walk-rows figure gives the row names a gutter of their own', async () => {
  const { tables, region, rows } = await cut('blocks', 'c', 60, 120)
  const graph = loadGraph(tables, 'cut')
  const svg = figureSvg(graph, walkRowLayoutOf(graph, rows, region)!, {
    width: 900,
    region: { refName: 'c', ...region },
    walkRows: rows,
  })
  const longest = [rows.reference, ...rows.rows].reduce(
    (most, each) => Math.max(most, each.label.length),
    0,
  )
  const barStarts = [
    ...svg.matchAll(
      /data-testid="graph-walk-(?:row|reference)">(?:<title>[^<]*<\/title>)?<rect x="([\d.]+)"/g,
    ),
  ].map(match => Number(match[1]))
  expect(barStarts.length).toBeGreaterThan(0)
  for (const x of barStarts) {
    expect(x).toBeGreaterThanOrEqual(12 + longest * LABEL_CHAR_PX)
  }
})

test('a row name in a figure sits on a backing of its own, over whatever the drawing runs under it', async () => {
  const { tables, region } = await cut('blocks', 'c', 60, 120)
  const graph = loadGraph(tables, 'cut', { referencePath: 'R#0#c' })
  const layout = layoutModeByValue('auto').run(graph, region)!
  const svg = figureSvg(graph, layout, {
    width: 900,
    region: { refName: 'c', ...region },
  })
  const label = layout.rowLabels![0]!.label
  expect(svg).toMatch(
    new RegExp(
      `<rect x="4" y="[\\d.]+" width="${label.length * LABEL_CHAR_PX + 4}" height="14" fill="#fff" fill-opacity="0.85"/><text x="6" [^>]*>${label.replaceAll(/[()]/g, '\\$&')}</text>`,
    ),
  )
  expect(svg).not.toContain('clipPath')
})

test('runs off the path draw as one, loaded or not, and runs under a pixel merge into the kind most of their bp is', () => {
  const runs: WalkRun[] = [
    { start: 0, bp: 2, onReference: true, referenceStart: 100 },
    { start: 2, bp: 5, onReference: false, unloaded: true },
    { start: 7, bp: 1, onReference: false },
  ]
  const off = { onReference: false, referenceStart: undefined }
  expect(coalesceRuns(runs, 0.1)).toEqual([{ start: 0, bp: 8, ...off }])
  expect(coalesceRuns(runs, 1)).toEqual([runs[0], { start: 2, bp: 6, ...off }])
})

// GRCh38 over three 1 kb nodes. E leaves it after the first for node 3, 500
// bp of loaded steps off it, then two runs not loaded, of 300 and 200 bp,
// and rejoins at the third
test('a run not loaded stays apart from the loaded steps off the reference beside it, and two runs not loaded on end draw as one', () => {
  const tables: GraphTables = {
    nodes: {
      names: ['0', '1', '2', '3', 'E#1#e:1500-1800', 'E#1#e:1800-2000'],
      lengths: Int32Array.of(1000, 1000, 1000, 500, 300, 200),
      refs: Int32Array.of(0, 0, 0, -1, 1, 1),
      starts: Float64Array.of(0, 1000, 2000, 0, 1500, 1800),
      ranks: Int32Array.of(0, 0, 0, 1, 1, 1),
      refNames: ['chr1', 'E#1#e'],
      placeholders: Uint8Array.of(0, 0, 0, 0, 1, 1),
    },
    links: {
      from: new Int32Array(0),
      to: new Int32Array(0),
      strands: new Uint8Array(0),
    },
    walks: {
      names: ['GRCh38#0#chr1', 'E#1#e'],
      starts: new Float64Array(2),
      ends: Float64Array.of(3000, 3000),
      offsets: Int32Array.of(0, 3, 8),
      steps: Int32Array.of(0, 1, 2, 0, 3, 4, 5, 2),
      reversed: new Uint8Array(8),
      abridgedSteps: Float64Array.of(NaN, 12),
    },
    departures: departureTable(),
    revisited: 0,
  }
  for (const source of [tables, graphFromTables(tables)]) {
    const e = walkRowsOf(walkRowRuns(source)!).rows[0]!
    expect(runsText(e)).toBe('R1000@0 o500 ?500 R1000@2000')
    expect(e).toMatchObject({
      bp: 3000,
      offReferenceBp: 500,
      unloadedBp: 500,
      abridgedSteps: 12,
    })
  }
})

// drawnedge.R.gfa at chr:4900-6233: H#1 walks the window twice, in two loaded
// fragments, and the 600 bp of its own between them lie in an abridged piece.
// It rejoins at 4000, within the window's 1000 bp of context, so the cut
// attaches them to the gap as one placeholder. The 2 kb before them it spends
// away from the window draw as a break 90 bp wide.
test("a placeholder among a gap's attached steps draws as a run not loaded", async () => {
  const { row } = await cut('drawnedge', 'chr', 4900, 6233, { gaps: true })
  const h = row('H#1')
  expect(h.runs.filter(run => run.unloaded)).toEqual([
    {
      start: 6090,
      bp: 600,
      onReference: false,
      referenceStart: undefined,
      unloaded: true,
    },
  ])
  expect(h).toMatchObject({ unloadedBp: 600, abridgedSteps: 9 })
  const loaded = await cut('drawnedge', 'chr', 4900, 6233, {
    gaps: true,
    loaded: true,
  })
  expect(loadedShape(h)).toEqual(loadedShape(loaded.row('H#1')))
})

// The same walk at chr:6228-6233, where H#1 neither leaves nor rejoins on the
// window or its context: the cut attaches no step, and the 600 bp are a gap
test('own steps a cut does not attach draw as a gap, loaded or not', async () => {
  for (const loaded of [false, true]) {
    const { row } = await cut('drawnedge', 'chr', 6228, 6233, {
      gaps: true,
      loaded,
    })
    const h = row('H#1')
    expect(h.runs.some(run => run.unloaded)).toBe(false)
    expect(h.runs.filter(run => run.cause === 'own')).toEqual([
      { start: 7060, bp: 600, onReference: false, gap: true, cause: 'own' },
    ])
  }
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
    revisited: 0,
  }
}

test('two runs not loaded are no node in common: no ribbon joins them, no block holds them and their visits name different things', () => {
  const rows = walkRowsOf(
    walkRowRuns(twinTables(), undefined, { visits: true })!,
  )
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
  expect(rowsNeedingRoutes(order)).toBe(2)
  const long = twinTables()
  long.nodes.lengths.set([400_000, 400_000], 4)
  const longRows = walkRowsOf(walkRowRuns(long, undefined, { visits: true })!)
  expect(walkRowBlocks(longRows.rows).map(block => block.bp)).toEqual([
    500, 500,
  ])
})

// E walks node 3 and then 300 bp not loaded, G walks node 3 alone
test('ribbons, shared blocks and the shared order leave out a row with a run not loaded, and count it', () => {
  const tables = besideTableData()
  const both: GraphTables = {
    ...tables,
    walks: {
      names: [...tables.walks.names, 'G#1#g'],
      starts: new Float64Array(4),
      ends: Float64Array.of(3000, 2800, 3000, 2500),
      offsets: Int32Array.of(0, 3, 7, 10, 13),
      steps: Int32Array.from([...tables.walks.steps, 0, 3, 2]),
      reversed: new Uint8Array(13),
      abridgedSteps: Float64Array.of(NaN, 12, NaN, NaN),
    },
  }
  const rowsOf = (placeholders: Uint8Array) => {
    const rows = walkRowsOf(
      walkRowRuns(
        { ...both, nodes: { ...both.nodes, placeholders } },
        undefined,
        { visits: true },
      )!,
    ).rows
    return ['E#1', 'G#1'].map(label => rows.find(row => row.label === label)!)
  }
  const unloaded = rowsOf(Uint8Array.of(0, 0, 0, 0, 1))
  const loaded = rowsOf(new Uint8Array(5))
  expect(walkRowLinks(loaded, 0)).not.toEqual([])
  expect(walkRowBlocks(loaded, 0)).not.toEqual([])
  expect(rowsNeedingRoutes(loaded)).toBe(0)
  expect(walkRowLinks(unloaded, 0)).toEqual([])
  expect(walkRowBlocks(unloaded, 0)).toEqual([])
  expect(rowsNeedingRoutes(unloaded)).toBe(1)
})

// G walks 0, 3, 2; F walks 0, 1, 2; E walks 0, 3, 300 bp not loaded, 2
test('the shared row order compares no row with a run not loaded, and the key says it is fetching those rows or how many it left out', () => {
  const tables = besideTableData()
  const rowsOf = (placeholders: Uint8Array) => {
    const all: GraphTables = {
      ...tables,
      nodes: { ...tables.nodes, placeholders },
      walks: {
        ...tables.walks,
        names: [...tables.walks.names, 'G#1#g'],
        starts: new Float64Array(4),
        ends: Float64Array.of(3000, 2800, 3000, 2500),
        offsets: Int32Array.of(0, 3, 7, 10, 13),
        steps: Int32Array.from([...tables.walks.steps, 0, 3, 2]),
        reversed: new Uint8Array(13),
        abridgedSteps: Float64Array.of(NaN, 12, NaN, NaN),
      },
    }
    const bars = walkRowsOf(walkRowRuns(all, undefined, { visits: true })!)
    const byLabel = (label: string) =>
      bars.rows.find(row => row.label === label)!
    return { bars, ordered: ['G#1', 'F#1', 'E#1'].map(byLabel) }
  }
  const labels = (rows: WalkRow[]) =>
    sharedRowOrder(rows).map(i => rows[i]!.label)
  const unloaded = rowsOf(Uint8Array.of(0, 0, 0, 0, 1))
  const loaded = rowsOf(new Uint8Array(5))
  expect(labels(loaded.ordered)).toEqual(['G#1', 'E#1', 'F#1'])
  expect(labels(unloaded.ordered)).toEqual(['G#1', 'F#1', 'E#1'])
  const notes = (rows: WalkRows, comparing?: { fetchLimit: number }) =>
    walkRowsKey(rows, { comparing })
      .filter(entry => entry.note)
      .map(entry => entry.label)
  expect(notes(unloaded.bars, { fetchLimit: 64 })).toEqual([
    'Fetching node-level detail for 1 row',
  ])
  expect(notes(unloaded.bars, { fetchLimit: 0 })).toEqual([
    'Leaves out 1 row: node-level detail is fetched for at most 0 at a time',
  ])
  expect(notes(unloaded.bars)).toEqual([])
  expect(notes(loaded.bars, { fetchLimit: 64 })).toEqual([])
})

test("a Graph from the tables keeps its placeholders, and its walk rows are the tables' rows", () => {
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

test('rGFA text of a graph tags a placeholder, and loading it keeps the flag', () => {
  const tables = twinTables()
  tables.nodes.refs[3] = 3
  tables.nodes.refNames.push('C#1#c')
  const rgfa = writeRgfa(loadGraph(tables, 'cut'))
  expect(rgfa).toContain(
    'S\tA#1#a:1000-1500\t*\tLN:i:500\tSN:Z:A#1#a\tSO:i:1000\tSR:i:1\tnl:i:1',
  )
  expect(rgfa.match(/nl:i:1/g)).toHaveLength(2)
  expect(
    loadGraph(rgfa, 'rgfa')
      .nodes.filter(node => node.placeholder)
      .map(node => node.name),
  ).toEqual(['A#1#a:1000-1500', 'B#1#b:1000-1500'])
})

// GRCh38 over three 1 kb nodes, which F walks too. E leaves it after the
// first for node 3, 500 bp only E walks, then 300 bp not loaded, and rejoins
// at the third
function besideTableData(placeholders = Uint8Array.of(0, 0, 0, 0, 1)) {
  const tables: GraphTables = {
    nodes: {
      names: ['0', '1', '2', '3', 'E#1#e:1500-1800'],
      lengths: Int32Array.of(1000, 1000, 1000, 500, 300),
      refs: Int32Array.of(0, 0, 0, 1, 1),
      starts: Float64Array.of(0, 1000, 2000, 1000, 1500),
      ranks: Int32Array.of(0, 0, 0, 1, 1),
      refNames: ['chr1', 'E#1#e'],
      placeholders,
    },
    links: {
      from: Int32Array.of(0, 1, 0, 3, 4),
      to: Int32Array.of(1, 2, 3, 4, 2),
      strands: new Uint8Array(5),
    },
    walks: {
      names: ['GRCh38#0#chr1', 'E#1#e', 'F#1#f'],
      starts: new Float64Array(3),
      ends: Float64Array.of(3000, 2800, 3000),
      offsets: Int32Array.of(0, 3, 7, 10),
      steps: Int32Array.of(0, 1, 2, 0, 3, 4, 2, 0, 1, 2),
      reversed: new Uint8Array(10),
      abridgedSteps: Float64Array.of(NaN, 12, NaN),
    },
    departures: departureTable(),
    revisited: 0,
  }
  return tables
}

function besideTables(placeholders = Uint8Array.of(0, 0, 0, 0, 1)) {
  return loadGraph(besideTableData(placeholders), 'cut', {
    referencePath: 'GRCh38#0#chr1',
  })
}

test('the tube map merges no placeholder with a loaded node, and keeps its box not loaded', () => {
  const boxes = (graph: ReturnType<typeof besideTables>) =>
    layoutModeByValue('tubemap')
      .run(graph, undefined)!
      .tubeMap!.graph.nodes.map(
        node => `${node.name}:${node.length}${node.placeholder ? '?' : ''}`,
      )
  expect(boxes(besideTables())).toContain('3:500')
  expect(boxes(besideTables())).toContain('E#1#e:1500-1800:300?')
  expect(boxes(besideTables(new Uint8Array(5)))).toContain('3:800')
})

test('a coarse tube map route through a placeholder is not loaded, and one through loaded nodes is', () => {
  const tables = twinTables()
  tables.nodes.refs[3] = 3
  tables.nodes.refNames.push('C#1#c')
  const graph = loadGraph(tables, 'cut', { referencePath: 'GRCh38#0#chr1' })
  const coarse = coarsenTubeMap(graph, 50)!
  const route = (id: string) =>
    coarse.graph.nodes.find(node => node.id === coarse.coarseOf.get(id))!
  for (const node of graph.nodes.filter(n => n.placeholder)) {
    expect(route(node.id)).toMatchObject({ placeholder: true, length: 500 })
  }
  expect(route('3+').placeholder).toBeUndefined()
})

test('a tube map box of steps not loaded is untinted and dashed, and says its nodes are not shown', () => {
  const drawing = layoutModeByValue('tubemap').run(
    besideTables(),
    undefined,
  )!.tubeMap!
  const placeholder = drawing.graph.nodes.find(node => node.placeholder)!
  const tints = tubeMapNodeColors(drawing.graph, 'random')!
  expect(tints.has(placeholder.id)).toBe(false)
  expect(tints.size).toBe(drawing.graph.nodes.length - 1)
  const picture = tubeMapPicture(drawing)
  expect(
    picture.nodes.flatMap(node =>
      node.notShown ? [[node.name, node.notShown.bp]] : [],
    ),
  ).toEqual([[placeholder.id, 300]])
  const dashes: number[] = []
  const texts: string[] = []
  let dash: number[] = []
  const ctx: TubeMapContext = {
    beginPath: () => {},
    bezierCurveTo: () => {},
    closePath: () => {},
    fill: () => {},
    fillStyle: '',
    fillText: text => {
      texts.push(text)
    },
    font: '',
    globalAlpha: 1,
    lineTo: () => {},
    lineWidth: 1,
    moveTo: () => {},
    quadraticCurveTo: () => {},
    rect: () => {},
    setLineDash: segments => {
      dash = [...segments]
    },
    stroke: () => {
      dashes.push(dash.length)
    },
    strokeStyle: '',
    strokeText: () => {},
    textAlign: 'center',
    textBaseline: 'middle',
    measureText: text => ({ width: text.length * 6 }),
  }
  drawTubeMap(ctx, picture, {
    x: tx => tx * 10,
    y: ty => ty,
    yScale: 1,
    width: 1e6,
  })
  expect(dashes.filter(n => n > 0)).toHaveLength(1)
  expect(texts.toSorted()).toEqual(['300 bp · nodes not shown', '500 bp'])
  const textPx = (text: string) => text.length * 6
  expect(notShownCaption(300, 200, textPx)).toBe('300 bp · nodes not shown')
  expect(notShownCaption(300, 120, textPx)).toBe('nodes not shown')
  expect(notShownCaption(300, 60, textPx)).toBeUndefined()
})

test('a placeholder is untinted grey, apart from the exon outline and the off-reference charcoal', () => {
  const channels = (css: string) => css.match(/\d+/g)!.map(Number)
  for (const css of [NOT_LOADED_CSS, NOT_LOADED_FILL_CSS]) {
    expect(new Set(channels(css)).size).toBe(1)
  }
  const [rim = 0] = channels(NOT_LOADED_CSS)
  for (const charcoal of channels(REFERENCE_RAMP_ALT_CSS)) {
    expect(rim).toBeGreaterThan(charcoal * 1.5)
  }
})

test('a node layout draws a placeholder as a hollow node of its bp under every scheme, outside the colour ranges', () => {
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
    expect(getNodeColor(loadedOff, 0, scheme, range)).not.toBe(NOT_LOADED_COLOR)
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
  const batch = buildGeometry({
    graph,
    nodeById: new Map(graph.nodes.map(node => [node.id, node])),
    nodePositions: layout.nodePositions,
    colorScheme: 'random',
    axis: { scaleX: 1, scaleY: 1 },
    contigThickness: 6,
    connectorThickness: 2,
    drawPaths: false,
  })
  const strokesOf = (id: string) => {
    const { start, count } = batch.nodeStrokeRuns.get(id)!
    return batch.nodeStrokes.slice(start, start + count)
  }
  for (const node of placeholders) {
    const [rim, fill] = strokesOf(node.id)
    expect(rim!.color).toBe(NOT_LOADED_COLOR)
    expect(fill!.color).toBe(NOT_LOADED_FILL_COLOR)
    expect(fill!.thickness).toBe(rim!.thickness - 1.5)
  }
  expect(strokesOf(loadedOff.id)).toHaveLength(1)
  const svg = figureSvg(graph, layout, { width: 600 })
  expect(svg).toContain(
    `fill="${abgrHex(NOT_LOADED_FILL_COLOR)}" stroke="${abgrHex(NOT_LOADED_COLOR)}"`,
  )
  expect(svg).toContain('>nodes not shown</text>')
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
  ).not.toContain('nodes not shown')
})

test('sample rows give no row for a placeholder, nor count it as sequence the reference lacks', async () => {
  const tables = twinTables()
  tables.nodes.refs[3] = 3
  tables.nodes.refNames.push('C#1#c')
  const graph = loadGraph(tables, 'cut')
  const placeholders = graph.nodes.filter(node => node.placeholder)
  expect(placeholders.some(isOffReference)).toBe(false)
  const layout = sampleRowLayout(graph)!
  expect(layout.sampleRows).toEqual(['C'])
  for (const node of placeholders) {
    expect(layout.nodePositions[node.id]![0]!.y).toBe(2 * ROW_HEIGHT_PX)
  }
  const available = async (loaded: boolean) =>
    layoutModeByValue('samplerows').available(
      loadGraph((await cut('blocks', 'c', 60, 120, { loaded })).tables, 'cut'),
    )
  expect(await available(false)).toBe(false)
  expect(await available(true)).toBe(true)
})

test('a graph over the node limit says how many of its nodes stand for nodes not shown', () => {
  expect(() => loadGraph(twinTables(), 'cut', { maxNodes: 5 })).toThrow(
    'Graph too large to draw: 6 nodes, 2 of them stretches whose nodes are not shown (limit 5)',
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
  expect(walkKey(a!).gaps).toBe(', 500 bp whose nodes are not shown')
  expect(walkKey(c!).gaps).toBe('')
})

test('a walk-rows figure of an unloaded cut is the figure of the loaded cut', async () => {
  const figure = async (loaded: boolean) => {
    const { tables, region, rows } = await cut('blocks', 'c', 60, 120, {
      loaded,
    })
    const graph = loadGraph(tables, 'cut')
    return figureSvg(graph, walkRowLayoutOf(graph, rows, region)!, {
      width: 900,
      region: { refName: 'c', ...region },
      walkRows: rows,
    })
  }
  expect(await figure(false)).toBe(await figure(true))
})

test('a cut says how many placeholders it returned, each a node of the tables', async () => {
  const { tables, placeholders } = await cut('blocks', 'c', 60, 120)
  expect(placeholders).toBeGreaterThan(0)
  expect(
    tables.nodes.placeholders!.reduce((sum, flagged) => sum + flagged, 0),
  ).toBe(placeholders)
})

test('a bubble with a run not loaded inside says some of its nodes are not shown', () => {
  const labels = (tables: GraphTables) =>
    graphBubbles(loadGraph(tables, 'cut')).map(bubble => bubbleLabel(bubble))
  expect(labels(twinTables())).toEqual([
    '500 bp–1 kb, 4 routes, some nodes not shown',
  ])
  const loaded = labels({
    ...twinTables(),
    nodes: { ...twinTables().nodes, placeholders: new Uint8Array(6) },
  })
  expect(loaded.join(' ')).not.toContain('not shown')
})

// graph-walks' placeholder is a run of steps off R, so the reference never
// steps one and a thread fold's reference nodes, built from R's steps, never
// hold one: every pass a walk makes over them is a step on R
test('a placeholder of a cut is never on the reference, so no folded reference node holds one', async () => {
  for (const [name, contig, start, end] of [
    ['blocks', 'c', 60, 120],
    ['blocks', 'c', 0, 60],
    ['interleaved', 'c', 0, 36],
    ['drawnedge', 'chr', 10_500, 13_500],
  ] as const) {
    const { tables } = await cut(name, contig, start, end)
    const held = new Set(
      [...(tables.nodes.placeholders ?? [])].flatMap((flag, i) =>
        flag === 1 ? [i] : [],
      ),
    )
    expect(held.size).toBeGreaterThan(0)
    for (const i of held) {
      expect(tables.nodes.ranks[i]).not.toBe(0)
    }
    const reference = tables.walks.names.findIndex(walk =>
      walk.startsWith(`R#0#${contig}`),
    )
    const steps = tables.walks.steps.slice(
      tables.walks.offsets[reference],
      tables.walks.offsets[reference + 1],
    )
    expect([...steps].some(step => held.has(step))).toBe(false)
    const graph = loadGraph(tables, 'cut')
    const fold = foldThreads(graph, 1)
    const names = new Set(
      graph.nodes.filter(node => node.placeholder).map(node => node.name),
    )
    expect(
      fold.graph.nodes.some(
        node =>
          node.stable?.rank === 0 &&
          (node.placeholder === true ||
            (node.members ?? []).some(member => names.has(member))),
      ),
    ).toBe(false)
  }
})
