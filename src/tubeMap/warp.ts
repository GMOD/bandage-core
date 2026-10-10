import type { TubeMapColumn } from '../layout/tubeMapLayout'

// Tube x to screen x under the reference axis. A column covers the screen span
// of the reference bp its backbone node covers, which puts the tubes under the
// linear view's other tracks. But the tube map changes lanes BETWEEN columns,
// and adjacent reference nodes abut in bp, so the curves would have no width
// at all. Each boundary gets back the gap the tube map drew (its curves, and
// any columns of inserted sequence, which cover no reference), up to
// MAX_GAP_PX, and the column edges move as little as they can to make room.
// A run of columns only a few bp wide has no room of its own, so it slides
// apart into the wide columns either side; otherwise every curve in it would
// be a vertical cliff. Zoomed out the gaps share at most half the screen and
// the curves steepen.
//
// Piecewise linear, so a curve's bezier, which lies inside one gap, maps
// exactly by mapping its control points.

export interface Knot {
  tx: number
  sx: number
}

// The most screen a boundary claims. The tube map spaces its columns to keep
// the lane changes shallow, which with many haplotypes is hundreds of px a
// gap; on the reference axis the curves steepen instead.
export const MAX_GAP_PX = 24
const MAX_GAP_SHARE = 0.5

const isReal = (c: TubeMapColumn) => c.bp1 > c.bp0

export function referenceKnots(
  columns: readonly TubeMapColumn[],
  bpToScreen: (bp: number) => number,
): Knot[] {
  const real = columns.filter(isReal)
  if (real.length === 0) {
    const first = columns[0]
    return first ? [{ tx: first.x0, sx: bpToScreen(first.bp0) }] : []
  }
  const tx: number[] = []
  const target: number[] = []
  // gap[k]: the least screen between knot k-1 and knot k
  const gap: number[] = []
  real.forEach((c, i) => {
    tx.push(c.x0, c.x1)
    target.push(bpToScreen(c.bp0), bpToScreen(c.bp1))
    gap.push(i === 0 ? 0 : Math.min(c.x0 - real[i - 1]!.x1, MAX_GAP_PX), 0)
  })
  const span = target.at(-1)! - target[0]!
  const demand = gap.reduce((a, b) => a + b, 0)
  const scale = demand > 0 ? Math.min(1, (MAX_GAP_SHARE * span) / demand) : 1
  return spread(target, gap, scale).map((sx, k) => ({ tx: tx[k]!, sx }))
}

// The positions nearest `target`, least squares, that keep each `gap` (times
// `scale`) between neighbours. Less the running sum of the gaps the constraint
// is only that positions never decrease, so this is isotonic regression: pool
// adjacent violators.
function spread(target: number[], gap: number[], scale: number) {
  const offset: number[] = []
  let sum = 0
  for (const g of gap) {
    sum += g * scale
    offset.push(sum)
  }
  const blocks: { mean: number; n: number }[] = []
  target.forEach((t, k) => {
    let block = { mean: t - offset[k]!, n: 1 }
    let last = blocks.at(-1)
    while (last && last.mean >= block.mean) {
      blocks.pop()
      const n = last.n + block.n
      block = { mean: (last.mean * last.n + block.mean * block.n) / n, n }
      last = blocks.at(-1)
    }
    blocks.push(block)
  })
  return blocks
    .flatMap(b => Array<number>(b.n).fill(b.mean))
    .map((q, k) => q + offset[k]!)
}

// Beyond the first and last knot the drawing continues at one screen px per
// tube px, which is where the track stubs past the end nodes go.
export function warpX(knots: readonly Knot[], tx: number) {
  const n = knots.length
  if (n === 0) {
    return tx
  }
  const first = knots[0]!
  const last = knots[n - 1]!
  if (tx <= first.tx) {
    return first.sx + (tx - first.tx)
  }
  if (tx >= last.tx) {
    return last.sx + (tx - last.tx)
  }
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (knots[mid]!.tx <= tx) {
      lo = mid
    } else {
      hi = mid
    }
  }
  const a = knots[lo]!
  const b = knots[hi]!
  const span = b.tx - a.tx
  return span > 0 ? a.sx + ((tx - a.tx) / span) * (b.sx - a.sx) : a.sx
}
