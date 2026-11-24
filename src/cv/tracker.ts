import type {
  CameraConfiguration,
  RawDetection,
  TrackedVehicle,
  TrafficDirection,
  VehicleCategory,
} from '../types/traffic';
import { angularDeviationFromPermitted, segmentCrossed } from './signalAndRoad';
import { estimateCalibratedSpeedKmh, medianSpeed } from './speedEstimator';

function computeIoU(
  a: [number, number, number, number],
  b: [number, number, number, number]
): number {
  const ax1 = a[0];
  const ay1 = a[1];
  const ax2 = a[0] + a[2];
  const ay2 = a[1] + a[3];

  const bx1 = b[0];
  const by1 = b[1];
  const bx2 = b[0] + b[2];
  const by2 = b[1] + b[3];

  const ix1 = Math.max(ax1, bx1);
  const iy1 = Math.max(ay1, by1);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);

  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  if (inter <= 0) return 0;

  const union = a[2] * a[3] + b[2] * b[3] - inter;
  return union > 0 ? inter / union : 0;
}

function emptyClassCounts(): Record<VehicleCategory, number> {
  return {
    car: 0,
    motorcycle: 0,
    bus: 0,
    truck: 0,
    auto_rickshaw: 0,
    bicycle: 0,
    other: 0,
  };
}

/**
 * Class-specific spawn threshold:
 * Motorcycles, bicycles, trucks, and buses receive lower raw scores in COCO-SSD than generic cars.
 * Lowering their spawn threshold avoids missing bikes & trucks on wide CCTV roads.
 */
function getClassSpawnThreshold(category: VehicleCategory, baseThreshold: number): number {
  if (category === 'motorcycle' || category === 'bicycle') {
    return Math.max(0.14, baseThreshold - 0.13);
  }
  if (category === 'truck' || category === 'bus') {
    return Math.max(0.16, baseThreshold - 0.11);
  }
  return Math.max(0.2, baseThreshold);
}

function getClassVoteWeight(category: VehicleCategory): number {
  if (category === 'truck' || category === 'bus') return 1.38;
  if (category === 'motorcycle' || category === 'bicycle') return 1.25;
  return 1.0;
}

/**
 * ByteTrack-inspired Two-Stage Multi-Object Vehicle Tracker.
 * - Class-aware spawn thresholds catch small motorcycles and heavy trucks reliably.
 * - Multi-frame weighted class voting prevents distant trucks from staying misclassified as cars.
 * - Center-proximity fallback keeps fast-moving bikes on a single track ID without splitting.
 * - Guarantees unique track IDs, non-duplicate counting, and full session history retention.
 */
export class ByteTrackVehicleTracker {
  private nextId = 1;
  private tracks: Map<number, TrackedVehicle> = new Map();
  private classVotes: Map<number, Partial<Record<VehicleCategory, number>>> = new Map();
  private sessionHistory: Map<number, TrackedVehicle> = new Map();
  private maxMissedFrames = 14;
  public uniqueCountByClass: Record<VehicleCategory, number> = emptyClassCounts();
  public crossedByClass: Record<VehicleCategory, number> = emptyClassCounts();
  public uniqueCountedIds: Set<number> = new Set();
  public inboundCount = 0;
  public outboundCount = 0;

  reset(): void {
    this.nextId = 1;
    this.tracks.clear();
    this.classVotes.clear();
    this.sessionHistory.clear();
    this.uniqueCountedIds.clear();
    this.inboundCount = 0;
    this.outboundCount = 0;
    this.uniqueCountByClass = emptyClassCounts();
    this.crossedByClass = emptyClassCounts();
  }

  getActiveTracks(): TrackedVehicle[] {
    return Array.from(this.tracks.values()).filter((t) => t.missedFrames <= 4);
  }

  getAllTracks(): TrackedVehicle[] {
    return Array.from(this.tracks.values());
  }

  getSessionVehicleHistory(): TrackedVehicle[] {
    return Array.from(this.sessionHistory.values()).sort((a, b) => b.lastSeenMs - a.lastSeenMs);
  }

  update(
    detections: RawDetection[],
    frameWidth: number,
    frameHeight: number,
    timestampMs: number,
    camera: CameraConfiguration,
    highConfThreshold: number,
    enabledClasses: VehicleCategory[]
  ): {
    activeTracks: TrackedVehicle[];
    personDetections: RawDetection[];
    trafficLightDetections: RawDetection[];
  } {
    const personDetections = detections.filter((d) => d.category === 'person');
    const trafficLightDetections = detections.filter((d) => d.category === 'traffic_light');

    const vehicleDetections = detections.filter(
      (d): d is RawDetection & { category: VehicleCategory } =>
        d.category !== 'person' &&
        d.category !== 'traffic_light' &&
        enabledClasses.includes(d.category)
    );

    const highDets = vehicleDetections.filter(
      (d) => d.confidence >= getClassSpawnThreshold(d.category, highConfThreshold)
    );
    const lowDets = vehicleDetections.filter(
      (d) =>
        d.confidence < getClassSpawnThreshold(d.category, highConfThreshold) &&
        d.confidence >= 0.12
    );

    // Predict next bounding boxes via constant-velocity model
    const predictedBoxes = new Map<number, [number, number, number, number]>();
    for (const [id, trk] of this.tracks.entries()) {
      const dtSec = Math.min(0.5, Math.max(0.016, (timestampMs - trk.lastSeenMs) / 1000));
      const predX = trk.bbox[0] + trk.velocity.vx * frameWidth * dtSec;
      const predY = trk.bbox[1] + trk.velocity.vy * frameHeight * dtSec;
      predictedBoxes.set(id, [predX, predY, trk.bbox[2], trk.bbox[3]]);
    }

    const unmatchedTrackIds = new Set<number>(this.tracks.keys());
    const unmatchedHigh = new Set<number>(highDets.map((_, i) => i));

    const matchPairs = (
      trackIds: number[],
      dets: Array<RawDetection & { category: VehicleCategory }>,
      detIndices: number[],
      iouThreshold: number
    ): Array<{ trackId: number; detIdx: number }> => {
      const candidates: Array<{ trackId: number; detIdx: number; score: number }> = [];
      for (const tid of trackIds) {
        const predBox = predictedBoxes.get(tid)!;
        const trk = this.tracks.get(tid)!;
        const predCx = predBox[0] + predBox[2] / 2;
        const predCy = predBox[1] + predBox[3] / 2;
        const diag = Math.max(24, Math.hypot(predBox[2], predBox[3]));

        for (const di of detIndices) {
          const det = dets[di];
          const iou = computeIoU(predBox, det.bbox);
          const bonus = trk.category === det.category ? 0.05 : 0;

          // Center-distance proximity score helps track small fast motorcycles across frames
          const detCx = det.bbox[0] + det.bbox[2] / 2;
          const detCy = det.bbox[1] + det.bbox[3] / 2;
          const normDist = Math.hypot(detCx - predCx, detCy - predCy) / diag;
          const proximityBonus =
            iou < 0.15 && normDist < 0.95 && (trk.category === 'motorcycle' || det.category === 'motorcycle')
              ? (1 - normDist) * 0.28
              : 0;

          const score = iou + bonus + proximityBonus;
          if (score >= iouThreshold) {
            candidates.push({ trackId: tid, detIdx: di, score });
          }
        }
      }
      candidates.sort((a, b) => b.score - a.score);
      const usedT = new Set<number>();
      const usedD = new Set<number>();
      const matched: Array<{ trackId: number; detIdx: number }> = [];
      for (const c of candidates) {
        if (usedT.has(c.trackId) || usedD.has(c.detIdx)) continue;
        usedT.add(c.trackId);
        usedD.add(c.detIdx);
        matched.push({ trackId: c.trackId, detIdx: c.detIdx });
      }
      return matched;
    };

    // Stage 1: High-confidence detections
    const stage1 = matchPairs(
      Array.from(unmatchedTrackIds),
      highDets,
      Array.from(unmatchedHigh),
      0.18
    );
    for (const { trackId, detIdx } of stage1) {
      this.applyDetectionToTrack(
        this.tracks.get(trackId)!,
        highDets[detIdx],
        frameWidth,
        frameHeight,
        timestampMs,
        camera
      );
      unmatchedTrackIds.delete(trackId);
      unmatchedHigh.delete(detIdx);
    }

    // Stage 2: Low-confidence detections for occlusion recovery
    if (unmatchedTrackIds.size > 0 && lowDets.length > 0) {
      const stage2 = matchPairs(
        Array.from(unmatchedTrackIds),
        lowDets,
        lowDets.map((_, i) => i),
        0.22
      );
      for (const { trackId, detIdx } of stage2) {
        this.applyDetectionToTrack(
          this.tracks.get(trackId)!,
          lowDets[detIdx],
          frameWidth,
          frameHeight,
          timestampMs,
          camera
        );
        unmatchedTrackIds.delete(trackId);
      }
    }

    // Age unmatched tracks and archive confirmed ones before pruning
    for (const tid of unmatchedTrackIds) {
      const trk = this.tracks.get(tid)!;
      trk.missedFrames += 1;
      if (trk.missedFrames > this.maxMissedFrames) {
        if (trk.hits >= 2) {
          this.sessionHistory.set(tid, { ...trk, violations: [...trk.violations] });
        }
        this.tracks.delete(tid);
        this.classVotes.delete(tid);
      }
    }

    // Spawn new tracks from remaining unmatched detections
    for (const di of unmatchedHigh) {
      const det = highDets[di];
      const cx = (det.bbox[0] + det.bbox[2] / 2) / frameWidth;
      const groundY = (det.bbox[1] + det.bbox[3] * 0.92) / frameHeight;
      const trackId = this.nextId++;

      const newTrack: TrackedVehicle = {
        trackId,
        category: det.category,
        confidence: det.confidence,
        bbox: det.bbox,
        centroid: { x: cx, y: groundY },
        velocity: { vx: 0, vy: 0 },
        trajectory: [{ x: cx, y: groundY, t: timestampMs }],
        direction: 'unknown',
        speedKmh: null,
        speedSamples: [],
        plateNumber: null,
        plateConfidence: null,
        helmetStatus: det.category === 'motorcycle' ? 'uncertain' : 'not_applicable',
        riderCount: 0,
        countedEntry: false,
        countedExit: false,
        firstSeenMs: timestampMs,
        lastSeenMs: timestampMs,
        missedFrames: 0,
        hits: 1,
        stationarySinceMs: null,
        violations: [],
        aiInspected: false,
      };
      this.tracks.set(trackId, newTrack);
      this.classVotes.set(trackId, {
        [det.category]: det.confidence * getClassVoteWeight(det.category),
      });
    }

    // Associate person detections with motorcycles
    for (const trk of this.tracks.values()) {
      if (trk.category !== 'motorcycle' || trk.missedFrames > 0) continue;
      let riders = 0;
      const [mx, my, mw, mh] = trk.bbox;
      const expandedMoto: [number, number, number, number] = [
        mx - mw * 0.25,
        Math.max(0, my - mh * 0.7),
        mw * 1.5,
        mh * 1.7,
      ];
      for (const person of personDetections) {
        const pcx = person.bbox[0] + person.bbox[2] / 2;
        const pcy = person.bbox[1] + person.bbox[3] * 0.65;
        if (
          pcx >= expandedMoto[0] &&
          pcx <= expandedMoto[0] + expandedMoto[2] &&
          pcy >= expandedMoto[1] &&
          pcy <= expandedMoto[1] + expandedMoto[3]
        ) {
          riders++;
        }
      }
      trk.riderCount = Math.max(trk.riderCount, riders);
    }

    // Sync all confirmed tracks into session history map
    for (const trk of this.tracks.values()) {
      if (trk.hits >= 2) {
        this.sessionHistory.set(trk.trackId, trk);
      }
    }

    return {
      activeTracks: this.getActiveTracks(),
      personDetections,
      trafficLightDetections,
    };
  }

  private updateTrackCategoryVote(
    trk: TrackedVehicle,
    det: RawDetection & { category: VehicleCategory }
  ): void {
    const votes = this.classVotes.get(trk.trackId) ?? {};
    votes[det.category] =
      (votes[det.category] ?? 0) + det.confidence * getClassVoteWeight(det.category);
    this.classVotes.set(trk.trackId, votes);

    let bestCat: VehicleCategory = trk.category;
    let bestScore = -1;
    for (const [cat, score] of Object.entries(votes) as Array<[VehicleCategory, number]>) {
      if (score > bestScore) {
        bestScore = score;
        bestCat = cat;
      }
    }

    if (bestCat !== trk.category) {
      const oldCat = trk.category;
      trk.category = bestCat;
      if (bestCat === 'motorcycle' && trk.helmetStatus === 'not_applicable') {
        trk.helmetStatus = 'uncertain';
      } else if (bestCat !== 'motorcycle' && trk.helmetStatus === 'uncertain') {
        trk.helmetStatus = 'not_applicable';
      }

      // Reconcile deduplicated counters cleanly if this track was already counted
      if (this.uniqueCountedIds.has(trk.trackId)) {
        this.uniqueCountByClass[oldCat] = Math.max(0, (this.uniqueCountByClass[oldCat] || 0) - 1);
        this.uniqueCountByClass[bestCat] = (this.uniqueCountByClass[bestCat] || 0) + 1;
      }
      if (trk.countedEntry || trk.countedExit) {
        this.crossedByClass[oldCat] = Math.max(0, (this.crossedByClass[oldCat] || 0) - 1);
        this.crossedByClass[bestCat] = (this.crossedByClass[bestCat] || 0) + 1;
      }
    }
  }

  private applyDetectionToTrack(
    trk: TrackedVehicle,
    det: RawDetection & { category: VehicleCategory },
    frameWidth: number,
    frameHeight: number,
    timestampMs: number,
    camera: CameraConfiguration
  ): void {
    const prevPt = trk.centroid;
    const cx = (det.bbox[0] + det.bbox[2] / 2) / frameWidth;
    const groundY = (det.bbox[1] + det.bbox[3] * 0.92) / frameHeight;
    const dtSec = Math.max(0.016, (timestampMs - trk.lastSeenMs) / 1000);

    const instVx = (cx - prevPt.x) / dtSec;
    const instVy = (groundY - prevPt.y) / dtSec;
    trk.velocity = {
      vx: trk.velocity.vx * 0.65 + instVx * 0.35,
      vy: trk.velocity.vy * 0.65 + instVy * 0.35,
    };

    trk.bbox = det.bbox;
    trk.confidence = Math.max(trk.confidence * 0.7 + det.confidence * 0.3, det.confidence);
    trk.centroid = { x: cx, y: groundY };
    trk.lastSeenMs = timestampMs;
    trk.missedFrames = 0;
    trk.hits += 1;
    trk.trajectory.push({ x: cx, y: groundY, t: timestampMs });
    if (trk.trajectory.length > 90) {
      trk.trajectory.shift();
    }

    // Multi-frame class majority voting (prevents trucks/bikes from staying mislabeled as cars)
    this.updateTrackCategoryVote(trk, det);

    // Confirm unique vehicle count once tracked for >= 2 frames (deduplicated strictly by trackId)
    if (trk.hits >= 2 && !this.uniqueCountedIds.has(trk.trackId)) {
      this.uniqueCountedIds.add(trk.trackId);
      this.uniqueCountByClass[trk.category] = (this.uniqueCountByClass[trk.category] || 0) + 1;
    }

    // Stationary dwell tracking
    const displacement = Math.hypot(cx - prevPt.x, groundY - prevPt.y);
    if (displacement < 0.0045) {
      if (trk.stationarySinceMs === null) {
        trk.stationarySinceMs = timestampMs;
      }
    } else {
      trk.stationarySinceMs = null;
    }

    // Direction estimation from trajectory start -> latest
    if (trk.trajectory.length >= 4) {
      const start = trk.trajectory[Math.max(0, trk.trajectory.length - 10)];
      const dx = cx - start.x;
      const dy = groundY - start.y;
      if (Math.hypot(dx, dy) > 0.025) {
        const angleDiff = angularDeviationFromPermitted(
          dx,
          dy,
          camera.zones.permittedDirectionDeg
        );
        const newDir: TrafficDirection = angleDiff <= 90 ? 'inbound' : 'outbound';
        trk.direction = newDir;
      }
    }

    // Entry/exit counting line crossing (never double-counts same track ID)
    const [lineA, lineB] = camera.zones.countingLine;
    const cross = segmentCrossed(prevPt, trk.centroid, lineA, lineB);
    if (cross.crossed) {
      const wasUncounted = !trk.countedEntry && !trk.countedExit;
      if (trk.direction === 'inbound' && !trk.countedEntry) {
        trk.countedEntry = true;
        this.inboundCount += 1;
      } else if (trk.direction === 'outbound' && !trk.countedExit) {
        trk.countedExit = true;
        this.outboundCount += 1;
      } else if (wasUncounted) {
        if (cross.side >= 0) {
          trk.countedEntry = true;
          this.inboundCount += 1;
        } else {
          trk.countedExit = true;
          this.outboundCount += 1;
        }
      }
      if (wasUncounted) {
        this.crossedByClass[trk.category] = (this.crossedByClass[trk.category] || 0) + 1;
      }
    }

    // Calibrated speed estimation (strictly null when uncalibrated)
    if (camera.calibration.isCalibrated) {
      const speed = estimateCalibratedSpeedKmh(trk.trajectory, camera.calibration);
      if (speed !== null) {
        trk.speedSamples.push(speed);
        if (trk.speedSamples.length > 15) trk.speedSamples.shift();
        trk.speedKmh = medianSpeed(trk.speedSamples);
      }
    } else {
      trk.speedKmh = null;
    }
  }
}
