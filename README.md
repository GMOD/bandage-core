# @jbrowse/bandage-core

@jbrowse/bandage-core lays out and draws pangenome graphs. The
[JBrowse graph plugin](https://github.com/GMOD/jbrowse-plugin-graphgenomeviewer),
[BandageJS](https://github.com/GMOD/BandageJS) and
[ggbandage](https://github.com/GMOD/ggbandage) all draw with it.

- **In:** GFA or rGFA text, or a region of a
  [gfa-to-tabix](https://github.com/GMOD/gfa-to-tabix) walk file, read with
  [@jbrowse/graph-walks](https://github.com/GMOD/graph-walks)
- **Out:** Bandage's force-directed layout or a layout along the reference

Can be used to roll-your-own data visualizations

## Install

```bash
npm install @jbrowse/bandage-core
```

Reading walk files also needs `@jbrowse/graph-walks`.

## Usage

The example below reads LPA's KIV-2 repeat from the HPRC release 2.1 walk file
on jbrowse.org and draws it with one panel per haplotype:

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
const kiv2 = await reader.cut(
  refName,
  { start: 160_614_798, end: 160_647_758 },
  { keep: walksKept(['HG00097', 'HG00133'], refName) },
)
const graph = loadGraph(
  kiv2.graph.tables(kiv2.kept, kiv2.fragments, kiv2.departures),
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

![GRCh38, HG00097#1 and HG00133#1 at LPA's KIV-2 repeat, a panel each, colored yellow to red along each haplotype. HG00097#1 is 22.2 kb longer than GRCh38, and HG00133#1 is 116 kb longer, 106 kb of it in a hollow grey loop whose nodes were not loaded](img/readme_kiv2.svg)

## Docs

- [API](docs/api.md): the main exports, by task: loading, layouts, drawing to a
  canvas, figures, haplotypes, and genes and variants
- [Walk rows and departures](docs/departures.md): where a haplotype leaves the
  reference, what the text beside each walk row means, and what a host app does
- [Command-line tools](docs/cli.md): `bandage-figure` draws a figure from a JSON
  spec, and `bandage-fold` merges small variants into the reference for viewing
  zoomed out

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

- [HPRC part 1: graph alleles and haplotypes](https://jbrowse.org/jb2/docs/tutorials/pangenome_hprc/)
- [HPRC part 3: repeat lengths](https://jbrowse.org/jb2/docs/tutorials/pangenome_hprc_repeats/)

## License

GPL-3.0-or-later, as [Bandage](https://github.com/rrwick/Bandage) and
[OGDF](https://www.ogdf.uni-osnabrueck.de/) are.
