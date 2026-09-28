import { svgCanvas } from './svgCanvas'

function strokeOf(
  lineCap: string,
  draw: (ctx: CanvasRenderingContext2D) => void,
) {
  const { canvas, markup } = svgCanvas(100, 100)
  const ctx = canvas.getContext('2d')!
  ctx.lineCap = lineCap as CanvasLineCap
  ctx.beginPath()
  draw(ctx)
  ctx.stroke()
  return /d="([^"]*)"/.exec(markup())![1]
}

// a chain of 1 bp nodes, each a curve a fraction of a pixel long
function chain(ctx: CanvasRenderingContext2D) {
  ctx.moveTo(10, 10)
  ctx.lineTo(40, 10)
  ctx.moveTo(50, 50)
  ctx.bezierCurveTo(50.02, 50, 50.03, 50, 50.04, 50)
  ctx.moveTo(50.04, 50)
  ctx.bezierCurveTo(50.06, 50, 50.07, 50, 50.08, 50)
  ctx.moveTo(70, 70)
  ctx.lineTo(70.2, 70)
}

test('a round-capped subpath under a pixel is one dot per cell, a longer one as drawn', () => {
  expect(strokeOf('round', chain)).toBe('M10 10L40 10M50 50h0M70.1 70h0')
})

test('a butt-capped subpath is written as drawn, however short', () => {
  expect(strokeOf('butt', chain)).toBe(
    'M10 10L40 10M50 50C50 50 50 50 50 50M50 50C50.1 50 50.1 50 50.1 50M70 70L70.2 70',
  )
})

test('a move with nothing drawn from it writes nothing as a dot', () => {
  expect(
    strokeOf('round', ctx => {
      ctx.moveTo(5, 5)
      ctx.moveTo(10, 10)
      ctx.lineTo(40, 10)
    }),
  ).toBe('M10 10L40 10')
})
