/** Canvas translation is in pixels; shared positions are fractions of the displayed photo. */
export interface CanvasZoom { scale: number; x: number; y: number }
export interface SharedZoom { scale: number; x: number; y: number }
interface Size { w: number; h: number }

const FIT: CanvasZoom = { scale: 1, x: 0, y: 0 };

export function shareZoom(zoom: CanvasZoom, shown: Size): SharedZoom | null {
  if (shown.w <= 0 || shown.h <= 0) return null;
  if (zoom.scale <= 1.001) return { scale: 1, x: 0.5, y: 0.5 };
  return {
    scale: zoom.scale,
    x: 0.5 - zoom.x / (shown.w * zoom.scale),
    y: 0.5 - zoom.y / (shown.h * zoom.scale),
  };
}

export function receiveZoom(shared: SharedZoom, shown: Size): CanvasZoom {
  const scale = Math.max(1, Math.min(20, shared.scale));
  if (scale <= 1.001) return FIT;
  return { scale, x: (0.5 - shared.x) * shown.w * scale, y: (0.5 - shared.y) * shown.h * scale };
}
