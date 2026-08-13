// A native driver for the layout path, so `perf` can attribute it.
//
// The engine has no profiler of its own and wasm has no symbols perf can walk,
// so the only way to see inside FMMM is to compile the same sources natively
// and run the same call. Native and wasm are within ~20% of each other on the
// same case, so ATTRIBUTION transfers and MAGNITUDES do not — the one known
// divergence is `__divdc3`, whose logb/scalbn are inline instructions natively
// and out-of-line calls in wasm (GRAPH_SCALE_AND_LOD.md).
//
// This reads a real GFA. The profile recorded in that doc was taken on
// bench-layout.mjs's synthetic bubble chain, which is uniform degree 2 with two
// node lengths; a pangenome graph has degree-5+ junctions and a bp range of
// four orders of magnitude, and the near-field/far-field split moves with both.
//
// Build and run: scripts/profile/build.sh, which says what it does.
//
//   ./gfa-layout-profile <file.gfa> <segment-cap|all> <quality> [minNodeLength]

#include "../../src/bandage/native/include/graph.h"
#include "../../src/bandage/native/include/graphlayout.h"
#include "../../src/bandage/native/include/settings.h"

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <string>
#include <unordered_set>
#include <vector>

namespace {

// mirrors src/GraphGenomeView/layout/drawnScale.ts bandageAutoScale
constexpr double MEAN_NODE_LENGTH = 40;
constexpr double MIN_TOTAL_GRAPH_LENGTH = 500;
constexpr double BANDAGE_MINIMUM_NODE_LENGTH = 5;

std::vector<std::string> splitTabs(const std::string& line, size_t want) {
    std::vector<std::string> out;
    size_t start = 0;
    while (out.size() < want) {
        size_t tab = line.find('\t', start);
        if (tab == std::string::npos) {
            out.push_back(line.substr(start));
            break;
        }
        out.push_back(line.substr(start, tab - start));
        start = tab + 1;
    }
    return out;
}

} // namespace

int main(int argc, char** argv) {
    if (argc < 4) {
        std::fprintf(stderr,
                     "usage: %s <file.gfa> <segment-cap|all> <quality> [minNodeLength]\n",
                     argv[0]);
        return 1;
    }
    const std::string path = argv[1];
    const size_t cap = std::string(argv[2]) == "all"
                           ? SIZE_MAX
                           : std::strtoull(argv[2], nullptr, 10);
    const int quality = std::atoi(argv[3]);
    const double minNodeLength = argc > 4 ? std::atof(argv[4]) : 0;

    std::ifstream in(path);
    if (!in) {
        std::fprintf(stderr, "cannot open %s\n", path.c_str());
        return 1;
    }

    AssemblyGraph graph;
    std::unordered_set<std::string> kept;
    // GFA does not order its records and real files disagree, so a link cannot
    // be resolved as it is read — see the same note in bench-gfa-layout.mjs.
    std::vector<std::pair<std::string, std::string>> pairs;
    double totalLength = 0;
    size_t segs = 0;

    std::string line;
    while (std::getline(in, line)) {
        if (line.size() < 2 || line[1] != '\t') continue;
        if (line[0] == 'S') {
            if (segs >= cap) continue;
            auto f = splitTabs(line, 4);
            if (f.size() < 3) continue;
            unsigned length = 0;
            if (f[2] != "*") {
                // f[2] was cut at the 4th tab, so take the sequence's own span
                size_t seqStart = line.find('\t', line.find('\t') + 1) + 1;
                size_t seqEnd = line.find('\t', seqStart);
                length = static_cast<unsigned>(
                    (seqEnd == std::string::npos ? line.size() : seqEnd) - seqStart);
            }
            if (length == 0) {
                size_t tag = line.find("LN:i:");
                if (tag != std::string::npos) {
                    length = static_cast<unsigned>(std::atoi(line.c_str() + tag + 5));
                }
            }
            if (length == 0) length = 1;
            kept.insert(f[1]);
            auto* n = graph.addNode(f[1] + "+", length, 1.0f);
            n->setAsDrawn();
            totalLength += length;
            segs++;
        } else if (line[0] == 'L') {
            auto f = splitTabs(line, 5);
            if (f.size() < 4) continue;
            pairs.emplace_back(f[1], f[3]);
        }
    }

    size_t links = 0;
    for (const auto& p : pairs) {
        if (kept.count(p.first) && kept.count(p.second)) {
            auto* e = graph.addEdge(p.first + "+", p.second + "+", 0, UNKNOWN_OVERLAP);
            if (e) {
                e->setAsDrawn();
                links++;
            }
        }
    }

    const double megabases = totalLength / 1e6;
    const double target =
        std::max(double(segs) * MEAN_NODE_LENGTH, MIN_TOTAL_GRAPH_LENGTH);

    LayoutSettings settings;
    settings.nodeLengthMode = AUTO_NODE_LENGTH;
    settings.autoNodeLengthPerMegabase = megabases > 0 ? target / megabases : 10000.0;
    settings.manualNodeLengthPerMegabase = settings.autoNodeLengthPerMegabase;
    settings.minimumNodeLength = std::max(BANDAGE_MINIMUM_NODE_LENGTH, minNodeLength);
    settings.nodeSegmentLength = 20.0;
    settings.edgeLength = 5.0;
    settings.graphLayoutQuality = quality;
    settings.useLinearLayout = false;

    std::fprintf(stderr, "%zu segs, %zu links, q=%d, %.0f units/Mb\n", segs, links,
                 quality, settings.autoNodeLengthPerMegabase);

    const auto t0 = std::chrono::steady_clock::now();
    auto result = layout::layoutGraph(graph, quality, false, 15.0, 1.333333, &settings);
    const auto t1 = std::chrono::steady_clock::now();

    std::fprintf(
        stderr, "laid out %zu nodes in %.0f ms\n", result.size(),
        std::chrono::duration<double, std::milli>(t1 - t0).count());
    return 0;
}
