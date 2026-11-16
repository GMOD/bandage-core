// Test support: a 2D context that records what it was asked to draw. jsdom
// implements no canvas backend, so there is no real context to render into and no
// pixels to read back; counting draw calls is what is available here, and it is
// enough for the two things worth asserting about this renderer.
//
// Draw-call counts are also the only *deterministic* performance signal available
// in a unit test -- wall-clock is machine- and load-dependent, so a timing bound
// loose enough not to flake is too loose to catch a 3x regression. See
// agent-docs/GRAPH_SCALE_AND_LOD.md.
//
// Not bundled: nothing under src/index.ts imports this, so it never ships.

// `points` is every coordinate the renderer asked for, in BACKING-STORE pixels
// — the far end of the whole pipeline. Counting draw calls says the renderer ran;
// this says where it put things, which is the only way to check a transform
// without a canvas backend to read pixels back from. `fillRect` is excluded: it
// is the background clear, and its corners are the pane, not the drawing.
export function recordingCanvas() {
  const strokes: string[] = []
  const fills: string[] = []
  // every stroke and fill in the order painted, with the points each traced
  const paints: {
    kind: 'stroke' | 'fill'
    style: string
    width: number
    points: { x: number; y: number }[]
  }[] = []
  let traced: { x: number; y: number }[] = []
  const lineWidths: number[] = []
  const points: { x: number; y: number }[] = []
  let clears = 0
  const at = (x: number, y: number) => {
    points.push({ x, y })
    traced.push({ x, y })
  }
  const ctx = {
    canvas: { width: 800, height: 600, style: {} },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
    beginPath: () => {
      traced = []
    },
    moveTo: at,
    lineTo: at,
    closePath: () => {},
    bezierCurveTo: (
      cx0: number,
      cy0: number,
      cx1: number,
      cy1: number,
      x: number,
      y: number,
    ) => {
      at(cx0, cy0)
      at(cx1, cy1)
      at(x, y)
    },
    fillRect: () => {},
    clearRect: () => {
      clears++
    },
    stroke: () => {
      strokes.push(ctx.strokeStyle)
      lineWidths.push(ctx.lineWidth)
      paints.push({
        kind: 'stroke',
        style: ctx.strokeStyle,
        width: ctx.lineWidth,
        points: traced,
      })
    },
    fill: () => {
      fills.push(ctx.fillStyle)
      paints.push({
        kind: 'fill',
        style: ctx.fillStyle,
        width: 0,
        points: traced,
      })
    },
  }
  // The element is real (jsdom gives a genuine HTMLCanvasElement); only the
  // context is a stand-in.
  const canvas = document.createElement('canvas')
  Object.defineProperty(canvas, 'getContext', { value: () => ctx })
  return {
    canvas,
    strokes,
    fills,
    lineWidths,
    points,
    paints,
    clears: () => clears,
  }
}
