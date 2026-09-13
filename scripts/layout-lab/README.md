# Layout lab

The harness behind `docs/layout-experiments.md`. It runs layouts on a GFA
outside the browser and writes PNGs, so a layout idea can be judged on a real
HPRC cut in seconds. Nothing here ships in the plugin.

Needs node, `rsvg-convert` and ImageMagick's `magick` on the path. The native
variants also need `scripts/profile/build.sh` to have built OGDF once, then:

```
g++ -O2 -std=c++17 -fcx-limited-range -Ivendor/ogdf/include -Ivendor/ogdf/build-native/include \
  scripts/layout-lab/native/driver.cpp -Lvendor/ogdf/build-native -lOGDF -lCOIN -lpthread \
  -o scripts/layout-lab/native/driver
```

## Cut a locus

```
node scripts/layout-lab/cut-hprc.ts <prefix> GRCh38 chr6 160525000 160655000 kiv2.gfa 1
```

`<prefix>` is the tabix pair without its suffix. `@gmod/tabix` reads local files
only, so download `hprc-v2.1-mc-grch38.{segs,links}.bed.gz{,.tbi}` from
`https://jbrowse.org/demos/hprc/` first. The last argument is the hop count; `1`
is the view's default and reproduces the tutorial's node counts.

## Draw it

```
node scripts/layout-lab/one.mjs kiv2.gfa out/kiv2 --region 160525000-160655000 --width 1600 \
  --v force --v "force:orient=1" --v "seeded:quality=2,orient=1" --v ordered --v anchored
```

One PNG per `--v`, plus a montage. Variants:

- `force[:quality=N,minNodeLength=N,orient=1]`: the committed wasm engine, as
  the view calls it. `orient=1` applies the reference orientation fit.
- `seeded[:quality=N,minNodeLength=N,rotate=0|1,side=below|above|alt,laneGap=N,orient=1]`:
  FMMM from reference seeds, native driver.
- `ordered[:laneGap=N,gutter=N]`: the reference-ordered layered prototype.
- `sugiyama[:ranking=longest|optimal|coffman,coord=fast|optimal]`: OGDF
  Sugiyama, native driver.
- `anchored`: the plugin's own anchored layout, bundled from `src/` by esbuild
  (`plugin-layouts.entry.ts`).

`--region s-e` sets the reference-position colour ramp's domain, as the view
does from the cut region. `--window s-e` cuts a path GFA to a reference window
first. `--ref name` picks the reference path of a path GFA. `--paths` draws
crude per-path ribbons. `--notitle` names outputs by variant instead of index.

## Variants rather than nodes

```
node scripts/layout-lab/bubbles.mjs <bubbles.bed.gz> 'GRCh38#0#chr6' 160525000 160655000 out.svg 'title'
node scripts/layout-lab/copycount.mjs kiv2_eight.gfa GRCh38 160616002 160646753 5548 copies.svg
node scripts/layout-lab/popbubble.mjs kiv2.gfa array.gfa s338859,s338860,...
```

`bubbles.mjs` draws a variant map from gfatools' bubble rows (the hosted
`hprc-v2.1-mc-grch38.bubbles.bed.gz`): one glyph per bubble, typed and sized
from the row. `copycount.mjs` reads a path GFA and reports the bp each walk
carries between a window's flanking reference nodes, as repeat units, plus
per-node carriage. `popbubble.mjs` cuts one bubble's segments out of a GFA so
`one.mjs` can draw it alone.

## Files

- `gfa.mjs`: GFA reader mirroring `gfaConverter.ts`, path anchoring, window cuts
- `engine.mjs`: the wasm engine, `orientToReference`, `referenceOrder`
- `native.mjs`, `native/driver.cpp`: seeds and the native FMMM / Sugiyama driver
- `ordered.mjs`: the layered layout
- `render.mjs`: SVG and PNG, the reference-position palette
- `to-vg.mjs`, `tubemap-render.mts`: a GFA window through sequenceTubeMapModern,
  headless (`node --experimental-strip-types`, run from that repo's directory)
