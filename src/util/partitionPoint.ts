// The first index in [0, n) where `pred`, true then false, is false; n if none
export function partitionPoint(n: number, pred: (i: number) => boolean) {
  let lo = 0
  let hi = n
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (pred(mid)) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  return lo
}
