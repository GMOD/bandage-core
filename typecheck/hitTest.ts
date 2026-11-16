// A hit test is told whether its drawing is stranded, as the drawing is: a
// default would test the nearer node ends where a force layout draws a link
// into the ends its strands name. It is told what ticks stand for too, which
// no link draws.
import type { findHoveredEdge } from '../src/util/hitDetection'

type Holds<T extends true> = T

export type HitTestStatesStrandedness = Holds<
  Parameters<typeof findHoveredEdge>['length'] extends 12 ? true : false
>
