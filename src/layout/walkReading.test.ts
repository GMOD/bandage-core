import * as graphWalks from '@jbrowse/graph-walks'

import { anchorEvents, readsBackToFront } from './walkReading'

import type { PathEvent } from './walkReading'

// Event lists of every shape the rule tells apart, from a seeded generator:
// stretches along and against the reference, of 0 bp and more, entering and
// leaving anywhere, with bp of their own between
function* eventLists() {
  let seed = 20261123
  const next = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31
    return seed / 2 ** 31
  }
  for (let n = 0; n < 2000; n++) {
    const events: PathEvent[] = []
    const count = Math.floor(next() * 6)
    for (let k = 0; k < count; k++) {
      if (next() < 0.25) {
        events.push({ kind: 'own', bp: Math.floor(next() * 50) })
      } else {
        const lo = Math.floor(next() * 100)
        events.push({
          kind: 'on',
          lo,
          hi: lo + Math.floor(next() * 3) * Math.floor(next() * 40),
          reversed: next() < 0.5,
        })
      }
    }
    yield events
  }
}

test("readsBackToFront reads every event list as graph-walks' does", () => {
  for (const events of eventLists()) {
    expect(readsBackToFront(events)).toBe(graphWalks.readsBackToFront(events))
  }
})

// A walk forward at its flanks, 0-100 and 1700-1800, with an inversion over
// most of the window between, as two departures that switch strand state it
test('a walk inverted between forward flanks reads forward from its departures alone', () => {
  const events = anchorEvents([
    { hap: 0, order: 0, pos: 100, reversed: false, own: 0 },
    { hap: 0, order: 1, pos: 1700, reversed: true },
    { hap: 1600, order: 0, pos: 100, reversed: true, own: 0 },
    { hap: 1600, order: 1, pos: 1700, reversed: false },
  ])
  expect(events).toEqual([
    { kind: 'on', lo: 100, hi: 100, reversed: false },
    { kind: 'own', bp: 0 },
    { kind: 'on', lo: 100, hi: 1700, reversed: true },
    { kind: 'own', bp: 0 },
    { kind: 'on', lo: 1700, hi: 1700, reversed: false },
  ])
  expect(readsBackToFront(events)).toBe(false)
  expect(
    readsBackToFront([{ kind: 'on', lo: 100, hi: 1700, reversed: true }]),
  ).toBe(true)
})
