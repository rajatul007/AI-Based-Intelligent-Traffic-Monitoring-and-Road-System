import type {
  AiModelSettings,
  CameraConfiguration,
  CongestionLevel,
  RoadFlowMode,
  SignalState,
  TrackedVehicle,
  VerificationStatus,
  ViolationType,
} from '../types/traffic';
import {
  angularDeviationFromPermitted,
  distancePointToSegment,
  pointInPolygon,
  segmentCrossed,
} from './signalAndRoad';

export interface DetectedViolationEvent {
  cameraId: string;
  trackId: number;
  vehicleClass: TrackedVehicle['category'];
  violationType: ViolationType;
  confidence: number;
  speedKmh: number | null;
  plateNumber: string | null;
  verificationStatus: VerificationStatus;
  notes: string;
  timestamp: string;
  locationNorm: { x: number; y: number };
}

export interface LearnedRoadFlow {
  leftAngleDeg: number | null;
  rightAngleDeg: number | null;
  leftSamples: number;
  rightSamples: number;
}

interface SideFlowVotes {
  down: number; // ~90 deg
  up: number; // ~270 deg
  right: number; // ~0 deg
  left: number; // ~180 deg
}

function emptyVotes(): SideFlowVotes {
  return { down: 0, up: 0, right: 0, left: 0 };
}

function getDominantAngle(votes: SideFlowVotes): { angleDeg: number | null; total: number } {
  const entries: Array<[number, number]> = [
    [90, votes.down],
    [270, votes.up],
    [0, votes.right],
    [180, votes.left],
  ];
  const total = votes.down + votes.up + votes.right + votes.left;
  if (total < 3) return { angleDeg: null, total };

  entries.sort((a, b) => b[1] - a[1]);
  const [bestAngle, bestCount] = entries[0];
  // Require clear >= 72% directional consensus on this carriageway before flagging wrong-way
  if (bestCount / total >= 0.72) {
    return { angleDeg: bestAngle, total };
  }
  return { angleDeg: null, total };
}

function classifyPrimaryBucket(dx: number, dy: number): keyof SideFlowVotes {
  if (Math.abs(dy) >= Math.abs(dx)) {
    return dy >= 0 ? 'down' : 'up';
  }
  return dx >= 0 ? 'right' : 'left';
}

function resolvePermittedAngleForTrack(
  roadMode: RoadFlowMode,
  dividerX: number,
  currX: number,
  learned: LearnedRoadFlow,
  fallbackDeg: number
): { angleDeg: number | null; laneLabel: string } {
  const margin = 0.035;
  const isLeft = currX < dividerX - margin;
  const isRight = currX > dividerX + margin;

  switch (roadMode) {
    case 'two_way_auto': {
      if (isLeft) {
        return { angleDeg: learned.leftAngleDeg, laneLabel: 'Left Carriageway (Auto)' };
      }
      if (isRight) {
        return { angleDeg: learned.rightAngleDeg, laneLabel: 'Right Carriageway (Auto)' };
      }
      return { angleDeg: null, laneLabel: 'Road Divider' };
    }
    case 'two_way_left_down_right_up': {
      if (isLeft) return { angleDeg: 90, laneLabel: 'Left Carriageway (↓)' };
      if (isRight) return { angleDeg: 270, laneLabel: 'Right Carriageway (↑)' };
      return { angleDeg: null, laneLabel: 'Road Divider' };
    }
    case 'two_way_left_up_right_down': {
      if (isLeft) return { angleDeg: 270, laneLabel: 'Left Carriageway (↑)' };
      if (isRight) return { angleDeg: 90, laneLabel: 'Right Carriageway (↓)' };
      return { angleDeg: null, laneLabel: 'Road Divider' };
    }
    case 'one_way_down':
      return { angleDeg: 90, laneLabel: 'One-Way (Top → Bottom)' };
    case 'one_way_up':
      return { angleDeg: 270, laneLabel: 'One-Way (Bottom → Top)' };
    case 'one_way_right':
      return { angleDeg: 0, laneLabel: 'One-Way (Left → Right)' };
    case 'one_way_left':
      return { angleDeg: 180, laneLabel: 'One-Way (Right → Left)' };
    default:
      return { angleDeg: fallbackDeg, laneLabel: 'Configured Road Direction' };
  }
}

/**
 * Evaluates all geometric, kinematic, signal-state, and rule-based violations
 * with strict deduplication per (cameraId, trackId, violationType).
 * Supports both Two-Way Carriageways (auto-learned or explicit L/R flow) and One-Way roads
 * so oncoming traffic on the 2nd side of a 2-way road is never falsely flagged as wrong-way.
 */
export class TrafficViolationEngine {
  private triggeredKeys: Set<string> = new Set();
  private leftVotes: SideFlowVotes = emptyVotes();
  private rightVotes: SideFlowVotes = emptyVotes();
  private recordedFlowTracks: Set<number> = new Set();

  reset(): void {
    this.triggeredKeys.clear();
    this.leftVotes = emptyVotes();
    this.rightVotes = emptyVotes();
    this.recordedFlowTracks.clear();
  }

  getLearnedRoadFlow(): LearnedRoadFlow {
    const left = getDominantAngle(this.leftVotes);
    const right = getDominantAngle(this.rightVotes);
    return {
      leftAngleDeg: left.angleDeg,
      rightAngleDeg: right.angleDeg,
      leftSamples: left.total,
      rightSamples: right.total,
    };
  }

  private markIfNew(cameraId: string, trackId: number, type: ViolationType): boolean {
    const key = `${cameraId}:${trackId}:${type}`;
    if (this.triggeredKeys.has(key)) return false;
    this.triggeredKeys.add(key);
    return true;
  }

  evaluateFrame(
    tracks: TrackedVehicle[],
    camera: CameraConfiguration,
    signalState: SignalState,
    timestampMs: number
  ): DetectedViolationEvent[] {
    const events: DetectedViolationEvent[] = [];
    const isoNow = new Date(timestampMs).toISOString();
    const roadMode: RoadFlowMode = camera.zones.roadMode ?? 'two_way_auto';
    const dividerX = camera.zones.dividerX ?? 0.5;
    const isTwoWay = roadMode.startsWith('two_way');

    // Update per-side majority flow histogram for two_way_auto before evaluating wrong-way
    if (roadMode === 'two_way_auto') {
      for (const trk of tracks) {
        if (this.recordedFlowTracks.has(trk.trackId)) continue;
        if (trk.trajectory.length < 6) continue;
        const start = trk.trajectory[0];
        const curr = trk.trajectory[trk.trajectory.length - 1];
        const dx = curr.x - start.x;
        const dy = curr.y - start.y;
        if (Math.hypot(dx, dy) < 0.06) continue;

        const midX = (start.x + curr.x) / 2;
        if (Math.abs(midX - dividerX) < 0.03) continue;

        const bucket = classifyPrimaryBucket(dx, dy);
        if (midX < dividerX) {
          this.leftVotes[bucket] += 1;
        } else {
          this.rightVotes[bucket] += 1;
        }
        this.recordedFlowTracks.add(trk.trackId);
      }
    }

    const learnedFlow = this.getLearnedRoadFlow();

    for (const trk of tracks) {
      if (trk.hits < 4) continue; // Ignore unconfirmed noise tracks
      const traj = trk.trajectory;
      if (traj.length < 2) continue;

      const prev = traj[traj.length - 2];
      const curr = traj[traj.length - 1];

      const pushViolation = (
        type: ViolationType,
        confidence: number,
        status: VerificationStatus,
        notes: string
      ) => {
        if (!this.markIfNew(camera.id, trk.trackId, type)) return;
        if (!trk.violations.includes(type)) {
          trk.violations.push(type);
        }
        events.push({
          cameraId: camera.id,
          trackId: trk.trackId,
          vehicleClass: trk.category,
          violationType: type,
          confidence: Math.round(confidence * 100) / 100,
          speedKmh: trk.speedKmh,
          plateNumber: trk.plateNumber,
          verificationStatus: status,
          notes,
          timestamp: isoNow,
          locationNorm: { x: curr.x, y: curr.y },
        });
      };

      // 1. Overspeeding (ONLY when homography calibration is active!)
      if (
        camera.calibration.isCalibrated &&
        trk.speedKmh !== null &&
        trk.speedSamples.length >= 3 &&
        trk.speedKmh > camera.speedLimitKmh * 1.08
      ) {
        pushViolation(
          'overspeeding',
          Math.min(0.96, trk.confidence),
          'verified',
          `Calibrated speed ${trk.speedKmh} km/h exceeded limit of ${camera.speedLimitKmh} km/h.`
        );
      }

      // 2. Wrong-Side Driving (Carriageway-aware for Two-Way roads, full-road for One-Way roads)
      if (traj.length >= 8) {
        const start = traj[traj.length - 8];
        const dx = curr.x - start.x;
        const dy = curr.y - start.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 0.085) {
          const { angleDeg: permittedDeg, laneLabel } = resolvePermittedAngleForTrack(
            roadMode,
            dividerX,
            curr.x,
            learnedFlow,
            camera.zones.permittedDirectionDeg
          );

          if (permittedDeg !== null) {
            const angleDiff = angularDeviationFromPermitted(dx, dy, permittedDeg);
            if (angleDiff > 140) {
              pushViolation(
                'wrong_way',
                Math.min(0.94, Math.max(0.72, trk.confidence)),
                'verified',
                `Moved ${Math.round(angleDiff)}° opposite to permitted traffic flow on ${laneLabel}.`
              );
            }
          }
        }
      }

      // 3. Red-Light Jumping & 4. Stop-Line Violation
      const [stopA, stopB] = camera.zones.stopLine;
      if (signalState === 'red') {
        const stopCross = segmentCrossed(prev, curr, stopA, stopB);
        if (stopCross.crossed) {
          pushViolation(
            'red_light_jumping',
            Math.min(0.93, Math.max(0.75, trk.confidence)),
            'verified',
            'Vehicle crossed configured stop-line while traffic signal was RED.'
          );
        } else if (trk.stationarySinceMs !== null) {
          const distStop = distancePointToSegment(curr, stopA, stopB);
          const dwellSec = (timestampMs - trk.stationarySinceMs) / 1000;
          if (distStop < 0.025 && dwellSec >= 2.0) {
            pushViolation(
              'stop_line_violation',
              Math.min(0.9, trk.confidence),
              'requires_review',
              `Vehicle halted directly over stop-line band for ${dwellSec.toFixed(1)}s during red signal.`
            );
          }
        }
      }

      // 5. Restricted Zone / No-Entry Intrusion (only when explicitly configured)
      if (
        camera.zones.restrictedPolygon.length >= 3 &&
        pointInPolygon(curr, camera.zones.restrictedPolygon)
      ) {
        pushViolation(
          'restricted_zone',
          Math.min(0.92, trk.confidence),
          'verified',
          'Vehicle entered configured restricted / no-entry zone.'
        );
      }

      // 6. Zebra Crossing Blocking (stationary inside crosswalk beyond dwell threshold)
      if (
        trk.stationarySinceMs !== null &&
        camera.zones.zebraPolygon.length >= 3 &&
        pointInPolygon(curr, camera.zones.zebraPolygon)
      ) {
        const dwellSec = (timestampMs - trk.stationarySinceMs) / 1000;
        if (dwellSec >= camera.zones.zebraBlockDwellSec) {
          pushViolation(
            'zebra_crossing_blocking',
            Math.min(0.91, trk.confidence),
            'verified',
            `Vehicle remained stationary inside zebra crossing for ${dwellSec.toFixed(1)}s.`
          );
        }
      }

      // 7. Illegal Parking (stationary inside no-parking zone beyond dwell threshold)
      if (
        trk.stationarySinceMs !== null &&
        camera.zones.noParkingPolygon.length >= 3 &&
        pointInPolygon(curr, camera.zones.noParkingPolygon)
      ) {
        const dwellSec = (timestampMs - trk.stationarySinceMs) / 1000;
        if (dwellSec >= camera.zones.illegalParkingDwellSec) {
          pushViolation(
            'illegal_parking',
            Math.min(0.9, trk.confidence),
            'verified',
            `Vehicle parked in no-parking zone for ${dwellSec.toFixed(1)}s.`
          );
        }
      }

      // 8. Median / Center Divider Crossing Violation (only on Two-Way roads when crossing solid center divider)
      if (isTwoWay && traj.length >= 6) {
        const earlier = traj[traj.length - 6];
        const crossedDivider =
          (earlier.x < dividerX - 0.045 && curr.x > dividerX + 0.045) ||
          (earlier.x > dividerX + 0.045 && curr.x < dividerX - 0.045);
        if (crossedDivider && Math.abs(trk.velocity.vx) > 0.14) {
          pushViolation(
            'lane_violation',
            Math.min(0.86, Math.max(0.7, trk.confidence)),
            'requires_review',
            'Vehicle crossed across center road median divider into opposite carriageway.'
          );
        }
      }

      // 9. Dangerous Vehicle Movement (abrupt multi-direction swerve)
      if (traj.length >= 10) {
        const pA = traj[traj.length - 10];
        const pB = traj[traj.length - 5];
        const pC = curr;
        const v1x = pB.x - pA.x;
        const v1y = pB.y - pA.y;
        const v2x = pC.x - pB.x;
        const v2y = pC.y - pB.y;
        const l1 = Math.hypot(v1x, v1y);
        const l2 = Math.hypot(v2x, v2y);
        if (l1 > 0.05 && l2 > 0.05) {
          const cos = (v1x * v2x + v1y * v2y) / (l1 * l2);
          const turnDeg = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
          if (turnDeg > 78 && turnDeg < 142) {
            pushViolation(
              'dangerous_movement',
              Math.min(0.78, trk.confidence),
              'requires_review',
              `Sharp trajectory swerve (${Math.round(turnDeg)}°) detected; queued for review.`
            );
          }
        }
      }

      // 10. Triple Riding preliminary candidate via motorcycle + person overlap (>= 3 riders)
      if (trk.category === 'motorcycle' && trk.riderCount >= 3) {
        pushViolation(
          'triple_riding',
          Math.min(0.84, Math.max(0.7, trk.confidence)),
          'requires_review',
          `Detected ${trk.riderCount} overlapping person bounding boxes on motorcycle; verify via AI Vision.`
        );
      }
    }

    return events;
  }
}

/**
 * Extracts Full Frame, Vehicle Crop, and lower-region Plate Crop as JPEG Data URLs
 * from a live HTMLCanvasElement for Smart Evidence Generation.
 */
export function captureEvidenceCrops(
  sourceCanvas: HTMLCanvasElement,
  bbox: [number, number, number, number]
): { fullFrame: string; vehicleCrop: string; plateCrop: string } {
  const fullFrame = sourceCanvas.toDataURL('image/jpeg', 0.78);

  const [bx, by, bw, bh] = bbox;
  const padX = bw * 0.14;
  const padY = bh * 0.14;
  const sx = Math.max(0, Math.floor(bx - padX));
  const sy = Math.max(0, Math.floor(by - padY));
  const sw = Math.min(sourceCanvas.width - sx, Math.max(16, Math.ceil(bw + padX * 2)));
  const sh = Math.min(sourceCanvas.height - sy, Math.max(16, Math.ceil(bh + padY * 2)));

  const vehCanvas = document.createElement('canvas');
  vehCanvas.width = sw;
  vehCanvas.height = sh;
  const vCtx = vehCanvas.getContext('2d');
  vCtx?.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
  const vehicleCrop = vehCanvas.toDataURL('image/jpeg', 0.85);

  // Plate region heuristic: lower 42% center band of vehicle crop
  const px = Math.floor(bx + bw * 0.15);
  const py = Math.floor(by + bh * 0.56);
  const pw = Math.max(24, Math.min(sourceCanvas.width - Math.max(0, px), Math.ceil(bw * 0.7)));
  const ph = Math.max(16, Math.min(sourceCanvas.height - Math.max(0, py), Math.ceil(bh * 0.4)));

  const plateCanvas = document.createElement('canvas');
  plateCanvas.width = pw;
  plateCanvas.height = ph;
  const pCtx = plateCanvas.getContext('2d');
  pCtx?.drawImage(sourceCanvas, Math.max(0, px), Math.max(0, py), pw, ph, 0, 0, pw, ph);
  const plateCrop = plateCanvas.toDataURL('image/jpeg', 0.9);

  return { fullFrame, vehicleCrop, plateCrop };
}

/**
 * Transparent Congestion & Smart Traffic Risk Score computation.
 */
export function computeCongestionAndRisk(params: {
  activeVehicleCount: number;
  roadLengthMeters: number;
  isCalibrated: boolean;
  avgSpeedKmh: number | null;
  speedLimitKmh: number;
  verifiedViolationsCount: number;
  totalUniqueVehicles: number;
  thresholds: AiModelSettings['congestionThresholds'];
}): {
  densityPer100m: number;
  congestionLevel: CongestionLevel;
  riskScore: number;
} {
  const effectiveMeters = params.isCalibrated ? Math.max(15, params.roadLengthMeters) : 50;
  const densityPer100m =
    Math.round(((params.activeVehicleCount / effectiveMeters) * 100) * 10) / 10;

  let congestionLevel: CongestionLevel = 'LOW';
  if (densityPer100m >= params.thresholds.severeDensity) {
    congestionLevel = 'SEVERE';
  } else if (densityPer100m >= params.thresholds.highDensity) {
    congestionLevel = 'HIGH';
  } else if (densityPer100m >= params.thresholds.moderateDensity) {
    congestionLevel = 'MODERATE';
  }

  // Transparent Risk Score (0..100):
  // 50% Violation rate weight + 35% Density weight + 15% Speed drop/excess variance
  const violRate =
    params.totalUniqueVehicles > 0
      ? Math.min(1, params.verifiedViolationsCount / Math.max(5, params.totalUniqueVehicles))
      : 0;
  const densityFactor = Math.min(1, densityPer100m / Math.max(1, params.thresholds.severeDensity));
  let speedFactor = 0;
  if (params.avgSpeedKmh !== null && params.speedLimitKmh > 0) {
    if (params.avgSpeedKmh > params.speedLimitKmh) {
      speedFactor = Math.min(1, (params.avgSpeedKmh - params.speedLimitKmh) / 30);
    } else if (params.avgSpeedKmh < params.speedLimitKmh * 0.35 && params.activeVehicleCount >= 4) {
      speedFactor = 0.6;
    }
  }

  const riskScore = Math.round(violRate * 50 + densityFactor * 35 + speedFactor * 15);
  return { densityPer100m, congestionLevel, riskScore: Math.min(100, Math.max(0, riskScore)) };
}
