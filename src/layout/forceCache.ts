import { engineKey, forceLayout } from '../pipeline'

import type { EngineSettings, LayoutEngine } from '../pipeline'
import type { Graph, LayoutResult } from '../types'

// Force layouts by graph and settings, so moving between two settings, or
// leaving a slow layout for a local one and coming back, picks the drawing up
// rather than running the engine again.
//
// Entries are the live position objects rather than copies, which a node drag
// mutates in place, so a layout comes back arranged the way it was left.
//
// Weak on the graph so nothing has to invalidate it: a graph is rebuilt by
// every load and dropped when the view clears, and its layouts go with it.

// Enough to hold the settings a comparison moves between; past that the oldest
// goes, since a big graph's positions are megabytes.
const DEFAULT_SIZE = 4

export interface ForceLayoutCache {
  // The layout for these settings: the run in flight or already done where
  // there is one, else a new run of the engine. A run that throws leaves
  // nothing behind.
  layout(
    graph: Graph,
    settings: EngineSettings,
    engine: LayoutEngine,
  ): Promise<{ result: LayoutResult; duration: number }>
  // The layout for these settings where one has finished, for a caller that
  // can draw this frame rather than await
  ready(graph: Graph, settings: EngineSettings): LayoutResult | undefined
  // Re-anchoring builds a new Graph, and the force layout of it is the same
  // drawing: anchoring rewrites each node's stable name and samples and
  // touches neither the ids, the lengths, the depths nor the edges, which are
  // all the engine reads. So the layouts follow the graph they were computed
  // for rather than being thrown away with it.
  inherit(from: Graph, to: Graph): void
}

interface Entry {
  run: Promise<{ result: LayoutResult; duration: number }>
  done?: LayoutResult
}

export function createForceLayoutCache(size = DEFAULT_SIZE): ForceLayoutCache {
  const caches = new WeakMap<Graph, Map<string, Entry>>()
  const cacheOf = (graph: Graph) => {
    let cache = caches.get(graph)
    if (!cache) {
      cache = new Map()
      caches.set(graph, cache)
    }
    return cache
  }
  return {
    layout(graph, settings, engine) {
      const cache = cacheOf(graph)
      const key = engineKey(graph, settings)
      const hit = cache.get(key)
      if (hit) {
        return hit.run
      }
      if (cache.size >= size) {
        cache.delete(cache.keys().next().value!)
      }
      const started = performance.now()
      // Filed under the key read BEFORE the run: the settings that produce
      // this drawing are not necessarily the ones in hand when it lands, and
      // filing it under those would serve it up as a layout it is not.
      const entry: Entry = {
        run: forceLayout(graph, settings, engine).then(r => {
          entry.done = r.result
          return { ...r, duration: r.duration || performance.now() - started }
        }),
      }
      entry.run.catch(() => cache.delete(key))
      cache.set(key, entry)
      return entry.run
    },
    ready(graph, settings) {
      return caches.get(graph)?.get(engineKey(graph, settings))?.done
    },
    inherit(from, to) {
      const cache = caches.get(from)
      if (cache && from !== to) {
        caches.set(to, cache)
      }
    },
  }
}
