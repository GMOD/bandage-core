// The tube map layout, from input nodes and tracks to drawable shapes. Ported
// from the original sequenceTubeMap JS, where it shared one module with the d3
// drawing; the passes below still share module state, but layoutTubeMap resets
// all of it on entry and runs synchronously, so no two calls see each other's.
import { emptyTrackShapes } from './types.js';
const DEBUG = false;
const DEFAULT_TRACK_COLORS = [
    '#1f77b4',
    '#ff7f0e',
    '#2ca02c',
    '#d62728',
    '#9467bd',
    '#8c564b',
    '#e377c2',
    '#7f7f7f',
];
function configFrom(options) {
    return {
        mergeNodesFlag: options.mergeNodes ?? true,
        showReads: options.showReads ?? true,
        coarsenedReadView: options.coarsenedReadView ?? false,
        ignoreStrand: options.ignoreStrand ?? false,
        nodeWidthOption: options.nodeWidthOption ?? 'normal',
        charWidth: options.charWidth ?? 8.401,
        trackWidth: options.trackWidth ?? 15,
        mappingQualityCutoff: options.mappingQualityCutoff ?? 0,
        focusReadNames: options.focusReadNames ?? null,
        showExonsFlag: options.showExons ?? false,
        trackColor: options.trackColor ??
            (track => DEFAULT_TRACK_COLORS[track.id % DEFAULT_TRACK_COLORS.length]),
        trackAlpha: options.trackAlpha ?? (() => 1),
    };
}
let config = configFrom({});
let bed = null;
let nodes = [];
// Each track has a `path`, which is an array of Segment objects describing pieces of the path that need to be drawn, in order along the path.
let tracks = [];
// Each read also has a `path` list of Segments, but reads are organized vertically using a different system than non-read tracks.
let reads = [];
let nodeMap = new Map();
let nodesPerOrder = [];
// Scratch array used only during generateNodeOrder. Indexed by node index;
// undefined = "not yet assigned." Copied into node.order at end of layout.
let nodeOrders = [];
// Lane assignment info for tracks, in one list per horizontal "order" slot.
// Duplicates info in tracks' `path` lists but is organized by order. Reads do not use this.
let assignments = [];
let extraLeft = [];
let extraRight = [];
let maxOrder = -1; // horizontal order of the rightmost node
let shapes = emptyTrackShapes();
let imageBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
let trackForRuler;
let coarsenedEdgeMeta = new Map();
// Lay out `inputNodes` and `inputTracks` (and `inputReads`, when
// `showReads`), or return undefined when nothing visible is left to draw.
// Neither input is modified. Track 0 is the reference the layout straightens.
export function layoutTubeMap(inputNodes, inputTracks, inputReads = [], options = {}) {
    config = configFrom(options);
    bed = options.bed ?? null;
    shapes = emptyTrackShapes();
    assignments = [];
    extraLeft = [];
    extraRight = [];
    nodesPerOrder = [];
    imageBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    trackForRuler = undefined;
    coarsenedEdgeMeta = new Map();
    if (inputNodes.length === 0 || inputTracks.length === 0) {
        return undefined;
    }
    // Boundary promotion: layout passes below populate the Node/Track fields
    // (width, order, x/y, path, indexSequence, etc.) before any reader runs.
    const copies = deepCopy(inputNodes);
    // Nodes are referenced in inputs by internal `name` attribute and not by
    // index. Internally in e.g. a path's indexSequence we need to reference
    // nodes by *signed* index, so index 0 can never be used: budge everything
    // down and leave a hole (rather than an `undefined` entry) at 0, which we
    // won't iterate over. Made after the copy, because not every structuredClone
    // keeps a hole.
    nodes = [];
    copies.forEach((node, i) => {
        nodes[i + 1] = node;
    });
    tracks = deepCopy(inputTracks);
    // Drop the reads we will never draw before cloning them — the deep copy of a
    // large GAM is the single most expensive step in a redraw.
    reads = deepCopy(filterReads(inputReads));
    for (let i = tracks.length - 1; i >= 0; i -= 1) {
        const t = tracks[i];
        if (t.type === undefined) {
            t.type = 'haplotype';
        }
        if (t.hidden === true) {
            tracks.splice(i, 1);
            continue;
        }
        if (t.indexOfFirstBase !== undefined) {
            trackForRuler = t.name;
        }
    }
    if (tracks.length === 0) {
        return undefined;
    }
    // Run against the visible tracks only, so hiding the reference doesn't leave
    // the layout straightened around a track that is no longer drawn.
    straightenTrack(0);
    nodeMap = generateNodeMap();
    generateTrackIndexSequences(tracks);
    if (config.showReads && reads.length > 0)
        generateTrackIndexSequences(reads);
    generateNodeWidth();
    if (config.mergeNodesFlag) {
        generateNodeSuccessors();
        generateNodeOrder();
        if (config.showReads && reads.length > 0)
            reverseReversedReads();
        mergeNodes();
        nodeMap = generateNodeMap();
        generateNodeWidth();
        generateTrackIndexSequences(tracks);
        if (config.showReads && reads.length > 0)
            generateTrackIndexSequences(reads);
    }
    generateNodeSuccessors();
    generateNodeDegree();
    if (DEBUG)
        console.log(`${nodes.length} nodes.`);
    generateNodeOrder();
    maxOrder = getMaxOrder();
    // can cause problems when there is a reversed single track node
    // OTOH, can solve problems with complex inversion patterns
    switchNodeOrientation();
    generateNodeOrder();
    maxOrder = getMaxOrder();
    calculateTrackWidth();
    generateLaneAssignment();
    if (config.showExonsFlag && bed !== null)
        addTrackFeatures();
    // Coarsened (Sankey) mode: collapse the read list to one synthetic "read"
    // per (srcSigned → dstSigned) edge BEFORE the normal read placement runs.
    // Each synthetic read traverses exactly two nodes, so the rest of the
    // pipeline (placeReads, generateSVGShapesFromPath, curve drawing) handles
    // it like any normal read: it gets a lane, picks up the "right-down-left-
    // up-right" topology for loops automatically, and uses the same elegant
    // bezier. Node heights end up proportional to *edge* count (typically tens)
    // rather than *read* count (potentially thousands).
    const drawCoarsened = config.showReads && config.coarsenedReadView && reads.length > 0;
    if (config.showReads && reads.length > 0) {
        generateReadOnlyNodeAttributes();
        reverseReversedReads();
        generateTrackIndexSequences(reads);
        if (drawCoarsened) {
            reads = buildCoarsenedSyntheticReads();
            reverseReversedReads();
            generateTrackIndexSequences(reads);
        }
        placeReads();
        tracks = tracks.concat(reads);
    }
    else {
        nodes.forEach(node => {
            if (node) {
                node.incomingReads = [];
                node.outgoingReads = [];
                node.internalReads = [];
            }
        });
    }
    generateNodeXCoords();
    generateSVGShapesFromPath();
    if (DEBUG) {
        console.log('Tracks:');
        console.log(tracks);
        console.log('Nodes:');
        console.log(nodes);
        console.log('Lane assignment:');
        console.log(assignments);
    }
    getImageDimensions();
    return {
        nodes,
        tracks,
        reads,
        nodeMap,
        shapes,
        bounds: imageBounds,
        maxOrder,
        trackForRuler,
        coarsenedEdgeMeta,
    };
}
function generateTrackColor(track, highlight = 'plain') {
    return config.trackColor(track, highlight);
}
function generateTrackAlpha(track) {
    return config.trackAlpha(track);
}
// structuredClone preserves sparse-array holes; JSON round-trip would fill them with null.
function deepCopy(val) {
    return structuredClone(val);
}
// Return true if the given name names a reverse strand node, and false otherwise.
export function isReverse(nodeName) {
    const s = String(nodeName);
    return s.length >= 1 && s.startsWith('-');
}
// Get the forward version of a node name, which may be either forward or backward (negative)
export function forward(nodeName) {
    return isReverse(nodeName) ? String(nodeName).substring(1) : nodeName;
}
// Get the reverse version of a node name, which may be either forward or backward (negative)
export function reverse(nodeName) {
    return isReverse(nodeName) ? nodeName : `-${nodeName}`;
}
// Get the opposite orientation node name for the given node.
export function flip(nodeName) {
    return isReverse(nodeName) ? forward(nodeName) : reverse(nodeName);
}
// Signed-index orientation test. Uses 1/n to distinguish -0 from +0 since
// indexSequence entries can be negative-zero for reverse-strand visits of node 0.
export function isForwardIndex(n) {
    return (n || 1 / n) >= 0;
}
// straighten track given by index by inverting inverted nodes
// only keep them inverted if this single track runs through them in both directions
// Operates on the per-render `nodes`/`tracks` copies; inputs are left untouched.
function straightenTrack(index) {
    const nodesToInvert = new Set();
    // find out which nodes should be inverted
    let currentSequence = tracks[index].sequence;
    for (let i = 0; i < currentSequence.length; i += 1) {
        const cur = currentSequence[i];
        if (isReverse(cur)) {
            const nodeName = forward(cur);
            const firstForwardIndex = currentSequence.indexOf(nodeName);
            if (firstForwardIndex === -1 || firstForwardIndex > i) {
                // only if this inverted node is no repeat
                nodesToInvert.add(nodeName);
            }
        }
    }
    // invert nodes in the tracks' sequence
    for (const track of tracks) {
        currentSequence = track.sequence;
        for (let j = 0; j < currentSequence.length; j += 1) {
            const cur = currentSequence[j];
            if (!isReverse(cur)) {
                if (nodesToInvert.has(cur)) {
                    currentSequence[j] = reverse(cur);
                }
            }
            else if (nodesToInvert.has(forward(cur))) {
                currentSequence[j] = forward(cur);
            }
        }
    }
    // invert the sequence within the nodes
    nodes.forEach(node => {
        if (node && nodesToInvert.has(node.name)) {
            node.seq = node.seq.split('').reverse().join('');
        }
    });
}
// generates attributes (node.y, node.contentHeight) for nodes without tracks, only reads
function generateReadOnlyNodeAttributes() {
    nodesPerOrder = [];
    for (let i = 0; i <= maxOrder; i += 1) {
        nodesPerOrder[i] = [];
    }
    const orderY = new Map();
    nodes.forEach(node => {
        if (node.y !== undefined) {
            setMapToMax(orderY, node.order, node.y + node.contentHeight);
        }
    });
    // for order values where there is no node with haplotypes, orderY is calculated via tracks
    tracks.forEach(track => {
        if (track.type === 'haplotype') {
            track.path.forEach(step => {
                setMapToMax(orderY, step.order, (step.y ?? 0) + track.width);
            });
        }
    });
    nodes.forEach((node, i) => {
        if (node.order >= 0 && node.y === undefined) {
            node.y = (orderY.get(node.order) ?? 0) + 25;
            node.contentHeight = 0;
            nodesPerOrder[node.order].push(i);
        }
    });
}
function setMapToMax(map, key, value) {
    const existing = map.get(key);
    if (existing === undefined) {
        map.set(key, value);
    }
    else {
        map.set(key, Math.max(existing, value));
    }
}
export const READ_WIDTH = 7;
// add info about reads to nodes (incoming, outgoing and internal reads)
function assignReadsToNodes() {
    nodes.forEach(node => {
        if (node) {
            node.incomingReads = [];
            node.outgoingReads = [];
            node.internalReads = [];
        }
    });
    reads.forEach((read, idx) => {
        // Honor a pre-set width (e.g. coarsened Sankey bands pre-size themselves
        // by traversing-read count) — only fall back to the default for normal
        // reads which leave width unset.
        if (read.width === undefined || read.width === 0) {
            read.width = READ_WIDTH;
        }
        if (read.path.length === 1) {
            const firstNode = read.path[0].node;
            if (firstNode !== null) {
                nodes[firstNode].internalReads.push(idx);
            }
        }
        else {
            read.path.forEach((element, pathIdx) => {
                if (pathIdx === 0) {
                    const firstNode = read.path[0].node;
                    if (firstNode !== null) {
                        nodes[firstNode].outgoingReads.push([idx, pathIdx]);
                    }
                }
                else {
                    const elemNode = element.node;
                    if (elemNode !== null) {
                        nodes[elemNode].incomingReads.push([idx, pathIdx]);
                    }
                }
            });
        }
    });
}
// calculate paths (incl. correct y coordinate) for all reads
function placeReads() {
    generateBasicPathsForReads();
    assignReadsToNodes();
    // sort nodes by order, then by y-coordinate
    const sortedNodes = nodes.slice();
    sortedNodes.sort(compareNodesByOrder);
    // Organize read IDs by source track
    const readsBySource = new Map();
    for (let i = 0; i < reads.length; i++) {
        const source = reads[i].sourceTrackID;
        const bucket = readsBySource.get(source);
        if (bucket === undefined) {
            readsBySource.set(source, [i]);
        }
        else {
            bucket.push(i);
        }
    }
    const allSources = Array.from(readsBySource.keys()).sort((a, b) => a - b);
    // Space out read tracks if multiple exist
    const topMargin = allSources.length > 1 ? READ_WIDTH : 0;
    sortedNodes.forEach(node => {
        if (!node)
            return;
        // For each node
        for (const source of allSources) {
            // Go through all source tracks in order
            // Place the reads from this source in this node.
            // Use a margin to separate multiple read tracks if we have them.
            placeReadSet(readsBySource.get(source), node, topMargin);
        }
    });
    // place read segments which are without node
    const bottomY = calculateBottomY();
    const elementsWithoutNode = [];
    reads.forEach((read, idx) => {
        const len = read.path.length;
        // For each path index, precompute the nearest preceding/following segment
        // whose node is non-null and truthy. Falls back to the boundary segment when
        // none qualifies, matching the original walking-loop semantics.
        const prevSegment = new Array(len);
        let lastValidPrev;
        for (let i = 0; i < len; i++) {
            if (i === 0) {
                prevSegment[i] = undefined;
            }
            else {
                prevSegment[i] = lastValidPrev ?? read.path[0];
            }
            const seg = read.path[i];
            if (seg.node !== null && seg.node)
                lastValidPrev = seg;
        }
        const nextSegment = new Array(len);
        let firstValidNext;
        for (let i = len - 1; i >= 0; i--) {
            if (i === len - 1) {
                nextSegment[i] = undefined;
            }
            else {
                nextSegment[i] = firstValidNext ?? read.path[len - 1];
            }
            const seg = read.path[i];
            if (seg.node !== null && seg.node)
                firstValidNext = seg;
        }
        read.path.forEach((element, pathIdx) => {
            if (element.y === undefined) {
                const previousVisitToNode = prevSegment[pathIdx];
                const nextVisitToNode = nextSegment[pathIdx];
                // Specifically referring to segments between a cycle that's traversing from right to left
                const betweenCycleReverseTraversal = Boolean(
                // A segment can be between a cycle if it there are nodes on both sides
                nextVisitToNode &&
                    previousVisitToNode &&
                    nextVisitToNode.isForward !== undefined &&
                    previousVisitToNode.isForward !== undefined &&
                    // A segment is between a cycle if the next node it visits is behind the previous node it visited
                    (previousVisitToNode.order > nextVisitToNode.order ||
                        // A segment can also be between a cycle if it's visiting the same node it just visited in the same direction
                        (nextVisitToNode.order === previousVisitToNode.order &&
                            nextVisitToNode.isForward === previousVisitToNode.isForward)));
                element.betweenCycleReverseTraversal = betweenCycleReverseTraversal;
                elementsWithoutNode.push({
                    readIndex: idx,
                    pathIndex: pathIdx,
                    previousY: previousVisitToNode?.y,
                    previousNode: previousVisitToNode?.node,
                });
            }
        });
    });
    elementsWithoutNode.sort(compareNoNodeReads);
    elementsWithoutNode.forEach(element => {
        const read = reads[element.readIndex];
        const segment = read.path[element.pathIndex];
        segment.y = bottomY[segment.order];
        bottomY[segment.order] += read.width;
    });
    if (DEBUG) {
        console.log('Reads:');
        console.log(reads);
    }
}
// Place a particular collection of reads, identified by a list of read
// numbers, into the given node at the right Y coordinates. All reads in all
// nodes above it, and no reads in any nodes below it, are already placed.
// Makes the given node bigger if needed and moves other nodes down if needed.
// If topMargin is set, applies that amount of spacing down from whatever is above the reads.
function placeReadSet(readIDs, node, topMargin) {
    // Turn the read IDs into a set
    const toPlace = new Set(readIDs);
    // Get arrays of the read entry/exit/internal-ness records we want to work on
    let incomingReads = node.incomingReads.filter(([readID]) => toPlace.has(readID));
    const outgoingReads = node.outgoingReads.filter(([readID]) => toPlace.has(readID));
    const internalReads = node.internalReads.filter(readID => toPlace.has(readID));
    // Only actually use the top margin if we have any reads on the node.
    if (incomingReads.length === 0 &&
        outgoingReads.length === 0 &&
        internalReads.length === 0) {
        topMargin = 0;
    }
    // Determine where we start vertically in the node.
    // TODO: Why do we have to double this to keep reads out of adjacent lanes???
    const startY = node.y + node.contentHeight + topMargin * 2;
    // sort incoming reads — decorate with a precomputed key so each compare is O(1).
    // The original comparator walks pathIdx backwards in lockstep on both sides, picking
    // the first step where either has a defined y (or reaches index 0). The walk's outcome
    // for a single entry is fully captured by:
    //   decisionStep: the smallest k>=1 where path[pathIdx-k].y is defined, or pathIdx+1
    //                 if no preceding segment has a defined y (the "reached 0" case).
    //   y:            the defined y at decisionStep, or undefined for "reached 0".
    // Smaller decisionStep wins; ties put the "reached 0" entries first;
    // otherwise compare y's.
    const incomingKeys = incomingReads.map(entry => {
        const [readID, pathIdx] = entry;
        const path = reads[readID].path;
        let decisionStep = pathIdx + 1;
        let foundY;
        for (let k = 1; k <= pathIdx; k++) {
            const y = path[pathIdx - k]?.y;
            if (y !== undefined) {
                decisionStep = k;
                foundY = y;
                break;
            }
        }
        return { entry, decisionStep, y: foundY };
    });
    incomingKeys.sort(compareIncomingReadKeys);
    incomingReads = incomingKeys.map(k => k.entry);
    // place incoming reads
    let currentY = startY;
    const occupiedUntil = new Map();
    incomingReads.forEach(readElement => {
        const read = reads[readElement[0]];
        read.path[readElement[1]].y = currentY;
        setOccupiedUntil(occupiedUntil, read, readElement[1], currentY, node);
        currentY += read.width;
    });
    let maxY = currentY;
    // sort outgoing reads
    outgoingReads.sort(compareReadOutgoingSegmentsByGoingTo);
    // place outgoing reads
    const occupiedFrom = new Map();
    currentY = startY;
    outgoingReads.forEach(readElement => {
        const read = reads[readElement[0]];
        const firstNodeOffset = read.firstNodeOffset ?? 0;
        // place in next lane
        read.path[readElement[1]].y = currentY;
        occupiedFrom.set(currentY, firstNodeOffset);
        // if no conflicts. The original predicate was strict-less-than, which
        // treats two reads that exactly touch (incoming ends at base K, outgoing
        // starts at base K+1) as conflicting. They don't overlap, so they can
        // share a lane — relax to <=. This also matters for coarsened Sankey
        // bands at single-base nodes (e.g. a 1bp "G" node): with edge-only offsets
        // the math becomes 0+1 < 1 (conflict, wrong) vs. 0+1 <= 1 (no conflict).
        const occUntil = occupiedUntil.get(currentY);
        if (occUntil === undefined || occUntil + 1 <= firstNodeOffset) {
            currentY += read.width;
            maxY = Math.max(maxY, currentY);
        }
        else {
            // otherwise push down incoming reads to make place for outgoing Read
            occupiedUntil.set(currentY, 0);
            incomingReads.forEach(incReadElementIndices => {
                const incRead = reads[incReadElementIndices[0]];
                const incReadPathElement = incRead.path[incReadElementIndices[1]];
                if (incReadPathElement.y !== undefined &&
                    incReadPathElement.y >= currentY) {
                    incReadPathElement.y += read.width;
                    setOccupiedUntil(occupiedUntil, incRead, incReadElementIndices[1], incReadPathElement.y, node);
                }
            });
            currentY += read.width;
            maxY += read.width;
        }
    });
    // sort internal reads
    internalReads.sort(compareInternalReads);
    // place internal reads
    internalReads.forEach(readIdx => {
        const currentRead = reads[readIdx];
        const firstNodeOffset = currentRead.firstNodeOffset ?? 0;
        const finalNodeCoverLength = currentRead.finalNodeCoverLength ?? 0;
        currentY = startY;
        while (firstNodeOffset < (occupiedUntil.get(currentY) ?? -Infinity) + 2 ||
            finalNodeCoverLength > (occupiedFrom.get(currentY) ?? Infinity) - 3) {
            currentY += currentRead.width || READ_WIDTH;
        }
        currentRead.path[0].y = currentY;
        occupiedUntil.set(currentY, finalNodeCoverLength);
        maxY = Math.max(maxY, currentY);
    });
    // adjust node height and move other nodes vertically down
    const heightIncrease = maxY - node.y - node.contentHeight;
    node.contentHeight += heightIncrease;
    adjustVertically3(node, heightIncrease);
}
// Smaller decisionStep wins. On a tie, entries that walked off the front of the
// path (no defined y) sort first and tie with each other; otherwise compare y.
export function compareIncomingReadKeys(a, b) {
    if (a.decisionStep !== b.decisionStep) {
        return a.decisionStep - b.decisionStep;
    }
    if (a.y === undefined || b.y === undefined) {
        return (a.y === undefined ? 0 : 1) - (b.y === undefined ? 0 : 1);
    }
    return a.y - b.y;
}
// keeps track of where reads end within nodes
function setOccupiedUntil(map, read, pathIndex, y, node) {
    if (pathIndex === read.path.length - 1) {
        // last node of current read
        map.set(y, read.finalNodeCoverLength ?? 0);
    }
    else {
        // read covers the whole node
        map.set(y, node.sequenceLength);
    }
}
// compare read segments which are outside of nodes to sort them in a good horizontal
// and then vertical display order.
function compareNoNodeReads(a, b) {
    const readA = reads[a.readIndex];
    const readB = reads[b.readIndex];
    const segmentA = readA.path[a.pathIndex];
    const segmentB = readB.path[b.pathIndex];
    // Sort by order by segments
    if (segmentA.order !== segmentB.order) {
        return segmentA.order - segmentB.order;
    }
    // Sort by reads' source track
    if (readA.sourceTrackID !== readB.sourceTrackID) {
        return readA.sourceTrackID - readB.sourceTrackID;
    }
    // Sort by order of previous node
    if (a.previousNode && b.previousNode) {
        const prevNodeA = nodes[a.previousNode];
        const prevNodeB = nodes[b.previousNode];
        if (prevNodeA && prevNodeB && prevNodeA.order !== prevNodeB.order) {
            return prevNodeA.order - prevNodeB.order;
        }
    }
    // We want to sort in reverse order when the segment is along the reverse-going part of a cycle.
    // This ensures a loop that starts on the outside, stays on the outside,
    // and rolls up in order with other loops.
    const aPrev = a.previousY ?? 0;
    const bPrev = b.previousY ?? 0;
    if (segmentA.betweenCycleReverseTraversal &&
        segmentB.betweenCycleReverseTraversal) {
        return bPrev - aPrev;
    }
    else {
        return aPrev - bPrev;
    }
}
// compare read segments by where they are going to
function compareReadOutgoingSegmentsByGoingTo([readIndexA, pathIndexA], [readIndexB, pathIndexB]) {
    // Expect two arrays both containing 2 integers.
    // The first index of each array contains the read index
    // The second index of each array contains the path index
    // Segments are first sorted by the y value of their last node,
    // then by the node they end on,
    // then by length in final node
    const readA = reads[readIndexA];
    const readB = reads[readIndexB];
    let previousValidYA;
    let previousValidYB;
    let lastPathIndexA = readA.path.length - 1;
    let lastPathIndexB = readB.path.length - 1;
    while (!previousValidYA && lastPathIndexA >= 0) {
        previousValidYA = readA.path[lastPathIndexA]?.y;
        lastPathIndexA -= 1;
    }
    while (!previousValidYB && lastPathIndexB >= 0) {
        previousValidYB = readB.path[lastPathIndexB]?.y;
        lastPathIndexB -= 1;
    }
    if (previousValidYA && previousValidYB) {
        return previousValidYA - previousValidYB;
    }
    // Couldn't find a valid y value for at least one of the reads, sort by which node reads end on
    const initialNodeA = readA.path[pathIndexA]?.node;
    const initialNodeB = readB.path[pathIndexB]?.node;
    let nodeA = initialNodeA != null ? nodes[initialNodeA] : null;
    let nodeB = initialNodeB != null ? nodes[initialNodeB] : null;
    // Follow the reads' paths until we find the node they diverge at
    // Or, they go through all the same nodes and we do a tiebreaker at the end
    while (nodeA != null && nodeB != null && nodeA === nodeB) {
        if (pathIndexA < readA.path.length - 1) {
            pathIndexA += 1;
            while (readA.path[pathIndexA]?.node === null)
                pathIndexA += 1; // skip null nodes in path
            const nextNodeIdx = readA.path[pathIndexA]?.node;
            nodeA = nextNodeIdx != null ? nodes[nextNodeIdx] : null;
        }
        else {
            nodeA = null;
        }
        if (pathIndexB < readB.path.length - 1) {
            pathIndexB += 1;
            while (readB.path[pathIndexB]?.node === null)
                pathIndexB += 1; // skip null nodes in path
            const nextNodeIdx = readB.path[pathIndexB]?.node;
            nodeB = nextNodeIdx != null ? nodes[nextNodeIdx] : null;
        }
        else {
            nodeB = null;
        }
    }
    if (nodeA != null) {
        if (nodeB != null)
            return compareNodesByOrder(nodeA, nodeB);
        return 1; // nodeB is null, nodeA not null
    }
    if (nodeB != null)
        return -1; // nodeB not null, nodeA null
    // both nodes are null -> both end in the same node
    const beginDiff = (readA.firstNodeOffset ?? 0) - (readB.firstNodeOffset ?? 0);
    if (beginDiff !== 0)
        return beginDiff;
    // break tie: both reads cover the same nodes and begin at the same position
    // One or both reads didn't have a previously valid Y value, compare by the endPosition of the read
    return (readA.finalNodeCoverLength ?? 0) - (readB.finalNodeCoverLength ?? 0);
}
// Compare tracks based on ordering at their first convergence
function compareTrackByInitialOrdering(trackA, trackB) {
    // Find the first node where the two tracks converge, sort by layer.
    // Tracks with no path sort first, and two of them tie.
    if (trackA.path === undefined || trackB.path === undefined) {
        return ((trackA.path === undefined ? 0 : 1) - (trackB.path === undefined ? 0 : 1));
    }
    const pathA = trackA.path;
    const pathB = trackB.path;
    let AIndex = 0;
    let BIndex = 0;
    while (AIndex < pathA.length && BIndex < pathB.length) {
        const a = pathA[AIndex];
        const b = pathB[BIndex];
        const trackAOrder = a.order;
        const trackBOrder = b.order;
        if (trackAOrder === trackBOrder && a.node && b.node) {
            return (b.y ?? 0) - (a.y ?? 0);
        }
        else if (trackAOrder < trackBOrder) {
            AIndex += 1;
        }
        else if (trackAOrder > trackBOrder) {
            BIndex += 1;
        }
        else {
            // Orders are equal but are traversing out of nodes
            AIndex += 1;
            BIndex += 1;
        }
    }
    // Tracks do not converge, keep the same ordering
    return 0;
}
// compare 2 reads which are completely within a single node
function compareInternalReads(idxA, idxB) {
    const a = reads[idxA];
    const b = reads[idxB];
    // compare by first base within first node
    const aFirst = a.firstNodeOffset ?? 0;
    const bFirst = b.firstNodeOffset ?? 0;
    if (aFirst < bFirst)
        return -1;
    else if (aFirst > bFirst)
        return 1;
    // compare by last base within last node
    const aLast = a.finalNodeCoverLength ?? 0;
    const bLast = b.finalNodeCoverLength ?? 0;
    if (aLast < bLast)
        return -1;
    else if (aLast > bLast)
        return 1;
    return 0;
}
// determine biggest y-coordinate for each order-value
function calculateBottomY() {
    const bottomY = [];
    for (let i = 0; i <= maxOrder; i += 1) {
        bottomY.push(0);
    }
    nodes.forEach(node => {
        if (node.y !== undefined) {
            bottomY[node.order] = Math.max(bottomY[node.order], node.y + node.contentHeight + 20);
        }
    });
    tracks.forEach(track => {
        track.path.forEach(element => {
            bottomY[element.order] = Math.max(bottomY[element.order], (element.y ?? 0) + track.width);
        });
    });
    return bottomY;
}
// generate path-info for each read
// containing order, node and orientation, but no concrete coordinates
// TODO: Duplicates a lot of the same work as generateLaneAssignment() does for non-read tracks.
function generateBasicPathsForReads() {
    reads.forEach(read => {
        // add info for start of track
        let currentNodeIndex = Math.abs(read.indexSequence[0]);
        let currentNodeIsForward = isForwardIndex(read.indexSequence[0]);
        let currentNode = nodes[currentNodeIndex];
        let previousNode;
        let previousNodeIsForward;
        read.path = [];
        read.path.push({
            order: currentNode.order,
            isForward: currentNodeIsForward,
            node: currentNodeIndex,
        });
        for (let i = 1; i < read.sequence.length; i += 1) {
            previousNode = currentNode;
            previousNodeIsForward = currentNodeIsForward;
            currentNodeIndex = Math.abs(read.indexSequence[i]);
            currentNodeIsForward = isForwardIndex(read.indexSequence[i]);
            currentNode = nodes[currentNodeIndex];
            if (currentNode.order > previousNode.order) {
                if (!previousNodeIsForward) {
                    // backward to forward at previous node
                    read.path.push({
                        order: previousNode.order,
                        isForward: true,
                        node: null,
                    });
                }
                for (let j = previousNode.order + 1; j < currentNode.order; j += 1) {
                    // forward without nodes
                    read.path.push({ order: j, isForward: true, node: null });
                }
                if (!currentNodeIsForward) {
                    // forward to backward at current node
                    read.path.push({
                        order: currentNode.order,
                        isForward: true,
                        node: null,
                    });
                    read.path.push({
                        order: currentNode.order,
                        isForward: false,
                        node: currentNodeIndex,
                    });
                }
                else {
                    // current Node forward
                    read.path.push({
                        order: currentNode.order,
                        isForward: true,
                        node: currentNodeIndex,
                    });
                }
            }
            else if (currentNode.order < previousNode.order) {
                if (previousNodeIsForward) {
                    // turnaround from fw to bw at previous node
                    read.path.push({
                        order: previousNode.order,
                        isForward: false,
                        node: null,
                    });
                }
                for (let j = previousNode.order - 1; j > currentNode.order; j -= 1) {
                    // bachward without nodes
                    read.path.push({ order: j, isForward: false, node: null });
                }
                if (currentNodeIsForward) {
                    // backward to forward at current node
                    read.path.push({
                        order: currentNode.order,
                        isForward: false,
                        node: null,
                    });
                    read.path.push({
                        order: currentNode.order,
                        isForward: true,
                        node: currentNodeIndex,
                    });
                }
                else {
                    // backward at current node
                    read.path.push({
                        order: currentNode.order,
                        isForward: false,
                        node: currentNodeIndex,
                    });
                }
            }
            else {
                if (currentNodeIsForward !== previousNodeIsForward) {
                    read.path.push({
                        order: currentNode.order,
                        isForward: currentNodeIsForward,
                        node: currentNodeIndex,
                    });
                }
                else {
                    read.path.push({
                        order: currentNode.order,
                        isForward: !currentNodeIsForward,
                        node: null,
                    });
                    read.path.push({
                        order: currentNode.order,
                        isForward: currentNodeIsForward,
                        node: currentNodeIndex,
                    });
                }
            }
        }
    });
}
// reverse reads which are reversed
function reverseReversedReads() {
    reads.forEach(read => {
        let pos = 0;
        while (pos < read.sequence.length && read.sequence[pos].startsWith('-')) {
            pos += 1;
        }
        if (pos === read.sequence.length) {
            // completely reversed read
            read.is_reverse = true;
            read.sequence = read.sequence.reverse(); // invert sequence
            for (let i = 0; i < read.sequence.length; i += 1) {
                read.sequence[i] = forward(read.sequence[i]); // visit nodes forward
                // TODO: Do we really want to visit all the nodes forward here? Are we
                // sure we aren't in mixed orientation?
            }
            const sequenceNew = read.sequenceNew ?? [];
            sequenceNew.reverse(); // invert sequence
            read.sequenceNew = sequenceNew;
            for (const entry of sequenceNew) {
                entry.nodeName = forward(entry.nodeName); // visit nodes forward
                reverseMismatches(entry.mismatches, nodeByName(entry.nodeName).sequenceLength);
            }
            // adjust firstNodeOffset and finalNodeCoverLength
            const temp = read.firstNodeOffset ?? 0;
            const firstLen = nodeByName(read.sequence[0]).sequenceLength;
            read.firstNodeOffset = firstLen - (read.finalNodeCoverLength ?? 0);
            const lastLen = nodeByName(read.sequence[read.sequence.length - 1]).sequenceLength;
            read.finalNodeCoverLength = lastLen - temp;
        }
    });
}
// Flip a node's mismatches onto the opposite strand: positions are measured
// from the other end of the node, and sequences are complemented.
// sequenceLength (not node.width, which is only equal to it in 'normal'
// node-width mode) is the right pivot because mismatch positions are base
// offsets. Exported for testing.
export function reverseMismatches(mismatches, sequenceLength) {
    mismatches.forEach(mm => {
        if (mm.type === 'insertion') {
            mm.pos = sequenceLength - mm.pos;
        }
        else if (mm.type === 'deletion') {
            mm.pos = sequenceLength - mm.pos - (mm.length ?? 0);
        }
        else if (mm.type === 'substitution') {
            mm.pos = sequenceLength - mm.pos - (mm.seq?.length ?? 0);
        }
        if (mm.seq !== undefined) {
            // NOTE: reverse-complement followed by reverse is a plain complement.
            // Preserved verbatim from the original code rather than "fixed" here.
            mm.seq = getReverseComplement(mm.seq).split('').reverse().join('');
        }
    });
}
const COMPLEMENT = { A: 'T', T: 'A', C: 'G', G: 'C' };
function getReverseComplement(s) {
    let result = '';
    for (let i = s.length - 1; i >= 0; i -= 1) {
        result += COMPLEMENT[s.charAt(i)] ?? 'N';
    }
    return result;
}
// for each track: generate sequence of node indices from seq. of node names
function generateTrackIndexSequences(tracksOrReads) {
    tracksOrReads.forEach(track => {
        track.indexSequence = [];
        track.sequence.forEach(rawNodeName => {
            let nodeName = rawNodeName;
            // if node was switched, reverse it here
            // Q? Is flipping the index enough? It looks like yes. Or should we also flip the node name in 'sequence'?
            const fwdIdx = nodeMap.get(forward(nodeName));
            const switched = nodes[fwdIdx]?.switched ?? false;
            if (switched) {
                nodeName = flip(nodeName);
            }
            // Get the index to visit the node. If the node is switched, this means
            // visiting it reverse. Otherwise, this means visiting it forward.
            const nodeIndex = nodeMap.get(forward(nodeName));
            if (nodeIndex === 0) {
                // If a node index is ever 0, we can't visit it in reverse, so we don't allow that to happen.
                throw new Error('Node ' + forward(nodeName) + ' has prohibited index 0');
            }
            if (isReverse(nodeName) !== switched) {
                // If we visit the node in reverse XOR the node is switched, go through
                // it right to left as displayed.
                track.indexSequence.push(-nodeIndex);
            }
            else {
                // If either the node isn't switched and we go through it forward, or
                // the node is switched *and* we go through it backward, go through it
                // left to right as displayed.
                track.indexSequence.push(nodeIndex);
            }
        });
    });
}
// Tracks enter and leave a node this far outside it horizontally. Note that
// getImageDimensions() below only adds it on the right: the pannable area
// understates the left edge of the drawing by this much.
const NODE_HORIZONTAL_SLACK = 20;
// get the minimum and maximum coordinates used in the image to calculate image dimensions
function getImageDimensions() {
    // Sentinels, deliberately crossed: if nothing below runs, minZoom() and
    // alignSVG() detect the empty content rather than computing a negative scale.
    const bounds = { minX: 99, maxX: -99, minY: 99, maxY: -99 };
    nodes.forEach(node => {
        if (!node)
            return;
        if (node.x !== undefined) {
            bounds.minX = Math.min(bounds.minX, node.x);
            bounds.maxX = Math.max(bounds.maxX, node.x + NODE_HORIZONTAL_SLACK + node.pixelWidth);
        }
        if (node.y !== undefined) {
            bounds.minY = Math.min(bounds.minY, node.y - 10);
            bounds.maxY = Math.max(bounds.maxY, node.y + node.contentHeight + 10);
        }
    });
    tracks.forEach(track => {
        track.path.forEach(segment => {
            const y = segment.y ?? 0;
            bounds.maxY = Math.max(bounds.maxY, y + track.width);
            bounds.minY = Math.min(bounds.minY, y);
        });
    });
    imageBounds = bounds;
}
// Resolve a (possibly reverse-oriented) node name to its layout node. Every
// caller runs after generateNodeMap, so a miss is a programming error.
function nodeByName(nodeName) {
    const index = nodeMap.get(forward(nodeName));
    const node = index === undefined ? undefined : nodes[index];
    if (node === undefined) {
        throw new Error(`Unknown node ${nodeName}`);
    }
    return node;
}
// map node names to node indices
function generateNodeMap() {
    nodeMap = new Map();
    nodes.forEach((node, index) => {
        if (node) {
            nodeMap.set(node.name, index);
        }
    });
    return nodeMap;
}
// adds a successor-array to each node containing the indices of the nodes coming directly after the current node
function generateNodeSuccessors() {
    const successorSets = nodes.map(() => new Set());
    const predecessorSets = nodes.map(() => new Set());
    const addEdges = (track) => {
        for (let i = 0; i < track.indexSequence.length - 1; i += 1) {
            const current = Math.abs(track.indexSequence[i]);
            const follower = Math.abs(track.indexSequence[i + 1]);
            successorSets[current].add(follower);
            predecessorSets[follower].add(current);
        }
    };
    tracks.forEach(addEdges);
    if (config.showReads && reads.length > 0) {
        reads.forEach(addEdges);
    }
    nodes.forEach((node, i) => {
        if (node) {
            node.successors = Array.from(successorSets[i]);
            node.predecessors = Array.from(predecessorSets[i]);
        }
    });
}
function generateNodeOrderOfSingleTrack(sequence) {
    let forwardOrder = 0;
    let backwardOrder = 0;
    let minOrder = 0;
    sequence.forEach(nodeIndex => {
        const idx = Math.abs(nodeIndex);
        if (nodeIndex < 0) {
            if (nodeOrders[idx] === undefined)
                nodeOrders[idx] = backwardOrder;
            const order = nodeOrders[idx];
            if (order < minOrder)
                minOrder = order;
            forwardOrder = order;
            backwardOrder = order - 1;
        }
        else {
            if (nodeOrders[idx] === undefined)
                nodeOrders[idx] = forwardOrder;
            const order = nodeOrders[idx];
            forwardOrder = order + 1;
            backwardOrder = order;
        }
    });
    if (minOrder < 0) {
        increaseOrderForAllNodes(-minOrder);
    }
}
// calculate the order-value of nodes contained in sequence which are to the left of the first node which already has an order-value
function generateNodeOrderTrackBeginning(sequence) {
    let anchorIndex = 0;
    let minOrder = 0;
    while (anchorIndex < sequence.length &&
        nodeOrders[Math.abs(sequence[anchorIndex])] === undefined) {
        anchorIndex += 1; // anchor = first node in common with existing graph
    }
    if (anchorIndex >= sequence.length) {
        return null;
    }
    const anchorSeqVal = sequence[anchorIndex];
    let currentOrder;
    let increment;
    if (anchorSeqVal >= 0) {
        // regular node
        currentOrder = nodeOrders[anchorSeqVal] - 1;
        increment = -1;
    }
    else {
        // reverse node
        currentOrder = nodeOrders[-anchorSeqVal] + 1;
        increment = 1;
    }
    for (let j = anchorIndex - 1; j >= 0; j -= 1) {
        // assign order to nodes which are left of anchor node
        const idx = Math.abs(sequence[j]);
        if (nodeOrders[idx] === undefined) {
            nodeOrders[idx] = currentOrder;
            minOrder = Math.min(minOrder, currentOrder);
            currentOrder += increment;
        }
    }
    if (minOrder < 0) {
        increaseOrderForAllNodes(-minOrder);
    }
    return anchorIndex;
}
// Sentinel order for nodes no track or read reaches.
export const UNREACHABLE_ORDER = -1;
// Replace every unassigned entry with UNREACHABLE_ORDER, producing a dense
// array. Holes matter here: `new Array(n)` is all holes and forEach/map skip
// them, so an in-place forEach would leave the sentinel unset.
export function fillUnassignedOrders(orders) {
    const filled = [];
    for (const order of orders) {
        filled.push(order ?? UNREACHABLE_ORDER);
    }
    return filled;
}
// generate global sequence of nodes from left to right, starting with first track and adding other tracks sequentially
function generateNodeOrder() {
    let modifiedSequence;
    let currentOrder;
    let rightIndex;
    let leftIndex;
    let minOrder = 0;
    const tracksAndReads = config.showReads && reads.length > 0 ? tracks.concat(reads) : tracks;
    const reachability = {
        stamp: new Int32Array(nodes.length),
        generation: 0,
    };
    // fill() makes the array dense: `new Array(n)` alone is all holes, which
    // forEach skips, so neither the sentinel pass nor the copy-back below ran.
    nodeOrders = new Array(nodes.length).fill(undefined);
    nodes.forEach(node => {
        if (node) {
            node.order = undefined;
        }
    });
    generateNodeOrderOfSingleTrack(tracks[0].indexSequence);
    for (let i = 1; i < tracksAndReads.length; i += 1) {
        if (DEBUG)
            console.log(`generating order for track ${i + 1}`);
        rightIndex = generateNodeOrderTrackBeginning(tracksAndReads[i].indexSequence);
        if (rightIndex === null) {
            if (tracksAndReads[i].type === 'haplotype') {
                generateNodeOrderOfSingleTrack(tracksAndReads[i].indexSequence);
            }
            else {
                tracksAndReads.splice(i, 1);
                reads.splice(i - tracks.length, 1);
                i -= 1;
            }
            continue;
        }
        modifiedSequence = uninvert(tracksAndReads[i].indexSequence);
        while (rightIndex < modifiedSequence.length) {
            // move right until the end of the sequence
            leftIndex = rightIndex;
            rightIndex += 1;
            while (rightIndex < modifiedSequence.length &&
                nodeOrders[modifiedSequence[rightIndex]] === undefined) {
                rightIndex += 1;
            }
            if (rightIndex < modifiedSequence.length) {
                // middle segment between two anchors
                currentOrder = nodeOrders[modifiedSequence[leftIndex]] + 1;
                for (let j = leftIndex + 1; j < rightIndex; j += 1) {
                    nodeOrders[modifiedSequence[j]] = currentOrder;
                    currentOrder += 1;
                }
                if (nodeOrders[modifiedSequence[rightIndex]] >
                    nodeOrders[modifiedSequence[leftIndex]]) {
                    if (nodeOrders[modifiedSequence[rightIndex]] < currentOrder) {
                        increaseOrderForSuccessors(modifiedSequence[rightIndex], modifiedSequence[rightIndex - 1], currentOrder);
                    }
                }
                else {
                    if (tracksAndReads[i].indexSequence[rightIndex] >= 0 &&
                        !isSuccessor(modifiedSequence[rightIndex], modifiedSequence[leftIndex], reachability)) {
                        // no real reversal
                        increaseOrderForSuccessors(modifiedSequence[rightIndex], modifiedSequence[rightIndex - 1], currentOrder);
                    }
                    else {
                        // real reversal
                        if (tracksAndReads[i].indexSequence[leftIndex] < 0 ||
                            (nodes[modifiedSequence[leftIndex + 1]].degree < 2 &&
                                nodeOrders[modifiedSequence[rightIndex]] <
                                    nodeOrders[modifiedSequence[leftIndex]])) {
                            currentOrder = nodeOrders[modifiedSequence[leftIndex]] - 1;
                            for (let j = leftIndex + 1; j < rightIndex; j += 1) {
                                nodeOrders[modifiedSequence[j]] = currentOrder;
                                minOrder = Math.min(minOrder, currentOrder);
                                currentOrder -= 1;
                            }
                        }
                    }
                }
            }
            else {
                // right segment to the right of last anchor
                if (tracksAndReads[i].indexSequence[leftIndex] >= 0) {
                    // elongate towards the right
                    currentOrder = nodeOrders[modifiedSequence[leftIndex]] + 1;
                    for (let j = leftIndex + 1; j < modifiedSequence.length; j += 1) {
                        const idx = modifiedSequence[j];
                        if (nodeOrders[idx] === undefined) {
                            nodeOrders[idx] = currentOrder;
                            currentOrder += 1;
                        }
                    }
                }
                else {
                    // elongate towards the left
                    currentOrder = nodeOrders[modifiedSequence[leftIndex]] - 1;
                    for (let j = leftIndex + 1; j < modifiedSequence.length; j += 1) {
                        const idx = modifiedSequence[j];
                        if (nodeOrders[idx] === undefined) {
                            nodeOrders[idx] = currentOrder;
                            minOrder = Math.min(minOrder, currentOrder);
                            currentOrder -= 1;
                        }
                    }
                }
            }
        }
    }
    if (minOrder < 0)
        increaseOrderForAllNodes(-minOrder);
    // Nodes unreachable from any track get UNREACHABLE_ORDER so every node ends
    // up with a defined order; downstream code uses `order >= 0` to skip them.
    const finalOrders = fillUnassignedOrders(nodeOrders);
    nodeOrders = finalOrders;
    finalOrders.forEach((order, i) => {
        const node = nodes[i];
        if (node !== undefined) {
            node.order = order;
        }
    });
}
function isSuccessor(first, second, scratch) {
    scratch.generation += 1;
    const { stamp, generation } = scratch;
    const stack = [first];
    stamp[first] = generation;
    while (stack.length > 0) {
        const current = stack.pop();
        if (current === second)
            return true;
        for (const childIndex of nodes[current].successors) {
            if (stamp[childIndex] !== generation) {
                stamp[childIndex] = generation;
                stack.push(childIndex);
            }
        }
    }
    return false;
}
// get order number of the rightmost node
function getMaxOrder() {
    let max = -1;
    nodeOrders.forEach(order => {
        if (order !== undefined && order > max)
            max = order;
    });
    return max;
}
// generates sequence keeping the order but switching all reversed (negative) nodes to forward nodes
function uninvert(sequence) {
    return sequence.map(v => Math.abs(v));
}
// increases the order-value of all nodes by amount
function increaseOrderForAllNodes(amount) {
    nodeOrders.forEach((order, i) => {
        if (order !== undefined)
            nodeOrders[i] = order + amount;
    });
}
// increases the order-value for currentNode and (if necessary) successor nodes recursively
function increaseOrderForSuccessors(startingNode, tabuNode, newOrder) {
    const increasedOrders = new Map();
    // Walked with a head pointer rather than shift(), which is O(length) per pop.
    const queue = [[startingNode, newOrder]];
    let head = 0;
    while (head < queue.length) {
        const [currentNode, currentOrder] = queue[head];
        head += 1;
        const currentNodeOrder = nodeOrders[currentNode];
        if (currentNodeOrder !== undefined && currentNodeOrder < currentOrder) {
            if (!increasedOrders.has(currentNode) ||
                increasedOrders.get(currentNode) < currentOrder) {
                increasedOrders.set(currentNode, currentOrder);
                nodes[currentNode].successors.forEach(successor => {
                    if (nodeOrders[successor] > currentNodeOrder &&
                        successor !== tabuNode) {
                        // only increase order of successors to the right of currentNode
                        queue.push([successor, currentOrder + 1]);
                    }
                });
                if (currentNode !== startingNode) {
                    nodes[currentNode].predecessors.forEach(predecessor => {
                        if (nodeOrders[predecessor] > currentNodeOrder &&
                            predecessor !== tabuNode) {
                            // only increase order of predecessors to the right of currentNode
                            queue.push([predecessor, currentOrder + 1]);
                        }
                    });
                }
            }
        }
    }
    increasedOrders.forEach((value, key) => {
        nodeOrders[key] = value;
    });
}
// calculates the node degree: the number of tracks passing through the node / the node height
function generateNodeDegree() {
    nodes.forEach(node => {
        node.tracks = [];
    });
    tracks.forEach(track => {
        track.indexSequence.forEach(nodeIndex => {
            nodes[Math.abs(nodeIndex)].tracks.push(track.id);
        });
    });
    nodes.forEach(node => {
        if (node.tracks !== undefined)
            node.degree = node.tracks.length;
    });
}
// Optimize the orientations for nodes in the global `nodes` for displaying the
// paths in the global `tracks` and the read paths, if applicable, in the
// global `reads`
function switchNodeOrientation() {
    const pivotPath = tracks[0];
    let countPaths = tracks.slice(1, tracks.length);
    if (config.showReads && reads.length > 0) {
        countPaths = countPaths.concat(reads);
    }
    switchNodeOrientationForPaths(countPaths, pivotPath);
    if (config.showReads && reads.length > 0) {
        // Any changes should be committed back
        for (let i = 0; i < reads.length; i++) {
            if (reads[i] !== countPaths[i + tracks.length - 1]) {
                throw new Error('Read inequality');
            }
        }
    }
}
// If more of the given paths pass through a specific node in reverse direction than in
// regular direction, switch its orientation. Processes all paths' nodes in
// place, so if you want e.g. a first track with nodes fixed in that
// orientation, pass it as pivotPath.
// References and modifies the global nodes variable.
function switchNodeOrientationForPaths(paths, pivotPath) {
    const toSwitch = new Map();
    const pivotNames = pivotPath ? new Set(pivotPath.sequence) : null;
    for (const path of paths) {
        const sequence = path.sequence;
        for (let j = 0; j < sequence.length; j += 1) {
            const nodeName = forward(sequence[j]);
            const currentNode = nodeByName(nodeName);
            if (pivotNames && !pivotNames.has(nodeName)) {
                // do not change orientation for nodes which are part of the pivot path
                const prevOrder = j > 0 ? nodeByName(sequence[j - 1]).order : undefined;
                const nextOrder = j < sequence.length - 1
                    ? nodeByName(sequence[j + 1]).order
                    : undefined;
                if ((prevOrder === undefined || prevOrder < currentNode.order) &&
                    (nextOrder === undefined || currentNode.order < nextOrder)) {
                    // Node is visited in increasing order along the path. Reverse
                    // visits count towards switching, forward visits against it.
                    addToSwitchScore(toSwitch, nodeName, isReverse(sequence[j]) ? 1 : -1);
                }
                if ((prevOrder === undefined || prevOrder > currentNode.order) &&
                    (nextOrder === undefined || currentNode.order > nextOrder)) {
                    // Node is visited in *decreasing* order along the path, so is already
                    // backward: the votes are the other way round.
                    addToSwitchScore(toSwitch, nodeName, isReverse(sequence[j]) ? -1 : 1);
                }
            }
        }
    }
    for (const path of paths) {
        path.sequence.forEach((node, nodeIndex) => {
            const score = toSwitch.get(forward(node));
            if (score !== undefined && score > 0) {
                // This node is backward more so flip it around
                path.sequence[nodeIndex] = flip(node);
                path.indexSequence[nodeIndex] = -path.indexSequence[nodeIndex];
            }
        });
    }
    // invert the sequence within the nodes and mark them as "switched"
    toSwitch.forEach((value, key) => {
        if (value > 0) {
            const node = nodeByName(key);
            node.seq = getReverseComplement(node.seq);
            node.switched = true;
        }
    });
}
function addToSwitchScore(scores, nodeName, delta) {
    scores.set(nodeName, (scores.get(nodeName) ?? 0) + delta);
}
// calculates the concrete values for the nodes' x-coordinates
function generateNodeXCoords() {
    let currentX = 0;
    let nextX = 20;
    let currentOrder = -1;
    const sortedNodes = nodes.slice();
    sortedNodes.sort(compareNodesByOrder);
    const extra = calculateExtraSpace();
    sortedNodes.forEach(node => {
        if (node.order >= 0) {
            if (node.order > currentOrder) {
                currentOrder = node.order;
                currentX = nextX + 10 * extra[node.order];
            }
            node.x = currentX;
            nextX = Math.max(nextX, currentX + 40 + node.pixelWidth);
        }
    });
}
// calculates additional horizontal space needed between two nodes
// two neighboring nodes have to be moved further apart if there is a lot going on in between them
// -> edges turning to vertical orientation should not overlap
function calculateExtraSpace() {
    const leftSideEdges = [];
    const rightSideEdges = [];
    const fallAngleAdjustment = [];
    const extra = [];
    for (let i = 0; i <= maxOrder; i += 1) {
        leftSideEdges.push(0);
        rightSideEdges.push(0);
        fallAngleAdjustment.push(0);
    }
    tracks.forEach(track => {
        for (let i = 1; i < track.path.length; i += 1) {
            const seg = track.path[i];
            const prevSeg = track.path[i - 1];
            // Track is going to the same node, account for space taken up by edges looping around
            if (seg.order === prevSeg.order) {
                // repeat or translocation
                if (seg.isForward) {
                    leftSideEdges[seg.order] = leftSideEdges[seg.order] + 1;
                }
                else {
                    rightSideEdges[seg.order] = rightSideEdges[seg.order] + 1;
                }
            }
            else {
                // Track is going to a different node; account for space needed to limit rise/fall angle
                const yDifference = Math.abs((seg.y ?? 0) - (prevSeg.y ?? 0));
                //TODO: Extra space should also be accounted when there are too many tracks curving at the nodes
                fallAngleAdjustment[seg.order] = Math.max(yDifference / 17.5, fallAngleAdjustment[seg.order]);
            }
        }
    });
    extra.push(Math.max(0, leftSideEdges[0] - 1));
    for (let i = 1; i <= maxOrder; i += 1) {
        // Extra space uses space needed for edges(tracks looping), or space needed to limit rise/fall angle, whichever is larger
        extra.push(Math.max(Math.max(0, leftSideEdges[i] - 1) +
            Math.max(0, rightSideEdges[i - 1] - 1), fallAngleAdjustment[i]));
    }
    return extra;
}
// create and fill assignment-variable, which contains info about tracks and lanes for each order-value
function generateLaneAssignment() {
    let segmentNumber;
    let currentNodeIndex;
    let currentNodeIsForward;
    let currentNode;
    let previousNode;
    let previousNodeIsForward;
    // For each horizontal order slot, for each track number, holds the
    // SegmentAssignment object for the visit of that track to that order slot.
    // When an order slot is visited multiple times, holds whatever
    // SegmentAssignment was created most recently.
    const prevSegmentPerOrderPerTrack = [];
    // Index into assignments[order] by node, so addToAssignment can find an
    // existing entry without scanning the whole order slot.
    const assignmentByOrderAndNode = [];
    // create empty variables
    for (let i = 0; i <= maxOrder; i += 1) {
        assignments[i] = [];
        assignmentByOrderAndNode[i] = new Map();
        prevSegmentPerOrderPerTrack[i] = [];
        for (let j = 0; j < tracks.length; j += 1) {
            prevSegmentPerOrderPerTrack[i][j] = null;
        }
    }
    tracks.forEach((track, trackNo) => {
        // Trace along each track and create Segment objects in the track's path
        // field, and SegmentAssignment objects in NodeAssignment objects in all
        // the order slots that are visited by the track. Set up all the
        // cross-reverencing indexes and work out when we need segments to let
        // tracks pass nodes and turn around, but leave all the assigned lane
        // values empty for now.
        // add info for start of track
        currentNodeIndex = Math.abs(track.indexSequence[0]);
        currentNodeIsForward = isForwardIndex(track.indexSequence[0]);
        currentNode = nodes[currentNodeIndex];
        track.path = [];
        track.path.push({
            order: currentNode.order,
            lane: null,
            isForward: currentNodeIsForward,
            node: currentNodeIndex,
        });
        addToAssignment(currentNode.order, currentNodeIndex, trackNo, 0, prevSegmentPerOrderPerTrack, assignmentByOrderAndNode);
        segmentNumber = 1;
        for (let i = 1; i < track.sequence.length; i += 1) {
            previousNode = currentNode;
            previousNodeIsForward = currentNodeIsForward;
            currentNodeIndex = Math.abs(track.indexSequence[i]);
            currentNodeIsForward = isForwardIndex(track.indexSequence[i]);
            currentNode = nodes[currentNodeIndex];
            if (currentNode.order > previousNode.order) {
                if (!previousNodeIsForward) {
                    // backward to forward at previous node
                    track.path.push({
                        order: previousNode.order,
                        lane: null,
                        isForward: true,
                        node: null,
                    });
                    addToAssignment(previousNode.order, null, trackNo, segmentNumber, prevSegmentPerOrderPerTrack, assignmentByOrderAndNode);
                    segmentNumber += 1;
                }
                for (let j = previousNode.order + 1; j < currentNode.order; j += 1) {
                    // forward without nodes
                    track.path.push({
                        order: j,
                        lane: null,
                        isForward: true,
                        node: null,
                    });
                    addToAssignment(j, null, trackNo, segmentNumber, prevSegmentPerOrderPerTrack, assignmentByOrderAndNode);
                    segmentNumber += 1;
                }
                if (!currentNodeIsForward) {
                    // forward to backward at current node
                    track.path.push({
                        order: currentNode.order,
                        lane: null,
                        isForward: true,
                        node: null,
                    });
                    addToAssignment(currentNode.order, null, trackNo, segmentNumber, prevSegmentPerOrderPerTrack, assignmentByOrderAndNode);
                    segmentNumber += 1;
                    track.path.push({
                        order: currentNode.order,
                        lane: null,
                        isForward: false,
                        node: currentNodeIndex,
                    });
                    addToAssignment(currentNode.order, currentNodeIndex, trackNo, segmentNumber, prevSegmentPerOrderPerTrack, assignmentByOrderAndNode);
                    segmentNumber += 1;
                }
                else {
                    // current Node forward
                    track.path.push({
                        order: currentNode.order,
                        lane: null,
                        isForward: true,
                        node: currentNodeIndex,
                    });
                    addToAssignment(currentNode.order, currentNodeIndex, trackNo, segmentNumber, prevSegmentPerOrderPerTrack, assignmentByOrderAndNode);
                    segmentNumber += 1;
                }
            }
            else if (currentNode.order < previousNode.order) {
                if (previousNodeIsForward) {
                    // turnaround from fw to bw at previous node
                    track.path.push({
                        order: previousNode.order,
                        lane: null,
                        isForward: false,
                        node: null,
                    });
                    addToAssignment(previousNode.order, null, trackNo, segmentNumber, prevSegmentPerOrderPerTrack, assignmentByOrderAndNode);
                    segmentNumber += 1;
                }
                for (let j = previousNode.order - 1; j > currentNode.order; j -= 1) {
                    // bachward without nodes
                    track.path.push({
                        order: j,
                        lane: null,
                        isForward: false,
                        node: null,
                    });
                    addToAssignment(j, null, trackNo, segmentNumber, prevSegmentPerOrderPerTrack, assignmentByOrderAndNode);
                    segmentNumber += 1;
                }
                if (currentNodeIsForward) {
                    // backward to forward at current node
                    track.path.push({
                        order: currentNode.order,
                        lane: null,
                        isForward: false,
                        node: null,
                    });
                    addToAssignment(currentNode.order, null, trackNo, segmentNumber, prevSegmentPerOrderPerTrack, assignmentByOrderAndNode);
                    segmentNumber += 1;
                    track.path.push({
                        order: currentNode.order,
                        lane: null,
                        isForward: true,
                        node: currentNodeIndex,
                    });
                    addToAssignment(currentNode.order, currentNodeIndex, trackNo, segmentNumber, prevSegmentPerOrderPerTrack, assignmentByOrderAndNode);
                    segmentNumber += 1;
                }
                else {
                    // backward at current node
                    track.path.push({
                        order: currentNode.order,
                        lane: null,
                        isForward: false,
                        node: currentNodeIndex,
                    });
                    addToAssignment(currentNode.order, currentNodeIndex, trackNo, segmentNumber, prevSegmentPerOrderPerTrack, assignmentByOrderAndNode);
                    segmentNumber += 1;
                }
            }
            else {
                if (currentNodeIsForward !== previousNodeIsForward) {
                    track.path.push({
                        order: currentNode.order,
                        lane: null,
                        isForward: currentNodeIsForward,
                        node: currentNodeIndex,
                    });
                    addToAssignment(currentNode.order, currentNodeIndex, trackNo, segmentNumber, prevSegmentPerOrderPerTrack, assignmentByOrderAndNode);
                    segmentNumber += 1;
                }
                else {
                    track.path.push({
                        order: currentNode.order,
                        lane: null,
                        isForward: !currentNodeIsForward,
                        node: null,
                    });
                    addToAssignment(currentNode.order, null, trackNo, segmentNumber, prevSegmentPerOrderPerTrack, assignmentByOrderAndNode);
                    segmentNumber += 1;
                    track.path.push({
                        order: currentNode.order,
                        lane: null,
                        isForward: currentNodeIsForward,
                        node: currentNodeIndex,
                    });
                    addToAssignment(currentNode.order, currentNodeIndex, trackNo, segmentNumber, prevSegmentPerOrderPerTrack, assignmentByOrderAndNode);
                    segmentNumber += 1;
                }
            }
        }
    });
    // Now sweep left to right across order slots and assign vertical lanes to all the segments.
    for (let i = 0; i <= maxOrder; i += 1) {
        generateSingleLaneAssignment(assignments[i], i); // this is where the lanes get assigned
    }
}
function addToAssignment(order, nodeIndex, trackNo, segmentID, prevSegmentPerOrderPerTrack, assignmentByOrderAndNode) {
    const segment = {
        trackID: trackNo,
        segmentID,
        compareToFromSame: prevSegmentPerOrderPerTrack[order][trackNo] ?? null,
    };
    // A null node means the track is passing through / turning around here rather
    // than visiting a node, so such segments never share a NodeAssignment.
    const existing = nodeIndex === null
        ? undefined
        : assignmentByOrderAndNode[order].get(nodeIndex);
    if (existing === undefined) {
        const assignment = {
            type: 'single',
            node: nodeIndex,
            tracks: [segment],
        };
        assignments[order].push(assignment);
        if (nodeIndex !== null) {
            assignmentByOrderAndNode[order].set(nodeIndex, assignment);
        }
    }
    else {
        // add to existing node in assignment
        existing.type = 'multiple';
        existing.tracks.push(segment);
    }
    prevSegmentPerOrderPerTrack[order][trackNo] = segment;
}
// looks at assignment and sets idealY and idealLane by looking at where the tracks come from
function getIdealLanesAndCoords(assignment, order) {
    let index;
    assignment.forEach(node => {
        node.idealLane = 0;
        node.tracks.forEach(track => {
            if (track.segmentID === 0) {
                track.idealLane = track.trackID;
                track.idealY = null;
            }
            else {
                if (tracks[track.trackID].path[track.segmentID - 1].order ===
                    order - 1) {
                    track.idealLane =
                        tracks[track.trackID].path[track.segmentID - 1].lane ?? undefined;
                    track.idealY = tracks[track.trackID].path[track.segmentID - 1].y;
                }
                else if (track.segmentID < tracks[track.trackID].path.length - 1 &&
                    tracks[track.trackID].path[track.segmentID + 1].order === order - 1) {
                    track.idealLane =
                        tracks[track.trackID].path[track.segmentID + 1].lane ?? undefined;
                    track.idealY = tracks[track.trackID].path[track.segmentID + 1].y;
                }
                else {
                    index = track.segmentID - 1;
                    while (index >= 0 &&
                        tracks[track.trackID].path[index].order !== order - 1) {
                        index -= 1;
                    }
                    if (index < 0) {
                        track.idealLane = track.trackID;
                        track.idealY = null;
                    }
                    else {
                        track.idealLane =
                            tracks[track.trackID].path[index].lane ?? undefined;
                        track.idealY = tracks[track.trackID].path[index].y;
                    }
                }
            }
            node.idealLane += track.idealLane;
        });
        node.idealLane /= node.tracks.length;
    });
}
// assigns the optimal lanes for a single horizontal position (=order)
// first an ideal lane is calculated for each track (which is ~ the lane of its predecessor)
// then the nodes are sorted by their average ideal lane
// and the whole construct is then moved up or down if necessary
function generateSingleLaneAssignment(assignment, order) {
    let currentLane = 0;
    const potentialAdjustmentValues = new Set();
    let currentY = 20;
    let prevNameIsNull = false;
    let prevTrack = -1;
    getIdealLanesAndCoords(assignment, order);
    assignment.sort(compareByIdealLane);
    assignment.forEach(node => {
        if (node.node !== null) {
            nodes[node.node].topLane = currentLane;
            if (prevNameIsNull)
                currentY -= 10;
            nodes[node.node].y = currentY;
            nodes[node.node].contentHeight = 0;
            prevNameIsNull = false;
        }
        else {
            if (prevNameIsNull)
                currentY -= 25;
            else if (currentY > 20)
                currentY -= 10;
            prevNameIsNull = true;
        }
        node.tracks.sort(compareByIdealLane);
        node.tracks.forEach(track => {
            track.lane = currentLane;
            if (track.trackID === prevTrack && node.node === null && prevNameIsNull) {
                currentY += 10;
            }
            tracks[track.trackID].path[track.segmentID].lane = currentLane;
            tracks[track.trackID].path[track.segmentID].y = currentY;
            if (track.idealY != null) {
                potentialAdjustmentValues.add(track.idealY - currentY);
            }
            currentLane += 1;
            currentY += tracks[track.trackID].width;
            if (node.node !== null) {
                nodes[node.node].contentHeight += tracks[track.trackID].width;
            }
            prevTrack = track.trackID;
        });
        currentY += 25;
    });
    adjustVertically(assignment, potentialAdjustmentValues);
}
// moves all tracks at a single horizontal location (=order) up/down to minimize lane changes
function adjustVertically(assignment, potentialAdjustmentValues) {
    let verticalAdjustment = 0;
    let minAdjustmentCost = Number.MAX_SAFE_INTEGER;
    potentialAdjustmentValues.forEach(moveBy => {
        if (getVerticalAdjustmentCost(assignment, moveBy) < minAdjustmentCost) {
            minAdjustmentCost = getVerticalAdjustmentCost(assignment, moveBy);
            verticalAdjustment = moveBy;
        }
    });
    assignment.forEach(node => {
        if (node.node !== null) {
            nodes[node.node].y += verticalAdjustment;
        }
        node.tracks.forEach(track => {
            const seg = tracks[track.trackID].path[track.segmentID];
            seg.y = seg.y + verticalAdjustment;
        });
    });
}
// Budge down all nodes and out-of-node tracks below this node by this amount
function adjustVertically3(node, adjustBy) {
    if (node.order < 0 || assignments[node.order] === undefined)
        return;
    assignments[node.order].forEach(assignmentNode => {
        if (assignmentNode.node !== null) {
            const aNode = nodes[assignmentNode.node];
            if (aNode !== node && aNode.y > node.y) {
                aNode.y += adjustBy;
                assignmentNode.tracks.forEach(track => {
                    const seg = tracks[track.trackID].path[track.segmentID];
                    seg.y = seg.y + adjustBy;
                });
            }
        }
        else {
            // track-segment not within a node
            assignmentNode.tracks.forEach(track => {
                const seg = tracks[track.trackID].path[track.segmentID];
                if (seg.y >= node.y) {
                    seg.y = seg.y + adjustBy;
                }
            });
        }
    });
    if (nodesPerOrder[node.order].length > 0) {
        nodesPerOrder[node.order].forEach(nodeIndex => {
            if (nodes[nodeIndex] !== node && nodes[nodeIndex].y > node.y) {
                nodes[nodeIndex].y += adjustBy;
            }
        });
    }
}
// calculates cost of vertical adjustment as vertical distance * width of track
function getVerticalAdjustmentCost(assignment, moveBy) {
    let result = 0;
    assignment.forEach(node => {
        node.tracks.forEach(track => {
            if (track.idealY != null && tracks[track.trackID].type !== 'read') {
                result +=
                    Math.abs(track.idealY -
                        moveBy -
                        tracks[track.trackID].path[track.segmentID].y) * tracks[track.trackID].width;
            }
        });
    });
    return result;
}
function compareByIdealLane(a, b) {
    if (a.idealLane !== undefined) {
        if (b.idealLane !== undefined) {
            if (a.idealLane < b.idealLane)
                return -1;
            else if (a.idealLane > b.idealLane)
                return 1;
            return 0;
        }
        return -1;
    }
    if (b.idealLane !== undefined) {
        return 1;
    }
    return 0;
}
function compareNodesByOrder(a, b) {
    if (!a) {
        if (!b)
            return 0;
        return -1;
    }
    if (!b)
        return 1;
    if (a.order !== undefined) {
        if (b.order !== undefined) {
            if (a.order < b.order)
                return -1;
            else if (a.order > b.order)
                return 1;
            if (a.y !== undefined && b.y !== undefined) {
                if (a.y < b.y)
                    return -1;
                else if (a.y > b.y)
                    return 1;
            }
            return 0;
        }
        return -1;
    }
    if (b.order !== undefined)
        return 1;
    return 0;
}
function addTrackFeatures() {
    let nodeStart;
    let nodeEnd;
    let feature = {};
    bed.forEach(line => {
        let i = 0;
        while (i < tracks.length && tracks[i].name !== line.track)
            i += 1;
        if (i < tracks.length) {
            nodeStart = 0;
            tracks[i].path.forEach(node => {
                if (node.node !== null) {
                    feature = {};
                    nodeEnd = nodeStart + nodes[node.node].sequenceLength - 1;
                    if (nodeStart >= line.start && nodeStart <= line.end) {
                        feature.start = 0;
                    }
                    if (nodeStart < line.start && nodeEnd >= line.start) {
                        feature.start = line.start - nodeStart;
                    }
                    if (nodeEnd <= line.end && nodeEnd >= line.start) {
                        feature.end = nodeEnd - nodeStart;
                        if (nodeEnd < line.end)
                            feature.continue = true;
                    }
                    if (nodeEnd > line.end && nodeStart <= line.end) {
                        feature.end = line.end - nodeStart;
                    }
                    if (feature.start !== undefined) {
                        feature.type = line.type;
                        feature.name = line.name;
                        if (node.features === undefined)
                            node.features = [];
                        node.features.push(feature);
                    }
                    nodeStart = nodeEnd + 1;
                }
            });
        }
    });
}
function calculateTrackWidth() {
    // flag: if vg returns freq of 0 for all tracks, we will increase width manually
    let allAreFour = true;
    const NARROW_WIDTH = 4;
    const WIDE_WIDTH = config.trackWidth;
    tracks.forEach(track => {
        if (track.freq !== undefined) {
            // custom track width
            track.width = Math.round((Math.log(track.freq) + 1) * NARROW_WIDTH);
        }
        else {
            // default track width
            track.width = WIDE_WIDTH;
            if (track.type !== undefined && track.type === 'read') {
                track.width = NARROW_WIDTH;
            }
        }
        if (track.width !== NARROW_WIDTH) {
            allAreFour = false;
        }
    });
    if (allAreFour) {
        tracks.forEach(track => {
            if (track.freq !== undefined) {
                track.width = WIDE_WIDTH;
            }
        });
    }
}
function getReadXStart(read) {
    const seg = read.path[0];
    const node = nodes[seg.node];
    const offset = read.firstNodeOffset ?? 0;
    // read starts in forward direction, or backward from the node's far end
    return clampedXCoordinateOfBaseWithinNode(node, seg.isForward ? offset : node.sequenceLength - offset);
}
function getReadXEnd(read) {
    const seg = read.path[read.path.length - 1];
    const node = nodes[seg.node];
    const cover = read.finalNodeCoverLength ?? 0;
    // read ends in forward direction, or backward from the node's far end
    return clampedXCoordinateOfBaseWithinNode(node, seg.isForward ? cover : node.sequenceLength - cover);
}
// returns the x coordinate (in pixels) of (the left side) of the given base
// position within the given node, or null if the position is past its end
export function getXCoordinateOfBaseWithinNode(node, base) {
    if (base > node.sequenceLength)
        return null; // equality is allowed
    return clampedXCoordinateOfBaseWithinNode(node, base);
}
// Same, but a base outside the node maps to the nearest node edge. Callers that
// have to produce a coordinate no matter what use this: falling back to 0 would
// put the shape at the far left of the whole image instead.
export function clampedXCoordinateOfBaseWithinNode(node, base) {
    const [nodeLeftX, nodeRightX] = nodePixelCoordinatesInX(node);
    if (node.sequenceLength === 0) {
        return nodeLeftX;
    }
    const clamped = Math.min(Math.max(base, 0), node.sequenceLength);
    return nodeLeftX + (clamped / node.sequenceLength) * (nodeRightX - nodeLeftX);
}
// transforms the info in the tracks' path attribute into actual coordinates
// and saves them in shapes.rectangles and shapes.curves
function generateSVGShapesFromPath() {
    let xStart;
    let xEnd;
    let yStart;
    let yEnd;
    let trackColor;
    let trackAlpha;
    let highlight;
    let dummy;
    let reversalFlag;
    for (let i = 0; i <= maxOrder; i += 1) {
        extraLeft.push(0);
        extraRight.push(0);
    }
    // generate x coords where each order starts and ends
    const orderStartX = [];
    const orderEndX = [];
    nodes.forEach(node => {
        if (node.x !== undefined) {
            orderStartX[node.order] = node.x;
            if (orderEndX[node.order] === undefined) {
                orderEndX[node.order] = node.x + node.pixelWidth;
            }
            else {
                orderEndX[node.order] = Math.max(orderEndX[node.order], node.x + node.pixelWidth);
            }
        }
    });
    // Helps generation of verticalRectangles, correct increments of extraRight and extraLeft
    tracks.sort(compareTrackByInitialOrdering);
    tracks.forEach(track => {
        highlight = 'plain';
        // Both are pure functions of (track, highlight); alpha doesn't even look at
        // highlight. Recomputing them per path segment was pure overhead.
        trackColor = generateTrackColor(track, highlight);
        trackAlpha = generateTrackAlpha(track);
        let colorHighlight = highlight;
        const colorForCurrentHighlight = () => {
            if (colorHighlight !== highlight) {
                colorHighlight = highlight;
                trackColor = generateTrackColor(track, highlight);
            }
            return trackColor;
        };
        // start of path
        yStart = track.path[0].y;
        if (track.type !== 'read') {
            if (track.sequence[0].startsWith('-')) {
                // The track starts with an inversed node
                xStart = orderEndX[track.path[0].order] + 20;
            }
            else {
                // The track starts with a forward node
                xStart = orderStartX[track.path[0].order] - 20;
            }
        }
        else {
            xStart = getReadXStart(track);
        }
        // middle of path
        for (let i = 0; i < track.path.length; i += 1) {
            if (track.path[i].y === yStart) {
                if (track.path[i].features !== undefined) {
                    reversalFlag =
                        i > 0 && track.path[i - 1].order === track.path[i].order;
                    dummy = createFeatureRectangle(track.path[i], orderStartX[track.path[i].order], orderEndX[track.path[i].order], highlight, track, xStart, yStart, trackColor, reversalFlag);
                    highlight = dummy.highlight;
                    xStart = dummy.xStart;
                }
            }
            else {
                if (track.path[i - 1].isForward) {
                    xEnd = orderEndX[track.path[i - 1].order];
                }
                else {
                    xEnd = orderStartX[track.path[i - 1].order];
                }
                if (xEnd !== xStart) {
                    trackColor = colorForCurrentHighlight();
                    shapes.rectangles.push({
                        xStart: Math.min(xStart, xEnd),
                        yStart,
                        xEnd: Math.max(xStart, xEnd),
                        yEnd: yStart + track.width - 1,
                        color: trackColor,
                        alpha: trackAlpha,
                        // TODO: This is not actually the index of the track!
                        id: track.id,
                        name: track.name,
                        type: track.type,
                    });
                }
                if (track.path[i].order - 1 === track.path[i - 1].order) {
                    // regular forward connection
                    xStart = xEnd;
                    xEnd = orderStartX[track.path[i].order];
                    yEnd = track.path[i].y;
                    trackColor = colorForCurrentHighlight();
                    shapes.curves.push({
                        xStart,
                        yStart,
                        xEnd: xEnd + 1,
                        yEnd,
                        width: track.width,
                        color: trackColor,
                        alpha: trackAlpha,
                        laneChange: Math.abs(track.path[i].lane - track.path[i - 1].lane),
                        id: track.id,
                        name: track.name,
                        type: track.type,
                        nodeStart: track.path[i - 1]?.node,
                        nodeEnd: track.path[i]?.node,
                    });
                    xStart = xEnd;
                    yStart = yEnd;
                }
                else if (track.path[i].order + 1 === track.path[i - 1].order) {
                    // regular backward connection
                    xStart = xEnd;
                    xEnd = orderEndX[track.path[i].order];
                    yEnd = track.path[i].y;
                    trackColor = colorForCurrentHighlight();
                    shapes.curves.push({
                        xStart: xStart + 1,
                        yStart,
                        xEnd,
                        yEnd,
                        width: track.width,
                        color: trackColor,
                        alpha: trackAlpha,
                        laneChange: Math.abs(track.path[i].lane - track.path[i - 1].lane),
                        id: track.id,
                        name: track.name,
                        type: track.type,
                        nodeStart: track.path[i - 1]?.node,
                        nodeEnd: track.path[i]?.node,
                    });
                    xStart = xEnd;
                    yStart = yEnd;
                }
                else {
                    // change of direction
                    if (track.path[i - 1].isForward) {
                        yEnd = track.path[i].y;
                        generateTurnaround(1, xEnd, yStart, yEnd, track.width, trackColor, track.id, track.path[i].order, track.type, track.name);
                        xStart = orderEndX[track.path[i].order];
                        yStart = track.path[i].y;
                    }
                    else {
                        yEnd = track.path[i].y;
                        generateTurnaround(-1, xEnd, yStart, yEnd, track.width, trackColor, track.id, track.path[i].order, track.type, track.name);
                        xStart = orderStartX[track.path[i].order];
                        yStart = track.path[i].y;
                    }
                }
                if (track.path[i].features !== undefined) {
                    reversalFlag = track.path[i - 1].order === track.path[i].order;
                    dummy = createFeatureRectangle(track.path[i], orderStartX[track.path[i].order], orderEndX[track.path[i].order], highlight, track, xStart, yStart, trackColor, reversalFlag);
                    highlight = dummy.highlight;
                    xStart = dummy.xStart;
                }
            }
        }
        // ending edges
        if (track.type !== 'read') {
            if (!track.path[track.path.length - 1].isForward) {
                // The track ends with an inversed node
                xEnd = orderStartX[track.path[track.path.length - 1].order] - 20;
            }
            else {
                // The track ends with a forward node
                xEnd = orderEndX[track.path[track.path.length - 1].order] + 20;
            }
        }
        else {
            xEnd = getReadXEnd(track);
        }
        shapes.rectangles.push({
            xStart: Math.min(xStart, xEnd),
            yStart,
            xEnd: Math.max(xStart, xEnd),
            yEnd: yStart + track.width - 1,
            color: trackColor,
            alpha: trackAlpha,
            id: track.id,
            name: track.name,
            type: track.type,
        });
    });
}
// Sankey-mode synthesis: one synthetic "read" per (srcSigned → dstSigned) edge,
// fed through the normal placeReads/generateSVGShapesFromPath pipeline so the
// band gets the same lane assignment, loop topology, bezier shape, AND color
// scheme as a real read — colors come from generateTrackColor's natural
// `id % palette.length` rotation, no custom palette needed.
//
// Synthetic-track ids live above this base so they don't collide with real
// track ids and so click/hover handlers can show count info instead of the
// per-read info dialog.
const COARSENED_ID_BASE = 1_000_000_000;
export const isCoarsenedId = (id) => id >= COARSENED_ID_BASE;
// Build one synthetic read per (srcSigned → dstSigned) edge in `reads`. The
// synthetic reads replace the real ones BEFORE placeReads runs, so:
//   • placeReads sees N_edges reads instead of N_reads (huge node-height win),
//   • each band gets a lane and an "right-down-left-up-right" loop topology
//     for free (placeReads handles reversals and out-of-order jumps),
//   • generateSVGShapesFromPath emits exactly one TrackCurve per band using
//     the same bezier as a real read — no special draw path needed.
//
// The synthetic track's `sequence` is just the two signed node names. After
// generateTrackIndexSequences runs, indexSequence is set and the rest of the
// layout follows.
function buildCoarsenedSyntheticReads() {
    coarsenedEdgeMeta = new Map();
    const edges = new Map();
    // When ignoring strand, (+A→+B) and (-B→-A) refer to the same underlying
    // graph connection — collapse both into one canonical key. We pick the
    // lexicographically smaller of the two orientations so a stable canonical
    // form is chosen; whichever orientation is seen first determines the
    // visual band direction.
    const ignoreStrand = config.ignoreStrand;
    for (const read of reads) {
        const seq = read.indexSequence;
        if (!seq || seq.length < 2)
            continue;
        for (let i = 0; i < seq.length - 1; i += 1) {
            const sSigned = seq[i];
            const dSigned = seq[i + 1];
            const sIdx = Math.abs(sSigned);
            const dIdx = Math.abs(dSigned);
            const srcNode = nodes[sIdx];
            const dstNode = nodes[dIdx];
            if (!srcNode || !dstNode)
                continue;
            let key;
            if (ignoreStrand) {
                const a = `${sSigned}>${dSigned}`;
                const b = `${-dSigned}>${-sSigned}`;
                key = a < b ? a : b;
            }
            else {
                key = `${sSigned}>${dSigned}`;
            }
            const existing = edges.get(key);
            if (existing === undefined) {
                edges.set(key, {
                    sSigned,
                    dSigned,
                    sName: sSigned < 0 ? `-${srcNode.name}` : srcNode.name,
                    dName: dSigned < 0 ? `-${dstNode.name}` : dstNode.name,
                    count: 1,
                    sourceTrackID: read.sourceTrackID,
                });
            }
            else {
                existing.count += 1;
            }
        }
    }
    // Square-root scaling on count gives heavy edges visible weight without
    // letting one massive edge dwarf everything else. Min stays near READ_WIDTH
    // so single-read edges still look like a normal read; max is generous so
    // hot edges read as obvious "highways."
    let maxEdgeCount = 0;
    for (const e of edges.values()) {
        if (e.count > maxEdgeCount)
            maxEdgeCount = e.count;
    }
    const BAND_MIN_WIDTH = READ_WIDTH;
    const BAND_MAX_WIDTH = 60;
    const widthForCount = (c) => {
        if (maxEdgeCount <= 1)
            return BAND_MIN_WIDTH;
        return (BAND_MIN_WIDTH +
            (BAND_MAX_WIDTH - BAND_MIN_WIDTH) * Math.sqrt(c / maxEdgeCount));
    };
    const synthetic = [];
    let i = 0;
    for (const edge of edges.values()) {
        const id = COARSENED_ID_BASE + i;
        const label = `${edge.count.toLocaleString()} read${edge.count === 1 ? '' : 's'}: Node ${edge.sName} → Node ${edge.dName}`;
        coarsenedEdgeMeta.set(id, { count: edge.count, label });
        // Place each synthetic band so it touches *only* its endpoint nodes' edges:
        //   • firstNodeOffset = src.sequenceLength → curve exits at src's right
        //     pixel edge, no rectangle drawn inside src.
        //   • finalNodeCoverLength = 0 → curve enters at dst's left pixel edge,
        //     no rectangle drawn inside dst.
        // The crucial side effect is in placeReadSet's conflict check: at any
        // node B with an incoming edge (A→B) and an outgoing edge (B→C), the
        // incoming's finalNodeCoverLength=0 and the outgoing's firstNodeOffset=
        // B.length leave them with no horizontal overlap, so they share a single
        // lane. Node heights collapse from ~(N_in + N_out) lanes down to
        // ~max(N_in, N_out) lanes.
        //
        // Note: reverseReversedReads will swap firstNodeOffset/finalNodeCoverLength
        // for fully-reverse synthetics. The math works out: pre-flip values of
        // (srcLen, 0) become post-flip (newSrcLen, 0), which is the same pattern
        // — bands stay edge-only regardless of orientation.
        const srcLen = nodes[Math.abs(edge.sSigned)]?.sequenceLength ?? 0; // node may be absent for a dangling edge
        synthetic.push({
            id,
            sourceTrackID: edge.sourceTrackID,
            type: 'read',
            // Human-readable so the name surfaces sensibly in any UI that uses it
            // (right-click → add to group, etc.) — and so trackTooltipText fallback
            // shows something meaningful.
            name: label,
            sequence: [edge.sName, edge.dName],
            indexSequence: [],
            path: [],
            // Pre-set width so placeReads / placeReadSet allocate the right vertical
            // space and assignReadsToNodes (patched to honor pre-set widths) leaves
            // it alone.
            width: widthForCount(edge.count),
            firstNodeOffset: srcLen,
            finalNodeCoverLength: 0,
            sequenceNew: [
                { nodeName: edge.sName, mismatches: [] },
                { nodeName: edge.dName, mismatches: [] },
            ],
            mapping_quality: 0,
            is_secondary: false,
            sample_name: null,
            read_group: null,
            score: edge.count,
        });
        i += 1;
    }
    // Single-line debug summary so the user can verify node sizing.
    let tallestName = '?';
    let tallestH = 0;
    for (const n of nodes) {
        if (!n)
            continue;
        const h = n.contentHeight;
        if (h > tallestH) {
            tallestH = h;
            tallestName = n.name;
        }
    }
    if (DEBUG) {
        console.log(`[coarsened] reads_in=${reads.length} edges_out=${synthetic.length} ` +
            `tallestNodeBeforePlace=${tallestName}(${tallestH.toFixed(1)})`);
    }
    return synthetic;
}
function createFeatureRectangle(node, nodeXStart, nodeXEnd, highlight, track, rectXStart, yStart, trackColor, reversalFlag) {
    let currentHighlight = highlight;
    let c;
    let co;
    let featureXStart;
    let featureXEnd;
    nodeXStart -= 8;
    nodeXEnd += 8;
    const nodeWidth = nodes[node.node].sequenceLength;
    node.features.sort((a, b) => a.start - b.start);
    node.features.forEach(feature => {
        if (currentHighlight !== feature.type) {
            // finish incoming rectangle
            c = generateTrackColor(track, currentHighlight);
            if (node.isForward) {
                featureXStart =
                    nodeXStart +
                        Math.round((feature.start * (nodeXEnd - nodeXStart + 1)) / nodeWidth);
                // overwrite narrow post-inversion rectangle if highlight starts near beginning of node
                if (reversalFlag && featureXStart < nodeXStart + 8) {
                    featureXEnd =
                        nodeXStart +
                            Math.round(((feature.end + 1) * (nodeXEnd - nodeXStart + 1)) / nodeWidth) -
                            1;
                    co = generateTrackColor(track, feature.type);
                    shapes.featureRectangles.push({
                        xStart: featureXStart,
                        yStart,
                        xEnd: featureXEnd,
                        yEnd: yStart + track.width - 1,
                        color: co,
                        id: track.id,
                        name: track.name,
                        type: track.type,
                    });
                }
                if (featureXStart > rectXStart + 1) {
                    shapes.featureRectangles.push({
                        xStart: rectXStart,
                        yStart,
                        xEnd: featureXStart - 1,
                        yEnd: yStart + track.width - 1,
                        color: c,
                        id: track.id,
                        name: track.name,
                        type: track.type,
                    });
                }
            }
            else {
                featureXStart =
                    nodeXEnd -
                        Math.round((feature.start * (nodeXEnd - nodeXStart + 1)) / nodeWidth);
                // overwrite narrow post-inversion rectangle if highlight starts near beginning of node
                if (reversalFlag && featureXStart > nodeXEnd - 8) {
                    featureXEnd =
                        nodeXEnd -
                            Math.round(((feature.end + 1) * (nodeXEnd - nodeXStart + 1)) / nodeWidth) -
                            1;
                    co = generateTrackColor(track, feature.type);
                    shapes.featureRectangles.push({
                        xStart: featureXEnd,
                        yStart,
                        xEnd: featureXStart,
                        yEnd: yStart + track.width - 1,
                        color: co,
                        id: track.id,
                        name: track.name,
                        type: track.type,
                    });
                }
                if (rectXStart > featureXStart + 1) {
                    shapes.featureRectangles.push({
                        xStart: featureXStart + 1,
                        yStart,
                        xEnd: rectXStart,
                        yEnd: yStart + track.width - 1,
                        color: c,
                        id: track.id,
                        name: track.name,
                        type: track.type,
                    });
                }
            }
            rectXStart = featureXStart;
            currentHighlight = feature.type;
        }
        if (feature.end < nodeWidth - 1 || feature.continue === undefined) {
            // finish internal rectangle
            c = generateTrackColor(track, currentHighlight);
            if (node.isForward) {
                featureXEnd =
                    nodeXStart +
                        Math.round(((feature.end + 1) * (nodeXEnd - nodeXStart + 1)) / nodeWidth) -
                        1;
                shapes.featureRectangles.push({
                    xStart: rectXStart,
                    yStart,
                    xEnd: featureXEnd,
                    yEnd: yStart + track.width - 1,
                    color: c,
                    id: track.id,
                    name: track.name,
                    type: track.type,
                });
            }
            else {
                featureXEnd =
                    nodeXEnd -
                        Math.round(((feature.end + 1) * (nodeXEnd - nodeXStart + 1)) / nodeWidth) -
                        1;
                shapes.featureRectangles.push({
                    xStart: featureXEnd,
                    yStart,
                    xEnd: rectXStart,
                    yEnd: yStart + track.width - 1,
                    color: c,
                    id: track.id,
                    name: track.name,
                    type: track.type,
                });
            }
            rectXStart = featureXEnd + 1;
            currentHighlight = 'plain';
        }
    });
    return { xStart: rectXStart, highlight: currentHighlight };
}
const MIN_BEND_WIDTH = 7;
// Emit the vertical rectangles + rounded corners for a track turning around at
// one end of an order slot. The two directions are mirror images of each other:
// a forward-to-reverse turn bulges out to the right of the node and consumes an
// `extraRight` slot, a reverse-to-forward turn bulges out to the left and
// consumes an `extraLeft` slot. `dir` is +1 for right, -1 for left.
function generateTurnaround(dir, x, yStart, yEnd, trackWidth, trackColor, trackID, order, type, trackName) {
    const extra = dir === 1 ? extraRight : extraLeft;
    const offset = 10 * extra[order];
    // The turn's apex, and the outward direction from it.
    const apex = x + dir * (offset + 5);
    const radius = MIN_BEND_WIDTH;
    const stem = Math.min(MIN_BEND_WIDTH, trackWidth);
    const yTop = Math.min(yStart, yEnd);
    const yBottom = Math.max(yStart, yEnd);
    // The incoming/outgoing stubs run from the node's edge out to the apex. The
    // one-pixel asymmetry between the two directions is carried over verbatim
    // from the original pair of functions.
    const stubNear = dir === 1 ? x : apex - 1;
    const stubFar = dir === 1 ? apex : x;
    const horizontal = (segTop) => {
        shapes.verticalRectangles.push({
            xStart: stubNear,
            yStart: segTop,
            xEnd: stubFar,
            yEnd: segTop + trackWidth - 1,
            color: trackColor,
            id: trackID,
            name: trackName,
            type,
        });
    };
    // elongate the incoming and outgoing rectangles a bit past the node
    horizontal(yStart);
    shapes.verticalRectangles.push({
        xStart: dir === 1 ? apex + radius : apex - radius - stem,
        yStart: yTop + trackWidth + radius - 1,
        xEnd: dir === 1 ? apex + radius + stem - 1 : apex - radius - 1,
        yEnd: yBottom - radius + 1,
        color: trackColor,
        id: trackID,
        name: trackName,
        type,
    });
    horizontal(yEnd);
    const inner = apex + dir * radius;
    const outer = apex + dir * (radius + stem);
    // bottom 90 degree bend
    let d = `M ${apex} ${yBottom}`;
    d += ` Q ${inner} ${yBottom} ${inner} ${yBottom - radius}`;
    d += ` H ${outer}`;
    d += ` Q ${outer} ${yBottom + trackWidth} ${apex} ${yBottom + trackWidth}`;
    d += ' Z ';
    shapes.corners.push({ path: d, color: trackColor, id: trackID, type });
    // top 90 degree bend
    d = `M ${apex} ${yTop}`;
    d += ` Q ${outer} ${yTop} ${outer} ${yTop + trackWidth + radius}`;
    d += ` H ${inner}`;
    d += ` Q ${inner} ${yTop + trackWidth} ${apex} ${yTop + trackWidth}`;
    d += ' Z ';
    shapes.corners.push({ path: d, color: trackColor, id: trackID, type });
    extra[order] += 1;
}
export function nodePixelCoordinatesInX(node) {
    // Add and subtract 4 to account for stroke width - TODO: figure out what the 4 means
    const nodeLeftX = node.x - 4;
    const nodeRightX = node.x + node.pixelWidth + 4;
    return [nodeLeftX, nodeRightX];
}
// calculate node widths depending on sequence lengths and chosen calculation method
function generateNodeWidth() {
    // Promote the input's optional sequenceLength; Node declares it required, so
    // widen to InputNode to make the still-possibly-undefined read explicit.
    nodes.forEach((node) => {
        if (node.sequenceLength === undefined) {
            node.sequenceLength = node.seq.length;
        }
    });
    switch (config.nodeWidthOption) {
        case 'compressed':
            nodes.forEach(node => {
                node.width = 1 + Math.log(node.sequenceLength) / Math.log(2);
                node.pixelWidth = Math.round((node.width - 1) * 8.401);
            });
            break;
        case 'small':
            nodes.forEach(node => {
                node.width = node.sequenceLength / 100;
                node.pixelWidth = Math.round((node.width - 1) * 8.401);
            });
            break;
        case 'fixed':
            // when there's no reads in the node, it should be a little wider
            nodes.forEach(node => {
                node.width = 10;
                node.pixelWidth = Math.round(node.width * 8.401);
            });
            break;
        case 'normal': {
            // The sequence is drawn in a monospace font, so one character's width,
            // which the caller measures, sizes every node.
            const charWidth = config.charWidth;
            nodes.forEach(node => {
                node.width = node.sequenceLength;
                const len = node.seq?.length ?? 1;
                node.pixelWidth = Math.round(charWidth * len);
            });
            break;
        }
        default:
            throw new Error(`${config.nodeWidthOption} not implemented`);
    }
}
// remove redundant nodes
// two nodes A and B can be merged if all tracks leaving A go directly into B
// and all tracks entering B come directly from A
// (plus no inversions involved)
function mergeNodes() {
    let nodeName;
    let nodeName2;
    // One set per node index, including the hole at 0 (Array.from materializes
    // holes, unlike forEach/map).
    const predSets = Array.from(nodes, () => new Set());
    const succSets = Array.from(nodes, () => new Set());
    let tracksAndReads;
    if (config.showReads && reads.length > 0)
        tracksAndReads = tracks.concat(reads);
    else
        tracksAndReads = tracks;
    tracksAndReads.forEach(track => {
        for (let i = 0; i < track.sequence.length; i += 1) {
            if (!isReverse(track.sequence[i])) {
                // forward Node
                if (i > 0) {
                    nodeName = track.sequence[i - 1];
                    predSets[nodeMap.get(track.sequence[i])].add(nodeName);
                    if (isReverse(nodeName)) {
                        // add 2 predecessors, to make sure there is no node merging in this case
                        predSets[nodeMap.get(track.sequence[i])].add(forward(nodeName));
                    }
                }
                else if (track.type === 'haplotype') {
                    predSets[nodeMap.get(track.sequence[i])].add('None');
                }
                if (i < track.sequence.length - 1) {
                    nodeName = track.sequence[i + 1];
                    succSets[nodeMap.get(track.sequence[i])].add(nodeName);
                    if (isReverse(nodeName)) {
                        // add 2 successors, to make sure there is no node merging in this case
                        succSets[nodeMap.get(track.sequence[i])].add(forward(nodeName));
                    }
                }
                else if (track.type === 'haplotype') {
                    succSets[nodeMap.get(track.sequence[i])].add('None');
                }
            }
            else {
                // reverse Node
                nodeName = forward(track.sequence[i]);
                if (i > 0) {
                    nodeName2 = track.sequence[i - 1];
                    if (isReverse(nodeName2)) {
                        succSets[nodeMap.get(nodeName)].add(forward(nodeName2));
                    }
                    else {
                        // add 2 successors, to make sure there is no node merging in this case
                        succSets[nodeMap.get(nodeName)].add(nodeName2);
                        succSets[nodeMap.get(nodeName)].add(reverse(nodeName2));
                    }
                }
                else if (track.type === 'haplotype') {
                    succSets[nodeMap.get(nodeName)].add('None');
                }
                if (i < track.sequence.length - 1) {
                    nodeName2 = track.sequence[i + 1];
                    if (isReverse(nodeName2)) {
                        predSets[nodeMap.get(nodeName)].add(forward(nodeName2));
                    }
                    else {
                        predSets[nodeMap.get(nodeName)].add(nodeName2);
                        predSets[nodeMap.get(nodeName)].add(reverse(nodeName2));
                    }
                }
                else if (track.type === 'haplotype') {
                    predSets[nodeMap.get(nodeName)].add('None');
                }
            }
        }
    });
    // convert sets to arrays
    const pred = predSets.map(s => Array.from(s));
    const succ = succSets.map(s => Array.from(s));
    // update reads which pass through merging nodes
    if (config.showReads && reads.length > 0) {
        // sort nodes by order, then by y-coordinate
        const sortedNodes = nodes.slice();
        sortedNodes.sort(compareNodesByOrder);
        // iterate over all nodes and calculate their position within the new merged node
        // Both maps carry an entry for each orientation of every node name ("7"
        // and "-7"), because the read update below looks up whichever orientation
        // the read happens to visit.
        const mergeOffset = new Map();
        // maps to leftmost node of a node's "merging cascade"
        const mergeOrigin = new Map();
        const offsetOf = (nodeName) => {
            const offset = mergeOffset.get(nodeName);
            if (offset === undefined) {
                throw new Error(`No merge offset recorded for node ${nodeName}`);
            }
            return offset;
        };
        const originOf = (nodeName) => {
            const origin = mergeOrigin.get(nodeName);
            if (origin === undefined) {
                throw new Error(`No merge origin recorded for node ${nodeName}`);
            }
            return origin;
        };
        sortedNodes.forEach(node => {
            const predecessor = mergeableWithPred(nodeMap.get(node.name), pred, succ);
            if (predecessor) {
                // Nodes are visited in order, so the predecessor of a merge cascade is
                // always recorded before the node that follows it.
                const offset = offsetOf(predecessor) + nodeByName(predecessor).sequenceLength;
                mergeOffset.set(node.name, offset);
                mergeOffset.set(reverse(node.name), offset);
                mergeOrigin.set(node.name, originOf(predecessor));
                mergeOrigin.set(reverse(node.name), originOf(predecessor));
            }
            else {
                mergeOffset.set(node.name, 0);
                mergeOffset.set(reverse(node.name), 0);
                mergeOrigin.set(node.name, node.name);
                mergeOrigin.set(reverse(node.name), node.name);
            }
        });
        reads.forEach(read => {
            const sequenceNew = read.sequenceNew ?? [];
            read.firstNodeOffset =
                (read.firstNodeOffset ?? 0) + offsetOf(read.sequence[0]);
            read.finalNodeCoverLength =
                (read.finalNodeCoverLength ?? 0) +
                    offsetOf(read.sequence[read.sequence.length - 1]);
            for (let i = read.sequence.length - 1; i >= 0; i -= 1) {
                const nodeName = forward(read.sequence[i]);
                const predecessor = mergeableWithPred(nodeMap.get(nodeName), pred, succ);
                if (predecessor &&
                    mergeableWithSucc(nodeMap.get(predecessor), pred, succ)) {
                    if (i > 0) {
                        read.sequence.splice(i, 1);
                        // adjust position of mismatches
                        const predLength = nodeByName(predecessor).sequenceLength;
                        sequenceNew[i].mismatches.forEach(mismatch => {
                            mismatch.pos += predLength;
                        });
                        // append mismatches to previous entry's mismatches
                        sequenceNew[i - 1].mismatches = sequenceNew[i - 1].mismatches.concat(sequenceNew[i].mismatches);
                        sequenceNew.splice(i, 1);
                    }
                    else {
                        read.sequence[0] = originOf(read.sequence[0]);
                        const firstEntry = sequenceNew[0];
                        const firstOffset = offsetOf(firstEntry.nodeName);
                        firstEntry.mismatches.forEach(mismatch => {
                            mismatch.pos += firstOffset;
                        });
                        firstEntry.nodeName = originOf(firstEntry.nodeName);
                    }
                }
            }
        });
    }
    // update node sequences + sequence lengths
    for (let i = 0; i < nodes.length; i += 1) {
        if (mergeableWithSucc(i, pred, succ) && !mergeableWithPred(i, pred, succ)) {
            let donor = i;
            while (mergeableWithSucc(donor, pred, succ)) {
                donor = nodeMap.get(forward(succ[donor][0]));
                nodes[i].sequenceLength += nodes[donor].sequenceLength;
                nodes[i].seq += nodes[donor].seq;
            }
        }
    }
    // actually merge the nodes by removing the corresponding nodes from track data
    tracks.forEach(track => {
        for (let i = track.sequence.length - 1; i >= 0; i -= 1) {
            nodeName = forward(track.sequence[i]);
            const nodeIndex = nodeMap.get(nodeName);
            if (mergeableWithPred(nodeIndex, pred, succ)) {
                track.sequence.splice(i, 1);
            }
        }
    });
    // remove the nodes from node-array
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
        if (mergeableWithPred(i, pred, succ)) {
            nodes.splice(i, 1);
        }
    }
}
function mergeableWithPred(index, pred, succ) {
    if (pred[index].length !== 1)
        return false;
    if (pred[index][0] === 'None')
        return false;
    const predecessor = forward(pred[index][0]);
    const predecessorIndex = nodeMap.get(predecessor);
    if (succ[predecessorIndex].length !== 1)
        return false;
    if (succ[predecessorIndex][0] === 'None')
        return false;
    return predecessor;
}
function mergeableWithSucc(index, pred, succ) {
    if (succ[index].length !== 1)
        return false;
    if (succ[index][0] === 'None')
        return false;
    const successor = forward(succ[index][0]);
    const successorIndex = nodeMap.get(successor);
    if (pred[successorIndex].length !== 1)
        return false;
    if (pred[successorIndex][0] === 'None')
        return false;
    return true;
}
function filterReads(readList) {
    const focusNames = config.focusReadNames
        ? new Set(config.focusReadNames)
        : null;
    return readList.filter(read => read.is_secondary !== true &&
        (read.mapping_quality ?? 0) >= config.mappingQualityCutoff &&
        (focusNames === null ||
            (read.name !== undefined && focusNames.has(read.name))));
}
