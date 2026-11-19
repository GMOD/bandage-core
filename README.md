# @jbrowse/bandage-core

@jbrowse/bandage-core lays out and draws pangenome graphs. The
[JBrowse graph plugin](https://github.com/GMOD/jbrowse-plugin-graphgenomeviewer),
[BandageJS](https://github.com/GMOD/BandageJS) and
[ggbandage](https://github.com/GMOD/ggbandage) all draw with it.

- **In:** GFA or rGFA text, or a region of a
  [gfa-to-tabix](https://github.com/GMOD/gfa-to-tabix) walk file cut by
  [@jbrowse/graph-walks](https://github.com/GMOD/graph-walks)
- **Out:** Bandage's force-directed layout or a layout along the reference

Can be used to roll-your-own data visualizations

## Install

```bash
npm install @jbrowse/bandage-core
```

Reading walk files also needs `@jbrowse/graph-walks`.

## Usage

The example below draws LPA's KIV-2 repeat from the HPRC release 2.1 walk file
on jbrowse.org, one panel per walk:

```ts
import {
  ENGINE_DEFAULTS,
  figureSvg,
  forceLayout,
  layoutEngine,
  loadGraph,
} from '@jbrowse/bandage-core'
import { WalkReader, walksKept } from '@jbrowse/graph-walks'

const reader = WalkReader.open(
  'https://jbrowse.org/demos/hprc/hprc-v2.1-mc-grch38-f8.GRCh38.walks.gz',
)
const refName = 'GRCh38#0#chr6'
const cut = await reader.cut(
  refName,
  { start: 160_614_798, end: 160_647_758 },
  { keep: walksKept(['HG00097', 'HG00133'], refName) },
)
const graph = loadGraph(
  cut.graph.tables(cut.kept, cut.fragments, cut.departures),
  'KIV-2',
)
const { result } = await forceLayout(graph, ENGINE_DEFAULTS, layoutEngine)
const svg = figureSvg(graph, result, {
  walks: [
    { walk: refName },
    { walk: 'HG00097#1#JBIRDD010000043.1' },
    { walk: 'HG00133#1#CM090050.1' },
  ],
  facet: { field: 'walk', columns: 3 },
})
```

![GRCh38, HG00097#1 and HG00133#1 at LPA's KIV-2 repeat, a panel each, shaded yellow to red along each walk. HG00097#1 is 22.2 kb longer than GRCh38, and HG00133#1 is 116 kb longer, 106 kb of it in a hollow grey loop whose nodes the cut did not load](img/readme_kiv2.svg)

## API

- **Reading:** `loadGraph` also reads GFA or rGFA text, which the caller
  decompresses first, and `graphTablesGFA` writes a walk-file cut as GFA
- **Layouts:** `forceLayout` runs Bandage's FMMM engine, compiled to wasm in
  [@jbrowse/graph-fmmm-layout](https://github.com/GMOD/graph-fmmm-layout), or,
  with `engine: 'stress'`,
  [@jbrowse/graph-stress-layout](https://github.com/GMOD/graph-stress-layout),
  which draws the reference straight. `layoutModeByValue(mode).run` runs the
  layouts along the reference: anchored, ordered, sample rows, walk rows and
  tube map
- **Canvas:** `buildGeometry` and `Canvas2DRenderer` draw a layout, and
  `findHoveredNode` and `findHoveredEdge` hit-test it. BandageJS's
  [`src/view.ts`](https://github.com/GMOD/BandageJS/blob/main/src/view.ts) wires
  them to panning and hover
- **Walks:** `walkLift` lifts a walk out of the drawing, `facetLifts` draws a
  panel per walk, and `walkKey` describes each walk in words
- **Genes:** `featuresOnBackbone` renames an assembly's genes onto the
  backbone's refNames, and `genePins` pins those
- **Figures:** `figureSvg` draws a standalone SVG, and `figureData` returns the
  same drawing as columnar tables, which ggbandage draws in ggplot2

## Command-line tools

```bash
npx -p @jbrowse/bandage-core bandage-figure spec.json -o figure.svg
npx -p @jbrowse/bandage-core bandage-fold graph.rgfa.gz --below 10000 -o fold.gfa
```

- `bandage-figure` draws a figure from a JSON spec, with no browser
- `bandage-fold` folds every variant under `--below` bp into the reference, for
  the coarse tier a graph track draws when zoomed out

## Docs

- [Figures from a spec](docs/figures.md): `bandage-figure` and its JSON spec
- [Walk rows and departures](docs/departures.md): what a walk row's readout
  means, and what a host passes through and loads
- [Folding a graph](docs/fold.md): `bandage-fold`, the coarse tier, and
  `gfa-to-tabix fold` for a whole human pangenome

## See also

- [jbrowse-plugin-graphgenomeviewer](https://github.com/GMOD/jbrowse-plugin-graphgenomeviewer):
  browses these graphs by locus in JBrowse 2
- [BandageJS](https://github.com/GMOD/BandageJS): browses GFA files and walk
  files in a web browser
- [ggbandage](https://github.com/GMOD/ggbandage) (R): Bandage-style figures as
  ggplot2 layers

Similar project for tubemaps

- [@jbrowse/tubemap-core](https://github.com/GMOD/tubemap-core):
  sequenceTubeMap's layout, without the DOM

JBrowse tutorials;

- The HPRC tutorials on jbrowse.org:
  [graph alleles and haplotypes](https://jbrowse.org/jb2/docs/tutorials/pangenome_hprc/)
  and
  [repeat lengths](https://jbrowse.org/jb2/docs/tutorials/pangenome_hprc_repeats/)

## License

GPL-3.0-or-later, as [Bandage](https://github.com/rrwick/Bandage) and
[OGDF](https://www.ogdf.uni-osnabrueck.de/) are.
