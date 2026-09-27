import type { BedRecord, ImageBounds, InputNode, InputTrack, LayoutNode, Mismatch, Node, Track, TrackShapes, TrackType } from './types.ts';
export type NodeWidthOption = 'normal' | 'compressed' | 'small' | 'fixed';
export interface ColorableTrack {
    id: number;
    sourceTrackID: number;
    type?: TrackType;
    name?: string;
    mapping_quality?: number;
    is_reverse?: boolean;
}
export interface LayoutOptions {
    mergeNodes?: boolean;
    showReads?: boolean;
    coarsenedReadView?: boolean;
    ignoreStrand?: boolean;
    nodeWidthOption?: NodeWidthOption;
    charWidth?: number;
    trackWidth?: number;
    mappingQualityCutoff?: number;
    focusReadNames?: string[] | null;
    bed?: BedRecord[] | null;
    showExons?: boolean;
    trackColor?: (track: ColorableTrack, highlight: string) => string;
    trackAlpha?: (track: ColorableTrack) => number;
}
export interface CoarsenedEdgeMeta {
    count: number;
    label: string;
}
export interface TubeMapLayout {
    nodes: LayoutNode[];
    tracks: Track[];
    reads: Track[];
    nodeMap: Map<string, number>;
    shapes: TrackShapes;
    bounds: ImageBounds;
    maxOrder: number;
    trackForRuler: string | undefined;
    coarsenedEdgeMeta: Map<number, CoarsenedEdgeMeta>;
}
export declare function layoutTubeMap(inputNodes: readonly InputNode[], inputTracks: readonly InputTrack[], inputReads?: readonly InputTrack[], options?: LayoutOptions): TubeMapLayout | undefined;
export declare function isReverse(nodeName: string): boolean;
export declare function forward(nodeName: string): string;
export declare function reverse(nodeName: string): string;
export declare function flip(nodeName: string): string;
export declare function isForwardIndex(n: number): boolean;
export declare const READ_WIDTH = 7;
export interface IncomingReadKey {
    decisionStep: number;
    y: number | undefined;
}
export declare function compareIncomingReadKeys(a: IncomingReadKey, b: IncomingReadKey): number;
export declare function reverseMismatches(mismatches: Mismatch[], sequenceLength: number): void;
export declare const UNREACHABLE_ORDER = -1;
export declare function fillUnassignedOrders(orders: readonly (number | undefined)[]): number[];
export declare function getXCoordinateOfBaseWithinNode(node: Node, base: number): number | null;
export declare function clampedXCoordinateOfBaseWithinNode(node: Node, base: number): number;
export declare const isCoarsenedId: (id: number) => boolean;
export declare function nodePixelCoordinatesInX(node: Node): [number, number];
