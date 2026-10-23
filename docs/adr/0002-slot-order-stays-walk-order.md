# 2. Slot order stays walk order

**Status:** accepted, 2026-10-23

## Context

- `slotCentres` in `src/renderer/walkLanes.ts` stacks every node's walks in the
  order the walks were lifted, so one walk runs on the same side of another
  along every band.
- Where a band splits and a walk heads off to the far side of another, their
  threads cross. In 11.13.0 the RHD and C4 syng figures each have 5 thread
  crossings, 7 of the 10 between different walks.
- A harness draws each figure at 1200 × 800 px, chains each walk's strokes into
  threads, and counts the crossings.

## Options tried

| Build                                                       | RHD | C4  |
| ----------------------------------------------------------- | --- | --- |
| 11.13.0, lifted order                                       | 5   | 5   |
| best of the 6 lifted orders                                 | 5   | 5   |
| per stretch, ending at the first node the walks don't share | 115 | 185 |
| per stretch, bridging bubbles that rejoin within two bands  | 21  | 7   |
| bridging, and a node with no lean takes its neighbour's     | 19  | 5   |

- **Global order.** Lifting the walks in another order only moves crossings from
  one junction to another.
- **Order per shared stretch.** For each pair of walks on a node, `slotOrders`
  followed both walks in lockstep along the nodes they share to each end of the
  stretch. It measured how far one ends up to the normal's side of the other two
  bands past the end, and stacked the walk leaving further along the normal
  later. Every node of a stretch sees the same two ends, so the order was meant
  to hold along it.
  - Syng walks part at every small bubble, so stretches had to bridge bubbles
    that rejoin within reach, and a lean under a quarter band counted as none.
  - A node with no decisive lean took the nearest lean the pair has along a run
    through it, so nodes some passes skip kept the band's order.
  - The last build put blue above grey along the RHD figure's horizontal band,
    as intended. Elsewhere, where a stretch's two ends call for opposite orders,
    the swap landed wherever the lockstep lost the shared route, such as
    mid-band on the diagonal and on both sides of the top loop's hairpin. A
    walk's second thread also wove through the other walk's slot where the
    number of passes changed from node to node.

## Decision

- Keep stacking walks in lifted order.
- When each stretch's order comes from its own two ends alone, nothing picks
  where a forced swap goes, and the trial's swaps fell in the open band more
  often than at a junction.

## Consequences

- Threads of different walks cross where a band splits towards the other walk's
  side.
- Revisit as crossing minimisation over the whole lifted graph (as in metro-line
  layout), which chooses every stretch's order together and places each forced
  swap at a junction.
