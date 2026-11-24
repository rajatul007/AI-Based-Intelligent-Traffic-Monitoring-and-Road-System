export type VehicleCategory =
  | 'car'
  | 'motorcycle'
  | 'bus'
  | 'truck'
  | 'auto_rickshaw'
  | 'bicycle'
  | 'other';

export type TrafficDirection = 'inbound' | 'outbound' | 'unknown';

export type RoadFlowMode =
  | 'two_way_auto'
  | 'two_way_left_down_right_up'
  | 'two_way_left_up_right_down'
  | 'one_way_down'
  | 'one_way_up'
  | 'one_way_right'
  | 'one_way_left';

export type SignalState = 'red' | 'yellow' | 'green' | 'unknown';

export type CongestionLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE';

export type VerificationStatus = 'verified' | 'requires_review' | 'dismissed';

export type ViolationType =
  | 'no_helmet'
  | 'wrong_way'
  | 'overspeeding'
  | 'red_light_jumping'
  | 'triple_riding'
  | 'lane_violation'
  | 'stop_line_violation'
  | 'no_entry'
  | 'seat_belt'
  | 'mobile_phone_usage'
  | 'illegal_parking'
  | 'zebra_crossing_blocking'
  | 'dangerous_movement'
  | 'restricted_zone';

export interface NormalizedPoint {
  x: number; // 0..1 normalized to frame width
  y: number; // 0..1 normalized to frame height
}

export interface CalibrationConfig {
  isCalibrated: boolean;
  /** 4 corners in normalized image space: TL, TR, BR, BL mapping to a real-world rectangle */
  imagePoints: [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint];
  /** Real-world width across lanes (meters) */
  realWidthMeters: number;
  /** Real-world length along road direction (meters) */
  realLengthMeters: number;
}

export interface CameraZones {
  countingLine: [NormalizedPoint, NormalizedPoint];
  stopLine: [NormalizedPoint, NormalizedPoint];
  laneDividerLine: [NormalizedPoint, NormalizedPoint];
  restrictedPolygon: NormalizedPoint[];
  zebraPolygon: NormalizedPoint[];
  noParkingPolygon: NormalizedPoint[];
  signalRoi: { x: number; y: number; w: number; h: number };
  /** Permitted travel angle in degrees (0 = right, 90 = down, 180 = left, 270 = up) */
  permittedDirectionDeg: number;
  /** Road layout mode for wrong-side detection (defaults to smart two_way_auto) */
  roadMode?: RoadFlowMode;
  /** Normalized X coordinate (0.15..0.85) of the road median divider for two-way roads */
  dividerX?: number;
  /** Stationary dwell seconds to flag illegal parking */
  illegalParkingDwellSec: number;
  /** Stationary dwell seconds to flag zebra crossing blocking */
  zebraBlockDwellSec: number;
}

export interface CameraConfiguration {
  id: string;
  name: string;
  location: string;
  sourceType: 'webcam' | 'usb' | 'ip_http' | 'rtsp' | 'video_file';
  sourceUri: string;
  speedLimitKmh: number;
  permittedDirection: string;
  isCalibrated: boolean;
  calibration: CalibrationConfig;
  zones: CameraZones;
  active: boolean;
  createdAt: string;
}

export interface RawDetection {
  bbox: [number, number, number, number]; // [x, y, width, height] in pixels
  rawClass: string;
  category: VehicleCategory | 'person' | 'traffic_light';
  confidence: number;
}

export interface TrajectoryPoint {
  x: number; // normalized 0..1
  y: number; // normalized 0..1
  t: number; // epoch ms
}

export interface TrackedVehicle {
  trackId: number;
  category: VehicleCategory;
  confidence: number;
  bbox: [number, number, number, number]; // pixel [x, y, w, h]
  centroid: { x: number; y: number }; // normalized 0..1
  velocity: { vx: number; vy: number }; // normalized units/sec
  trajectory: TrajectoryPoint[];
  direction: TrafficDirection;
  speedKmh: number | null; // strictly null when uncalibrated
  speedSamples: number[];
  plateNumber: string | null;
  plateConfidence: number | null;
  helmetStatus: 'helmet_present' | 'helmet_absent' | 'uncertain' | 'not_applicable';
  riderCount: number;
  countedEntry: boolean;
  countedExit: boolean;
  firstSeenMs: number;
  lastSeenMs: number;
  missedFrames: number;
  hits: number;
  stationarySinceMs: number | null;
  violations: ViolationType[];
  aiInspected: boolean;
}

export interface ViolationRecord {
  id: number;
  cameraId: string;
  cameraName?: string;
  trackId: number;
  vehicleClass: VehicleCategory;
  violationType: ViolationType;
  confidence: number;
  speedKmh: number | null;
  plateNumber: string | null;
  verificationStatus: VerificationStatus;
  notes: string | null;
  timestamp: string;
  evidenceId: number | null;
  fullFrameUrl?: string | null;
  vehicleCropUrl?: string | null;
  plateCropUrl?: string | null;
}

export interface NumberPlateRecord {
  id: number;
  cameraId: string;
  trackId: number;
  rawText: string;
  normalizedPlate: string | null;
  isValidIndianFormat: boolean;
  ocrConfidence: number;
  correctedPlate: string | null;
  plateImageUrl: string | null;
  timestamp: string;
}

export interface VehicleRecord {
  id: number;
  cameraId: string;
  trackId: number;
  vehicleClass: VehicleCategory;
  confidence: number;
  firstSeen: string;
  lastSeen: string;
  direction: TrafficDirection;
  avgSpeedKmh: number | null;
  maxSpeedKmh: number | null;
  plateNumber: string | null;
  sessionId: string;
}

export interface EvidenceRecord {
  id: number;
  cameraId: string;
  trackId: number;
  violationType: ViolationType;
  fullFrameUrl: string | null;
  vehicleCropUrl: string | null;
  plateCropUrl: string | null;
  metadata: Record<string, unknown>;
  timestamp: string;
}

export interface TrafficStatBucket {
  id?: number;
  cameraId: string;
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
  isForecast?: boolean;
}

export interface DashboardSummary {
  kpis: {
    totalVehicles: number;
    activeVehicles: number;
    totalViolations: number;
    overspeedingCases: number;
    noHelmetCases: number;
    wrongWayCases: number;
    averageSpeedKmh: number | null;
    trafficDensity: number;
    congestionLevel: CongestionLevel;
    riskScore: number;
  };
  vehicleCountsByType: Array<{ category: string; count: number }>;
  violationsByType: Array<{ type: ViolationType; label: string; count: number }>;
  directionalCounts: Array<{ cameraName: string; inbound: number; outbound: number }>;
  trafficFlowSeries: Array<{
    label: string;
    observed: number | null;
    forecast: number | null;
    avgSpeedKmh: number | null;
    density: number;
  }>;
  recentViolations: ViolationRecord[];
  multiViolationVehicles: Array<{
    cameraId: string;
    trackId: number;
    vehicleClass: string;
    plateNumber: string | null;
    violationCount: number;
    types: string[];
  }>;
}

export interface AiModelSettings {
  confidenceThreshold: number;
  inferenceIntervalMs: number;
  enableTrajectoryOverlay: boolean;
  enableHeatmapOverlay: boolean;
  enableZonesOverlay: boolean;
  enableAutoGeminiVerification: boolean;
  enableMultiTileBoost?: boolean;
  enabledClasses: VehicleCategory[];
  congestionThresholds: {
    moderateDensity: number;
    highDensity: number;
    severeDensity: number;
  };
}

export interface VisionVerificationResult {
  plateText: string | null;
  normalizedPlate: string | null;
  isValidIndianFormat: boolean;
  ocrConfidence: number;
  helmetStatus: 'helmet_present' | 'helmet_absent' | 'uncertain' | 'not_applicable';
  riderCount: number | null;
  tripleRidingStatus: 'detected' | 'not_detected' | 'uncertain' | 'not_applicable';
  seatBeltStatus: 'present' | 'absent' | 'uncertain' | 'not_applicable';
  mobileUsageStatus: 'detected' | 'not_detected' | 'uncertain' | 'not_applicable';
  signalState: SignalState;
  vehicleSubType: string | null;
  evidenceSummary: string;
}

export interface TrafficRecommendation {
  category: 'congestion_hotspot' | 'peak_management' | 'signal_timing_advisory' | 'monitoring_priority';
  priority: 'high' | 'medium' | 'low';
  title: string;
  rationale: string;
  suggestedAction: string;
  advisoryModeNote: string;
}

export const VIOLATION_LABELS: Record<ViolationType, string> = {
  no_helmet: 'No Helmet',
  wrong_way: 'Wrong-Side Driving',
  overspeeding: 'Overspeeding',
  red_light_jumping: 'Red-Light Jumping',
  triple_riding: 'Triple Riding',
  lane_violation: 'Lane Violation',
  stop_line_violation: 'Stop-Line Violation',
  no_entry: 'No-Entry Violation',
  seat_belt: 'Seat Belt Absent',
  mobile_phone_usage: 'Mobile Phone Usage',
  illegal_parking: 'Illegal Parking',
  zebra_crossing_blocking: 'Zebra Crossing Blocking',
  dangerous_movement: 'Dangerous Movement',
  restricted_zone: 'Restricted Zone Entry',
};

export const VIOLATION_DETECTION_METHOD: Record<
  ViolationType,
  { engine: string; reliability: string; notes: string }
> = {
  overspeeding: {
    engine: 'Homography Calibration + Timestamp Tracking',
    reliability: 'High (when calibrated)',
    notes: 'Requires 4-point road calibration. Disabled when camera is uncalibrated.',
  },
  wrong_way: {
    engine: 'ByteTrack Trajectory Vector Analysis',
    reliability: 'High',
    notes: 'Compares vehicle displacement vector against configured permitted road direction.',
  },
  red_light_jumping: {
    engine: 'Signal ROI HSV Classifier + Stop-Line Crossing',
    reliability: 'High (when signal visible)',
    notes: 'Triggers only when traffic light ROI reads Red and vehicle crosses stop line.',
  },
  stop_line_violation: {
    engine: 'Signal ROI + Stop-Line Spatial Band',
    reliability: 'High',
    notes: 'Detects vehicles halting over the configured stop-line zone during red phase.',
  },
  no_entry: {
    engine: 'Polygon Zone Intrusion',
    reliability: 'High',
    notes: 'Point-in-polygon detection on operator-configured No-Entry region.',
  },
  restricted_zone: {
    engine: 'Polygon Zone Intrusion',
    reliability: 'High',
    notes: 'Flags vehicles entering bus-only, pedestrian, or restricted camera polygons.',
  },
  zebra_crossing_blocking: {
    engine: 'Zebra Polygon Dwell-Time Tracker',
    reliability: 'High',
    notes: 'Flags stationary vehicles occupying the crosswalk longer than configured threshold.',
  },
  illegal_parking: {
    engine: 'No-Parking Polygon Dwell-Time Tracker',
    reliability: 'High',
    notes: 'Flags vehicles remaining stationary inside no-parking zone beyond dwell threshold.',
  },
  lane_violation: {
    engine: 'Lane Divider Line Crossing Analysis',
    reliability: 'Moderate-High',
    notes: 'Detects abrupt crossings over configured solid lane divider geometry.',
  },
  dangerous_movement: {
    engine: 'Trajectory Curvature & Lateral Velocity',
    reliability: 'Moderate (Review Recommended)',
    notes: 'Flags erratic multi-lane swerving; marked requires_review for operator confirmation.',
  },
  no_helmet: {
    engine: 'Motorcycle/Rider Association + Gemini Vision Inspection',
    reliability: 'Vision-Verified (Uncertain -> Review)',
    notes: 'Requires clear upper-body rider visibility; blurry crops are marked uncertain/review.',
  },
  triple_riding: {
    engine: 'Motorcycle/Person Overlap + Gemini Vision Count',
    reliability: 'Vision-Verified (Uncertain -> Review)',
    notes: 'Flags motorcycles carrying 3 or more riders; occluded views route to human review.',
  },
  seat_belt: {
    engine: 'Cabin Crop Gemini Vision Inspection',
    reliability: 'Requires Front-Facing High-Res View',
    notes: 'Marked requires_review unless clear windshield visibility confirms absent belt.',
  },
  mobile_phone_usage: {
    engine: 'Driver Crop Gemini Vision Inspection',
    reliability: 'Requires Front-Facing High-Res View',
    notes: 'Marked requires_review unless clear driver-side evidence confirms handheld phone use.',
  },
};
