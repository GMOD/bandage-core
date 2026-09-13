// Layout experiment driver against natively built OGDF.
//
// stdin, one record per line:
//   N <id> <drawnLength> [seedX seedY]
//   E <from> <to>
// argv: <mode> [key=value ...]
//   mode: fmmm | sugiyama
//   quality=0..4 seg=20 edge=5 seed=1 rotate=0|1 keep=0|1 force=new|fr|eades
//   rep=nmm|exact  layerdist=30 nodedist=10 ranking=longest|optimal|coffman
// stdout: <id> x,y x,y ...
#include <ogdf/basic/Graph.h>
#include <ogdf/basic/GraphAttributes.h>
#include <ogdf/basic/simple_graph_alg.h>
#include <ogdf/energybased/FMMMLayout.h>
#include <ogdf/energybased/fmmm/FMMMOptions.h>
#include <ogdf/layered/SugiyamaLayout.h>
#include <ogdf/layered/LongestPathRanking.h>
#include <ogdf/layered/OptimalRanking.h>
#include <ogdf/layered/CoffmanGrahamRanking.h>
#include <ogdf/layered/MedianHeuristic.h>
#include <ogdf/layered/BarycenterHeuristic.h>
#include <ogdf/layered/FastHierarchyLayout.h>
#include <ogdf/layered/OptimalHierarchyLayout.h>
#include <ogdf/layered/GreedyCycleRemoval.h>
#include <ogdf/layered/DfsAcyclicSubgraph.h>

#include <chrono>
#include <cmath>
#include <iostream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

using namespace ogdf;

struct InNode { std::string id; double drawn; bool seeded; double sx, sy; };
struct InEdge { std::string from, to; };

int main(int argc, char** argv) {
    std::string mode = argc > 1 ? argv[1] : "fmmm";
    std::map<std::string, std::string> o;
    for (int i = 2; i < argc; i++) {
        std::string a = argv[i];
        auto eq = a.find('=');
        if (eq != std::string::npos) o[a.substr(0, eq)] = a.substr(eq + 1);
    }
    auto opt = [&](const char* k, const std::string& d) { return o.count(k) ? o[k] : d; };
    auto optd = [&](const char* k, double d) { return o.count(k) ? std::stod(o[k]) : d; };

    std::vector<InNode> nodes;
    std::vector<InEdge> edges;
    std::string line;
    while (std::getline(std::cin, line)) {
        std::istringstream ss(line);
        std::string kind;
        ss >> kind;
        if (kind == "N") {
            InNode n; n.seeded = false; n.sx = n.sy = 0;
            ss >> n.id >> n.drawn;
            if (ss >> n.sx >> n.sy) n.seeded = true;
            nodes.push_back(n);
        } else if (kind == "E") {
            InEdge e; ss >> e.from >> e.to; edges.push_back(e);
        }
    }

    Graph G;
    GraphAttributes GA(G, GraphAttributes::nodeGraphics | GraphAttributes::edgeGraphics);
    std::map<std::string, std::vector<node>> chain;
    auto t0 = std::chrono::steady_clock::now();

    if (mode == "fmmm") {
        double seg = optd("seg", 20), edgeLen = optd("edge", 5);
        bool keep = opt("keep", "0") == "1";
        EdgeArray<double> len(G);
        for (auto& n : nodes) {
            int nEdges = std::max(1, (int)std::ceil(n.drawn / seg));
            double per = n.drawn / nEdges;
            node prev = nullptr;
            for (int i = 0; i <= nEdges; i++) {
                node v = G.newNode();
                GA.width(v) = GA.height(v) = edgeLen;
                if (n.seeded) { GA.x(v) = n.sx + i * per; GA.y(v) = n.sy; }
                chain[n.id].push_back(v);
                if (prev) { edge e = G.newEdge(prev, v); len[e] = per; }
                prev = v;
            }
        }
        for (auto& e : edges) {
            auto a = chain.find(e.from), b = chain.find(e.to);
            if (a == chain.end() || b == chain.end()) continue;
            if (e.from == e.to && a->second.size() <= 2) continue;
            edge ge = G.newEdge(a->second.back(), b->second.front());
            len[ge] = edgeLen;
        }
        // one FMMM per connected component, as the engine does, but without
        // the aspect-ratio rotation unless asked
        NodeArray<int> comp(G);
        int nc = connectedComponents(G, comp);
        Array<List<node>> inCC(nc);
        for (node v : G.nodes) inCC[comp[v]].pushBack(v);
        double xoff = 0;
        for (int c = 0; c < nc; c++) {
            GraphCopy GC; EdgeArray<edge> aux(G);
            GC.createEmpty(G); GC.initByNodes(inCC[c], aux);
            GraphAttributes cGA(GC, GA.attributes());
            EdgeArray<double> clen(GC);
            for (node v : GC.nodes) { cGA.x(v) = GA.x(GC.original(v)); cGA.y(v) = GA.y(GC.original(v)); cGA.width(v) = GA.width(GC.original(v)); cGA.height(v) = GA.height(GC.original(v)); }
            for (edge e : GC.edges) clen[e] = len[GC.original(e)];
            FMMMLayout L;
            L.randSeed((int)optd("seed", 1));
            L.useHighLevelOptions(false);
            L.unitEdgeLength(1.0);
            L.allowedPositions(FMMMOptions::AllowedPositions::All);
            L.pageRatio(1.333333);
            L.minDistCC(15);
            L.stepsForRotatingComponents(opt("rotate", "1") == "1" ? 50 : 0);
            L.initialPlacementForces(keep ? FMMMOptions::InitialPlacementForces::KeepPositions
                                          : FMMMOptions::InitialPlacementForces::RandomRandIterNr);
            std::string fm = opt("force", "new");
            L.forceModel(fm == "fr" ? FMMMOptions::ForceModel::FruchtermanReingold
                       : fm == "eades" ? FMMMOptions::ForceModel::Eades
                       : FMMMOptions::ForceModel::New);
            L.repulsiveForcesCalculation(opt("rep", "nmm") == "exact" ? FMMMOptions::RepulsiveForcesMethod::Exact
                                                                       : FMMMOptions::RepulsiveForcesMethod::NMM);
            int q = (int)optd("quality", 2);
            int fixed[] = {3, 15, 30, 60, 120}, fine[] = {1, 10, 20, 40, 60}, prec[] = {2, 2, 4, 6, 8};
            L.fixedIterations(fixed[q]); L.fineTuningIterations(fine[q]); L.nmPrecision(prec[q]);
            if (o.count("iters")) L.fixedIterations((int)optd("iters", 30));
            if (o.count("fine")) L.fineTuningIterations((int)optd("fine", 20));
            L.call(cGA, clen);
            double minx = 1e300;
            for (node v : GC.nodes) minx = std::min(minx, cGA.x(v));
            for (node v : GC.nodes) { GA.x(GC.original(v)) = cGA.x(v) - minx + xoff; GA.y(GC.original(v)) = cGA.y(v); }
            double maxx = -1e300;
            for (node v : GC.nodes) maxx = std::max(maxx, GA.x(GC.original(v)));
            xoff = maxx + 50;
        }
#ifdef WITH_SUGIYAMA
    } else if (mode == "sugiyama") {
        double thick = optd("thick", 6);
        for (auto& n : nodes) {
            node v = G.newNode();
            // transposed later: height along the layer axis becomes x extent
            GA.height(v) = n.drawn;
            GA.width(v) = thick;
            chain[n.id].push_back(v);
        }
        for (auto& e : edges) {
            auto a = chain.find(e.from), b = chain.find(e.to);
            if (a == chain.end() || b == chain.end() || e.from == e.to) continue;
            G.newEdge(a->second.front(), b->second.front());
        }
        SugiyamaLayout SL;
        std::string rk = opt("ranking", "longest");
        if (rk == "optimal") {
            auto* r = new OptimalRanking; r->setSubgraph(new GreedyCycleRemoval); SL.setRanking(r);
        } else if (rk == "coffman") {
            auto* r = new CoffmanGrahamRanking; r->setSubgraph(new GreedyCycleRemoval); r->width((int)optd("width", 3)); SL.setRanking(r);
        } else {
            auto* r = new LongestPathRanking; r->setSubgraph(new GreedyCycleRemoval); r->separateMultiEdges(false); SL.setRanking(r);
        }
        if (opt("crossmin", "median") == "bary") SL.setCrossMin(new BarycenterHeuristic); else SL.setCrossMin(new MedianHeuristic);
        SL.runs((int)optd("runs", 15));
        if (opt("coord", "fast") == "optimal") {
            auto* h = new OptimalHierarchyLayout; h->layerDistance(optd("layerdist", 30)); h->nodeDistance(optd("nodedist", 10)); h->weightBalancing(optd("balance", 0.1)); SL.setLayout(h);
        } else {
            auto* h = new FastHierarchyLayout; h->layerDistance(optd("layerdist", 30)); h->nodeDistance(optd("nodedist", 10)); h->fixedLayerDistance(false); SL.setLayout(h);
        }
        SL.call(GA);
        // transpose: layers ran top-down, we want left-right
        for (node v : G.nodes) { double x = GA.x(v), y = GA.y(v); GA.x(v) = y; GA.y(v) = x; }
        for (auto& n : nodes) {
            node v = chain[n.id].front();
            double cx = GA.x(v), cy = GA.y(v);
            chain[n.id].clear();
            node a = G.newNode(); GA.x(a) = cx - n.drawn / 2; GA.y(a) = cy;
            node b = G.newNode(); GA.x(b) = cx + n.drawn / 2; GA.y(b) = cy;
            chain[n.id] = {a, b};
        }
#endif
    } else {
        std::cerr << "unknown mode " << mode << "\n";
        return 1;
    }
    auto ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
    std::cerr << "layout " << ms << " ms, " << G.numberOfNodes() << " ogdf nodes\n";
    for (auto& n : nodes) {
        std::cout << n.id;
        for (node v : chain[n.id]) std::cout << ' ' << GA.x(v) << ',' << GA.y(v);
        std::cout << '\n';
    }
    return 0;
}
