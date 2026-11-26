import { WalkFile } from '@gmod/gfa-tabix'

import { walkRowReadout } from '../layout/walkRowDraw'
import { walkRowRuns, walkRowsOf } from '../layout/walkRowRuns'
import { walkRows } from '../layout/walkRows'
import { graphFromTables } from './graphTables'

import type { GraphTables } from './graphTables'

// Walk format 8 files built by test_data/walks8/build.sh from the GFAs beside
// them, cut by graph-walks 7 as the plugin and BandageJS cut them, on chr1 of
// the reference the name ends in
async function rowsOf(name: string, start: number, end: number, context = 0) {
  const reader = new WalkFile({
    walksPath: `test_data/walks8/${name}.walks.gz`,
  })
  const { graph, kept, fragments, departures } = await reader.getCutForRange(
    `${name.split('.').at(-1)}#0#chr1`,
    start,
    end,
    { context },
  )
  const tables = graph.tables(kept, fragments, departures)
  const region = { start, end }
  const rows = walkRowsOf(walkRowRuns(tables, region)!)
  expect(walkRows(graphFromTables(tables), region)).toEqual(rows)
  return {
    rows,
    row: (label: string) => {
      const row = rows.rows.find(r => r.label === label)!
      return {
        readout: walkRowReadout(row, rows.reference),
        gaps: row.runs
          .filter(r => r.gap)
          .map(r => ({
            start: r.start,
            bp: r.bp,
            cause: r.cause,
          })),
        row,
      }
    },
  }
}

// skip.GRCh38.gfa: HG002 steps from chr1:20 to 80 with nothing between
test('a haplotype with no step in the window is a row of its departure', async () => {
  const { row } = await rowsOf('skip.GRCh38', 40, 60)
  expect(row('HG002#1')).toMatchObject({
    readout: 'no step on GRCh38 across 60 bp',
    gaps: [{ start: 0, bp: 20, cause: 'departure' }],
    row: { bp: 0, offReferenceBp: 0, stepless: true },
  })
})

// With context the cut holds HG002's steps on chr1:10-20 and 80-90, the
// window's flanks, and nothing of it between them
test('a haplotype whose steps in the cut are the flanks alone is a row of its departure', async () => {
  const { row } = await rowsOf('skip.GRCh38', 31, 60, 1000)
  expect(row('HG002#1')).toMatchObject({
    readout: 'no step on GRCh38 across 60 bp',
    gaps: [{ start: 0, bp: 30, cause: 'departure' }],
    row: { bp: 0, offReferenceBp: 0, stepless: true, complete: true },
  })
  expect(row('HG002#1').row.departures).toMatchObject([
    { leavePos: 20, rejoinPos: 80, ownBp: 0 },
  ])
})

// rejoin.GRCh38 (below) with 500 bp of context: chr1:1500-2000's left flank,
// chr1:1000-1500, is HG002#1's only step on the cut, and its departure from
// 1500 to 4000 crosses the window; at chr1:3500-4000 it comes into the right
// flank, 4000-4500, by the same departure
test('a haplotype whose only step is a flank, with a departure across the window, is a row of that departure', async () => {
  const { row } = await rowsOf('rejoin.GRCh38', 1500, 2000, 500)
  expect(row('HG002#1')).toMatchObject({
    readout: 'no step on GRCh38 across 2.5 kb · 4.0 kb of its own',
    gaps: [{ start: 0, bp: 500, cause: 'departure' }],
    row: { bp: 0, offReferenceBp: 4000, stepless: true, complete: true },
  })
  const back = await rowsOf('rejoin.GRCh38', 3500, 4000, 500)
  expect(back.row('HG002#1')).toMatchObject({
    readout: 'no step on GRCh38 across 2.5 kb · 4.0 kb of its own',
    gaps: [{ start: 0, bp: 500, cause: 'departure' }],
    row: { bp: 0, offReferenceBp: 4000, stepless: true },
  })
})

// follow.GRCh38.gfa: HG002#1 leaves at 1500 for 4 kb of its own and rejoins
// at 4000
test("a stepless row states the own bp between the departure's ends", async () => {
  for (const context of [0, 1000]) {
    const { row } = await rowsOf('follow.GRCh38', 2000, 3000, context)
    expect(row('HG002#1')).toMatchObject({
      readout: 'no step on GRCh38 across 2.5 kb · 4.0 kb of its own',
      gaps: [{ start: 0, bp: 1000, cause: 'departure' }],
      row: { offReferenceBp: 4000, stepless: true },
    })
    expect(row('HG002#2').row.stepless).toBeUndefined()
  }
})

// records.GRCh38.gfa: HG002's contig is three W lines, 0-2000 and 4000-7000
// on the reference with 2500-3200 between on a node it has no step on, so
// 1300 bp of the 2 kb between are in no W line. HG003 jumps from 1500 to
// 9000 and back from 10000 to 1500.
test('a gap states what the departure across it says: bp the graph lacks, own bp the cut did not read, where the walk goes on', async () => {
  const { row } = await rowsOf('records.GRCh38', 1500, 3500)
  expect(row('HG002#1')).toMatchObject({
    readout:
      '3.0 kb (+1.0 kb), of which 1.3 kb left out of graph, 700 bp own sequence not drawn',
    gaps: [
      { start: 500, bp: 1300, cause: 'missing' },
      { start: 1800, bp: 700, cause: 'own' },
    ],
  })
  const away = await rowsOf('records.GRCh38', 1000, 3000)
  expect(away.row('HG003#1')).toMatchObject({
    readout: '3.0 kb of its contig, of which 1.0 kb away from the window',
    gaps: [{ start: 500, bp: 30, cause: 'away' }],
  })
})

// revisit.GRCh38.gfa: the reference passes node 7 twice, and HG002 leaves it
// for node 11
test('a departure from a node the reference passes twice is a placement choice', async () => {
  const { row } = await rowsOf('revisit.GRCh38', 4000, 5000)
  const hg002 = row('HG002#1')
  expect(hg002.row.placementChoice).toBe(true)
  expect(hg002.row.departures).toMatchObject([
    { leavePos: 4500, leavePasses: 2, rejoinPos: 5000, ownBp: 500 },
  ])
  expect(hg002.readout).toMatch(/ · placement choice$/)
})

// rejoin.GRCh38.gfa is follow.GRCh38.gfa, its walk file in one 10 kb tile as
// the plugin's walks6_rejoin. With 500 bp of context, HG002#1 and HG003#1
// reach chr1:1000-1500's left flank alone: HG002#1 leaves at 1500 for 4 kb of
// its own and rejoins at 4000, and HG003#1's contig runs on 300 bp off the
// reference. In records.GRCh38.gfa HG002's last W line ends on chr1:5500-6000
test("a walk ending at the window's edge reads as a contig end only with no departure there and nothing trimmed past it", async () => {
  const { row } = await rowsOf('rejoin.GRCh38', 1000, 1500, 500)
  expect(row('HG002#1')).toMatchObject({
    readout: '≥ 500 bp · goes on near chr1:4 kb · 4.0 kb of its own',
    row: {
      complete: false,
      stops: {
        right: {
          contigEnds: false,
          goesOn: { near: 4000, departure: { leavePos: 1500, ownBp: 4000 } },
        },
      },
    },
  })
  expect(row('HG003#1')).toMatchObject({
    readout: '≥ 500 bp · goes on away from the window',
    row: {
      complete: false,
      stops: { right: { contigEnds: false, shortBp: 0 } },
    },
  })
  const ends = await rowsOf('records.GRCh38', 5500, 6500, 500)
  expect(ends.row('HG002#1')).toMatchObject({
    readout: '≥ 500 bp · no more of the contig on GRCh38 chr1',
    row: {
      complete: false,
      stops: { right: { contigEnds: true, shortBp: 0 } },
    },
  })
})

// HG002#1 reaches chr1:4000-4500's right flank alone, by the departure that
// rejoins at 4000 from 1500
test('a walk that comes into the window by a departure says where it comes from', async () => {
  const { row } = await rowsOf('rejoin.GRCh38', 4000, 4500, 500)
  expect(row('HG002#1')).toMatchObject({
    readout: '≥ 500 bp · comes from away from the window',
    row: {
      complete: false,
      stops: { left: { contigEnds: false, goesOn: { near: 1500 } } },
    },
  })
})

// With no context the cut has no flanks, so the reference's outermost nodes
// in it, chr1:1000-1500 and 1500-2000, stand in for them: HG002#1 and HG003#1
// stop past the first, HG002#2 walks both. In records.GRCh38.gfa HG002's
// contig ends on chr1:5500-6000, and HG003 walks it and 6000-6500
test('with no context, a walk that stops inside the window states how, and a whole one reads complete', async () => {
  const { row } = await rowsOf('rejoin.GRCh38', 1000, 2000)
  expect(row('HG002#1')).toMatchObject({
    readout: '≥ 500 bp · goes on near chr1:4 kb · 4.0 kb of its own',
    row: {
      bp: 500,
      complete: false,
      stops: { right: { goesOn: { near: 4000 } } },
    },
  })
  expect(row('HG003#1')).toMatchObject({
    readout: '≥ 500 bp · goes on away from the window',
    row: { bp: 500, complete: false, stops: { right: { contigEnds: false } } },
  })
  expect(row('HG002#2')).toMatchObject({
    readout: '1.0 kb',
    row: { complete: true },
  })
  const ends = await rowsOf('records.GRCh38', 5500, 6500)
  expect(ends.row('HG002#1')).toMatchObject({
    readout: '≥ 500 bp · no more of the contig on GRCh38 chr1',
    row: {
      complete: false,
      stops: { right: { contigEnds: true, shortBp: 0 } },
    },
  })
  expect(ends.row('HG003#1')).toMatchObject({
    readout: '1.0 kb',
    row: { complete: true },
  })
})

// With 500 bp of context, chr1:1500-2000's left flank, chr1:1000-1500, is
// HG003#1's only step on the cut, and its contig runs on 300 bp off the
// reference. In records.GRCh38.gfa HG002's contig ends on chr1:6000-6500's
// left flank
test('a walk whose only step is a flank has no bp in the window and says how it goes on from there', async () => {
  const { row } = await rowsOf('rejoin.GRCh38', 1500, 2000, 500)
  expect(row('HG003#1')).toMatchObject({
    readout: 'goes on away from the window',
    row: { bp: 0, complete: false, stops: { right: { contigEnds: false } } },
  })
  expect(row('HG002#2')).toMatchObject({
    readout: '500 bp',
    row: { complete: true },
  })
  const ends = await rowsOf('records.GRCh38', 6000, 6500, 500)
  expect(ends.row('HG002#1')).toMatchObject({
    readout: 'last step on GRCh38 chr1 at the window',
    row: {
      bp: 0,
      complete: false,
      stops: { right: { contigEnds: true, shortBp: 0 } },
    },
  })
})

// clip.REF.gfa, built with --walks --refs REF --tile 1000: five 100 bp REF
// nodes over chr1:0-500, and two contigs that end on
// the third, CLIP along REF and CLIPSNP through node 6 in place of 2, a
// departure between its steps. The cut holds all of REF, so has no flank at
// any context. Walk-file controls: rejoin.GRCh38's HG002#2 walks the whole of
// chr1:1000-2000
test("a walk file's contig that ends inside the window with no departure reads as ending there", async () => {
  for (const [start, end, context] of [
    [0, 500, 0],
    [0, 500, 100],
    [50, 450, 0],
  ] as const) {
    const { row } = await rowsOf('clip.REF', start, end, context)
    for (const label of ['CLIP#1', 'CLIPSNP#1']) {
      expect(row(label)).toMatchObject({
        readout: '≥ 300 bp · no more of the contig on REF chr1',
        row: {
          complete: false,
          stops: { right: { contigEnds: true, shortBp: 0 } },
        },
      })
    }
  }
  const whole = await rowsOf('rejoin.GRCh38', 1000, 2000)
  expect(whole.row('HG002#2')).toMatchObject({
    readout: '1.0 kb',
    row: { complete: true },
  })
})

// orient.GRCh38.gfa: GRCh38 over chr1:0-10,000 in 1 kb nodes 1-10, cut over
// chr1:2000-8000 with 1 kb of context, each haplotype modelled on a window of
// the HPRC v2.1 audit:
// - HG01960#1, H-8p23: forward into the window, then its contig's next W line,
//   500 bp on, walks it reversed from the right flank, jumps out to node 2
//   and walks node 3 forward again
// - HG00097#1, H-8p23: inverted between forward flanks outside the cut, by a
//   departure that switches strand at either end
// - HG00099#1: its contig stored back to front, with no inversion
// - HG01123#1, R1M-06: a whole forward pass, 500 bp of its own, then a second
//   pass that ends inside the window
describe('a row over a window its walk crosses more than once', () => {
  const runsOf = async (label: string) => {
    const { row } = await rowsOf('orient.GRCh38', 2000, 8000, 1000)
    const { readout, row: drawn } = row(label)
    return {
      readout,
      runs: drawn.runs.map(r =>
        r.gap ? [r.bp, r.cause] : [r.bp, r.referenceStart, r.reversed === true],
      ),
    }
  }

  test('draws every stretch of its contig in the window, and its steps outside it as breaks of one width', async () => {
    expect(await runsOf('HG01960#1')).toEqual({
      readout:
        '9.5 kb of its contig, of which 4.0 kb reversed, 500 bp left out of graph, 2.0 kb away from the window · no more of the contig on GRCh38 chr1',
      runs: [
        [2000, 2000, false],
        [500, 'missing'],
        [90, 'away'],
        [4000, 4000, true],
        [90, 'away'],
        [1000, 2000, false],
      ],
    })
    expect(await runsOf('HG01123#1')).toEqual({
      readout:
        '11 kb of its contig, of which 1.0 kb away from the window · no more of the contig on GRCh38 chr1',
      runs: [
        [6000, 2000, false],
        [90, 'away'],
        [500, undefined, false],
        [3000, 4000, false],
      ],
    })
  })

  test('paints an inverted walk reversed, and a contig stored back to front reversed end to end', async () => {
    expect(await runsOf('HG00097#1')).toEqual({
      readout: '≥ 6.0 kb, of which 6.0 kb reversed · goes on near chr1:9 kb',
      runs: [[6000, 2000, true]],
    })
    expect(await runsOf('HG00099#1')).toEqual({
      readout: '6.0 kb, of which 6.0 kb reversed',
      runs: [[6000, 2000, true]],
    })
  })
})

// strand.R.gfa, graph-walks' fixture: R walks >1<2<3>4, 10 bp each, and A
// walks >1>3>2>1. A cut of the first 10 bp holds R's step on 1 alone and A's
// steps on 3 and 2, which the tables place on the reference
test('a reference node a haplotype brings into a cut takes the strand the reference steps it on', async () => {
  const reader = new WalkFile({
    walksPath: 'test_data/walks8/strand.R.walks.gz',
  })
  const tablesOf = async (end: number) => {
    const { graph, kept, fragments, departures } = await reader.getCutForRange(
      'R#0#chr',
      0,
      end,
      { context: 0 },
    )
    return graph.tables(kept, fragments, departures)
  }
  const strands = (tables: GraphTables) =>
    graphFromTables(tables).nodes.map(
      node => `${node.name}${node.stable?.strand ?? '?'}`,
    )
  const first = await tablesOf(10)
  expect(Array.from(first.nodes.reversed ?? [])).toEqual([0, 1, 1])
  expect(strands(first)).toEqual(['1+', '2-', '3-'])
  const { reversed: _, ...unstated } = first.nodes
  expect(strands({ ...first, nodes: unstated })).toEqual(['1+', '2?', '3?'])
  const whole = await tablesOf(40)
  const { reversed: __, ...walked } = whole.nodes
  expect(strands(whole)).toEqual(['1+', '2-', '3-', '4+'])
  expect(graphFromTables(whole)).toStrictEqual(
    graphFromTables({ ...whole, nodes: walked }),
  )
})
