// The graph viewer without JBrowse: GFA in, layouts, geometry, a Canvas2D
// renderer, hit testing and label placement out. Nothing reachable from here
// may import a host, a state tree or a UI framework (index.test.ts), so a page
// of its own (github.com/cmdcolin/BandageJS) can draw exactly what the plugin
// draws.

export {
  FIT_PADDING,
  clampZoom,
  drawingBounds,
  engineRequest,
  fitTransform,
  forceLayout,
  layoutExtent,
  loadGraph,
} from './pipeline'
export type {
  Bounds,
  EngineRequest,
  EngineSettings,
  LayoutEngine,
} from './pipeline'

export {
  FORCE_LAYOUT_LABEL,
  LAYOUT_MODES,
  layoutModeByValue,
  modeUsesLayoutEngine,
} from './layoutModes'
export type { LayoutModeValue } from './layoutModes'
export { COLOR_SCHEMES, resolveColorScheme } from './colorSchemes'
export type { ColorScheme, ResolvedColorScheme } from './colorSchemes'
export {
  NODE_WIDTHS,
  maxNodeWidthPx,
  meanDepth,
  nodeInk,
  nodeWidthPx,
} from './nodeWidths'
export type { NodeWidth } from './nodeWidths'
export { BUBBLE_SPREADS } from './bubbleSpreads'
export type { BubbleSpread } from './bubbleSpreads'

export {
  REFERENCE_RAMP_MAX_HUE,
  buildGeometry,
  computeReferenceRamp,
} from './renderer/GeometryBuilder'
export { Canvas2DRenderer } from './renderer/Canvas2DRenderer'
// the ratio the renderer sizes its backing store with, which the transform
// handed to it has to be multiplied by
export { getDpr } from '@jbrowse/render-core/canvas2dUtils'
export type { Renderer } from './renderer/types'
export { findHoveredEdge, findHoveredNode } from './util/hitDetection'
export type { NodeInk } from './util/hitDetection'
export type { AxisScale } from './util/geometry'
export { wheelZoomFactor } from './util/wheelZoom'
// the tube map layouts draw their own shapes rather than the batch above
export {
  REFERENCE_STRIP_ZONE_PX,
  drawReferenceStrip,
  referenceStripBlocks,
  stripBlockAt,
} from './referenceStrip'
export type { StripBlock } from './referenceStrip'
export { drawTubeMap, tubeMapPicture } from './tubeMap/draw'
export type { TubeMapFrame, TubeMapPicture } from './tubeMap/draw'
export { tubeMapNodeColors } from './tubeMap/nodeColors'
export { referenceKnots, warpX } from './tubeMap/warp'
export { tubeMapFrame, tubeMapNodeAt } from './tubeMap/frame'
export type { TubeMapTransform, TubeMapView } from './tubeMap/frame'
export {
  drawTubeMapRuler,
  referenceBoxes,
  rulerBoxes,
  tubeX,
} from './tubeMap/axis'
export type { Box as TubeMapBox, ReferenceBoxes } from './tubeMap/axis'
export { drawTubeMapGenes, tubeMapGenes } from './tubeMap/genes'
export type { TubeMapGene } from './tubeMap/genes'
export {
  connectorAt,
  drawTubeMapConnectors,
  referenceNodes,
  tubeMapConnectors,
} from './tubeMap/connectors'
export type { Connector, ReferenceNode } from './tubeMap/connectors'
export type { TubeMapColumn, TubeMapDrawing } from './layout/tubeMapLayout'

export { deletionEdges } from './deletionEdges'
export type { DeletionEdge } from './deletionEdges'
export { facetLifts, walkHighlight, walkLift } from './walkHighlight'
export { rangeText, walkKey, walkPosition } from './walkKey'
export { figureSvg } from './figure'
export {
  genesFromBed,
  genesFromGff3Lines,
  genesFromText,
} from './genes/geneFiles'
export { HPRC_GBZ, cutGbzRegion, openGbz, parseRegion } from './gbzCut'
export type { GbzSource } from './gbzCut'
export { version } from './version'
export type { FigureOptions } from './figure'
export { svgCanvas } from './renderer/svgCanvas'
export {
  FACET_GAP_PX,
  FACET_PAD_PX,
  FACET_TITLE_PX,
  facetCells,
  facetGrid,
  facetSettingOf,
} from './facetGrid'
export type { FacetBy, FacetGrid, FacetInput, FacetSetting } from './facetGrid'
export type { LiftedWalk, WalkLift } from './walkHighlight'
export {
  WALK_FIELDS,
  WALK_SCHEMES,
  encodingStops,
  encodingSwatchCss,
  resolveEncoding,
  schemeCss,
} from './walkEncoding'
export type {
  WalkEncoding,
  WalkField,
  WalkLayer,
  WalkScheme,
} from './walkEncoding'
export { pathColorsLegible, pathLegend } from './pathColors'
export { bubblesFromGraph } from './bubbles/bubblesFromGraph'
export { bubbleHalos } from './bubbles/bubbleHalos'
export type { BubbleHalo } from './bubbles/bubbleHalos'
export {
  BUBBLE_KIND_COLORS,
  BUBBLE_KIND_NAMES,
  bubbleSegmentIds,
  classifyBubble,
} from './bubbles/classifyBubble'
export { bubbleSubgraph } from './bubbles/popBubble'
export type { MinigraphBubble } from './bubbles/bubbleLine'
export { walkRows } from './layout/walkRows'
export type { WalkRows } from './layout/walkRows'
export { walkRowsExtent } from './layout/walkRowLayout'
export { ROW_HEIGHT_PX } from './layout/rowSpacing'

export {
  HALO_FACTOR,
  LEGEND_INSET_PX,
  geneCoverageNote,
  layoutLabels,
} from './labelLayout'
export type { LabelLayout, LabelLayoutSource } from './labelLayout'
export { formatBp } from './graphLabels'
export { genePins } from './genes/genePins'
export type { GeneModel, GenePin } from './genes/genePins'
export {
  WELL_KNOWN_SAMPLES,
  assemblyWalk,
  backboneAssembly,
  featuresOnBackbone,
  graphBackbone,
  refNameBinding,
  wellKnownSample,
} from './reference'
export type { AssemblyNames, Backbone, BackboneContig } from './reference'
export { LABEL_CHAR_PX, LABEL_PAD, LABEL_PX } from './overlayLabels'

export type {
  Graph,
  GraphEdge,
  GraphNode,
  LayoutResult,
  NodeSegment,
} from './types'

export {
  cutWindowGFA,
  haplotypeWanted,
  referencePathQuery,
  referenceSamplesOf,
  resolveReferenceSample,
} from './gbzWindow'
export type { GbzWindowOptions } from './gbzWindow'

export { engineKey } from './pipeline'
export {
  axisScaleOf,
  contains,
  padded,
  screenToLayout,
  viewportOf,
  zoomAbout,
} from './viewport'
export type { PaneTransform } from './viewport'
export { default as loadBandage } from './loadBandage'
export { panSNContig, panSNHaplotype, panSNSample } from './pansn'
