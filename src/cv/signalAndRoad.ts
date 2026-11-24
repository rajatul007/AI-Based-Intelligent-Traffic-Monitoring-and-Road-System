import type { NormalizedPoint, SignalState } from '../types/traffic';

/**
 * Ray-casting point-in-polygon check in normalized coordinates (0..1).
 */
export function pointInPolygon(pt: NormalizedPoint, polygon: NormalizedPoint[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersect =
      yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function ccw(A: NormalizedPoint, B: NormalizedPoint, C: NormalizedPoint): number {
  return (C.y - A.y) * (B.x - A.x) - (B.y - A.y) * (C.x - A.x);
}

/**
 * Checks if segment p1->p2 intersects segment q1->q2 and returns crossing side sign.
 */
export function segmentCrossed(
  p1: NormalizedPoint,
  p2: NormalizedPoint,
  q1: NormalizedPoint,
  q2: NormalizedPoint
): { crossed: boolean; side: 1 | -1 | 0 } {
  const d1 = ccw(q1, q2, p1);
  const d2 = ccw(q1, q2, p2);
  const d3 = ccw(p1, p2, q1);
  const d4 = ccw(p1, p2, q2);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return { crossed: true, side: d2 > 0 ? 1 : -1 };
  }
  return { crossed: false, side: 0 };
}

/**
 * Computes shortest distance from point p to line segment a->b.
 */
export function distancePointToSegment(
  p: NormalizedPoint,
  a: NormalizedPoint,
  b: NormalizedPoint
): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const abLenSq = abx * abx + aby * aby;
  const t = abLenSq > 1e-9 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq)) : 0;
  const projX = a.x + t * abx;
  const projY = a.y + t * aby;
  return Math.hypot(p.x - projX, p.y - projY);
}

/**
 * Computes angular deviation (0..180 deg) between a vehicle's displacement vector
 * and the camera's configured permitted road direction.
 */
export function angularDeviationFromPermitted(
  dx: number,
  dy: number,
  permittedDeg: number
): number {
  const moveDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  let diff = Math.abs(((moveDeg - permittedDeg + 180) % 360 + 360) % 360 - 180);
  if (diff > 180) diff = 360 - diff;
  return diff;
}

/**
 * Converts RGB (0..255) to HSV (H: 0..360, S: 0..1, V: 0..1).
 */
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / d + 2);
    else h = 60 * ((rn - gn) / d + 4);
  }
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : d / max;
  return [h, s, max];
}

/**
 * Classifies traffic signal color (Red, Yellow, Green, Unknown) from a canvas ROI
 * using bright saturated HSV pixel votes.
 */
export function classifyTrafficSignalFromCanvas(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  roi: { x: number; y: number; w: number; h: number }
): { state: SignalState; confidence: number } {
  const rx = Math.max(0, Math.floor(roi.x * canvasWidth));
  const ry = Math.max(0, Math.floor(roi.y * canvasHeight));
  const rw = Math.max(4, Math.min(canvasWidth - rx, Math.floor(roi.w * canvasWidth)));
  const rh = Math.max(4, Math.min(canvasHeight - ry, Math.floor(roi.h * canvasHeight)));

  if (rw < 4 || rh < 4) return { state: 'unknown', confidence: 0 };

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(rx, ry, rw, rh).data;
  } catch {
    return { state: 'unknown', confidence: 0 };
  }

  let redVotes = 0;
  let yellowVotes = 0;
  let greenVotes = 0;
  const totalPixels = rw * rh;

  for (let i = 0; i < data.length; i += 4) {
    const [h, s, v] = rgbToHsv(data[i], data[i + 1], data[i + 2]);
    if (s < 0.45 || v < 0.45) continue;

    if (h <= 18 || h >= 342) redVotes++;
    else if (h >= 24 && h <= 64) yellowVotes++;
    else if (h >= 85 && h <= 170) greenVotes++;
  }

  const maxVotes = Math.max(redVotes, yellowVotes, greenVotes);
  const ratio = maxVotes / Math.max(1, totalPixels);

  // Require at least 2.5% bright colored lamp pixels to classify cleanly
  if (ratio < 0.025 || maxVotes < 8) {
    return { state: 'unknown', confidence: 0 };
  }

  const totalVotes = redVotes + yellowVotes + greenVotes;
  const dominance = maxVotes / Math.max(1, totalVotes);
  if (dominance < 0.5) return { state: 'unknown', confidence: dominance };

  if (maxVotes === redVotes) return { state: 'red', confidence: Math.min(0.95, dominance) };
  if (maxVotes === yellowVotes) return { state: 'yellow', confidence: Math.min(0.95, dominance) };
  return { state: 'green', confidence: Math.min(0.95, dominance) };
}
