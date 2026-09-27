# @jbrowse/bandage-core

Pangenome graph layout and drawing with no host, the engine behind
[jbrowse-plugin-graphgenomeviewer](https://github.com/GMOD/jbrowse-plugin-graphgenomeviewer)
and [BandageJS](https://github.com/cmdcolin/BandageJS).

```
npm install @jbrowse/bandage-core
```

- GFA and rGFA text in (`loadGraph`)
- Layouts: Bandage's FMMM engine as WASM (`loadBandage`, `forceLayout`), variant
  map, ordered, anchored, sample rows, walk rows, tube map
- A Canvas2D renderer (`buildGeometry`, `Canvas2DRenderer`), hit testing and
  label placement
- Bubbles, deletion edges, path colors, gbz-base windows cut to GFA

Nothing here imports React, MobX or a JBrowse host. BandageJS's
[`src/main.ts`](https://github.com/cmdcolin/BandageJS/blob/main/src/main.ts) is
the worked example.

## Developing

Lives in the plugin repo as a pnpm workspace package. The plugin imports its
source directly, so a change here needs no publish to reach the plugin.

The core releases with the plugin: `pnpm version patch` at the repo root bumps
both, and the plugin's publish workflow publishes both from the `v*` tag.
