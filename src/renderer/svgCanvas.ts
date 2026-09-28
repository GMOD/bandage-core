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

export function svgCanvas(width: number, height: number) {
  const out: string[] = []
  let d = ''
  const ctx = {
    canvas: undefined as unknown,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    beginPath() {
      d = ''
    },
    moveTo(x: number, y: number) {
      d += `M${n(x)} ${n(y)}`
    },
    lineTo(x: number, y: number) {
      d += `L${n(x)} ${n(y)}`
    },
    bezierCurveTo(
      cx0: number,
      cy0: number,
      cx1: number,
      cy1: number,
      x: number,
      y: number,
    ) {
      d += `C${n(cx0)} ${n(cy0)} ${n(cx1)} ${n(cy1)} ${n(x)} ${n(y)}`
    },
    closePath() {
      d += 'Z'
    },
    stroke() {
      if (d) {
        out.push(
          `<path d="${d}" fill="none" ${paintAttrs('stroke', ctx.strokeStyle)} stroke-width="${n(ctx.lineWidth)}" stroke-linecap="${ctx.lineCap}" stroke-linejoin="${ctx.lineJoin}"/>`,
        )
      }
    },
    fill() {
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
