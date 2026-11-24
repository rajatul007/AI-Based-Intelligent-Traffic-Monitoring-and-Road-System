import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type {
  CalibrationConfig,
  CameraConfiguration,
  CameraZones,
  CongestionLevel,
  DashboardSummary,
  EvidenceRecord,
  NumberPlateRecord,
  VehicleRecord,
  VerificationStatus,
  ViolationRecord,
  ViolationType,
} from '../src/types/traffic.ts';
import { VIOLATION_LABELS } from '../src/types/traffic.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'traffic_monitoring.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize all 7 core relational tables
db.exec(`
  CREATE TABLE IF NOT EXISTS camera_configurations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    location TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'webcam',
    source_uri TEXT NOT NULL DEFAULT '',
    speed_limit_kmh REAL NOT NULL DEFAULT 50,
    permitted_direction TEXT NOT NULL DEFAULT 'Southbound',
    is_calibrated INTEGER NOT NULL DEFAULT 0,
    calibration_json TEXT NOT NULL,
    zones_json TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    camera_id TEXT NOT NULL,
    track_id INTEGER NOT NULL,
    vehicle_class TEXT NOT NULL,
    confidence REAL NOT NULL,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    direction TEXT NOT NULL DEFAULT 'unknown',
    avg_speed_kmh REAL,
    max_speed_kmh REAL,
    plate_number TEXT,
    session_id TEXT NOT NULL,
    UNIQUE(camera_id, track_id, session_id),
    FOREIGN KEY(camera_id) REFERENCES camera_configurations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS vehicle_tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    camera_id TEXT NOT NULL,
    track_id INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    points_json TEXT NOT NULL,
    direction TEXT NOT NULL DEFAULT 'unknown',
    entered_line INTEGER NOT NULL DEFAULT 0,
    exited_line INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(camera_id, track_id, session_id),
    FOREIGN KEY(camera_id) REFERENCES camera_configurations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS evidence_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    camera_id TEXT NOT NULL,
    track_id INTEGER NOT NULL,
    violation_type TEXT NOT NULL,
    full_frame_path TEXT,
    vehicle_crop_path TEXT,
    plate_crop_path TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    timestamp TEXT NOT NULL,
    FOREIGN KEY(camera_id) REFERENCES camera_configurations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS violations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    camera_id TEXT NOT NULL,
    track_id INTEGER NOT NULL,
    session_id TEXT NOT NULL DEFAULT 'default',
    vehicle_class TEXT NOT NULL,
    violation_type TEXT NOT NULL,
    confidence REAL NOT NULL,
    speed_kmh REAL,
    plate_number TEXT,
    verification_status TEXT NOT NULL DEFAULT 'requires_review',
    notes TEXT,
    timestamp TEXT NOT NULL,
    evidence_id INTEGER,
    UNIQUE(camera_id, session_id, track_id, violation_type),
    FOREIGN KEY(camera_id) REFERENCES camera_configurations(id) ON DELETE CASCADE,
    FOREIGN KEY(evidence_id) REFERENCES evidence_records(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS number_plates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    camera_id TEXT NOT NULL,
    track_id INTEGER NOT NULL,
    raw_text TEXT NOT NULL,
    normalized_plate TEXT,
    is_valid_indian_format INTEGER NOT NULL DEFAULT 0,
    ocr_confidence REAL NOT NULL DEFAULT 0,
    corrected_plate TEXT,
    plate_image_path TEXT,
    timestamp TEXT NOT NULL,
    FOREIGN KEY(camera_id) REFERENCES camera_configurations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS traffic_statistics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    camera_id TEXT NOT NULL,
    bucket_timestamp TEXT NOT NULL,
    total_vehicles INTEGER NOT NULL DEFAULT 0,
    cars INTEGER NOT NULL DEFAULT 0,
    motorcycles INTEGER NOT NULL DEFAULT 0,
    buses INTEGER NOT NULL DEFAULT 0,
    trucks INTEGER NOT NULL DEFAULT 0,
    bicycles INTEGER NOT NULL DEFAULT 0,
    other_vehicles INTEGER NOT NULL DEFAULT 0,
    inbound_count INTEGER NOT NULL DEFAULT 0,
    outbound_count INTEGER NOT NULL DEFAULT 0,
    avg_speed_kmh REAL,
    density_per_100m REAL NOT NULL DEFAULT 0,
    congestion_level TEXT NOT NULL DEFAULT 'LOW',
    risk_score REAL NOT NULL DEFAULT 0,
    FOREIGN KEY(camera_id) REFERENCES camera_configurations(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_vehicles_cam ON vehicles(camera_id, last_seen);
  CREATE INDEX IF NOT EXISTS idx_violations_cam_ts ON violations(camera_id, timestamp);
  CREATE INDEX IF NOT EXISTS idx_plates_cam_ts ON number_plates(camera_id, timestamp);
  CREATE INDEX IF NOT EXISTS idx_stats_cam_ts ON traffic_statistics(camera_id, bucket_timestamp);
`);

export const DEFAULT_CALIBRATION: CalibrationConfig = {
  isCalibrated: false,
  imagePoints: [
    { x: 0.32, y: 0.42 },
    { x: 0.68, y: 0.42 },
    { x: 0.88, y: 0.92 },
    { x: 0.12, y: 0.92 },
  ],
  realWidthMeters: 10.5,
  realLengthMeters: 30.0,
};

export const DEFAULT_ZONES: CameraZones = {
  countingLine: [
    { x: 0.1, y: 0.62 },
    { x: 0.9, y: 0.62 },
  ],
  stopLine: [
    { x: 0.14, y: 0.72 },
    { x: 0.86, y: 0.72 },
  ],
  laneDividerLine: [
    { x: 0.5, y: 0.35 },
    { x: 0.5, y: 0.95 },
  ],
  restrictedPolygon: [],
  zebraPolygon: [
    { x: 0.16, y: 0.73 },
    { x: 0.84, y: 0.73 },
    { x: 0.88, y: 0.85 },
    { x: 0.12, y: 0.85 },
  ],
  noParkingPolygon: [],
  signalRoi: { x: 0.82, y: 0.08, w: 0.07, h: 0.16 },
  permittedDirectionDeg: 90,
  roadMode: 'two_way_auto',
  dividerX: 0.5,
  illegalParkingDwellSec: 8,
  zebraBlockDwellSec: 5,
};

// Seed default camera profiles only (zero fabricated detections or violations)
const existingCamCount = (
  db.prepare('SELECT COUNT(*) as c FROM camera_configurations').get() as { c: number }
).c;

if (existingCamCount === 0) {
  const now = new Date().toISOString();
  const insertCam = db.prepare(`
    INSERT INTO camera_configurations (
      id, name, location, source_type, source_uri, speed_limit_kmh,
      permitted_direction, is_calibrated, calibration_json, zones_json, active, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const defaults = [
    {
      id: 'CAM-DEL-01',
      name: 'ITO Intersection — Northbound Arterial',
      location: 'New Delhi, DL (Zone 4)',
      sourceType: 'webcam',
      sourceUri: '',
      speedLimitKmh: 50,
      permittedDirection: 'Southbound (Top → Bottom)',
      isCalibrated: 0,
    },
    {
      id: 'CAM-MUM-02',
      name: 'Western Express Highway — Corridor B',
      location: 'Mumbai, MH (Andheri Flyover)',
      sourceType: 'video_file',
      sourceUri: '',
      speedLimitKmh: 70,
      permittedDirection: 'Southbound (Top → Bottom)',
      isCalibrated: 0,
    },
    {
      id: 'CAM-BLR-03',
      name: 'Silk Board Signalized Junction',
      location: 'Bengaluru, KA (Outer Ring Rd)',
      sourceType: 'ip_http',
      sourceUri: '',
      speedLimitKmh: 40,
      permittedDirection: 'Southbound (Top → Bottom)',
      isCalibrated: 0,
    },
  ];

  const tx = db.transaction(() => {
    for (const c of defaults) {
      insertCam.run(
        c.id,
        c.name,
        c.location,
        c.sourceType,
        c.sourceUri,
        c.speedLimitKmh,
        c.permittedDirection,
        c.isCalibrated,
        JSON.stringify(DEFAULT_CALIBRATION),
        JSON.stringify(DEFAULT_ZONES),
        1,
        now
      );
    }
  });
  tx();
}

function mapCameraRow(row: Record<string, unknown>): CameraConfiguration {
  const calibration = JSON.parse(String(row.calibration_json)) as CalibrationConfig;
  const rawZones = JSON.parse(String(row.zones_json)) as CameraZones;
  const isLegacySeededZones = !rawZones.roadMode;
  const zones: CameraZones = {
    ...rawZones,
    roadMode: rawZones.roadMode ?? 'two_way_auto',
    dividerX: typeof rawZones.dividerX === 'number' ? rawZones.dividerX : 0.5,
    restrictedPolygon: isLegacySeededZones ? [] : rawZones.restrictedPolygon,
    noParkingPolygon: isLegacySeededZones ? [] : rawZones.noParkingPolygon,
  };
  return {
    id: String(row.id),
    name: String(row.name),
    location: String(row.location),
    sourceType: row.source_type as CameraConfiguration['sourceType'],
    sourceUri: String(row.source_uri ?? ''),
    speedLimitKmh: Number(row.speed_limit_kmh ?? 50),
    permittedDirection: String(row.permitted_direction ?? 'Two-Way Auto'),
    isCalibrated: Boolean(row.is_calibrated) && Boolean(calibration.isCalibrated),
    calibration,
    zones,
    active: Boolean(row.active),
    createdAt: String(row.created_at),
  };
}

export function getCameras(): CameraConfiguration[] {
  const rows = db
    .prepare('SELECT * FROM camera_configurations ORDER BY created_at ASC')
    .all() as Record<string, unknown>[];
  return rows.map(mapCameraRow);
}

export function getCameraById(id: string): CameraConfiguration | null {
  const row = db
    .prepare('SELECT * FROM camera_configurations WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapCameraRow(row) : null;
}

export function upsertCamera(cam: Omit<CameraConfiguration, 'createdAt'> & { createdAt?: string }): CameraConfiguration {
  const now = cam.createdAt || new Date().toISOString();
  const isCal = cam.calibration.isCalibrated ? 1 : 0;
  db.prepare(`
    INSERT INTO camera_configurations (
      id, name, location, source_type, source_uri, speed_limit_kmh,
      permitted_direction, is_calibrated, calibration_json, zones_json, active, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      location = excluded.location,
      source_type = excluded.source_type,
      source_uri = excluded.source_uri,
      speed_limit_kmh = excluded.speed_limit_kmh,
      permitted_direction = excluded.permitted_direction,
      is_calibrated = excluded.is_calibrated,
      calibration_json = excluded.calibration_json,
      zones_json = excluded.zones_json,
      active = excluded.active
  `).run(
    cam.id,
    cam.name,
    cam.location,
    cam.sourceType,
    cam.sourceUri,
    cam.speedLimitKmh,
    cam.permittedDirection,
    isCal,
    JSON.stringify({ ...cam.calibration, isCalibrated: Boolean(isCal) }),
    JSON.stringify(cam.zones),
    cam.active ? 1 : 0,
    now
  );
  return getCameraById(cam.id)!;
}

export function deleteCamera(id: string): boolean {
  const res = db.prepare('DELETE FROM camera_configurations WHERE id = ?').run(id);
  return res.changes > 0;
}

export interface IngestBatchPayload {
  cameraId: string;
  sessionId: string;
  vehicles?: Array<{
    trackId: number;
    vehicleClass: string;
    confidence: number;
    firstSeen: string;
    lastSeen: string;
    direction: string;
    avgSpeedKmh: number | null;
    maxSpeedKmh: number | null;
    plateNumber: string | null;
    trajectory?: Array<{ x: number; y: number; t: number }>;
    enteredLine?: boolean;
    exitedLine?: boolean;
  }>;
  violations?: Array<{
    trackId: number;
    vehicleClass: string;
    violationType: ViolationType;
    confidence: number;
    speedKmh: number | null;
    plateNumber: string | null;
    verificationStatus: VerificationStatus;
    notes?: string | null;
    timestamp: string;
    evidencePaths?: {
      fullFramePath?: string | null;
      vehicleCropPath?: string | null;
      plateCropPath?: string | null;
      metadata?: Record<string, unknown>;
    };
  }>;
  plates?: Array<{
    trackId: number;
    rawText: string;
    normalizedPlate: string | null;
    isValidIndianFormat: boolean;
    ocrConfidence: number;
    plateImagePath?: string | null;
    timestamp: string;
  }>;
  statsBucket?: {
    bucketTimestamp: string;
    totalVehicles: number;
    cars: number;
    motorcycles: number;
    buses: number;
    trucks: number;
    bicycles: number;
    otherVehicles: number;
    inboundCount: number;
    outboundCount: number;
    avgSpeedKmh: number | null;
    densityPer100m: number;
    congestionLevel: CongestionLevel;
    riskScore: number;
  };
}

export function ingestBatch(payload: IngestBatchPayload): {
  vehiclesSaved: number;
  violationsSaved: number;
  platesSaved: number;
} {
  let vehiclesSaved = 0;
  let violationsSaved = 0;
  let platesSaved = 0;

  const upsertVehicle = db.prepare(`
    INSERT INTO vehicles (
      camera_id, track_id, vehicle_class, confidence, first_seen, last_seen,
      direction, avg_speed_kmh, max_speed_kmh, plate_number, session_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(camera_id, track_id, session_id) DO UPDATE SET
      confidence = MAX(vehicles.confidence, excluded.confidence),
      last_seen = excluded.last_seen,
      direction = CASE WHEN excluded.direction != 'unknown' THEN excluded.direction ELSE vehicles.direction END,
      avg_speed_kmh = COALESCE(excluded.avg_speed_kmh, vehicles.avg_speed_kmh),
      max_speed_kmh = CASE
        WHEN excluded.max_speed_kmh IS NOT NULL AND (vehicles.max_speed_kmh IS NULL OR excluded.max_speed_kmh > vehicles.max_speed_kmh)
        THEN excluded.max_speed_kmh
        ELSE vehicles.max_speed_kmh
      END,
      plate_number = COALESCE(excluded.plate_number, vehicles.plate_number)
  `);

  const upsertTrack = db.prepare(`
    INSERT INTO vehicle_tracks (
      camera_id, track_id, session_id, points_json, direction, entered_line, exited_line, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(camera_id, track_id, session_id) DO UPDATE SET
      points_json = excluded.points_json,
      direction = excluded.direction,
      entered_line = MAX(vehicle_tracks.entered_line, excluded.entered_line),
      exited_line = MAX(vehicle_tracks.exited_line, excluded.exited_line)
  `);

  const insertEvidence = db.prepare(`
    INSERT INTO evidence_records (
      camera_id, track_id, violation_type, full_frame_path, vehicle_crop_path,
      plate_crop_path, metadata_json, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertViolation = db.prepare(`
    INSERT OR IGNORE INTO violations (
      camera_id, track_id, session_id, vehicle_class, violation_type, confidence,
      speed_kmh, plate_number, verification_status, notes, timestamp, evidence_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertPlate = db.prepare(`
    INSERT INTO number_plates (
      camera_id, track_id, raw_text, normalized_plate, is_valid_indian_format,
      ocr_confidence, corrected_plate, plate_image_path, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `);

  const insertStat = db.prepare(`
    INSERT INTO traffic_statistics (
      camera_id, bucket_timestamp, total_vehicles, cars, motorcycles, buses, trucks,
      bicycles, other_vehicles, inbound_count, outbound_count, avg_speed_kmh,
      density_per_100m, congestion_level, risk_score
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    if (payload.vehicles) {
      for (const v of payload.vehicles) {
        upsertVehicle.run(
          payload.cameraId,
          v.trackId,
          v.vehicleClass,
          v.confidence,
          v.firstSeen,
          v.lastSeen,
          v.direction,
          v.avgSpeedKmh,
          v.maxSpeedKmh,
          v.plateNumber,
          payload.sessionId
        );
        vehiclesSaved++;

        if (v.trajectory && v.trajectory.length > 0) {
          upsertTrack.run(
            payload.cameraId,
            v.trackId,
            payload.sessionId,
            JSON.stringify(v.trajectory.slice(-120)),
            v.direction,
            v.enteredLine ? 1 : 0,
            v.exitedLine ? 1 : 0,
            v.lastSeen
          );
        }
      }
    }

    if (payload.violations) {
      for (const viol of payload.violations) {
        let evidenceId: number | null = null;
        if (viol.evidencePaths) {
          const evRes = insertEvidence.run(
            payload.cameraId,
            viol.trackId,
            viol.violationType,
            viol.evidencePaths.fullFramePath ?? null,
            viol.evidencePaths.vehicleCropPath ?? null,
            viol.evidencePaths.plateCropPath ?? null,
            JSON.stringify(viol.evidencePaths.metadata ?? {}),
            viol.timestamp
          );
          evidenceId = Number(evRes.lastInsertRowid);
        }
        const vRes = insertViolation.run(
          payload.cameraId,
          viol.trackId,
          payload.sessionId,
          viol.vehicleClass,
          viol.violationType,
          viol.confidence,
          viol.speedKmh,
          viol.plateNumber,
          viol.verificationStatus,
          viol.notes ?? null,
          viol.timestamp,
          evidenceId
        );
        if (vRes.changes > 0) {
          violationsSaved++;
        }
      }
    }

    if (payload.plates) {
      for (const p of payload.plates) {
        insertPlate.run(
          payload.cameraId,
          p.trackId,
          p.rawText,
          p.normalizedPlate,
          p.isValidIndianFormat ? 1 : 0,
          p.ocrConfidence,
          p.plateImagePath ?? null,
          p.timestamp
        );
        platesSaved++;
      }
    }

    if (payload.statsBucket) {
      const s = payload.statsBucket;
      insertStat.run(
        payload.cameraId,
        s.bucketTimestamp,
        s.totalVehicles,
        s.cars,
        s.motorcycles,
        s.buses,
        s.trucks,
        s.bicycles,
        s.otherVehicles,
        s.inboundCount,
        s.outboundCount,
        s.avgSpeedKmh,
        s.densityPer100m,
        s.congestionLevel,
        s.riskScore
      );
    }
  });

  tx();
  return { vehiclesSaved, violationsSaved, platesSaved };
}

function toEvidenceUrl(filePath: unknown): string | null {
  if (!filePath || typeof filePath !== 'string') return null;
  const base = path.basename(filePath);
  return `/api/evidence/file/${encodeURIComponent(base)}`;
}

export function getVehicles(filters?: {
  cameraId?: string;
  vehicleClass?: string;
  limit?: number;
}): VehicleRecord[] {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters?.cameraId && filters.cameraId !== 'all') {
    clauses.push('camera_id = ?');
    params.push(filters.cameraId);
  }
  if (filters?.vehicleClass && filters.vehicleClass !== 'all') {
    clauses.push('vehicle_class = ?');
    params.push(filters.vehicleClass);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(Math.max(filters?.limit ?? 200, 1), 1000);
  params.push(limit);

  const rows = db
    .prepare(`SELECT * FROM vehicles ${where} ORDER BY last_seen DESC LIMIT ?`)
    .all(...params) as Record<string, unknown>[];

  return rows.map((r) => ({
    id: Number(r.id),
    cameraId: String(r.camera_id),
    trackId: Number(r.track_id),
    vehicleClass: r.vehicle_class as VehicleRecord['vehicleClass'],
    confidence: Number(r.confidence),
    firstSeen: String(r.first_seen),
    lastSeen: String(r.last_seen),
    direction: r.direction as VehicleRecord['direction'],
    avgSpeedKmh: r.avg_speed_kmh === null ? null : Number(r.avg_speed_kmh),
    maxSpeedKmh: r.max_speed_kmh === null ? null : Number(r.max_speed_kmh),
    plateNumber: r.plate_number ? String(r.plate_number) : null,
    sessionId: String(r.session_id),
  }));
}

export function getTracks(cameraId?: string, limit = 150): Array<{
  id: number;
  cameraId: string;
  trackId: number;
  sessionId: string;
  points: Array<{ x: number; y: number; t: number }>;
  direction: string;
  enteredLine: boolean;
  exitedLine: boolean;
  createdAt: string;
}> {
  const hasCam = Boolean(cameraId && cameraId !== 'all');
  const rows = hasCam
    ? (db
        .prepare('SELECT * FROM vehicle_tracks WHERE camera_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(cameraId, limit) as Record<string, unknown>[])
    : (db
        .prepare('SELECT * FROM vehicle_tracks ORDER BY created_at DESC LIMIT ?')
        .all(limit) as Record<string, unknown>[]);

  return rows.map((r) => ({
    id: Number(r.id),
    cameraId: String(r.camera_id),
    trackId: Number(r.track_id),
    sessionId: String(r.session_id),
    points: JSON.parse(String(r.points_json || '[]')),
    direction: String(r.direction),
    enteredLine: Boolean(r.entered_line),
    exitedLine: Boolean(r.exited_line),
    createdAt: String(r.created_at),
  }));
}

export function getViolations(filters?: {
  cameraId?: string;
  violationType?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}): ViolationRecord[] {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters?.cameraId && filters.cameraId !== 'all') {
    clauses.push('v.camera_id = ?');
    params.push(filters.cameraId);
  }
  if (filters?.violationType && filters.violationType !== 'all') {
    clauses.push('v.violation_type = ?');
    params.push(filters.violationType);
  }
  if (filters?.status && filters.status !== 'all') {
    clauses.push('v.verification_status = ?');
    params.push(filters.status);
  }
  if (filters?.dateFrom) {
    clauses.push('v.timestamp >= ?');
    params.push(filters.dateFrom);
  }
  if (filters?.dateTo) {
    clauses.push('v.timestamp <= ?');
    params.push(filters.dateTo);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(Math.max(filters?.limit ?? 200, 1), 1000);
  params.push(limit);

  const rows = db
    .prepare(`
      SELECT v.*, c.name as camera_name,
             e.full_frame_path, e.vehicle_crop_path, e.plate_crop_path
      FROM violations v
      LEFT JOIN camera_configurations c ON c.id = v.camera_id
      LEFT JOIN evidence_records e ON e.id = v.evidence_id
      ${where}
      ORDER BY v.timestamp DESC
      LIMIT ?
    `)
    .all(...params) as Record<string, unknown>[];

  return rows.map((r) => ({
    id: Number(r.id),
    cameraId: String(r.camera_id),
    cameraName: r.camera_name ? String(r.camera_name) : String(r.camera_id),
    trackId: Number(r.track_id),
    vehicleClass: r.vehicle_class as ViolationRecord['vehicleClass'],
    violationType: r.violation_type as ViolationType,
    confidence: Number(r.confidence),
    speedKmh: r.speed_kmh === null ? null : Number(r.speed_kmh),
    plateNumber: r.plate_number ? String(r.plate_number) : null,
    verificationStatus: r.verification_status as VerificationStatus,
    notes: r.notes ? String(r.notes) : null,
    timestamp: String(r.timestamp),
    evidenceId: r.evidence_id === null ? null : Number(r.evidence_id),
    fullFrameUrl: toEvidenceUrl(r.full_frame_path),
    vehicleCropUrl: toEvidenceUrl(r.vehicle_crop_path),
    plateCropUrl: toEvidenceUrl(r.plate_crop_path),
  }));
}

export function updateViolationStatus(
  id: number,
  status: VerificationStatus,
  notes?: string | null
): boolean {
  const res = db
    .prepare('UPDATE violations SET verification_status = ?, notes = COALESCE(?, notes) WHERE id = ?')
    .run(status, notes ?? null, id);
  return res.changes > 0;
}

export function getNumberPlates(cameraId?: string, limit = 200): NumberPlateRecord[] {
  const hasCam = Boolean(cameraId && cameraId !== 'all');
  const rows = hasCam
    ? (db
        .prepare('SELECT * FROM number_plates WHERE camera_id = ? ORDER BY timestamp DESC LIMIT ?')
        .all(cameraId, limit) as Record<string, unknown>[])
    : (db
        .prepare('SELECT * FROM number_plates ORDER BY timestamp DESC LIMIT ?')
        .all(limit) as Record<string, unknown>[]);

  return rows.map((r) => ({
    id: Number(r.id),
    cameraId: String(r.camera_id),
    trackId: Number(r.track_id),
    rawText: String(r.raw_text),
    normalizedPlate: r.normalized_plate ? String(r.normalized_plate) : null,
    isValidIndianFormat: Boolean(r.is_valid_indian_format),
    ocrConfidence: Number(r.ocr_confidence),
    correctedPlate: r.corrected_plate ? String(r.corrected_plate) : null,
    plateImageUrl: toEvidenceUrl(r.plate_image_path),
    timestamp: String(r.timestamp),
  }));
}

export function correctNumberPlate(id: number, correctedPlate: string): boolean {
  const cleaned = correctedPlate.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const indianRegex = /^([A-Z]{2}[0-9]{2}[A-Z]{1,3}[0-9]{4}|[0-9]{2}BH[0-9]{4}[A-Z]{1,2})$/;
  const isValid = indianRegex.test(cleaned) ? 1 : 0;
  const plateRow = db
    .prepare('SELECT camera_id, track_id FROM number_plates WHERE id = ?')
    .get(id) as { camera_id: string; track_id: number } | undefined;

  if (!plateRow) return false;

  const tx = db.transaction(() => {
    db.prepare(
      'UPDATE number_plates SET corrected_plate = ?, normalized_plate = ?, is_valid_indian_format = ? WHERE id = ?'
    ).run(cleaned, cleaned, isValid, id);

    // Propagate corrected plate to linked vehicle & violation records
    db.prepare('UPDATE vehicles SET plate_number = ? WHERE camera_id = ? AND track_id = ?').run(
      cleaned,
      plateRow.camera_id,
      plateRow.track_id
    );
    db.prepare('UPDATE violations SET plate_number = ? WHERE camera_id = ? AND track_id = ?').run(
      cleaned,
      plateRow.camera_id,
      plateRow.track_id
    );
  });
  tx();
  return true;
}

export function getEvidenceRecords(cameraId?: string, limit = 100): EvidenceRecord[] {
  const hasCam = Boolean(cameraId && cameraId !== 'all');
  const rows = hasCam
    ? (db
        .prepare('SELECT * FROM evidence_records WHERE camera_id = ? ORDER BY timestamp DESC LIMIT ?')
        .all(cameraId, limit) as Record<string, unknown>[])
    : (db
        .prepare('SELECT * FROM evidence_records ORDER BY timestamp DESC LIMIT ?')
        .all(limit) as Record<string, unknown>[]);

  return rows.map((r) => ({
    id: Number(r.id),
    cameraId: String(r.camera_id),
    trackId: Number(r.track_id),
    violationType: r.violation_type as ViolationType,
    fullFrameUrl: toEvidenceUrl(r.full_frame_path),
    vehicleCropUrl: toEvidenceUrl(r.vehicle_crop_path),
    plateCropUrl: toEvidenceUrl(r.plate_crop_path),
    metadata: JSON.parse(String(r.metadata_json || '{}')),
    timestamp: String(r.timestamp),
  }));
}

export function getDashboardSummary(cameraId?: string): DashboardSummary {
  const hasCam = Boolean(cameraId && cameraId !== 'all');
  const camWhere = hasCam ? 'WHERE camera_id = ?' : '';
  const camParam = hasCam ? [cameraId] : [];

  const totalVehicles = Number(
    (
      db
        .prepare(`SELECT COUNT(*) as c FROM vehicles ${camWhere}`)
        .get(...camParam) as { c: number }
    ).c
  );

  // Active vehicles seen in the last 60 seconds
  const oneMinAgo = new Date(Date.now() - 60_000).toISOString();
  const activeVehicles = Number(
    (
      (hasCam
        ? db
            .prepare('SELECT COUNT(*) as c FROM vehicles WHERE camera_id = ? AND last_seen >= ?')
            .get(cameraId, oneMinAgo)
        : db
            .prepare('SELECT COUNT(*) as c FROM vehicles WHERE last_seen >= ?')
            .get(oneMinAgo)) as { c: number }
    ).c
  );

  const violCounts = db
    .prepare(
      `SELECT violation_type, COUNT(*) as c FROM violations ${
        hasCam ? "WHERE camera_id = ? AND verification_status != 'dismissed'" : "WHERE verification_status != 'dismissed'"
      } GROUP BY violation_type`
    )
    .all(...camParam) as Array<{ violation_type: ViolationType; c: number }>;

  let totalViolations = 0;
  let overspeedingCases = 0;
  let noHelmetCases = 0;
  let wrongWayCases = 0;
  for (const row of violCounts) {
    totalViolations += Number(row.c);
    if (row.violation_type === 'overspeeding') overspeedingCases = Number(row.c);
    if (row.violation_type === 'no_helmet') noHelmetCases = Number(row.c);
    if (row.violation_type === 'wrong_way') wrongWayCases = Number(row.c);
  }

  const avgSpeedRow = db
    .prepare(
      `SELECT AVG(avg_speed_kmh) as avg_s FROM vehicles ${
        hasCam ? 'WHERE camera_id = ? AND avg_speed_kmh IS NOT NULL' : 'WHERE avg_speed_kmh IS NOT NULL'
      }`
    )
    .get(...camParam) as { avg_s: number | null };

  const averageSpeedKmh =
    avgSpeedRow.avg_s === null || avgSpeedRow.avg_s === undefined
      ? null
      : Math.round(Number(avgSpeedRow.avg_s) * 10) / 10;

  const latestStat = db
    .prepare(
      `SELECT density_per_100m, congestion_level, risk_score FROM traffic_statistics ${camWhere} ORDER BY bucket_timestamp DESC LIMIT 1`
    )
    .get(...camParam) as
    | { density_per_100m: number; congestion_level: CongestionLevel; risk_score: number }
    | undefined;

  const vehicleRows = db
    .prepare(`SELECT vehicle_class, COUNT(*) as c FROM vehicles ${camWhere} GROUP BY vehicle_class`)
    .all(...camParam) as Array<{ vehicle_class: string; c: number }>;

  const dirRows = db
    .prepare(`
      SELECT c.name as camera_name,
             SUM(CASE WHEN v.direction = 'inbound' THEN 1 ELSE 0 END) as inbound,
             SUM(CASE WHEN v.direction = 'outbound' THEN 1 ELSE 0 END) as outbound
      FROM camera_configurations c
      LEFT JOIN vehicles v ON v.camera_id = c.id
      ${hasCam ? 'WHERE c.id = ?' : ''}
      GROUP BY c.id
    `)
    .all(...camParam) as Array<{ camera_name: string; inbound: number; outbound: number }>;

  // Observed traffic flow series + short-horizon linear trend forecast
  const statRows = db
    .prepare(
      `SELECT bucket_timestamp, total_vehicles, avg_speed_kmh, density_per_100m
       FROM traffic_statistics ${camWhere}
       ORDER BY bucket_timestamp DESC LIMIT 20`
    )
    .all(...camParam)
    .reverse() as Array<{
    bucket_timestamp: string;
    total_vehicles: number;
    avg_speed_kmh: number | null;
    density_per_100m: number;
  }>;

  const trafficFlowSeries: DashboardSummary['trafficFlowSeries'] = statRows.map((s) => {
    const dt = new Date(s.bucket_timestamp);
    const label = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}:${String(dt.getSeconds()).padStart(2, '0')}`;
    return {
      label,
      observed: Number(s.total_vehicles),
      forecast: null,
      avgSpeedKmh: s.avg_speed_kmh === null ? null : Math.round(Number(s.avg_speed_kmh) * 10) / 10,
      density: Math.round(Number(s.density_per_100m) * 10) / 10,
    };
  });

  // Compute simple linear trend forecast for next 4 intervals strictly when >= 3 observed buckets exist
  if (statRows.length >= 3) {
    const n = statRows.length;
    const ys = statRows.map((r) => Number(r.total_vehicles));
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += ys[i];
      sumXY += i * ys[i];
      sumXX += i * i;
    }
    const denom = n * sumXX - sumX * sumX;
    const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
    const intercept = (sumY - slope * sumX) / n;

    // Anchor forecast at last observed point so the dashed line connects smoothly
    trafficFlowSeries[trafficFlowSeries.length - 1].forecast = ys[n - 1];
    for (let k = 1; k <= 4; k++) {
      const predicted = Math.max(0, Math.round(intercept + slope * (n - 1 + k)));
      trafficFlowSeries.push({
        label: `+${k}T (Est)`,
        observed: null,
        forecast: predicted,
        avgSpeedKmh: null,
        density: 0,
      });
    }
  }

  // Multi-violation vehicles (vehicles with >= 2 non-dismissed violations)
  const multiRows = db
    .prepare(`
      SELECT camera_id, track_id, vehicle_class, MAX(plate_number) as plate_number,
             COUNT(*) as violation_count, GROUP_CONCAT(violation_type, ',') as types
      FROM violations
      ${hasCam ? "WHERE camera_id = ? AND verification_status != 'dismissed'" : "WHERE verification_status != 'dismissed'"}
      GROUP BY camera_id, track_id
      HAVING COUNT(*) >= 2
      ORDER BY violation_count DESC
      LIMIT 20
    `)
    .all(...camParam) as Array<{
    camera_id: string;
    track_id: number;
    vehicle_class: string;
    plate_number: string | null;
    violation_count: number;
    types: string;
  }>;

  const recentViolations = getViolations({ cameraId, limit: 15 });

  return {
    kpis: {
      totalVehicles,
      activeVehicles,
      totalViolations,
      overspeedingCases,
      noHelmetCases,
      wrongWayCases,
      averageSpeedKmh,
      trafficDensity: latestStat ? Math.round(latestStat.density_per_100m * 10) / 10 : 0,
      congestionLevel: latestStat ? latestStat.congestion_level : 'LOW',
      riskScore: latestStat ? Math.round(latestStat.risk_score) : 0,
    },
    vehicleCountsByType: vehicleRows.map((r) => ({
      category: r.vehicle_class,
      count: Number(r.c),
    })),
    violationsByType: violCounts.map((r) => ({
      type: r.violation_type,
      label: VIOLATION_LABELS[r.violation_type] ?? r.violation_type,
      count: Number(r.c),
    })),
    directionalCounts: dirRows.map((r) => ({
      cameraName: r.camera_name.split('—')[0].trim(),
      inbound: Number(r.inbound ?? 0),
      outbound: Number(r.outbound ?? 0),
    })),
    trafficFlowSeries,
    recentViolations,
    multiViolationVehicles: multiRows.map((r) => ({
      cameraId: r.camera_id,
      trackId: Number(r.track_id),
      vehicleClass: r.vehicle_class,
      plateNumber: r.plate_number,
      violationCount: Number(r.violation_count),
      types: r.types ? r.types.split(',') : [],
    })),
  };
}

export function clearTelemetryData(): void {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM violations').run();
    db.prepare('DELETE FROM evidence_records').run();
    db.prepare('DELETE FROM number_plates').run();
    db.prepare('DELETE FROM vehicle_tracks').run();
    db.prepare('DELETE FROM vehicles').run();
    db.prepare('DELETE FROM traffic_statistics').run();
  });
  tx();
}
