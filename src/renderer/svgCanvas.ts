// A canvas whose 2D context writes what it is asked to draw as SVG. It speaks
// the handful of Canvas2D calls Canvas2DRenderer makes, so the renderer that
// paints the screen also writes a vector figure, in Node as in a browser.

const n = (v: number) => +v.toFixed(1)

// `rgba(r, g, b, a)` as SVG 1.1 paint, which has no alpha channel of its own
function paint(css: string) {
  const m = /^rgba?\(([^,]+),([^,]+),([^,)]+)(?:,([^)]+))?\)$/.exec(
    css.replaceAll(' ', ''),
  )
  if (!m) {
    return { color: css, opacity: 1 }
  }
  const opacity = m[4] === undefined ? 1 : Number(m[4])
  return { color: `rgb(${m[1]},${m[2]},${m[3]})`, opacity }
}

function paintAttrs(kind: 'fill' | 'stroke', css: string) {
  const { color, opacity } = paint(css)
  return `${kind}="${color}"${opacity < 1 ? ` ${kind}-opacity="${n(opacity)}"` : ''}`
}

// A base-level cut draws thousands of nodes and edges under a pixel long, and
// a round cap draws each as a dot the stroke's width. So a subpath inside this
// many px is written as a dot, and a stroke keeps one dot per cell this size:
// the dots a chain of 1 bp nodes stacks there draw the same pixels. The KIV-2
// figure went from 4.6 MB to 1.2 MB.
const DOT_PX = 0.5
const DOT_CELL_PX = 0.25

interface Subpath {
  d: string
  segments: number
  x0: number
  x1: number
  y0: number
  y1: number
}

export function svgCanvas(width: number, height: number) {
  const out: string[] = []
  let subpaths: Subpath[] = []
  const start = (x: number, y: number) => {
    const s = { d: `M${n(x)} ${n(y)}`, segments: 0, x0: x, x1: x, y0: y, y1: y }
    subpaths.push(s)
    return s
  }
  const reach = (points: number[]) => {
    const s = subpaths.at(-1) ?? start(points[0]!, points[1]!)
    for (let i = 0; i < points.length; i += 2) {
      s.x0 = Math.min(s.x0, points[i]!)
      s.x1 = Math.max(s.x1, points[i]!)
      s.y0 = Math.min(s.y0, points[i + 1]!)
      s.y1 = Math.max(s.y1, points[i + 1]!)
    }
    s.segments++
    return s
  }
  const pathData = (dots: boolean) => {
    const seen = new Set<string>()
    return subpaths
      .map(s => {
        if (!dots || s.x1 - s.x0 >= DOT_PX || s.y1 - s.y0 >= DOT_PX) {
          return s.d
        }
        const x = (s.x0 + s.x1) / 2
        const y = (s.y0 + s.y1) / 2
        const cell = `${Math.round(x / DOT_CELL_PX)} ${Math.round(y / DOT_CELL_PX)}`
        if (s.segments === 0 || seen.has(cell)) {
          return ''
        }
        seen.add(cell)
        return `M${n(x)} ${n(y)}h0`
      })
      .join('')
  }
  const ctx = {
    canvas: undefined as unknown,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    beginPath() {
      subpaths = []
    },
    moveTo(x: number, y: number) {
      start(x, y)
    },
    lineTo(x: number, y: number) {
      reach([x, y]).d += `L${n(x)} ${n(y)}`
    },
    bezierCurveTo(
      cx0: number,
      cy0: number,
      cx1: number,
      cy1: number,
      x: number,
      y: number,
    ) {
      reach([cx0, cy0, cx1, cy1, x, y]).d +=
        `C${n(cx0)} ${n(cy0)} ${n(cx1)} ${n(cy1)} ${n(x)} ${n(y)}`
    },
    closePath() {
      const s = subpaths.at(-1)
      if (s) {
        s.d += 'Z'
      }
    },
    stroke() {
      // a butt cap draws nothing of a subpath this short, so only a round or
      // square one becomes a dot
      const d = pathData(ctx.lineCap !== 'butt')
      if (d) {
        out.push(
          `<path d="${d}" fill="none" ${paintAttrs('stroke', ctx.strokeStyle)} stroke-width="${n(ctx.lineWidth)}" stroke-linecap="${ctx.lineCap}" stroke-linejoin="${ctx.lineJoin}"/>`,
        )
      }
    },
    fill() {
      const d = pathData(false)
      if (d) {
        out.push(`<path d="${d}" ${paintAttrs('fill', ctx.fillStyle)}/>`)
      }
    },
    fillRect(x: number, y: number, w: number, h: number) {
      out.push(
        `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" ${paintAttrs('fill', ctx.fillStyle)}/>`,
      )
    },
  }
  const canvas = {
    width,
    height,
    style: {},
    getContext: () => ctx,
  }
  ctx.canvas = canvas
  return {
    canvas: canvas as unknown as HTMLCanvasElement,
    // the drawing so far, as SVG elements in canvas pixels
    markup: () => out.join(''),
  }
}
