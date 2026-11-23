import { anchorEvents, readsBackToFront } from './walkReading'

import type { PathEvent } from './walkReading'

const on = (lo: number, hi: number, reversed = false): PathEvent => ({
  kind: 'on',
  lo,
  hi,
  reversed,
})
const own = (bp: number): PathEvent => ({ kind: 'own', bp })

test('a contig reads back to front where it walks the reference only against it', () => {
  expect(readsBackToFront([on(100, 1700, true)])).toBe(true)
  expect(readsBackToFront([on(600, 1700), own(1700), on(0, 600)])).toBe(false)
  expect(readsBackToFront([own(300)])).toBe(false)
})

test('a contig walking both ways reads by where it leaves the reference against where it entered, and by bp where it leaves where it entered', () => {
  expect(
    readsBackToFront([on(0, 100), on(100, 1700, true), on(1700, 1800)]),
  ).toBe(false)
  expect(
    readsBackToFront([on(1700, 1800, true), on(100, 1700), on(0, 100, true)]),
  ).toBe(true)
  expect(readsBackToFront([on(0, 100), own(5), on(0, 100, true)])).toBe(false)
  expect(readsBackToFront([on(0, 100, true), own(5), on(0, 300)])).toBe(false)
})

// >3>4<5>6>7 over 1 kb nodes from 2 kb, then a jump back to node 1's start,
// outside the cut: the departure's end walks no bp
test('a departure end walks no bp, so a jump back does not turn round a contig mostly along the reference', () => {
  expect(
    readsBackToFront([
      on(2000, 4000),
      on(4000, 5000, true),
      on(5000, 7000),
      own(0),
      on(0, 0),
    ]),
  ).toBe(false)
})

// a tandem copy longer than the tiles read: the contig starts with the jump
// back from 9 kb, then walks 1-3 kb along the reference with one node reversed
test('a contig that starts with a jump back reads by the bp it walks', () => {
  expect(
    readsBackToFront([
      on(9000, 9000),
      own(0),
      on(1000, 2000),
      on(2000, 2100, true),
      on(2100, 3000),
    ]),
  ).toBe(false)
})

// a window inside an inversion: the contig is against the reference
// throughout, and the departures into and out of the inversion stand on it
// along it
test('a contig one way between departure ends the other way at both its ends reads as an inversion between them, and one such end decides nothing', () => {
  expect(
    readsBackToFront([
      on(7_616_815, 7_616_815),
      own(0),
      on(7_393_526, 12_234_236, true),
      own(0),
      on(12_338_568, 12_338_568),
    ]),
  ).toBe(false)
  expect(
    readsBackToFront([
      on(7_616_815, 7_616_815, true),
      own(0),
      on(7_393_526, 12_234_236, true),
    ]),
  ).toBe(true)
  // R1M-05: a contig that comes from the far p arm against the reference by
  // a record and walks the window along it reads along the reference
  expect(
    readsBackToFront([
      on(11_774_636, 11_774_636, true),
      own(5_631_835),
      on(15_154_318, 15_466_138),
    ]),
  ).toBe(false)
})

test('anchorEvents follows the reference from a rejoin to the next leave', () => {
  expect(
    anchorEvents([
      { hap: 1600, order: 0, pos: 100, reversed: true, own: 0 },
      { hap: 0, order: 1, pos: 1700, reversed: true },
      { hap: 1600, order: 1, pos: 1700, reversed: false },
    ]),
  ).toEqual([
    { kind: 'on', lo: 100, hi: 1700, reversed: true },
    { kind: 'own', bp: 0 },
    { kind: 'on', lo: 1700, hi: 1700, reversed: false },
  ])
})
