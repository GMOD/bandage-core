// A hit test is told whether its drawing is stranded, as the drawing is: a
// default would test the nearer node ends where a force layout draws a link
// into the ends its strands name. Both hit tests are told what the drawing
// folded, which draws nothing.
import type { findHoveredEdge, findHoveredNode } from '../src/util/hitDetection'

type Holds<T extends true> = T

export type HitTestStatesStrandedness = Holds<
  Parameters<typeof findHoveredEdge>['length'] extends 12 ? true : false
>

export type NodeHitTestStatesFold = Holds<
  Parameters<typeof findHoveredNode>['length'] extends 7 ? true : false
>
