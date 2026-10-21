# @jbrowse/bandage-core

TypeScript library that lays out and draws pangenome graphs, used by
[jbrowse-plugin-graphgenomeviewer](https://github.com/GMOD/jbrowse-plugin-graphgenomeviewer)
and [BandageJS](https://github.com/cmdcolin/BandageJS). It imports no React,
MobX or JBrowse code. BandageJS's
[`src/main.ts`](https://github.com/cmdcolin/BandageJS/blob/main/src/main.ts) is
the worked example.

```
npm install @jbrowse/bandage-core
```

## Reading a graph

- `loadGraph` reads GFA or rGFA text. The caller decompresses a `.gfa.gz` first
- `loadGraph` also takes `GraphTables`, the typed arrays that
  [@jbrowse/graph-walks](https://github.com/GMOD/graph-walks) cuts from a
  [gfa-to-tabix](https://github.com/GMOD/gfa-to-tabix) walk file
  (`.walks.bed.gz` beside its `.tbi`) for a region on the reference. A worker
  can transfer them without copying, and `graphTablesGFA` writes them as GFA
- `openGbz` and `cutGbzRegion` cut a window from a
  [gbz-base](https://github.com/jltsiren/gbz-base) database (`.gbz.db`) to GFA
  text
- In a walk-file cut, the `ws:Z:` and `we:Z:` tags on each W line record what
  lies past the fragment's start and end, such as `break,bp=19021` or
  `elsewhere,trimmed=400,chunk=GRCh38#0#chr22:20316160`
  (`src/gfa/walkStops.ts`). Walk rows split each gap at those stops and label
  each part with its cause

## Laying out and drawing

- `loadBandage` loads Bandage's FMMM engine, compiled to WASM in
  [@jbrowse/graph-fmmm-layout](https://github.com/GMOD/graph-fmmm-layout), and
  `forceLayout` runs it. The other layouts are ordered, anchored, sample rows,
  walk rows and tube map
- `buildGeometry` and `Canvas2DRenderer` draw to a canvas, with hit testing and
  label placement. The library also finds bubbles and deletion edges and colors
  paths
- `walkLift` lifts a walk out of the drawing, `facetLifts` and `facetGrid` draw
  one panel per walk, and `walkKey` describes each walk in words
- `graphBackbone`, `backboneAssembly` and `assemblyWalk` find which assembly a
  backbone lies on. `featuresOnBackbone` renames that assembly's genes onto the
  backbone's refNames, and `genePins` pins only those

## Figures

- `figureSvg` draws a graph and its lifted walks to a standalone SVG. The
  `bandage-figure` CLI makes one from a JSON spec with no browser:
  `npx -p @jbrowse/bandage-core bandage-figure spec.json -o figure.svg`. See
  [docs/figures.md](docs/figures.md)
- `figureData` returns what `figureSvg` would draw as columnar tables, for
  another graphics system to draw;
  [ggbandage](https://github.com/GMOD/ggbandage) draws them in ggplot2

## Coarse tier: `bandage-fold`

`bandage-fold` writes an rGFA with every variant under `--below` bp folded into
the reference. Indexed by gfa-to-tabix, the output is the coarse tier a graph
track draws once zoomed out past the fine index, so a whole chromosome fits.
[`gfa-to-tabix fold`](https://github.com/GMOD/gfa-to-tabix/blob/main/docs/subcommands.md#fold)
documents the fold and the handover from the fine index.

```console
npx -p @jbrowse/bandage-core bandage-fold graph.rgfa.gz --below 10000 \
  | gfa-to-tabix - -o graph.fold10000
```

- The input is a GFA or rGFA, plain or gzipped, or `-` for stdin. `-o out.gfa`
  writes a file in place of stdout
- `--reference PATH` names a plain GFA's backbone path. In an rGFA, the segments
  tagged `SR:i:0` form the backbone
- The fold keeps the backbone, every allele whose own length or the reference it
  replaces reaches `--below`, and the shortest way from each one's ends back to
  the backbone. It joins the reference between kept alleles into one segment
- `bandage-fold` drops paths and walks from the output. It writes forward a
  segment that a plain GFA's path reads reversed, and flips its links to match,
  so the output re-reads as the graph that was folded
- gfa-to-tabix's `--layout anchored|contig` should match the fine index's. An
  anchored window inside a large bubble then returns the whole bubble in both
  tiers, and a contig one only what links reach from it
- The graph track folds each cut it draws at ten pixels (`FOLD_PX` in
  jbrowse-plugin-graphgenomeviewer), and folding a fold again at a larger size
  closely matches folding the original at that size. A tier folded at N and
  handed over at N / 10 bp per pixel, such as
  `coarse: { uri: "graph.fold10000", aboveBpPerPx: 1000 }`, therefore draws
  nearly what the fine cut drew
- Node caps a string at 512 MB, and `bandage-fold` reads the whole graph into
  one, so it cannot fold a whole human pangenome. `gfa-to-tabix fold`, a port of
  the same fold, writes the index in one pass:
  `gfa-to-tabix fold graph.rgfa.gz --below 10000 -o graph.fold10000`

## Developing

```
pnpm install
pnpm test          # unit tests
pnpm build         # dist/ with declarations
```

- The FMMM engine and its wasm build are in
  [graph-fmmm-layout](https://github.com/GMOD/graph-fmmm-layout)
- CI also packs the core and runs the typecheck and tests of
  [BandageJS](https://github.com/cmdcolin/BandageJS) and
  [jbrowse-plugin-graphgenomeviewer](https://github.com/GMOD/jbrowse-plugin-graphgenomeviewer)
  against it. For an API change, push the consumer's matching change to a
  `core-next` branch in that consumer's repo, which CI tests in place of `main`
  until the release
- `src/foldParity.test.ts` folds a few hundred random rGFA graphs with
  `foldVariants` and with the gfa-to-tabix release that
  `.github/actions/gfa-to-tabix` pins, and fails when they fold differently.
  Locally the test runs the `gfa-to-tabix` on PATH or named by `GFA_TO_TABIX`,
  and skips without one. In the other direction, gfa-to-tabix's
  `scripts/parity-fold.sh` checks that `gfa-to-tabix fold` writes the same bytes
  as `bandage-fold | gfa-to-tabix -`, and its CI tests the port against a pinned
  bandage-core
- Release with `pnpm version patch`: it lints, tests, stamps `src/version.ts`,
  writes the changelog with git-cliff and pushes the `v*` tag. `publish.yml`
  then runs CI, consumers included, and publishes to npm with trusted publishing
  only if it passes. When a consumer fails, push its side to `core-next` and
  rerun the failed jobs

## See also

- [jbrowse-plugin-graphgenomeviewer](https://github.com/GMOD/jbrowse-plugin-graphgenomeviewer) -
  JBrowse 2 plugin that browses these graphs by locus
- [BandageJS](https://github.com/cmdcolin/BandageJS) - browser viewer for GFA
  files, walk files and gbz-base databases
- [gfa-to-tabix](https://github.com/GMOD/gfa-to-tabix) - indexes a GFA by
  reference position, writing the `.walks.bed.gz` walk files
- [@jbrowse/graph-walks](https://github.com/GMOD/graph-walks) - range-request
  reader for walk files
- [@jbrowse/graph-fmmm-layout](https://github.com/GMOD/graph-fmmm-layout) -
  Bandage's FMMM layout as wasm
- [@jbrowse/graph-stress-layout](https://github.com/GMOD/graph-stress-layout) -
  stress layout that keeps the reference straight
- [@gmod/gbz-base](https://github.com/GMOD/gbz-base-js) - range-request reader
  for `.gbz.db` databases
- [ggbandage](https://github.com/GMOD/ggbandage) - Bandage-style graph figures
  as ggplot2 layers
- [@jbrowse/tubemap-core](https://github.com/GMOD/tubemap-core) -
  sequenceTubeMap's layout, without the DOM

Tutorials on [jbrowse.org](https://jbrowse.org/jb2/docs/tutorials/):

- [HPRC part 1: graph alleles and haplotypes](https://jbrowse.org/jb2/docs/tutorials/pangenome_hprc/)
- [HPRC part 3: repeat lengths](https://jbrowse.org/jb2/docs/tutorials/pangenome_hprc_repeats/)

## License

Both Bandage and OGDF are GPL, which is why this package is GPL-3.0-or-later.
