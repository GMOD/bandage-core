export type MismatchType = 'insertion' | 'deletion' | 'substitution';
export interface Mismatch {
    type: MismatchType;
    pos: number;
    seq?: string;
    length?: number;
}
export interface ReadSequenceEntry {
    nodeName: string;
    mismatches: Mismatch[];
}
export type TrackType = 'haplotype' | 'read';
export interface TrackRectangle {
    xStart: number;
    yStart: number;
    xEnd: number;
    yEnd: number;
    color: string;
    alpha?: number;
    id: number;
    name?: string;
    type?: TrackType;
}
export interface TrackCurve {
    xStart: number;
    yStart: number;
    xEnd: number;
    yEnd: number;
    width: number;
    color: string;
    alpha?: number;
    laneChange: number;
    id: number;
    name?: string;
    type?: TrackType;
    nodeStart: number | null | undefined;
    nodeEnd: number | null | undefined;
    path?: string;
}
export interface TrackCorner {
    path: string;
    color: string;
    id: number;
    name?: string;
    type?: TrackType;
}
export interface TrackFeature {
    start?: number;
    end?: number;
    type?: string;
    name?: string;
    continue?: boolean;
}
export interface Segment {
    order: number;
    lane?: number | null;
    isForward: boolean;
    node: number | null;
    y?: number;
    features?: TrackFeature[];
    betweenCycleReverseTraversal?: boolean;
}
export interface BedRecord {
    track: string;
    start: number;
    end: number;
    type: string;
    name: string;
}
export interface InputTrack {
    id: number;
    name?: string;
    sequence: string[];
    type?: TrackType;
    freq?: number;
    hidden?: boolean;
    sourceTrackID: number;
    indexOfFirstBase?: number;
    isCompletelyReverse?: boolean;
    sequenceNew?: ReadSequenceEntry[];
    firstNodeOffset?: number;
    finalNodeCoverLength?: number;
    mapping_quality?: number;
    is_secondary?: boolean;
    is_reverse?: boolean;
    sample_name?: string | null;
    read_group?: string | null;
    cigar_string?: string;
    score?: number;
}
export interface Track extends InputTrack {
    indexSequence: number[];
    path: Segment[];
    width: number;
}
export interface InputNode {
    name: string;
    seq: string;
    sequenceLength?: number;
}
export interface Node extends InputNode {
    sequenceLength: number;
    width: number;
    pixelWidth: number;
    order?: number;
    y: number;
    contentHeight: number;
    x: number;
    topLane: number;
    successors: number[];
    predecessors: number[];
    tracks: number[];
    degree: number;
    switched?: boolean;
    incomingReads: [number, number][];
    outgoingReads: [number, number][];
    internalReads: number[];
    d?: string;
}
export interface LayoutNode extends Node {
    order: number;
}
export interface SegmentAssignment {
    trackID: number;
    segmentID: number;
    compareToFromSame: SegmentAssignment | null;
    idealLane?: number;
    idealY?: number | null;
    lane?: number;
}
export interface NodeAssignment {
    type: 'single' | 'multiple';
    node: number | null;
    tracks: SegmentAssignment[];
    idealLane?: number;
}
export interface TrackShapes {
    rectangles: TrackRectangle[];
    curves: TrackCurve[];
    corners: TrackCorner[];
    verticalRectangles: TrackRectangle[];
    featureRectangles: TrackRectangle[];
}
export declare function emptyTrackShapes(): TrackShapes;
export interface ImageBounds {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}
