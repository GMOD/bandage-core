// @vitest-environment node
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

// Pages like BandageJS bundle this package on their own, so a host, a state
// tree or a UI framework reached from here would land in a page that has none
// of them. These are the leaf utilities it may take from outside src/ instead.
const ALLOWED = [
  /^@jbrowse\/core\/esm\/util\/(colorBits|cssColorParse)\.js$/,
  /^@jbrowse\/core\/esm\/util\/color-bits\//,
  /^@jbrowse\/core\/esm\/util\/color\/cssColorsLevel4\.js$/,
  /^@jbrowse\/render-core\/esm\/(canvas2dUtils|canvasContext|renderingBackendBase)\.js$/,
  /^@jbrowse\/render-core\/esm\/marks\/colorFill\.js$/,
  /^@gmod\/tubemap-core\/dist\//,
  /^@gmod\/gbz-base\/dist\//,
]

// What BandageJS imports. Dropping one breaks that page at its next upgrade,
// which the plugin would not notice: it imports these through deep paths.
const PUBLISHED = [
  'BUBBLE_KIND_COLORS',
  'BUBBLE_KIND_NAMES',
  'BUBBLE_SPREADS',
  'COLOR_SCHEMES',
  'Canvas2DRenderer',
  'FACET_GAP_PX',
  'FACET_PAD_PX',
  'FACET_TITLE_PX',
  'FIT_PADDING',
  'HALO_FACTOR',
  'HPRC_GBZ',
  'LABEL_CHAR_PX',
  'LABEL_PAD',
  'LABEL_PX',
  'LAYOUT_MODES',
  'NODE_WIDTHS',
  'REFERENCE_RAMP_MAX_HUE',
  'ROW_HEIGHT_PX',
  'WALK_FIELDS',
  'WALK_SCHEMES',
  'axisScaleOf',
  'backboneAssembly',
  'bubbleHalos',
  'bubbleSegmentIds',
  'bubbleSubgraph',
  'bubblesFromGraph',
  'buildGeometry',
  'classifyBubble',
  'computeReferenceRamp',
  'contains',
  'cutGbzRegion',
  'cutWindowGFA',
  'deletionEdges',
  'drawTubeMap',
  'drawingBounds',
  'encodingStops',
  'encodingSwatchCss',
  'engineKey',
  'facetCells',
  'facetGrid',
  'facetLifts',
  'featuresOnBackbone',
  'figureSvg',
  'findHoveredEdge',
  'findHoveredNode',
  'fitTransform',
  'forceLayout',
  'formatBp',
  'genePins',
  'genesFromBed',
  'genesFromGff3Lines',
  'genesFromText',
  'getDpr',
  'graphBackbone',
  'haplotypeWanted',
  'layoutLabels',
  'layoutModeByValue',
  'loadBandage',
  'loadGraph',
  'modeUsesLayoutEngine',
  'nodeInk',
  'openGbz',
  'padded',
  'panSNContig',
  'panSNHaplotype',
  'parseRegion',
  'pathColorsLegible',
  'pathLegend',
  'referencePathQuery',
  'referenceSamplesOf',
  'resolveColorScheme',
  'resolveReferenceSample',
  'screenToLayout',
  'tubeMapFrame',
  'tubeMapNodeAt',
  'tubeMapPicture',
  'viewportOf',
  'walkHighlight',
  'walkKey',
  'walkLift',
  'walkRows',
  'walkRowsExtent',
  'wellKnownSample',
  'wheelZoomFactor',
  'zoomAbout',
]

function bundleCore() {
  return build({
    absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
    entryPoints: ['src/index.ts'],
    bundle: true,
    write: false,
    outdir: 'out',
    format: 'esm',
    platform: 'browser',
    metafile: true,
    logLevel: 'silent',
  })
}

test('the core entry reaches no host, state tree or UI framework', async () => {
  const { metafile } = await bundleCore()
  const outside = Object.keys(metafile.inputs)
    .filter(path => !path.startsWith('src/'))
    .map(path => path.replace(/.*node_modules\//, ''))
  expect(outside.filter(p => !ALLOWED.some(re => re.test(p)))).toEqual([])
})

test('the core entry still exports what BandageJS imports', async () => {
  const { metafile } = await bundleCore()
  const exported = new Set(
    Object.entries(metafile.outputs).find(([path]) =>
      path.endsWith('index.js'),
    )?.[1].exports,
  )
  expect(PUBLISHED.filter(name => !exported.has(name))).toEqual([])
})
