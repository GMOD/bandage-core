# 3. Threads stay on their nodes

**Status:** accepted, 2026-11-20

## Context

- A walk's threads run on its lane's line, which `laneLines` in
  `src/renderer/walkLanes.ts` smooths, and each thread runs up to half the band
  off that line.
- Two steps moved the line further than half the band off the walk's nodes:
  - `cutCurls` replaced a curl shorter than π bands that closed within half a
    band by its chord.
  - `loosened` smoothed the line again, up to eight times, within three
    half-bands of wherever it turned tighter than half the band. A small loop
    shrank towards its base on every pass.
- Both measure the band in screen px and the loop in layout units, so a loop the
  threads followed in a large pane lost them in a smaller one. On the C4 syng
  graph with grch38, HG01978#2 and HG01952#1 lifted (a 28 px band), a thread ran
  up to 51, 41 and 45 px off a node it was drawn for at 1000 × 800, 750 × 550
  and 560 × 390 px. The HERV-K loop's grey and blue threads curled at its base
  at 750 × 550 and left it at 560 × 390, and at every size all three walks'
  threads skipped the small loop at the lower right that each of them walks.

## Decision

- A thread lies over the node it is drawn for: no further from the node's line
  than the band is wide, at any pane size or zoom.
- The line is smoothed once, over half a band either side, which moves no point
  more than half a band. `cutCurls` and `loosened` are gone.
- Where the line still turns tighter than half the band, every thread's offset
  from it is scaled by the turning radius over half the band, so the inner
  thread rounds the turn instead of folding back, and the line stays on the
  nodes.

## Consequences

- On the same graph the furthest thread runs 17 px off its node at all three
  sizes, and threads go round both loops.
- Hairpin tips no longer stop half a band short of their nodes, as decision 1
  had them: the band reaches the tip and narrows there. In the `syng_rhd`
  gallery figure, pass 1's hairpin now reaches the hub's node cluster.
- A loop narrower than the band draws its threads bunched over it rather than
  spread across it.
