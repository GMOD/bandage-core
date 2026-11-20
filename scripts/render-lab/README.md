# Render lab

Times `Canvas2DRenderer` against `glPrototype.ts`, an instanced WebGL2 painter
of the same `RenderBatch`, on screen with vsync on.
jbrowse-plugin-graphgenomeviewer's `agent-docs/reference/GPU_RENDERING.md` has
the results. Nothing here ships in the package.

`glPrototype.ts` draws a node segment as a capsule and a link cubic as a ribbon
tessellated in the vertex shader, one instance each. It leaves out the faded
layer, highlights, dashes, arrowheads and their halos, and the order in which
skip, turn and along links are painted over nodes.

```
E=node_modules/.bin/esbuild
$E scripts/render-lab/lab.ts --bundle --format=iife --outfile=scripts/render-lab/out/lab.js
$E scripts/render-lab/scenes.ts --bundle --platform=node --format=esm \
  --outfile=scripts/render-lab/out/scenes.mjs \
  --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"
node scripts/render-lab/out/scenes.mjs /some/dir path/to/ggbandage/inst/extdata/rhd.syng.gfa.gz
PLAYWRIGHT=path/to/playwright-core/index.mjs node scripts/render-lab/drive.mjs /some/dir [--amd]
```

- `scenes.mjs` writes six whole-graph views at 1280×800: the
  `renderPasses.bench.ts` bubble chain at 1,499 and 14,999 nodes in rows, the
  KIV-2 figure graph and `rhd` from ggbandage under FMMM, and synthetic assembly
  graphs of 15k and 50k nodes under FMMM. It takes about 40 s.
- `drive.mjs` opens a headed Chrome window, so it needs a display. `--amd`
  selects ANGLE's Vulkan backend, which a second GPU needs. It prints a line per
  scene and painter: the median frame interval, frames per second, vsync
  intervals missed per frame and the upload time, and writes a PNG per painter
  with the count of pixels that differ from Canvas2D.
