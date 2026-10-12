// Emscripten bindings for Bandage Layout

#include <emscripten/bind.h>
#include <emscripten/val.h>
#include "../include/graphlayout.h"
#include "../include/settings.h"
#include <cmath>
#include <memory>

using namespace emscripten;

// Whether a link reads `name` on the other strand from the one its id carries,
// i.e. joins the node at the opposite end. An absent or malformed strand reads
// as the id's own, which is how every link attached before strands were read.
static bool flipped(const val& edge, const char* key, const std::string& name) {
    if (name.empty() || !edge.hasOwnProperty(key) || !edge[key].isString()) {
        return false;
    }
    std::string strand = edge[key].as<std::string>();
    char own = name.back();
    return strand.size() == 1 && (own == '+' || own == '-') &&
           (strand[0] == '+' || strand[0] == '-') && strand[0] != own;
}

std::unique_ptr<AssemblyGraph> createGraphFromJS(const val& jsGraph) {
    auto graph = std::make_unique<AssemblyGraph>();

    val jsNodes = jsGraph["nodes"];
    unsigned length = jsNodes["length"].as<unsigned>();

    for (unsigned i = 0; i < length; ++i) {
        val node = jsNodes[i];
        std::string id = node["id"].as<std::string>();
        unsigned nodeLength = node["length"].as<unsigned>();

        auto* n = graph->addNode(id, nodeLength);

        // Optional seed. A missing property reads as undefined, so isNumber()
        // is the whole presence check; the finite test keeps a NaN from
        // reaching FMMM, which has no way to report one.
        val x = node["x"];
        val y = node["y"];
        if (x.isNumber() && y.isNumber()) {
            double seedX = x.as<double>();
            double seedY = y.as<double>();
            if (std::isfinite(seedX) && std::isfinite(seedY)) {
                n->setSeed(seedX, seedY);
            }
        }
    }

    val jsEdges = jsGraph["edges"];
    length = jsEdges["length"].as<unsigned>();

    for (unsigned i = 0; i < length; ++i) {
        val edge = jsEdges[i];
        std::string from = edge["from"].as<std::string>();
        std::string to = edge["to"].as<std::string>();

        auto* e = graph->addEdge(from, to);
        if (e) {
            e->leavesStart = flipped(edge, "fromStrand", from);
            e->entersEnd = flipped(edge, "toStrand", to);
        }
    }

    return graph;
}

val layoutToJS(const GraphLayout& layout) {
    val result = val::object();
    val nodePositions = val::object();

    for (const auto& [node, segments] : layout) {
        std::string nodeName = node->getName();

        val jsSegments = val::array();
        for (size_t i = 0; i < segments.size(); ++i) {
            val point = val::object();
            point.set("x", segments[i].x);
            point.set("y", segments[i].y);
            jsSegments.set(i, point);
        }

        nodePositions.set(nodeName, jsSegments);
    }

    result.set("nodePositions", nodePositions);
    return result;
}

val computeLayout(val jsGraph, val jsOptions) {
    LayoutSettings settings;
    if (jsOptions.hasOwnProperty("quality")) {
        settings.graphLayoutQuality = jsOptions["quality"].as<int>();
    }
    if (jsOptions.hasOwnProperty("linearLayout")) {
        settings.useLinearLayout = jsOptions["linearLayout"].as<bool>();
    }
    if (jsOptions.hasOwnProperty("componentSeparation")) {
        settings.componentSeparation = jsOptions["componentSeparation"].as<double>();
    }
    if (jsOptions.hasOwnProperty("aspectRatio")) {
        settings.aspectRatio = jsOptions["aspectRatio"].as<double>();
    }
    if (jsOptions.hasOwnProperty("nodeLengthPerMegabase")) {
        settings.nodeLengthPerMegabase = jsOptions["nodeLengthPerMegabase"].as<double>();
    }
    if (jsOptions.hasOwnProperty("minimumNodeLength")) {
        settings.minimumNodeLength = jsOptions["minimumNodeLength"].as<double>();
    }
    if (jsOptions.hasOwnProperty("nodeSegmentLength")) {
        settings.nodeSegmentLength = jsOptions["nodeSegmentLength"].as<double>();
    }
    if (jsOptions.hasOwnProperty("edgeLength")) {
        settings.edgeLength = jsOptions["edgeLength"].as<double>();
    }
    if (jsOptions.hasOwnProperty("seed")) {
        settings.randomSeed = jsOptions["seed"].as<int>();
    }
    if (jsOptions.hasOwnProperty("rotateComponents")) {
        settings.rotateComponents = jsOptions["rotateComponents"].as<bool>();
    }

    // Declared before the layout, whose keys point into it.
    auto graph = createGraphFromJS(jsGraph);
    return layoutToJS(layout::layoutGraph(*graph, settings));
}

EMSCRIPTEN_BINDINGS(bandage_layout) {
    function("computeLayout", &computeLayout);
}
