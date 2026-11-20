import type { Graph, GraphNode, NodeSegment } from '../../src/types'

export const W = 1600
export const H = 1000

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function makeGraph(n: number, seed = 1) {
  const r = rng(seed)
  const gauss = () =>
    Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r())
  const nodes: GraphNode[] = []
  const edges: Graph['edges'] = []
  const positions: Record<string, NodeSegment[]> = {}
  const lengths: number[] = []
  for (let i = 0; i < n; i++) {
    lengths.push(Math.max(50, Math.round(800 * Math.exp(1.2 * gauss()))))
  }
  const sqrtSum = lengths.reduce((a, l) => a + Math.sqrt(l), 0)
  const inkPx = (0.6 * W * H) / 6
  let i = 0
  while (i < n) {
    const chain = Math.min(n - i, 10 + Math.floor(r() * 150))
    const from = i > 0 && r() < 0.8 ? Math.floor(r() * i) : -1
    const anchor = from >= 0 ? positions[`${from}+`]!.at(-1)! : undefined
    let heading = r() * 2 * Math.PI
    let x = anchor
      ? Math.min(W - 10, Math.max(10, anchor.x + 3 * Math.cos(heading)))
      : 20 + r() * (W - 40)
    let y = anchor
      ? Math.min(H - 10, Math.max(10, anchor.y + 3 * Math.sin(heading)))
      : 20 + r() * (H - 40)
    if (from >= 0) {
      edges.push({ from: `${from}+`, to: `${i}+` })
    }
    for (let c = 0; c < chain; c++, i++) {
      const length = lengths[i]!
      const u = r()
      const base = 30 * Math.exp(0.3 * gauss())
      const depth =
        u < 0.05
          ? 1 + r() * 9
          : u < 0.12
            ? base * 2
            : u < 0.15
              ? base * (3 + r() * 5)
              : base
      const id = `${i}+`
      nodes.push({ id, name: `${i}`, length, depth: +depth.toFixed(4) })
      const px = (inkPx * Math.sqrt(length)) / sqrtSum
      const k = Math.min(
        10,
        Math.max(2, 2 + Math.round(Math.log2(length / 200))),
      )
      const pts: NodeSegment[] = [{ x, y }]
      for (let s = 1; s < k; s++) {
        heading += 0.25 * gauss()
        x += (Math.cos(heading) * px) / (k - 1)
        y += (Math.sin(heading) * px) / (k - 1)
        if (x < 10 || x > W - 10) {
          heading = Math.PI - heading
          x = Math.min(W - 10, Math.max(10, x))
        }
        if (y < 10 || y > H - 10) {
          heading = -heading
          y = Math.min(H - 10, Math.max(10, y))
        }
        pts.push({ x, y })
      }
      positions[id] = pts
      const gap = Math.max(1.5, px / 3)
      x = Math.min(W - 10, Math.max(10, x + Math.cos(heading) * gap))
      y = Math.min(H - 10, Math.max(10, y + Math.sin(heading) * gap))
      if (c > 0) {
        edges.push({ from: `${i - 1}+`, to: id })
      }
      if (c > 1 && r() < 0.15) {
        edges.push({ from: `${i - 2}+`, to: id })
      }
    }
  }
  return { graph: { name: 'bench', nodes, edges } satisfies Graph, positions }
}
