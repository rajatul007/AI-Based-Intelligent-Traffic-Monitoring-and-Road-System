import type { CalibrationConfig, NormalizedPoint } from '../types/traffic';

type Matrix3x3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number]
];

/**
 * Solves a linear system Ax = b via Gaussian elimination with partial pivoting.
 */
function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxVal = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > maxVal) {
        maxVal = Math.abs(M[r][col]);
        pivotRow = r;
      }
    }
    if (maxVal < 1e-10) return null;
    if (pivotRow !== col) {
      const tmp = M[col];
      M[col] = M[pivotRow];
      M[pivotRow] = tmp;
    }

    const pivot = M[col][col];
    for (let j = col; j <= n; j++) {
      M[col][j] /= pivot;
    }

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      for (let j = col; j <= n; j++) {
        M[r][j] -= factor * M[col][j];
      }
    }
  }

  return M.map((row) => row[n]);
}

/**
 * Computes a 3x3 projective homography matrix H mapping 4 normalized image points
 * (TL, TR, BR, BL) to real-world ground coordinates in meters:
 * (0,0), (W,0), (W,L), (0,L).
 */
export function computeHomographyMatrix(calibration: CalibrationConfig): Matrix3x3 | null {
  if (!calibration.isCalibrated) return null;
  if (calibration.realWidthMeters <= 0.5 || calibration.realLengthMeters <= 0.5) return null;

  const src = calibration.imagePoints;
  const W = calibration.realWidthMeters;
  const L = calibration.realLengthMeters;
  const dst: NormalizedPoint[] = [
    { x: 0, y: 0 },
    { x: W, y: 0 },
    { x: W, y: L },
    { x: 0, y: L },
  ];

  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const x = src[i].x;
    const y = src[i].y;
    const u = dst[i].x;
    const v = dst[i].y;

    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }

  const h = solveLinearSystem(A, b);
  if (!h) return null;

  return [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1],
  ];
}

/**
 * Projects a normalized image point (0..1, 0..1) into real-world ground meters (X, Y).
 */
export function projectToGroundMeters(
  pt: NormalizedPoint,
  H: Matrix3x3
): { xMeters: number; yMeters: number } | null {
  const denom = H[2][0] * pt.x + H[2][1] * pt.y + H[2][2];
  if (Math.abs(denom) < 1e-8) return null;

  const xMeters = (H[0][0] * pt.x + H[0][1] * pt.y + H[0][2]) / denom;
  const yMeters = (H[1][0] * pt.x + H[1][1] * pt.y + H[1][2]) / denom;
  if (!Number.isFinite(xMeters) || !Number.isFinite(yMeters)) return null;
  return { xMeters, yMeters };
}

/**
 * Computes perspective-corrected speed in km/h from timestamped trajectory points.
 * Strictly returns null when camera is uncalibrated or when insufficient temporal baseline exists.
 */
export function estimateCalibratedSpeedKmh(
  trajectory: Array<{ x: number; y: number; t: number }>,
  calibration: CalibrationConfig
): number | null {
  if (!calibration.isCalibrated) return null;
  if (trajectory.length < 4) return null;

  const H = computeHomographyMatrix(calibration);
  if (!H) return null;

  // Use a rolling temporal window (350ms to 1500ms) to suppress single-frame bbox jitter
  const latest = trajectory[trajectory.length - 1];
  let anchor = trajectory[0];
  for (let i = trajectory.length - 2; i >= 0; i--) {
    const dtMs = latest.t - trajectory[i].t;
    if (dtMs >= 350) {
      anchor = trajectory[i];
      break;
    }
  }

  const dtSec = (latest.t - anchor.t) / 1000;
  if (dtSec < 0.25 || dtSec > 5.0) return null;

  const p1 = projectToGroundMeters({ x: anchor.x, y: anchor.y }, H);
  const p2 = projectToGroundMeters({ x: latest.x, y: latest.y }, H);
  if (!p1 || !p2) return null;

  const dx = p2.xMeters - p1.xMeters;
  const dy = p2.yMeters - p1.yMeters;
  const distMeters = Math.hypot(dx, dy);

  // Reject impossible teleportation spikes from tracking noise (> 200 km/h)
  const kmh = (distMeters / dtSec) * 3.6;
  if (!Number.isFinite(kmh) || kmh > 200) return null;

  return Math.round(kmh * 10) / 10;
}

export function medianSpeed(samples: number[]): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const val = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return Math.round(val * 10) / 10;
}
