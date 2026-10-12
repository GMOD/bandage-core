// Copyright 2022 Anton Korobeynikov
// Copyright 2024 Bandage Layout JS Port

// This file is part of Bandage

// Bandage is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

#pragma once

#include "types.h"
#include "graph.h"
#include "settings.h"
#include <unordered_map>
#include <vector>

using GraphLayout = std::unordered_map<DeBruijnNode*, std::vector<Point>>;

namespace layout {
    GraphLayout layoutGraph(const AssemblyGraph& graph, const LayoutSettings& settings);
}
