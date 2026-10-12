// Copyright 2017 Ryan Wick
// Copyright 2024 Bandage Layout JS Port

// This file is part of Bandage

// Bandage is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

#pragma once

// for ceil(): emcc's libc++ pulls it in transitively and libstdc++ does not,
// so scripts/profile/ failed to compile these sources natively without it
#include <cmath>

struct LayoutSettings {
    double nodeLengthPerMegabase = 1000.0;
    double minimumNodeLength = 1.0;
    double nodeSegmentLength = 1.0;
    double edgeLength = 1.0;

    // 0-4
    int graphLayoutQuality = 1;
    bool useLinearLayout = false;
    double componentSeparation = 15.0;
    double aspectRatio = 1.333333;

    // FMMM's random seed. Fixed by default: the same graph laid out twice has
    // to give the same picture, or every screenshot of a force-directed layout
    // differs from the last one by a couple of percent.
    int randomSeed = 1;

    // FMMM's area-minimising rotation of each component, and the 90-degree tip
    // MAAR packing may add. Off when the caller seeded positions, since a
    // rotation would throw away the orientation the seeds stated.
    bool rotateComponents = true;
};

inline double getDrawnNodeLength(const LayoutSettings& settings, unsigned nodeLength) {
    double drawnNodeLength = settings.nodeLengthPerMegabase * double(nodeLength) / 1000000.0;
    if (drawnNodeLength < settings.minimumNodeLength)
        drawnNodeLength = settings.minimumNodeLength;
    return drawnNodeLength;
}

inline int getNumberOfOgdfGraphEdges(const LayoutSettings& settings, double drawnNodeLength) {
    int numberOfGraphEdges = ceil(drawnNodeLength / settings.nodeSegmentLength);
    if (numberOfGraphEdges <= 0)
        numberOfGraphEdges = 1;
    return numberOfGraphEdges;
}
