# 1. Hairpin tips keep their pull-back

**Status:** accepted, 2026-10-23

## Context

- `loosened` in `src/renderer/walkLanes.ts` smooths a lane's line again wherever
  it turns tighter than half the band, so a hairpin's inner thread rounds the
  tip instead of folding back on itself.
- The smoothing pulls a hairpin's tip back towards its arms. In the RHD syng
  figure the lanes stop 11–16 px short of the hub's node cluster, against a 24.5
  px band.

## Options tried

- **Restore the centreline's tip.** After smoothing, `reachTip` slid each
  loosened turn back out along the hairpin's axis by the distance smoothing
  took, scaled by how far the turn folds (fully for a hairpin, not at all for a
  right angle). It tapered the slide over four radii of the arms beyond the
  turn, so straight arms slid along themselves.
  - In a 1200×800 render the hub's hairpins reached the cluster with round inner
    threads.
  - In the `syng_rhd` gallery figure, the two hairpins entering the hub from
    opposite sides overlapped, the outer grey thread of one crossing the blue
    threads of the other.
  - A test hairpin with arms 8 px apart and its tip at x = 29 had its outermost
    thread reach x = 17 before the change and past 29 after it.
- **Restore only the outer thread's reach.** The same slide, less half the band,
  left the outermost thread at the tip. It drew almost exactly what 11.13.0
  draws.

## Decision

- Keep the pull-back. `loosened` already leaves the band's outer thread close to
  the hairpin's tip, so the gap at the hub is the room the band needs to turn.
- If `loosened` slides a hairpin further out, its band runs past its own nodes
  and over any band that meets those nodes from the other side.

## Consequences

- Lanes at a hairpin stop short of the node cluster by about half the band.
- Revisit this decision only if the core also spaces opposing hairpins apart,
  for example by giving each hairpin's band its own side of a shared node.
