// Copyright 2017 Ryan Wick
// Copyright 2024 Bandage Layout JS Port

// This file is part of Bandage

// Bandage is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

#pragma once

#include <algorithm>
#include <string>
#include <unordered_map>
#include <vector>

class DeBruijnNode;

class DeBruijnEdge {
public:
    DeBruijnNode* startingNode;
    DeBruijnNode* endingNode;
    // Which side of each node the link joins, from its strands against the
    // node's own. A graph holds one node per segment, so `L 1 + 2 -` joins the
    // END of 2+ and has no 2- to attach to; without these it joined 2's start.
    bool leavesStart;
    bool entersEnd;

    DeBruijnEdge(DeBruijnNode* start, DeBruijnNode* end)
        : startingNode(start), endingNode(end), leavesStart(false),
          entersEnd(false) {}

    DeBruijnNode* getStartingNode() const { return startingNode; }
    DeBruijnNode* getEndingNode() const { return endingNode; }
};

class DeBruijnNode {
public:
    std::string name;
    unsigned length;
    std::vector<DeBruijnEdge*> edges;
    // Where FMMM starts this node's chain, when the caller has an opinion:
    // reference-anchored graphs seed the backbone along x so the layout keeps
    // its coarse shape instead of curling (ADR-042).
    bool seeded;
    double seedX;
    double seedY;

    DeBruijnNode(const std::string& name_, unsigned length_)
        : name(name_), length(length_), seeded(false), seedX(0.0), seedY(0.0) {}

    std::string getName() const { return name; }
    std::string getNameWithoutSign() const {
        if (name.length() > 0)
            return name.substr(0, name.length() - 1);
        return name;
    }

    unsigned getLength() const { return length; }
    bool hasSeed() const { return seeded; }
    void setSeed(double x, double y) {
        seeded = true;
        seedX = x;
        seedY = y;
    }

    std::vector<DeBruijnNode*> getUpstreamNodes() const {
        std::vector<DeBruijnNode*> result;
        for (auto* edge : edges) {
            if (edge->getEndingNode() == this) {
                result.push_back(edge->getStartingNode());
            }
        }
        return result;
    }
};

class AssemblyGraph {
public:
    std::vector<DeBruijnNode*> nodes;
    std::unordered_map<std::string, DeBruijnNode*> nodesByName;
    std::vector<DeBruijnEdge*> edges;

    AssemblyGraph() = default;

    // Owns every node and edge by raw pointer, so a copy would delete each of
    // them twice.
    AssemblyGraph(const AssemblyGraph&) = delete;
    AssemblyGraph& operator=(const AssemblyGraph&) = delete;

    ~AssemblyGraph() {
        for (auto* node : nodes) {
            delete node;
        }
        for (auto* edge : edges) {
            delete edge;
        }
    }

    // A repeated name replaces the earlier node in its place.
    DeBruijnNode* addNode(const std::string& name, unsigned length) {
        auto* node = new DeBruijnNode(name, length);
        auto [it, inserted] = nodesByName.try_emplace(name, node);
        if (inserted) {
            nodes.push_back(node);
        } else {
            *std::find(nodes.begin(), nodes.end(), it->second) = node;
            delete it->second;
            it->second = node;
        }
        return node;
    }

    DeBruijnEdge* addEdge(const std::string& fromName, const std::string& toName) {
        auto fromIt = nodesByName.find(fromName);
        auto toIt = nodesByName.find(toName);

        if (fromIt == nodesByName.end() || toIt == nodesByName.end()) {
            return nullptr;
        }

        auto* edge = new DeBruijnEdge(fromIt->second, toIt->second);
        edges.push_back(edge);

        fromIt->second->edges.push_back(edge);
        toIt->second->edges.push_back(edge);

        return edge;
    }
};
