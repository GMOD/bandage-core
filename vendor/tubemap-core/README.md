# @gmod/tubemap-core

sequenceTubeMap's layout: graph nodes and paths (and reads) in, tube map shapes
out. No DOM, d3 or React.

```ts
import { curvePaths, layoutTubeMap, nodeOutlinePath } from '@gmod/tubemap-core'

const layout = layoutTubeMap(
  [
    { name: '1', seq: 'ACGT' },
    { name: '2', seq: 'A' },
    { name: '3', seq: 'G' },
    { name: '4', seq: 'TTGCA' },
  ],
  [
    { id: 0, name: 'ref', sequence: ['1', '2', '4'], sourceTrackID: 0 },
    { id: 1, name: 'alt', sequence: ['1', '3', '4'], sourceTrackID: 0 },
  ],
  [], // reads
  { nodeWidthOption: 'compressed' },
)
```

- Track 0 is the reference; `-name` is a reverse visit
- `layout.shapes`: `rectangles`, `curves` (`curvePaths` adds SVG paths),
  `verticalRectangles` and `corners` (inversions)
- `nodeOutlinePath(node)`: a node's box as SVG path data; `new Path2D(d)` on a
  canvas
- `layout.nodes` has a hole at index 0: use `forEach`, not `for...of`

## Options

- `nodeWidthOption`: `normal` (default), `compressed`, `small`, `fixed`
- `charWidth`: px per base under `normal` (8.401)
- `trackWidth`: tube width (15)
- `mergeNodes`, `showReads` (true); `coarsenedReadView`, `ignoreStrand` (false)
- `mappingQualityCutoff`, `focusReadNames`: read filters
- `trackColor(track, highlight)`, `trackAlpha(track)`

## Releasing

- Bump `version`, commit, push tag `tubemap-core-v<version>`
- `.github/workflows/publish-tubemap-core.yml` tests and publishes it
