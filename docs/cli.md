# Command-line tools

```bash
npx -p @jbrowse/bandage-core bandage-figure spec.json -o figure.svg
npx -p @jbrowse/bandage-core bandage-fold graph.rgfa.gz --below 10000 -o fold.gfa
```

- `bandage-figure` draws a graph to an SVG file from a JSON spec, without a
  browser
- `bandage-fold` merges small variants into the reference, for a graph track to
  show when zoomed out

## bandage-figure

`bandage-figure` uses the same layout and drawing code as the JBrowse graph
plugin and BandageJS, so a figure matches what those viewers show. Running the
same spec twice writes the same file.

The spec names a GFA file, plain or gzipped, under `gfa`. To draw a region of a
walk file, read the region with
[@jbrowse/graph-walks](https://github.com/GMOD/graph-walks), write it as GFA
with `graphTablesGFA`, and name that file under `gfa`.
[figures/kiv2_walks.gfa.gz](../figures/kiv2_walks.gfa.gz) was made this way. It
contains LPA's KIV-2 repeat, chr6:160,614,798-160,647,758, from the HPRC release
2.1 walk file, with GRCh38 and three haplotypes.

Instead of `gfa`, a spec can name a region of a
[gbz-base](https://github.com/GMOD/gbz-base-js) database under `gbz`, as
`{ "db", "region" }`, which `bandage-figure` reads by range and cuts itself.

```console
npx -p @jbrowse/bandage-core bandage-figure figures/kiv2_walks.json -o kiv2.svg
```

[figures/kiv2_walks.json](../figures/kiv2_walks.json) draws the force-directed
layout with one panel per haplotype:

```json
{
  "gfa": "kiv2_walks.gfa.gz",
  "layout": "force",
  "walks": [
    "GRCh38#0#chr6",
    "HG00097#1#JBIRDD010000043.1",
    "HG01960#1#JBHIHM010000036.1",
    "HG00133#1#CM090050.1"
  ],
  "facet": { "field": "walk", "columns": 2 },
  "width": 1000
}
```

![LPA's KIV-2 repeat, one panel per haplotype on the same layout: GRCh38 passes through the small loops, HG00097 adds one (+22.2 kb), HG01960 skips most of them for the large loop (+49.9 kb), and HG00133 passes through both (+116 kb)](../img/figure_kiv2_walks.svg)

Each panel colors one haplotype's path yellow at its start and red at its end,
on the same layout, so the panels show which loops each haplotype passes
through. GRCh38 passes through the small loops. HG00097 adds one (+22.2 kb),
HG01960 skips most of GRCh38's loops for the large one (+49.9 kb), and HG00133
passes through both (+116 kb).

### The spec

| Field                               | What it sets                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gfa`                               | a GFA file, plain or gzipped, or a URL; a relative path is read from the spec's folder                                                                                                                                                                                                                                                                                                                                    |
| `gbz`                               | a region of a gbz-base database, in place of `gfa`. `db` is a `.gbz.db` file or URL, or `"hprc"` for the HPRC release 2 Minigraph-Cactus graph, and `region` is the region to cut, 0-based and half-open like `region` below, which a `gbz` spec does not read                                                                                                                                                            |
| `gbz.index`                         | the database's haplotype index, which names its walks by sample. Without one, the `.haplotype-index.db` file beside a `.gbz.db` is used if it is there                                                                                                                                                                                                                                                                    |
| `gbz.referenceSample`               | the sample whose path `gbz.region` lies on, such as `GRCh38`; `hg38` and `hs1` name GRCh38 and CHM13. By default the database's first reference sample                                                                                                                                                                                                                                                                    |
| `gbz.haplotypes`                    | the haplotypes to cut, by sample (`HG002`) or haplotype (`HG002#1`); every haplotype by default                                                                                                                                                                                                                                                                                                                           |
| `gbz.context`, `gbz.snarls`         | `context` is the bp of graph to keep past the region's ends, 1000 by default. `snarls` says which snarls the cut keeps whole: `contained` (the default), `overlapping` (the default with `walkStrip`) or `none`                                                                                                                                                                                                           |
| `genes`                             | a GFF3 or BED file or URL under `file`, with its `.tbi` or `.csi` file under `index` if it has one; the figure outlines and names the genes on the reference                                                                                                                                                                                                                                                              |
| `genes.refNames`                    | the file's names for contigs it names differently from the graph, such as `{ "chr6": "NC_000006.12" }`; `6` for `chr6` needs no entry                                                                                                                                                                                                                                                                                     |
| `genes.format`                      | `gff3` or `bed`, for a file whose format its name or contents do not show                                                                                                                                                                                                                                                                                                                                                 |
| `region`                            | the reference region the GFA covers, for the layouts along the reference. It is 0-based and half-open, as in BED, so a browser's `chr6:160,614,798-160,647,758` is `chr6:160,614,797-160,647,758`                                                                                                                                                                                                                         |
| `referenceName`                     | the reference's name in the key, such as `hg38 chr6`; by default its sample and contig, such as `GRCh38 chr6`                                                                                                                                                                                                                                                                                                             |
| `referencePath`                     | the path to draw the graph along                                                                                                                                                                                                                                                                                                                                                                                          |
| `layout`                            | `force` (the default), `auto`, `ordered` or `samplerows`                                                                                                                                                                                                                                                                                                                                                                  |
| `engine`, `quality`, `bubbleSpread` | force-directed layout settings; `engine` is `fmmm` (Bandage's, the default) or `stress`                                                                                                                                                                                                                                                                                                                                   |
| `spacing`                           | the length of links, as a multiple of the default                                                                                                                                                                                                                                                                                                                                                                         |
| `componentSeparation`               | the gap between disconnected parts of the graph, as a multiple of the default                                                                                                                                                                                                                                                                                                                                             |
| `walks`                             | the haplotypes to highlight, by name, or as `{ "walk", "color": { "field", "scheme" } }`. `"field": "pass"` draws a separate thread and color for each trip round a repeat, named by `passNames`; for a graph that keeps each copy of a repeat apart, list the trips in `passes` ([Threading by pass](drawing.md#threading-by-pass)). `"color": { "value": "#2a9fd0" }` draws a haplotype, or the reference, in one color |
| `facet`                             | `walk` for a panel per haplotype, or `sample` for a row per sample and a column per haplotype. In `{ "field", "sort", "columns" }`, `sort` lists the panels to put first and `columns` sets how many go across                                                                                                                                                                                                            |
| `width`, `height`                   | the figure's width, and its maximum height                                                                                                                                                                                                                                                                                                                                                                                |
| `colorScheme`, `nodeWidth`          | as in the viewer's Color menu and node width setting; `nodeWidth: "frequency"` draws each node as wide as the share of haplotypes through it                                                                                                                                                                                                                                                                              |
| `colorDomain`                       | the interval the reference-position colors run over, as `{ "start", "end" }`, where it is not `region`                                                                                                                                                                                                                                                                                                                    |
| `edgeWidth`                         | `uniform` (the default) draws every link the same thickness; `walks` draws a link thicker the more walks take it                                                                                                                                                                                                                                                                                                          |
| `frequencies`                       | the share of haplotypes through each segment, by segment name, such as `{ "146684935": 0.5 }`; these override a segment's `AF` tag and the walks' counts                                                                                                                                                                                                                                                                  |
| `contigThickness`                   | a node's width in pixels, 6 by default                                                                                                                                                                                                                                                                                                                                                                                    |
| `connectorThickness`                | a link's width in pixels, 2 by default                                                                                                                                                                                                                                                                                                                                                                                    |
| `countLaneScale`                    | how wide a thread of a folded graph draws against its count's own width (3 px plus 2 px per e-fold of haplotypes), 1 by default; 0.4 draws 464 haplotypes about 6 px wide                                                                                                                                                                                                                                                 |
| `countLaneWidth`                    | `"share"` draws a thread of a folded graph as wide as its share of the haplotypes, 12 px for all of them, so two threads compare by width; `"log"` (the default) by the log of its count                                                                                                                                                                                                                                  |
| `liftFade`                          | the opacity of everything off the lifted walks, 0.3 by default; a figure with thin nodes can raise it so a branch no lifted walk takes still shows                                                                                                                                                                                                                                                                        |
| `nodeLengths`                       | every node's length written on it, `true` by default; `false` writes only a "nodes not shown" placeholder's length, as turning off the viewer's node lengths does                                                                                                                                                                                                                                                         |
| `nodeShares`                        | `true` writes the share of the drawn haplotypes that walk a node or loop some of them leave out: after its length, such as `81.8 kb · 8%`, or alone on a node whose length is not written, as on the reference stretch a deletion skips; none is written where a walk has steps not loaded                                                                                                                                |
| `compactKey`                        | `true` lays the key in two lines where it can: the lifted threads by their counts and the other haplotypes, then the shares, the skips and what the fold does not draw. A thickness is keyed, in one entry, only where the unlit nodes or links vary in width                                                                                                                                                             |
| `smallSites`                        | `"nodes"` draws every node, however small. By default (`"hidden"`), a site too small to see at the figure's scale is left out and counted in the key. Either way a skip too short on screen to arch is drawn as its plain link and counted ([Small sites](drawing.md#small-sites))                                                                                                                                        |
| `showDeletionEdges`                 | `false` leaves out the links that skip reference sequence, except where such a link is the only connection between its ends                                                                                                                                                                                                                                                                                               |
| `fitToDrawing`                      | `true` fits the figure to what is drawn, where a layout along the reference otherwise fits it to `region`                                                                                                                                                                                                                                                                                                                 |
| `linearLayout`                      | `true` passes the force-directed engine its linear-layout option, and draws strand arrows only where a layout unit is over 1 pixel, where they are otherwise drawn from 0.45 pixels                                                                                                                                                                                                                                       |
| `walkStrip`                         | adds walk rows under the graph, one bar per haplotype                                                                                                                                                                                                                                                                                                                                                                     |
| `walkRowSamples`                    | the samples to show in the walk rows, in order                                                                                                                                                                                                                                                                                                                                                                            |
| `rowAnnotation`                     | what the key calls the boxes on the walk rows, in the singular; `gene` by default                                                                                                                                                                                                                                                                                                                                         |

- `bandage-figure` warns about a name under `walks` that no walk in the graph
  has, and draws the figure without it
- In walk rows, the figure outlines the spec's genes on the reference row only,
  since the gene positions are on the reference, and the key marks the other
  rows "no gene track"
- `bandage-figure` saves the spec and its own version, such as
  `@jbrowse/bandage-core@4.0.25`, in each SVG's `<metadata>`. To draw the figure
  again, run that version on the spec:
  `npx -p @jbrowse/bandage-core@4.0.25 bandage-figure spec.json`
- The JBrowse graph plugin and BandageJS save the same drawing with **Export
  SVG**. `bandage-figure` cannot draw a layout without nodes, such as walk rows
  alone or a tube map
- To redraw every spec in [figures/](../figures) to `img/figure_<name>.svg`, run
  `pnpm build`, then `node scripts/render-figures.mjs`

## bandage-fold

`bandage-fold` simplifies a graph for viewing zoomed out. It merges every
variant shorter than `--below` bp into the reference and writes the result as
rGFA. Indexed with gfa-to-tabix, the simplified graph is what a graph track
shows when zoomed out too far for the full graph, so a whole chromosome fits on
screen.
[`gfa-to-tabix fold`](https://github.com/GMOD/gfa-to-tabix/blob/main/docs/subcommands.md#fold)
explains the simplification and when a graph track switches to it.

```console
npx -p @jbrowse/bandage-core bandage-fold graph.rgfa.gz --below 10000 \
  | gfa-to-tabix - -o graph.fold10000
```

- **Input and output:** a GFA or rGFA, plain or gzipped, or `-` for standard
  input. The output goes to standard output, or to a file with `-o out.gfa`
- **The reference:** in an rGFA, the segments tagged `SR:i:0`. For a plain GFA,
  name the reference path with `--reference PATH`
- **What bandage-fold keeps:** the reference, every variant at least `--below`
  bp long in its own sequence or in the reference sequence it replaces, and the
  shortest route from each kept variant's ends back to the reference. It merges
  each stretch of reference between kept variants into one segment
- **Paths:** the output has no paths or walks. A segment that a plain GFA's
  reference path reads in reverse is written forward, with its links flipped to
  match, so the output describes the same graph
- **Indexing:** give gfa-to-tabix the same `--layout anchored|contig` as the
  full graph's index. With `anchored`, a region inside a large bubble returns
  the whole bubble from both indexes; with `contig`, only what links reach from
  the region
- **When to switch:** the graph track already simplifies each region it draws,
  merging variants shorter than 10 pixels (`FOLD_PX` in
  jbrowse-plugin-graphgenomeviewer), and simplifying an already simplified graph
  at a larger size gives nearly the same result as simplifying the original. A
  graph simplified at N bp and shown from N / 10 bp per pixel, such as
  `coarse: { uri: "graph.fold10000", aboveBpPerPx: 1000 }`, therefore looks
  nearly the same as the full graph at that zoom
- **Size limit:** Node.js caps a string at 512 MB, and `bandage-fold` reads the
  whole graph into one string, so it cannot simplify a whole human pangenome.
  `gfa-to-tabix fold` runs the same simplification and writes the index in one
  pass: `gfa-to-tabix fold graph.rgfa.gz --below 10000 -o graph.fold10000`
