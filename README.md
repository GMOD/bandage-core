# @jbrowse/bandage-core

Pangenome graph layout and drawing with no host, the engine behind
[jbrowse-plugin-graphgenomeviewer](https://github.com/GMOD/jbrowse-plugin-graphgenomeviewer)
and [BandageJS](https://github.com/cmdcolin/BandageJS).

```
npm install @jbrowse/bandage-core
```

- GFA and rGFA text in (`loadGraph`), or the same graph as typed arrays a worker
  can transfer (`GraphTables`)
- Layouts: Bandage's FMMM engine as WASM (`loadBandage`, `forceLayout`),
  ordered, anchored, sample rows, walk rows, tube map
- A Canvas2D renderer (`buildGeometry`, `Canvas2DRenderer`), hit testing and
  label placement
- Bubbles, deletion edges, path colors, gbz-base windows cut to GFA
- Walks lifted out of the drawing (`walkLift`), one facet panel per walk
  (`facetLifts`, `facetGrid`) and each walk's key in words (`walkKey`)
- Which assembly a backbone lies on (`graphBackbone`, `backboneAssembly`,
  `assemblyWalk`), and the genes on it: `featuresOnBackbone` renames an
  assembly's genes onto the backbone's refNames, and `genePins` pins only those

- Figures: `figureSvg` draws a graph and its lifted walks to a standalone SVG,
  and the `bandage-figure` CLI makes one from a JSON spec with no browser:
  `npx -p @jbrowse/bandage-core bandage-figure spec.json -o figure.svg`. See
  [docs/figures.md](docs/figures.md)
- Figure data: `figureData` returns what `figureSvg` would paint as columnar
  tables, for another graphics system to draw;
  [ggbandage](https://github.com/GMOD/ggbandage) draws them in ggplot2

Nothing here imports React, MobX or a JBrowse host. BandageJS's
[`src/main.ts`](https://github.com/cmdcolin/BandageJS/blob/main/src/main.ts) is
the worked example.

## Developing

```
pnpm install
pnpm test          # unit tests
pnpm build         # dist/ with declarations
pnpm test:wasm     # the committed layout engine still loads
```

The Bandage layout engine is OGDF's FMMM compiled to WASM and committed at
`src/bandage/bandage-layout.js`; [src/bandage/README.md](src/bandage/README.md)
says how to rebuild it from `src/bandage/native` and the vendored `vendor/ogdf`.
A weekly workflow proves the committed artifact still reproduces.

CI also packs the core and runs
[BandageJS](https://github.com/cmdcolin/BandageJS) and
[jbrowse-plugin-graphgenomeviewer](https://github.com/GMOD/jbrowse-plugin-graphgenomeviewer)
against it. An API change lands with the consumer's side on a `core-next` branch
in that repo, which CI tests in place of `main` until the release.

Release with `pnpm version patch`: it lints, tests, stamps `src/version.ts`,
writes the changelog with git-cliff and pushes the `v*` tag, and `publish.yml`
publishes to npm with trusted publishing.

## See also

- [jbrowse-plugin-graphgenomeviewer](https://github.com/GMOD/jbrowse-plugin-graphgenomeviewer) -
  JBrowse 2 plugin that browses these graphs by locus
- [BandageJS](https://github.com/cmdcolin/BandageJS) - standalone page for GFA
  and gbz-base graphs
- [@jbrowse/graph-stress-layout](https://github.com/GMOD/graph-stress-layout) -
  stress layout that keeps the reference straight
- [@gmod/gbz-base](https://github.com/GMOD/gbz-base-js) - range-request reader
  for `.gbz.db` databases
- [ggbandage](https://github.com/GMOD/ggbandage) - Bandage-style graph figures
  as ggplot2 layers
- [@jbrowse/tubemap-core](https://github.com/GMOD/tubemap-core) -
  sequenceTubeMap's layout, without the DOM

Tutorials on [jbrowse.org](https://jbrowse.org/jb2/docs/tutorials/)

- [HPRC part 1: graph alleles and haplotypes](https://jbrowse.org/jb2/docs/tutorials/pangenome_hprc/)
- [HPRC part 3: repeat lengths](https://jbrowse.org/jb2/docs/tutorials/pangenome_hprc_repeats/)

## License

Both Bandage and OGDF are GPL, which is why this package is GPL-3.0-or-later.
