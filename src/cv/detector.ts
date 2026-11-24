import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import type { RawDetection, VehicleCategory } from '../types/traffic';

const CLASS_MAP: Record<string, VehicleCategory | 'person' | 'traffic_light'> = {
  car: 'car',
  motorcycle: 'motorcycle',
  bus: 'bus',
  truck: 'truck',
  bicycle: 'bicycle',
  person: 'person',
  'traffic light': 'traffic_light',
};

export interface DetectorStatus {
  loaded: boolean;
  loading: boolean;
  backend: string;
  error: string | null;
}

export interface DetectOptions {
  /** Run overlapping road-band sub-tiles to double pixel resolution for small bikes & distant trucks */
  multiTileBoost?: boolean;
}

function bboxIoU(
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

/**
 * Class-aware Non-Maximum Suppression + Heavy Vehicle / Motorcycle Preservation:
 * - Prevents COCO-SSD's common failure where a `car` box swallows an overlapping `truck` or `bus`.
 * - Merges duplicate boxes generated across full-frame and overlapping road tiles.
 * - Boosts low-confidence `motorcycle`/`bicycle` detections when a `person` (rider) sits directly on top.
 */
function refineAndMergeDetections(
  raw: RawDetection[],
  frameWidth: number,
  frameHeight: number
): RawDetection[] {
  const persons = raw.filter((d) => d.category === 'person');
  const trafficLights = raw.filter((d) => d.category === 'traffic_light');
  const vehicles = raw
    .filter((d) => d.category !== 'person' && d.category !== 'traffic_light')
    .map((d) => ({ ...d, bbox: [...d.bbox] as [number, number, number, number] }));

  // 1. Rider-assisted boost for motorcycles & bicycles (helps small/distant bikes clear thresholds)
  for (const v of vehicles) {
    if (v.category !== 'motorcycle' && v.category !== 'bicycle') continue;
    const [vx, vy, vw, vh] = v.bbox;
    const ex1 = vx - vw * 0.25;
    const ey1 = Math.max(0, vy - vh * 0.75);
    const ex2 = vx + vw * 1.25;
    const ey2 = vy + vh * 1.1;

    for (const p of persons) {
      const pcx = p.bbox[0] + p.bbox[2] / 2;
      const pcy = p.bbox[1] + p.bbox[3] * 0.65;
      if (pcx >= ex1 && pcx <= ex2 && pcy >= ey1 && pcy <= ey2 && p.confidence >= 0.2) {
        v.confidence = Math.min(0.92, v.confidence + 0.16);
        break;
      }
    }
  }

  // 2. Priority scoring for cross-class suppression:
  // When truck/bus overlaps car strongly, preserve the specific heavy-vehicle class.
  const frameArea = Math.max(1, frameWidth * frameHeight);
  const effectivePriority = (d: RawDetection): number => {
    const areaRatio = (d.bbox[2] * d.bbox[3]) / frameArea;
    if (d.category === 'truck' || d.category === 'bus') {
      // Heavy vehicles often get slightly lower raw score than generic `car` in COCO-SSD
      return d.confidence * (areaRatio > 0.015 ? 1.48 : 1.32);
    }
    if (d.category === 'motorcycle') {
      return d.confidence * 1.18;
    }
    return d.confidence;
  };

  vehicles.sort((a, b) => effectivePriority(b) - effectivePriority(a));

  const keptVehicles: RawDetection[] = [];
  for (const cand of vehicles) {
    let suppressed = false;
    for (const kept of keptVehicles) {
      const iou = bboxIoU(cand.bbox, kept.bbox);
      if (cand.category === kept.category) {
        if (iou >= 0.45) {
          suppressed = true;
          break;
        }
      } else {
        // Cross-class duplicate suppression (e.g., truck vs car, bus vs truck, motorcycle vs bicycle)
        const isCarVsHeavy =
          (cand.category === 'car' && (kept.category === 'truck' || kept.category === 'bus')) ||
          ((cand.category === 'truck' || cand.category === 'bus') && kept.category === 'car');
        const isTwoWheelerPair =
          (cand.category === 'motorcycle' && kept.category === 'bicycle') ||
          (cand.category === 'bicycle' && kept.category === 'motorcycle');

        if ((isCarVsHeavy && iou >= 0.46) || (isTwoWheelerPair && iou >= 0.42) || iou >= 0.68) {
          suppressed = true;
          break;
        }
      }
    }
    if (!suppressed) {
      keptVehicles.push(cand);
    }
  }

  // Deduplicate person detections across tiles
  persons.sort((a, b) => b.confidence - a.confidence);
  const keptPersons: RawDetection[] = [];
  for (const p of persons) {
    if (!keptPersons.some((kp) => bboxIoU(p.bbox, kp.bbox) >= 0.5)) {
      keptPersons.push(p);
    }
  }

  return [...keptVehicles, ...keptPersons, ...trafficLights];
}

class TrafficDetectorService {
  private model: cocoSsd.ObjectDetection | null = null;
  private loadingPromise: Promise<void> | null = null;
  private tileCanvas: HTMLCanvasElement | null = null;
  public backend = 'initializing';
  public modelVariant = 'mobilenet_v2';
  public error: string | null = null;

  async load(onProgress?: (msg: string) => void): Promise<void> {
    if (this.model) return;
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = (async () => {
      try {
        this.error = null;
        onProgress?.('Initializing TensorFlow.js GPU inference backend...');
        await tf.ready();
        try {
          await tf.setBackend('webgl');
        } catch {
          await tf.setBackend('cpu');
        }
        this.backend = tf.getBackend() || 'cpu';
        onProgress?.(
          `Loading high-accuracy MobileNetV2 COCO-SSD weights (${this.backend.toUpperCase()})...`
        );
        try {
          this.model = await cocoSsd.load({ base: 'mobilenet_v2' });
          this.modelVariant = 'mobilenet_v2';
        } catch {
          onProgress?.('Falling back to Lite MobileNetV2 weights...');
          this.model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
          this.modelVariant = 'lite_mobilenet_v2';
        }
        onProgress?.('High-recall traffic detection model ready.');
      } catch (err) {
        this.error = (err as Error).message || 'Failed to load object detection model.';
        this.loadingPromise = null;
        throw err;
      }
    })();

    return this.loadingPromise;
  }

  isReady(): boolean {
    return this.model !== null;
  }

  private getSourceDims(
    source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement
  ): { w: number; h: number } {
    if (source instanceof HTMLVideoElement) {
      return { w: source.videoWidth, h: source.videoHeight };
    }
    if (source instanceof HTMLImageElement) {
      return { w: source.naturalWidth, h: source.naturalHeight };
    }
    return { w: source.width, h: source.height };
  }

  async detect(
    source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
    minConfidence = 0.2,
    options: DetectOptions = {}
  ): Promise<RawDetection[]> {
    if (!this.model) {
      await this.load();
    }
    if (!this.model) return [];

    const { w, h } = this.getSourceDims(source);
    if (w <= 0 || h <= 0) return [];

    // Request low-threshold predictions (0.12) so motorcycles, trucks, and Stage-2 ByteTrack can catch everything
    const baseFloor = Math.min(minConfidence, 0.12);
    const fullPreds = await this.model.detect(source, 60, baseFloor);
    const rawDetections: RawDetection[] = [];

    for (const p of fullPreds) {
      const mapped = CLASS_MAP[p.class];
      if (!mapped) continue;
      if (p.bbox[2] < 8 || p.bbox[3] < 8) continue;
      rawDetections.push({
        bbox: [p.bbox[0], p.bbox[1], p.bbox[2], p.bbox[3]],
        rawClass: p.class,
        category: mapped,
        confidence: p.score,
      });
    }

    // Optional Multi-Tile Road-Band Zoom: doubles effective pixel resolution for small motorcycles & distant trucks
    if (options.multiTileBoost && w >= 480 && h >= 270) {
      if (!this.tileCanvas) {
        this.tileCanvas = document.createElement('canvas');
      }
      const tileCtx = this.tileCanvas.getContext('2d');
      if (tileCtx) {
        const tiles = [
          // Left carriageway road band
          { sx: 0, sy: Math.floor(h * 0.16), sw: Math.floor(w * 0.56), sh: Math.floor(h * 0.82) },
          // Right carriageway road band
          {
            sx: Math.floor(w * 0.44),
            sy: Math.floor(h * 0.16),
            sw: Math.floor(w * 0.56),
            sh: Math.floor(h * 0.82),
          },
        ];

        for (const tile of tiles) {
          if (tile.sw < 64 || tile.sh < 64) continue;
          if (this.tileCanvas.width !== tile.sw || this.tileCanvas.height !== tile.sh) {
            this.tileCanvas.width = tile.sw;
            this.tileCanvas.height = tile.sh;
          }
          tileCtx.drawImage(
            source,
            tile.sx,
            tile.sy,
            tile.sw,
            tile.sh,
            0,
            0,
            tile.sw,
            tile.sh
          );

          const tilePreds = await this.model.detect(this.tileCanvas, 35, 0.14);
          for (const p of tilePreds) {
            const mapped = CLASS_MAP[p.class];
            if (!mapped) continue;
            // Ignore clipped giant artifacts covering >90% of a tile
            if (p.bbox[2] < 8 || p.bbox[3] < 8) continue;
            if (p.bbox[2] > tile.sw * 0.92 && p.bbox[3] > tile.sh * 0.92) continue;
            rawDetections.push({
              bbox: [p.bbox[0] + tile.sx, p.bbox[1] + tile.sy, p.bbox[2], p.bbox[3]],
              rawClass: p.class,
              category: mapped,
              confidence: p.score,
            });
          }
        }
      }
    }

    return refineAndMergeDetections(rawDetections, w, h);
  }
}

export const trafficDetector = new TrafficDetectorService();
