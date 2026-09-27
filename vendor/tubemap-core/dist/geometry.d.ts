import type { Node, TrackCurve, TrackType } from './types.ts';
export declare function curvePaths(curves: readonly TrackCurve[], type: TrackType | undefined): TrackCurve[];
export declare function nodeOutlinePath(node: Node): string;
