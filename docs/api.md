# API

The main exports of `@jbrowse/bandage-core`, grouped by task.
[`src/index.ts`](../src/index.ts) lists the rest.

## Loading a graph

| Export                             | What it does                                                                                                                                                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loadGraph(source, name, options)` | reads GFA or rGFA text, or a region read from a walk file with @jbrowse/graph-walks, into a `Graph`. `referencePath` names the reference path of a plain GFA, and `maxNodes` makes it throw an error for a larger graph |
| `graphTablesGFA(tables)`           | writes a region read from a walk file as GFA                                                                                                                                                                            |
| `departureTable()`                 | an empty list of departures, for a source that has none                                                                                                                                                                 |

Decompress a `.gfa.gz` before passing its text to `loadGraph`.

## Layouts

| Export                                       | What it does                                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `forceLayout(graph, settings, layoutEngine)` | Bandage's force-directed layout, or with `engine: 'stress'` a stress layout that keeps the reference in a straight line   |
| `ENGINE_DEFAULTS`                            | the default `settings`: engine, quality, spacing, bubble spread and deletion edges                                        |
| `layoutModeByValue(mode).run(graph, region)` | a layout along the reference, or `undefined` when that layout cannot draw the graph                                       |
| `LAYOUT_MODES`                               | every layout, with its label: `auto` (anchored), `ordered`, `samplerows`, `walkrows`, `tubemap`, `tubemapref` and `force` |
| `loadBandage()`                              | loads the WebAssembly module of Bandage's layout ahead of time; otherwise the first force layout loads it                 |

## Drawing to a canvas

| Export                                  | What it does                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------- |
| `buildGeometry(options)`                | turns a layout into the shapes to draw                                                |
| `layoutGeometryInputs(layout, drawing)` | the options to `buildGeometry` that come from the layout                              |
| `Canvas2DRenderer`                      | draws those shapes to a canvas, with `uploadGeometry`, `updateTransform` and `render` |
| `drawingBounds(layout)`, `fitTransform` | the size of the drawing, and the zoom and offset that fit it to a canvas              |
| `findHoveredNode`, `findHoveredEdge`    | the node or link under the mouse pointer                                              |
| `tubeMapPicture`, `drawTubeMap`         | draw a tube map, which does not go through `buildGeometry`                            |

BandageJS's
[`src/view.ts`](https://github.com/GMOD/BandageJS/blob/main/src/view.ts)
connects these to panning, zooming and hover.

## Figures

| Export                               | What it does                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `figureSvg(graph, layout, options)`  | an SVG file of the drawing, with highlighted haplotypes, a panel per haplotype, genes and a key |
| `figureData(graph, layout, options)` | the same drawing as tables of coordinates, which ggbandage draws in ggplot2                     |
| `gfaFigureData(text, name, spec)`    | `figureData` from GFA text and a `bandage-figure` spec                                          |

## Haplotypes

| Export                            | What it does                                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `walkLift(graph, layers)`         | highlights haplotypes: draws each along the nodes it passes through, colored from its start to its end, and fades the rest of the graph |
| `facetLifts(graph, lift, layers)` | splits a highlight into one per haplotype, for a panel each                                                                             |
| `walkKey(walk)`                   | the text of a highlighted haplotype's key: its coordinates, its length compared with the reference, and the sequence not drawn          |
| `walkRows(graph, region)`         | one bar per haplotype, showing its length across the region; see [Walk rows and departures](departures.md)                              |

## Genes and variants

| Export                                            | What it does                                                                                   |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `genesFromGff3Lines(lines)`, `genesFromBed(text)` | genes from a GFF3 or BED file                                                                  |
| `graphBackbone(graph)`                            | the graph's reference, and the contigs it covers                                               |
| `featuresOnBackbone(genes, backbone)`             | renames genes' contigs to the names the graph's reference uses                                 |
| `genePins(graph, genes, positions)`               | where each gene lies on the laid-out nodes                                                     |
| `graphBubbles(graph)`                             | the graph's bubbles (variant sites), found along the reference, or as superbubbles without one |
| `deletionEdges(graph)`                            | the links that skip reference sequence, which are deletions                                    |
