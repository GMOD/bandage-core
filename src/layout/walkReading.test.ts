import * as graphWalks from '@jbrowse/graph-walks'
import { LocalFile } from 'generic-filehandle2'

import { anchorEvents, readsBackToFront } from './walkReading'
import { walkRowRuns, walkRowsOf } from './walkRowRuns'

import type { PathAnchor, PathEvent } from './walkReading'

// A seeded stream of numbers in [0, 1)
function seeded(seed: number) {
  let state = seed
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31
    return state / 2 ** 31
  }
}

// Event lists of every shape the rule tells apart: stretches along and
// against the reference, of 0 bp and more, with bp of their own between
function* eventLists() {
  const next = seeded(20261123)
  for (let n = 0; n < 2000; n++) {
    const events: PathEvent[] = []
    for (let k = Math.floor(next() * 6); k > 0; k--) {
      const lo = Math.floor(next() * 100)
      events.push(
        next() < 0.25
          ? { kind: 'own', bp: Math.floor(next() * 50) }
          : {
              kind: 'on',
              lo,
              hi: lo + Math.floor(next() * 3) * Math.floor(next() * 40),
              reversed: next() < 0.5,
            },
      )
    }
    yield events
  }
}

// Anchor lists as pieces' ends and departures' ends make them, some at one
// place on the contig
function* anchorLists() {
  const next = seeded(20261124)
  for (let n = 0; n < 2000; n++) {
    const anchors: PathAnchor[] = []
    for (let k = Math.floor(next() * 8); k > 0; k--) {
      const order = next() < 0.5 ? 0 : 1
      anchors.push({
        hap: Math.floor(next() * 5) * 100,
        order,
        pos: Math.floor(next() * 1000),
        reversed: next() < 0.5,
        ...(order === 0 && next() < 0.5 ? { exit: true } : {}),
        ...(order === 0 ? { own: Math.floor(next() * 30) } : {}),
      })
    }
    yield anchors
  }
}

test("readsBackToFront and anchorEvents read every list as graph-walks' do", () => {
  for (const events of eventLists()) {
    expect(readsBackToFront(events)).toBe(graphWalks.readsBackToFront(events))
  }
  for (const anchors of anchorLists()) {
    expect(anchorEvents(anchors)).toEqual(graphWalks.anchorEvents(anchors))
  }
})

// Each row of a walk-file fixture's cut reads its contig the way
// graph-walks' pathOrientations reads that path, from the same pieces and
// departures
test.each([
  ['orient.GRCh38', 2000, 8000, 1000],
  ['orient.GRCh38', 4500, 5500, 0],
  ['orient.GRCh38', 0, 10_000, 0],
  ['rejoin.GRCh38', 1000, 1500, 500],
  ['rejoin.GRCh38', 1000, 2000, 0],
  ['records.GRCh38', 1500, 3500, 0],
  ['records.GRCh38', 5500, 6500, 500],
  ['revisit.GRCh38', 0, 3000, 0],
  ['strand.R', 0, 40, 0],
])(
  'rows of %s over %i-%i read as graph-walks reads their paths',
  async (name, start, end, context) => {
    const reader = graphWalks.WalkReader.open(
      `test_data/walks8/${name}.walks.gz`,
      url => new LocalFile(url),
    )
    const cut = await reader.cut(
      `${name.split('.').at(-1)}#0#${name === 'strand.R' ? 'chr' : 'chr1'}`,
      { start, end },
      { context },
    )
    const orientations = graphWalks.pathOrientations({
      fragments: cut.fragments,
      departures: cut.departures,
      nodes: cut.graph.nodes,
    })
    const tables = cut.graph.tables(cut.kept, cut.fragments, cut.departures)
    const rows = walkRowsOf(walkRowRuns(tables, { start, end })!).rows.filter(
      row => !row.stepless,
    )
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect([row.name, row.flipped === true]).toEqual([
        row.name,
        orientations.get(row.name) ?? false,
      ])
    }
  },
)
