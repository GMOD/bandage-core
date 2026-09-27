function groupBy(items, key) {
    const groups = new Map();
    for (const item of items) {
        const k = key(item);
        const group = groups.get(k);
        if (group === undefined) {
            groups.set(k, [item]);
        }
        else {
            group.push(item);
        }
    }
    return groups;
}
function compareCurvesByXYStartValue(a, b) {
    if (a.xStart < b.xStart)
        return 1;
    else if (a.xStart > b.xStart)
        return -1;
    else if (a.yStart > b.yStart)
        return 1;
    else if (a.yStart < b.yStart)
        return -1;
    return 0;
}
// The curves of one track type in draw order, each with its `path` set. Curves
// between the same pair of nodes form a group whose control points fan out, so
// a bundle of tracks changing lanes together stays parallel rather than
// crossing at one x.
export function curvePaths(curves, type) {
    const groupedCurves = groupBy(curves.filter(curve => curve.type === type), curve => `${curve.nodeStart},${curve.nodeEnd}`);
    groupedCurves.forEach(curveGroup => {
        // Control point adjustment range: 30% to 70% of the original x values
        let adjustValue = 0.3;
        let adjustIncrement = 0.4 / curveGroup.length;
        // Ignore Beziar Curve skewing when a group is not too big
        if (curveGroup.length <= 5) {
            adjustValue = 0.5;
            adjustIncrement = 0;
        }
        curveGroup.sort(compareCurvesByXYStartValue);
        curveGroup.forEach(curve => {
            let xAdjusted;
            // NextAdjusted is used to try to draw a parallel curve on the way back
            let xNextAdjusted;
            if (curve.yStart < curve.yEnd) {
                xAdjusted =
                    curve.xStart + (curve.xEnd - curve.xStart) * (1 - adjustValue);
                adjustValue += adjustIncrement;
                xNextAdjusted =
                    curve.xStart + (curve.xEnd - curve.xStart) * (1 - adjustValue);
            }
            else {
                xAdjusted = curve.xStart + (curve.xEnd - curve.xStart) * adjustValue;
                adjustValue += adjustIncrement;
                xNextAdjusted = curve.xStart + (curve.xEnd - curve.xStart) * adjustValue;
            }
            let d = `M ${curve.xStart} ${curve.yStart}`;
            d += ` C ${xAdjusted} ${curve.yStart} ${xAdjusted} ${curve.yEnd} ${curve.xEnd} ${curve.yEnd}`;
            d += ` V ${curve.yEnd + curve.width}`;
            d += ` C ${xNextAdjusted} ${curve.yEnd + curve.width} ${xNextAdjusted} ${curve.yStart + curve.width} ${curve.xStart} ${curve.yStart + curve.width}`;
            d += ' Z';
            curve.path = d;
        });
    });
    // One flat list ordered by group, then by the within-group sort
    const groupKeys = Array.from(groupedCurves.keys());
    groupKeys.sort(function (a, b) {
        const aParts = a.split(',').map(Number);
        const bParts = b.split(',').map(Number);
        const a0 = aParts[0] ?? 0;
        const a1 = aParts[1] ?? 0;
        const b0 = bParts[0] ?? 0;
        const b1 = bParts[1] ?? 0;
        if (a0 < b0) {
            return -1;
        }
        else if (a0 > b0) {
            return 1;
        }
        else {
            if (a1 < b1) {
                return -1;
            }
            else if (a1 > b1) {
                return 1;
            }
            else {
                return 0;
            }
        }
    });
    const flattenedGroups = [];
    for (const key of groupKeys) {
        const group = groupedCurves.get(key);
        if (group !== undefined) {
            flattenedGroups.push(...group);
        }
    }
    return flattenedGroups;
}
// A node's outline: a rounded box 9 units outside the node's x extent and its
// content height, the tracks through it inside.
export function nodeOutlinePath(node) {
    // top left arc
    let d = `M ${node.x - 9} ${node.y} Q ${node.x - 9} ${node.y - 9} ${node.x} ${node.y - 9}`;
    let x = node.x;
    let y = node.y - 9;
    // top straight
    if (node.width > 1) {
        x += node.pixelWidth;
        d += ` L ${x} ${y}`;
    }
    // top right arc
    d += ` Q ${x + 9} ${y} ${x + 9} ${y + 9}`;
    x += 9;
    y += 9;
    // right straight
    if (node.contentHeight > 0) {
        y += node.contentHeight - 0;
        d += ` L ${x} ${y}`;
    }
    // bottom right arc
    d += ` Q ${x} ${y + 9} ${x - 9} ${y + 9}`;
    x -= 9;
    y += 9;
    // bottom straight
    if (node.width > 1) {
        x -= node.pixelWidth;
        d += ` L ${x} ${y}`;
    }
    // bottom left arc
    d += ` Q ${x - 9} ${y} ${x - 9} ${y - 9}`;
    x -= 9;
    y -= 9;
    // left straight
    if (node.contentHeight > 0) {
        y -= node.contentHeight - 0;
        d += ` L ${x} ${y}`;
    }
    return d;
}
