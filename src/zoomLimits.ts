// The floor keeps a scale positive and finite, and has to clear the smallest
// scale a real layout asks for: fitting a chromosome-scale rGFA (250 Mbp) into
// ~720 px needs ~3e-6.
export const MIN_ZOOM = 1e-6
export const MAX_ZOOM = 100

export function clampZoom(zoom: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom))
}
