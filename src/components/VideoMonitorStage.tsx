import {
  AlertTriangle,
  Bike,
  Bus,
  Camera,
  Car,
  CheckCircle2,
  Download,
  Eye,
  FileVideo,
  Pause,
  Play,
  RefreshCw,
  ScanText,
  ShieldAlert,
  Square,
  Truck,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { renderTrafficOverlays } from '../cv/canvasRenderer';
import { trafficDetector } from '../cv/detector';
import { classifyTrafficSignalFromCanvas } from '../cv/signalAndRoad';
import { ByteTrackVehicleTracker } from '../cv/tracker';
import {
  captureEvidenceCrops,
  computeCongestionAndRisk,
  type DetectedViolationEvent,
  TrafficViolationEngine,
} from '../cv/violationEngine';
import type {
  AiModelSettings,
  CameraConfiguration,
  CongestionLevel,
  RoadFlowMode,
  SignalState,
  TrackedVehicle,
  VehicleCategory,
  VisionVerificationResult,
} from '../types/traffic';
import { VIOLATION_LABELS } from '../types/traffic';
import { api } from '../utils/api';

interface VideoMonitorStageProps {
  mode: 'live' | 'upload';
  camera: CameraConfiguration;
  settings: AiModelSettings;
  onUpdateSettings: (patch: Partial<AiModelSettings>) => void;
  onTelemetrySaved: () => void;
  onLiveActiveChange?: (active: boolean) => void;
}

interface SessionViolationCard extends DetectedViolationEvent {
  cropDataUrl?: string;
}

interface LiveStats {
  fps: number;
  activeCount: number;
  uniqueTotal: number;
  byClass: Record<VehicleCategory, number>;
  crossedByClass: Record<VehicleCategory, number>;
  inbound: number;
  outbound: number;
  avgSpeedKmh: number | null;
  signalState: SignalState;
  densityPer100m: number;
  congestionLevel: CongestionLevel;
  riskScore: number;
  progressPct: number;
}

const EMPTY_COUNTS: Record<VehicleCategory, number> = {
  car: 0,
  motorcycle: 0,
  bus: 0,
  truck: 0,
  auto_rickshaw: 0,
  bicycle: 0,
  other: 0,
};

export function VideoMonitorStage({
  mode,
  camera,
  settings,
  onUpdateSettings,
  onTelemetrySaved,
  onLiveActiveChange,
}: VideoMonitorStageProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hiddenCaptureCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const trackerRef = useRef<ByteTrackVehicleTracker>(new ByteTrackVehicleTracker());
  const violationEngineRef = useRef<TrafficViolationEngine>(new TrafficViolationEngine());
  const heatmapPointsRef = useRef<Array<{ x: number; y: number; weight: number }>>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const rafRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const pausedRef = useRef(false);
  const lastInferenceRef = useRef(0);
  const lastSyncRef = useRef(0);
  const pendingViolationsRef = useRef<
    Array<
      DetectedViolationEvent & {
        evidenceBase64?: {
          fullFrame: string;
          vehicleCrop: string;
          plateCrop: string;
          metadata: Record<string, unknown>;
        };
      }
    >
  >([]);
  const pendingPlatesRef = useRef<
    Array<{
      trackId: number;
      rawText: string;
      normalizedPlate: string | null;
      isValidIndianFormat: boolean;
      ocrConfidence: number;
      plateImageBase64?: string;
      timestamp: string;
    }>
  >([]);
  const sessionIdRef = useRef<string>(`sess_${Date.now()}`);
  const sessionStartEpochRef = useRef<number>(Date.now());

  // UI States
  const [modelStatus, setModelStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    trafficDetector.isReady() ? 'ready' : 'idle'
  );
  const [modelMessage, setModelMessage] = useState<string>('');
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [analysisCompleted, setAnalysisCompleted] = useState(false);
  const [hasAnalyzedFrame, setHasAnalyzedFrame] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Live Camera Source Settings
  const [liveSourceType, setLiveSourceType] = useState<'webcam' | 'ip_stream'>('webcam');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [streamUrl, setStreamUrl] = useState<string>(camera.sourceUri || '');

  // Upload Mode States
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedMediaType, setUploadedMediaType] = useState<'video' | 'image' | null>(null);
  const [uploadedObjectUrl, setUploadedObjectUrl] = useState<string | null>(null);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);
  const [recordAnnotated, setRecordAnnotated] = useState<boolean>(true);
  const [loadingSample, setLoadingSample] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [roadMode, setRoadMode] = useState<RoadFlowMode>(
    camera.zones.roadMode ?? 'two_way_auto'
  );
  const [dividerX, setDividerX] = useState<number>(camera.zones.dividerX ?? 0.5);
  const [multiTileBoost, setMultiTileBoost] = useState<boolean>(
    mode === 'upload' ? (settings.enableMultiTileBoost ?? true) : false
  );

  // Live Tracks, Complete Passed History & Violator Cards
  const [activeTracks, setActiveTracks] = useState<TrackedVehicle[]>([]);
  const [sessionVehicles, setSessionVehicles] = useState<TrackedVehicle[]>([]);
  const [vehicleLogFilter, setVehicleLogFilter] = useState<
    'all' | 'car' | 'motorcycle' | 'truck' | 'bus' | 'violators' | 'compliant'
  >('all');
  const [sessionViolations, setSessionViolations] = useState<SessionViolationCard[]>([]);
  const [inspectingTrackId, setInspectingTrackId] = useState<number | null>(null);
  const [inspectingFrame, setInspectingFrame] = useState(false);
  const [lastInspectionNote, setLastInspectionNote] = useState<string | null>(null);
  const [signalOverride, setSignalOverride] = useState<SignalState | 'auto'>('auto');

  const [stats, setStats] = useState<LiveStats>({
    fps: 0,
    activeCount: 0,
    uniqueTotal: 0,
    byClass: { ...EMPTY_COUNTS },
    crossedByClass: { ...EMPTY_COUNTS },
    inbound: 0,
    outbound: 0,
    avgSpeedKmh: null,
    signalState: 'unknown',
    densityPer100m: 0,
    congestionLevel: 'LOW',
    riskScore: 0,
    progressPct: 0,
  });

  useEffect(() => {
    if (mode !== 'live' || !navigator.mediaDevices?.enumerateDevices) return;
    navigator.mediaDevices
      .enumerateDevices()
      .then((list) => {
        const cams = list.filter((d) => d.kind === 'videoinput');
        setDevices(cams);
        if (cams.length > 0 && !selectedDeviceId) {
          setSelectedDeviceId(cams[0].deviceId);
        }
      })
      .catch(() => {
        // Permission not granted yet
      });
  }, [mode, selectedDeviceId]);

  const flushBatchToDatabase = useCallback(
    async (force = false) => {
      const now = Date.now();
      if (!force && now - lastSyncRef.current < 4000) return;
      lastSyncRef.current = now;

      const allTracks = trackerRef.current.getSessionVehicleHistory();
      const violationsToSend = pendingViolationsRef.current.splice(0, 20);
      const platesToSend = pendingPlatesRef.current.splice(0, 20);

      if (allTracks.length === 0 && violationsToSend.length === 0 && platesToSend.length === 0) {
        return;
      }

      const active = trackerRef.current.getActiveTracks();
      const speedVals = active
        .map((t) => t.speedKmh)
        .filter((s): s is number => s !== null);
      const avgSpeedKmh =
        speedVals.length > 0
          ? Math.round((speedVals.reduce((a, b) => a + b, 0) / speedVals.length) * 10) / 10
          : null;

      const cong = computeCongestionAndRisk({
        activeVehicleCount: active.length,
        roadLengthMeters: camera.calibration.realLengthMeters,
        isCalibrated: camera.calibration.isCalibrated,
        avgSpeedKmh,
        speedLimitKmh: camera.speedLimitKmh,
        verifiedViolationsCount: sessionViolations.length + violationsToSend.length,
        totalUniqueVehicles: trackerRef.current.uniqueCountedIds.size,
        thresholds: settings.congestionThresholds,
      });

      const byClass = trackerRef.current.uniqueCountByClass;

      try {
        await api.ingestBatch({
          cameraId: camera.id,
          sessionId: sessionIdRef.current,
          vehicles: allTracks.map((t) => ({
            trackId: t.trackId,
            vehicleClass: t.category,
            confidence: Math.round(t.confidence * 100) / 100,
            firstSeen: new Date(t.firstSeenMs).toISOString(),
            lastSeen: new Date(t.lastSeenMs).toISOString(),
            direction: t.direction,
            avgSpeedKmh: t.speedKmh,
            maxSpeedKmh: t.speedSamples.length > 0 ? Math.max(...t.speedSamples) : null,
            plateNumber: t.plateNumber,
            trajectory: t.trajectory,
            enteredLine: t.countedEntry,
            exitedLine: t.countedExit,
          })),
          violations: violationsToSend,
          plates: platesToSend,
          statsBucket: {
            bucketTimestamp: new Date().toISOString(),
            totalVehicles: trackerRef.current.uniqueCountedIds.size,
            cars: byClass.car,
            motorcycles: byClass.motorcycle,
            buses: byClass.bus,
            trucks: byClass.truck,
            bicycles: byClass.bicycle,
            otherVehicles: byClass.auto_rickshaw + byClass.other,
            inboundCount: trackerRef.current.inboundCount,
            outboundCount: trackerRef.current.outboundCount,
            avgSpeedKmh,
            densityPer100m: cong.densityPer100m,
            congestionLevel: cong.congestionLevel,
            riskScore: cong.riskScore,
          },
        });
        onTelemetrySaved();
      } catch (err) {
        console.error('Telemetry sync warning:', err);
      }
    },
    [camera, settings.congestionThresholds, sessionViolations.length, onTelemetrySaved]
  );

  const stopAll = useCallback(
    async (completedNaturally = false) => {
      runningRef.current = false;
      pausedRef.current = false;
      setIsRunning(false);
      setIsPaused(false);
      if (completedNaturally) {
        setAnalysisCompleted(true);
        setStats((prev) => ({ ...prev, progressPct: 100 }));
      }
      onLiveActiveChange?.(false);

      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }

      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          // ignore
        }
      }

      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
      }

      if (videoRef.current) {
        videoRef.current.pause();
        if (mode === 'live') {
          videoRef.current.srcObject = null;
        }
      }

      setSessionVehicles([...trackerRef.current.getSessionVehicleHistory()]);
      await flushBatchToDatabase(true);
    },
    [flushBatchToDatabase, mode, onLiveActiveChange]
  );

  useEffect(() => {
    return () => {
      runningRef.current = false;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (uploadedObjectUrl) URL.revokeObjectURL(uploadedObjectUrl);
      if (recordedVideoUrl) URL.revokeObjectURL(recordedVideoUrl);
    };
  }, [uploadedObjectUrl, recordedVideoUrl]);

  const ensureModelLoaded = useCallback(async () => {
    if (trafficDetector.isReady()) {
      setModelStatus('ready');
      return true;
    }
    setModelStatus('loading');
    try {
      await trafficDetector.load((msg) => setModelMessage(msg));
      setModelStatus('ready');
      return true;
    } catch (err) {
      setModelStatus('error');
      setErrorMsg((err as Error).message || 'Could not load AI detection weights.');
      return false;
    }
  }, []);

  const runSingleFramePipeline = useCallback(
    async (
      source: HTMLVideoElement | HTMLImageElement,
      sourceWidth: number,
      sourceHeight: number
    ) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (canvas.width !== sourceWidth || canvas.height !== sourceHeight) {
        canvas.width = sourceWidth;
        canvas.height = sourceHeight;
      }
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      ctx.drawImage(source, 0, 0, sourceWidth, sourceHeight);

      let cleanCanvas = hiddenCaptureCanvasRef.current;
      if (!cleanCanvas) {
        cleanCanvas = document.createElement('canvas');
        hiddenCaptureCanvasRef.current = cleanCanvas;
      }
      if (cleanCanvas.width !== sourceWidth || cleanCanvas.height !== sourceHeight) {
        cleanCanvas.width = sourceWidth;
        cleanCanvas.height = sourceHeight;
      }
      const cleanCtx = cleanCanvas.getContext('2d', { willReadFrequently: true });
      cleanCtx?.drawImage(source, 0, 0, sourceWidth, sourceHeight);

      const nowMs = performance.now();
      // Use video media clock anchored to session start so 0.25x slow-mo / 2x fast-forward keeps calibrated km/h, dwell timers & ISO timestamps exact
      const kinematicTimeMs =
        mode === 'upload' && source instanceof HTMLVideoElement && Number.isFinite(source.currentTime)
          ? sessionStartEpochRef.current + Math.round(source.currentTime * 1000)
          : Date.now();

      const sigResult =
        signalOverride === 'auto' && cleanCtx
          ? classifyTrafficSignalFromCanvas(
              cleanCtx,
              sourceWidth,
              sourceHeight,
              camera.zones.signalRoi
            )
          : { state: signalOverride === 'auto' ? 'unknown' : signalOverride, confidence: 1 };

      const effectiveCamera: CameraConfiguration = {
        ...camera,
        zones: {
          ...camera.zones,
          roadMode,
          dividerX,
          laneDividerLine: [
            { x: dividerX, y: 0.2 },
            { x: dividerX, y: 0.96 },
          ],
        },
      };

      const t0 = performance.now();
      const detections = await trafficDetector.detect(cleanCanvas, settings.confidenceThreshold, {
        multiTileBoost,
      });
      const inferMs = Math.max(1, performance.now() - t0);

      const { activeTracks: tracks } = trackerRef.current.update(
        detections,
        sourceWidth,
        sourceHeight,
        kinematicTimeMs,
        effectiveCamera,
        settings.confidenceThreshold,
        settings.enabledClasses
      );

      for (const trk of tracks) {
        heatmapPointsRef.current.push({
          x: trk.centroid.x,
          y: trk.centroid.y,
          weight: trk.violations.length > 0 ? 2.5 : 1,
        });
      }
      if (heatmapPointsRef.current.length > 500) {
        heatmapPointsRef.current.splice(0, heatmapPointsRef.current.length - 500);
      }

      const newViolations = violationEngineRef.current.evaluateFrame(
        tracks,
        effectiveCamera,
        sigResult.state,
        kinematicTimeMs
      );

      renderTrafficOverlays({
        ctx,
        width: sourceWidth,
        height: sourceHeight,
        tracks,
        camera: effectiveCamera,
        signalState: sigResult.state,
        settings,
        heatmapPoints: heatmapPointsRef.current,
        learnedRoadFlow: violationEngineRef.current.getLearnedRoadFlow(),
      });

      setHasAnalyzedFrame(true);

      if (newViolations.length > 0) {
        const cardsWithCrops: SessionViolationCard[] = [];
        for (const v of newViolations) {
          const matchedTrack = tracks.find((t) => t.trackId === v.trackId);
          const crops = matchedTrack
            ? captureEvidenceCrops(cleanCanvas, matchedTrack.bbox)
            : { fullFrame: canvas.toDataURL('image/jpeg', 0.78), vehicleCrop: '', plateCrop: '' };

          const annotatedFrame = canvas.toDataURL('image/jpeg', 0.78);
          pendingViolationsRef.current.push({
            ...v,
            evidenceBase64: {
              fullFrame: annotatedFrame,
              vehicleCrop: crops.vehicleCrop,
              plateCrop: crops.plateCrop,
              metadata: {
                signalState: sigResult.state,
                speedLimitKmh: camera.speedLimitKmh,
                calibrated: camera.calibration.isCalibrated,
                locationNorm: v.locationNorm,
              },
            },
          });
          cardsWithCrops.push({
            ...v,
            cropDataUrl: crops.vehicleCrop || annotatedFrame,
          });
        }
        setSessionViolations((prev) => [...cardsWithCrops, ...prev].slice(0, 80));
      }

      const speedVals = tracks.map((t) => t.speedKmh).filter((s): s is number => s !== null);
      const avgSpeedKmh =
        speedVals.length > 0
          ? Math.round((speedVals.reduce((a, b) => a + b, 0) / speedVals.length) * 10) / 10
          : null;

      const cong = computeCongestionAndRisk({
        activeVehicleCount: tracks.length,
        roadLengthMeters: camera.calibration.realLengthMeters,
        isCalibrated: camera.calibration.isCalibrated,
        avgSpeedKmh,
        speedLimitKmh: camera.speedLimitKmh,
        verifiedViolationsCount: sessionViolations.length + newViolations.length,
        totalUniqueVehicles: trackerRef.current.uniqueCountedIds.size,
        thresholds: settings.congestionThresholds,
      });

      let progressPct = 0;
      if (
        source instanceof HTMLVideoElement &&
        source.duration > 0 &&
        Number.isFinite(source.duration)
      ) {
        progressPct = Math.min(100, Math.round((source.currentTime / source.duration) * 100));
      }

      setActiveTracks([...tracks]);
      setSessionVehicles([...trackerRef.current.getSessionVehicleHistory()]);
      setStats({
        fps: Math.round(
          Math.min(60, 1000 / Math.max(inferMs, nowMs - lastInferenceRef.current || inferMs))
        ),
        activeCount: tracks.length,
        uniqueTotal: trackerRef.current.uniqueCountedIds.size,
        byClass: { ...trackerRef.current.uniqueCountByClass },
        crossedByClass: { ...trackerRef.current.crossedByClass },
        inbound: trackerRef.current.inboundCount,
        outbound: trackerRef.current.outboundCount,
        avgSpeedKmh,
        signalState: sigResult.state,
        densityPer100m: cong.densityPer100m,
        congestionLevel: cong.congestionLevel,
        riskScore: cong.riskScore,
        progressPct,
      });

      lastInferenceRef.current = nowMs;
      void flushBatchToDatabase(false);
    },
    [
      camera,
      dividerX,
      flushBatchToDatabase,
      mode,
      multiTileBoost,
      roadMode,
      sessionViolations.length,
      settings,
      signalOverride,
    ]
  );

  const startProcessingLoop = useCallback(() => {
    runningRef.current = true;
    pausedRef.current = false;
    setIsRunning(true);
    setIsPaused(false);
    setAnalysisCompleted(false);
    onLiveActiveChange?.(mode === 'live');

    const loop = async () => {
      if (!runningRef.current) return;
      if (!pausedRef.current) {
        const video = videoRef.current;
        if (video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
          const now = performance.now();
          if (now - lastInferenceRef.current >= settings.inferenceIntervalMs) {
            await runSingleFramePipeline(video, video.videoWidth, video.videoHeight);
          }
          if (mode === 'upload' && video.ended) {
            await stopAll(true);
            return;
          }
        }
      }
      if (runningRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          void loop();
        });
      }
    };

    rafRef.current = requestAnimationFrame(() => {
      void loop();
    });
  }, [mode, onLiveActiveChange, runSingleFramePipeline, settings.inferenceIntervalMs, stopAll]);

  const resetSessionCounters = () => {
    sessionStartEpochRef.current = Date.now();
    trackerRef.current.reset();
    violationEngineRef.current.reset();
    heatmapPointsRef.current = [];
    setActiveTracks([]);
    setSessionVehicles([]);
    setSessionViolations([]);
    setAnalysisCompleted(false);
    setHasAnalyzedFrame(false);
    setStats({
      fps: 0,
      activeCount: 0,
      uniqueTotal: 0,
      byClass: { ...EMPTY_COUNTS },
      crossedByClass: { ...EMPTY_COUNTS },
      inbound: 0,
      outbound: 0,
      avgSpeedKmh: null,
      signalState: 'unknown',
      densityPer100m: 0,
      congestionLevel: 'LOW',
      riskScore: 0,
      progressPct: 0,
    });
  };

  const handleStartLiveCamera = async () => {
    setErrorMsg(null);
    const loaded = await ensureModelLoaded();
    if (!loaded) return;

    resetSessionCounters();
    sessionIdRef.current = `live_${Date.now()}`;

    try {
      const video = videoRef.current;
      if (!video) return;

      if (liveSourceType === 'webcam') {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Browser camera API is unavailable in this context.');
        }
        const constraints: MediaStreamConstraints = {
          video: selectedDeviceId
            ? {
                deviceId: { exact: selectedDeviceId },
                width: { ideal: 1280 },
                height: { ideal: 720 },
              }
            : { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        mediaStreamRef.current = stream;
        video.srcObject = stream;
        await video.play();

        const list = await navigator.mediaDevices.enumerateDevices();
        setDevices(list.filter((d) => d.kind === 'videoinput'));
      } else {
        const uri = streamUrl.trim();
        if (!uri) {
          throw new Error('Enter an HTTP/HTTPS MP4/WebM/HLS stream URL from your CCTV gateway.');
        }
        if (uri.toLowerCase().startsWith('rtsp://')) {
          throw new Error(
            'Browsers cannot decode raw RTSP streams directly. Proxy your RTSP camera through MediaMTX or FFmpeg to an HLS (.m3u8) or WebRTC/HTTP stream URL.'
          );
        }
        video.crossOrigin = 'anonymous';
        video.srcObject = null;
        video.src = uri;
        await video.play();
      }

      startProcessingLoop();
    } catch (err) {
      setErrorMsg((err as Error).message || 'Unable to connect to camera source.');
      await stopAll(false);
    }
  };

  const handleFileChange = (file: File | null) => {
    if (!file) return;
    setErrorMsg(null);
    setLastInspectionNote(null);

    if (uploadedObjectUrl) URL.revokeObjectURL(uploadedObjectUrl);
    if (recordedVideoUrl) {
      URL.revokeObjectURL(recordedVideoUrl);
      setRecordedVideoUrl(null);
    }

    const isImg = file.type.startsWith('image/');
    const isVid =
      file.type.startsWith('video/') || /\.(mp4|avi|mov|mkv|webm)$/i.test(file.name);

    if (!isImg && !isVid) {
      setErrorMsg(
        'Unsupported file type. Upload MP4, AVI, MOV, MKV, WebM video or JPG/PNG traffic image.'
      );
      return;
    }

    const url = URL.createObjectURL(file);
    setUploadedFile(file);
    setUploadedMediaType(isImg ? 'image' : 'video');
    setUploadedObjectUrl(url);
    resetSessionCounters();
  };

  const handleLoadSampleVideo = async (urlPath: string, filename: string) => {
    setErrorMsg(null);
    setLoadingSample(filename);
    try {
      const res = await fetch(urlPath);
      if (!res.ok) throw new Error(`Failed to fetch sample video (${res.status})`);
      const blob = await res.blob();
      const file = new File([blob], filename, { type: 'video/mp4' });
      handleFileChange(file);
      setLastInspectionNote(
        `Loaded real CCTV footage "${filename}". Click "Start AI Analysis" to count every car, bike, bus & truck and detect traffic rule violators.`
      );
    } catch (err) {
      setErrorMsg((err as Error).message || 'Could not load sample video.');
    } finally {
      setLoadingSample(null);
    }
  };

  const handleStartUploadAnalysis = async () => {
    if (!uploadedFile || !uploadedObjectUrl) {
      setErrorMsg('Upload a traffic video or image first.');
      return;
    }
    setErrorMsg(null);
    const loaded = await ensureModelLoaded();
    if (!loaded) return;

    resetSessionCounters();
    sessionIdRef.current = `upload_${Date.now()}`;

    if (uploadedMediaType === 'image') {
      const img = imageRef.current;
      if (!img) return;
      if (!img.complete) {
        await new Promise<void>((resolve) => {
          img.onload = () => resolve();
        });
      }
      await runSingleFramePipeline(img, img.naturalWidth, img.naturalHeight);
      await runSingleFramePipeline(img, img.naturalWidth, img.naturalHeight);
      setAnalysisCompleted(true);
      await flushBatchToDatabase(true);
      setLastInspectionNote(
        `Photo analyzed: ${trackerRef.current.uniqueCountedIds.size} vehicle(s) detected. Click "Inspect Frame (Helmet & ANPR)" to check helmet compliance and Indian license plates.`
      );
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    try {
      video.currentTime = 0;
      video.playbackRate = playbackRate;
      await video.play();

      if (
        recordAnnotated &&
        typeof canvas.captureStream === 'function' &&
        typeof MediaRecorder !== 'undefined'
      ) {
        recordedChunksRef.current = [];
        const stream = canvas.captureStream(24);
        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
          ? 'video/webm;codecs=vp9'
          : 'video/webm';
        const recorder = new MediaRecorder(stream, { mimeType });
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) recordedChunksRef.current.push(e.data);
        };
        recorder.onstop = () => {
          if (recordedChunksRef.current.length > 0) {
            const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
            setRecordedVideoUrl(URL.createObjectURL(blob));
          }
        };
        recorder.start(500);
        mediaRecorderRef.current = recorder;
      }

      startProcessingLoop();
    } catch (err) {
      setErrorMsg(
        `Browser could not decode this video codec (${(err as Error).message}). Ensure H.264/MP4 or WebM encoding.`
      );
    }
  };

  const handleTogglePause = () => {
    const next = !isPaused;
    pausedRef.current = next;
    setIsPaused(next);
    if (videoRef.current) {
      if (next) {
        videoRef.current.pause();
      } else {
        if (mode === 'upload') videoRef.current.playbackRate = playbackRate;
        void videoRef.current.play();
      }
    }
  };

  const handleInspectTrackWithAI = async (trk: TrackedVehicle) => {
    const cleanCanvas = hiddenCaptureCanvasRef.current || canvasRef.current;
    if (!cleanCanvas || cleanCanvas.width === 0) return;

    setInspectingTrackId(trk.trackId);
    setErrorMsg(null);
    setLastInspectionNote(null);

    try {
      const crops = captureEvidenceCrops(cleanCanvas, trk.bbox);
      const result: VisionVerificationResult = await api.verifyVehicleVision({
        vehicleCropBase64: crops.vehicleCrop,
        fullFrameBase64: crops.fullFrame,
        vehicleClass: trk.category,
      });

      const isoNow = new Date().toISOString();

      if (result.plateText) {
        trk.plateNumber = result.normalizedPlate || result.plateText;
        trk.plateConfidence = result.ocrConfidence;
        pendingPlatesRef.current.push({
          trackId: trk.trackId,
          rawText: result.plateText,
          normalizedPlate: result.normalizedPlate,
          isValidIndianFormat: result.isValidIndianFormat,
          ocrConfidence: result.ocrConfidence,
          plateImageBase64: crops.plateCrop,
          timestamp: isoNow,
        });
      }

      trk.helmetStatus = result.helmetStatus;
      trk.aiInspected = true;

      const aiEvents: SessionViolationCard[] = [];

      if (result.helmetStatus === 'helmet_absent') {
        aiEvents.push({
          cameraId: camera.id,
          trackId: trk.trackId,
          vehicleClass: trk.category,
          violationType: 'no_helmet',
          confidence: 0.88,
          speedKmh: trk.speedKmh,
          plateNumber: trk.plateNumber,
          verificationStatus: 'verified',
          notes: `No Helmet Confirmed: ${result.evidenceSummary}`,
          timestamp: isoNow,
          locationNorm: trk.centroid,
          cropDataUrl: crops.vehicleCrop,
        });
      } else if (trk.category === 'motorcycle' && result.helmetStatus === 'uncertain') {
        aiEvents.push({
          cameraId: camera.id,
          trackId: trk.trackId,
          vehicleClass: trk.category,
          violationType: 'no_helmet',
          confidence: 0.45,
          speedKmh: trk.speedKmh,
          plateNumber: trk.plateNumber,
          verificationStatus: 'requires_review',
          notes: `Uncertain helmet visibility: ${result.evidenceSummary}`,
          timestamp: isoNow,
          locationNorm: trk.centroid,
          cropDataUrl: crops.vehicleCrop,
        });
      }

      if (result.tripleRidingStatus === 'detected') {
        aiEvents.push({
          cameraId: camera.id,
          trackId: trk.trackId,
          vehicleClass: trk.category,
          violationType: 'triple_riding',
          confidence: 0.87,
          speedKmh: trk.speedKmh,
          plateNumber: trk.plateNumber,
          verificationStatus: 'verified',
          notes: `Triple Riding (${result.riderCount ?? 3}+ riders): ${result.evidenceSummary}`,
          timestamp: isoNow,
          locationNorm: trk.centroid,
          cropDataUrl: crops.vehicleCrop,
        });
      }

      if (result.seatBeltStatus === 'absent') {
        aiEvents.push({
          cameraId: camera.id,
          trackId: trk.trackId,
          vehicleClass: trk.category,
          violationType: 'seat_belt',
          confidence: 0.8,
          speedKmh: trk.speedKmh,
          plateNumber: trk.plateNumber,
          verificationStatus: 'requires_review',
          notes: `Seat belt absent: ${result.evidenceSummary}`,
          timestamp: isoNow,
          locationNorm: trk.centroid,
          cropDataUrl: crops.vehicleCrop,
        });
      }

      if (result.mobileUsageStatus === 'detected') {
        aiEvents.push({
          cameraId: camera.id,
          trackId: trk.trackId,
          vehicleClass: trk.category,
          violationType: 'mobile_phone_usage',
          confidence: 0.8,
          speedKmh: trk.speedKmh,
          plateNumber: trk.plateNumber,
          verificationStatus: 'requires_review',
          notes: `Mobile phone usage suspected: ${result.evidenceSummary}`,
          timestamp: isoNow,
          locationNorm: trk.centroid,
          cropDataUrl: crops.vehicleCrop,
        });
      }

      for (const ev of aiEvents) {
        if (!trk.violations.includes(ev.violationType)) {
          trk.violations.push(ev.violationType);
        }
        pendingViolationsRef.current.push({
          ...ev,
          evidenceBase64: {
            fullFrame: crops.fullFrame,
            vehicleCrop: crops.vehicleCrop,
            plateCrop: crops.plateCrop,
            metadata: { aiSummary: result.evidenceSummary, subType: result.vehicleSubType },
          },
        });
      }

      if (aiEvents.length > 0) {
        setSessionViolations((prev) => [...aiEvents, ...prev].slice(0, 80));
      }

      setActiveTracks([...trackerRef.current.getActiveTracks()]);
      setSessionVehicles([...trackerRef.current.getSessionVehicleHistory()]);
      await flushBatchToDatabase(true);

      const plateInfo = result.plateText
        ? `Plate: ${result.normalizedPlate || result.plateText} (${Math.round(
            result.ocrConfidence * 100
          )}%)`
        : 'Plate: Unreadable';
      setLastInspectionNote(
        `Track #${trk.trackId} (${result.vehicleSubType || trk.category}) · ${plateInfo} · Helmet: ${result.helmetStatus} · ${result.evidenceSummary}`
      );
    } catch (err) {
      setErrorMsg((err as Error).message || 'AI vision verification failed.');
    } finally {
      setInspectingTrackId(null);
    }
  };

  const handleInspectFullFrame = async () => {
    const cleanCanvas = hiddenCaptureCanvasRef.current || canvasRef.current;
    if (!cleanCanvas || cleanCanvas.width === 0) {
      setErrorMsg('Start camera or analyze a video frame before running AI frame inspection.');
      return;
    }
    setInspectingFrame(true);
    setErrorMsg(null);
    try {
      const frameBase64 = cleanCanvas.toDataURL('image/jpeg', 0.85);
      const res = await api.inspectFullFrameVision(frameBase64);
      const isoNow = new Date().toISOString();

      for (let i = 0; i < res.readablePlates.length; i++) {
        const p = res.readablePlates[i];
        pendingPlatesRef.current.push({
          trackId: 900 + i,
          rawText: p.plateText,
          normalizedPlate: p.normalizedPlate,
          isValidIndianFormat: p.isValidIndianFormat,
          ocrConfidence: p.confidence,
          timestamp: isoNow,
        });
      }

      const newCards: SessionViolationCard[] = [];
      for (let i = 0; i < res.observedSafetyIssues.length; i++) {
        const iss = res.observedSafetyIssues[i];
        const vEvent: SessionViolationCard = {
          cameraId: camera.id,
          trackId: 900 + i,
          vehicleClass: (['car', 'motorcycle', 'bus', 'truck', 'auto_rickshaw', 'bicycle'].includes(
            iss.vehicleType
          )
            ? iss.vehicleType
            : 'other') as VehicleCategory,
          violationType: iss.violationType as DetectedViolationEvent['violationType'],
          confidence: iss.confidence,
          speedKmh: null,
          plateNumber: res.readablePlates[0]?.normalizedPlate ?? null,
          verificationStatus: iss.requiresReview ? 'requires_review' : 'verified',
          notes: `AI Vision Scan: ${iss.description}`,
          timestamp: isoNow,
          locationNorm: { x: 0.5, y: 0.5 },
          cropDataUrl: frameBase64,
        };
        pendingViolationsRef.current.push({
          ...vEvent,
          evidenceBase64: {
            fullFrame: frameBase64,
            vehicleCrop: '',
            plateCrop: '',
            metadata: { fullFrameInspection: true, autoRickshaws: res.autoRickshawCount },
          },
        });
        newCards.push(vEvent);
      }

      if (newCards.length > 0) {
        setSessionViolations((prev) => [...newCards, ...prev].slice(0, 80));
      }

      await flushBatchToDatabase(true);
      setLastInspectionNote(
        `AI Frame Scan · Signal: ${res.signalState.toUpperCase()} · Auto-rickshaws: ${
          res.autoRickshawCount
        } · Legible Plates: ${res.readablePlates.length} · Safety Violations Flagged: ${
          res.observedSafetyIssues.length
        } · ${res.sceneSummary}`
      );
    } catch (err) {
      setErrorMsg((err as Error).message || 'Full-frame AI inspection failed.');
    } finally {
      setInspectingFrame(false);
    }
  };

  const filteredSessionVehicles = sessionVehicles.filter((v) => {
    if (vehicleLogFilter === 'car') return v.category === 'car';
    if (vehicleLogFilter === 'motorcycle')
      return v.category === 'motorcycle' || v.category === 'bicycle';
    if (vehicleLogFilter === 'truck') return v.category === 'truck';
    if (vehicleLogFilter === 'bus') return v.category === 'bus';
    if (vehicleLogFilter === 'violators') return v.violations.length > 0;
    if (vehicleLogFilter === 'compliant') return v.violations.length === 0;
    return true;
  });

  const violatorVehicleCount = sessionVehicles.filter((v) => v.violations.length > 0).length;
  const compliantVehicleCount = sessionVehicles.filter((v) => v.violations.length === 0).length;

  return (
    <div className="space-y-6">
      {/* Modern Top Command Bar */}
      <div className="bg-[#0D1526] border border-slate-800/90 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        {mode === 'live' ? (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center bg-[#060B17] border border-slate-800 rounded-lg p-1">
              <button
                type="button"
                onClick={() => setLiveSourceType('webcam')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  liveSourceType === 'webcam'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                Webcam / USB
              </button>
              <button
                type="button"
                onClick={() => setLiveSourceType('ip_stream')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  liveSourceType === 'ip_stream'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                IP CCTV / Stream URL
              </button>
            </div>

            {liveSourceType === 'webcam' ? (
              <select
                value={selectedDeviceId}
                onChange={(e) => setSelectedDeviceId(e.target.value)}
                disabled={isRunning}
                className="h-9 rounded-lg bg-[#060B17] border border-slate-700/90 px-3 text-xs text-slate-200 max-w-[240px]"
              >
                {devices.length === 0 ? (
                  <option value="">Default System Camera</option>
                ) : (
                  devices.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>
                      {d.label || `Camera Device ${i + 1}`}
                    </option>
                  ))
                )}
              </select>
            ) : (
              <input
                type="text"
                value={streamUrl}
                onChange={(e) => setStreamUrl(e.target.value)}
                placeholder="https://camera-gateway/stream.m3u8 or .mp4"
                disabled={isRunning}
                className="h-9 w-72 rounded-lg bg-[#060B17] border border-slate-700/90 px-3 text-xs text-slate-100 placeholder:text-slate-500 font-mono"
              />
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <label className="h-9 px-4 rounded-lg bg-[#060B17] hover:bg-slate-800/80 border border-slate-700 text-slate-200 text-xs font-medium flex items-center gap-2 cursor-pointer whitespace-nowrap">
              <Upload className="w-3.5 h-3.5 text-blue-400" />
              <span>
                {uploadedFile ? uploadedFile.name : 'Upload Video (MP4/AVI/MOV/MKV) or Photo'}
              </span>
              <input
                type="file"
                accept="video/*,.mp4,.avi,.mov,.mkv,.webm,image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={recordAnnotated}
                onChange={(e) => setRecordAnnotated(e.target.checked)}
                className="rounded border-slate-700 bg-[#060B17] text-blue-600"
              />
              <span>Record Annotated Video</span>
            </label>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {!isRunning ? (
            <button
              type="button"
              onClick={mode === 'live' ? handleStartLiveCamera : handleStartUploadAnalysis}
              disabled={modelStatus === 'loading' || (mode === 'upload' && !uploadedFile)}
              className="h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold flex items-center gap-2 whitespace-nowrap shadow-[0_1px_12px_rgba(37,99,235,0.3)]"
            >
              {modelStatus === 'loading' ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              <span>
                {modelStatus === 'loading'
                  ? 'Loading AI Weights...'
                  : mode === 'live'
                  ? 'Start Camera'
                  : uploadedMediaType === 'image'
                  ? 'Analyze Photo'
                  : 'Start AI Analysis'}
              </span>
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleTogglePause}
                className="h-9 px-3.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap"
              >
                {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                <span>{isPaused ? 'Resume' : 'Pause'}</span>
              </button>
              <button
                type="button"
                onClick={() => void stopAll(false)}
                className="h-9 px-3.5 rounded-lg bg-red-600/90 hover:bg-red-500 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
              >
                <Square className="w-3.5 h-3.5" />
                <span>Stop</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => void handleInspectFullFrame()}
            disabled={inspectingFrame}
            className="h-9 px-3.5 rounded-lg bg-[#060B17] hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
          >
            <ScanText
              className={`w-3.5 h-3.5 text-blue-400 ${inspectingFrame ? 'animate-pulse' : ''}`}
            />
            <span>{inspectingFrame ? 'Scanning Frame...' : 'Inspect Frame (Helmet & ANPR)'}</span>
          </button>

          {recordedVideoUrl && (
            <a
              href={recordedVideoUrl}
              download={`annotated_${camera.id}_${Date.now()}.webm`}
              className="h-9 px-3.5 rounded-lg bg-emerald-600/90 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Video</span>
            </a>
          )}
        </div>
      </div>

      {/* Bundled Real CCTV Sample Videos (Upload Mode) */}
      {mode === 'upload' && (
        <div className="bg-[#0D1526] border border-slate-800/90 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-0.5">
            <div className="text-xs font-semibold text-slate-100">
              Built-In Real CCTV Sample Videos
            </div>
            <div className="text-xs text-slate-400">
              Load directly for instant AI analysis or download the MP4 to upload live during your
              presentation
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            <div className="flex items-center gap-2 bg-[#060B17] border border-slate-800 rounded-lg px-3 py-1.5">
              <span className="text-slate-200 font-medium whitespace-nowrap">
                Highway CCTV (Cars &amp; Trucks)
              </span>
              <button
                type="button"
                disabled={Boolean(loadingSample) || isRunning}
                onClick={() =>
                  void handleLoadSampleVideo(
                    '/samples/highway_traffic_sample.mp4',
                    'highway_traffic_sample.mp4'
                  )
                }
                className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold whitespace-nowrap"
              >
                {loadingSample === 'highway_traffic_sample.mp4' ? 'Loading...' : 'Load'}
              </button>
              <a
                href="/samples/highway_traffic_sample.mp4"
                download="highway_traffic_sample.mp4"
                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 whitespace-nowrap"
              >
                MP4
              </a>
            </div>

            <div className="flex items-center gap-2 bg-[#060B17] border border-slate-800 rounded-lg px-3 py-1.5">
              <span className="text-slate-200 font-medium whitespace-nowrap">
                Multi-Lane Arterial CCTV
              </span>
              <button
                type="button"
                disabled={Boolean(loadingSample) || isRunning}
                onClick={() =>
                  void handleLoadSampleVideo(
                    '/samples/intersection_traffic_sample.mp4',
                    'intersection_traffic_sample.mp4'
                  )
                }
                className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold whitespace-nowrap"
              >
                {loadingSample === 'intersection_traffic_sample.mp4' ? 'Loading...' : 'Load'}
              </button>
              <a
                href="/samples/intersection_traffic_sample.mp4"
                download="intersection_traffic_sample.mp4"
                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 whitespace-nowrap"
              >
                MP4
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Status / Error / Completion Banners */}
      {modelStatus === 'loading' && (
        <div className="bg-blue-950/40 border border-blue-800/50 rounded-xl px-4 py-3 text-xs text-blue-200 flex items-center gap-2.5">
          <RefreshCw className="w-4 h-4 animate-spin text-blue-400 shrink-0" />
          <span>{modelMessage || 'Loading neural vehicle detection weights...'}</span>
        </div>
      )}

      {errorMsg && (
        <div className="bg-red-950/40 border border-red-800/60 rounded-xl px-4 py-3 text-xs text-red-200 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {analysisCompleted && (
        <div className="bg-emerald-950/30 border border-emerald-800/60 rounded-xl px-4 py-3 text-xs text-emerald-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              Analysis complete: <strong className="font-mono">{stats.uniqueTotal}</strong> unique
              vehicles passed ({stats.byClass.car} Cars · {stats.byClass.motorcycle} Bikes ·{' '}
              {stats.byClass.bus} Buses · {stats.byClass.truck} Trucks) —{' '}
              <strong className="font-mono text-red-300">{sessionViolations.length}</strong> rule
              violation(s) flagged and saved to SQLite.
            </span>
          </div>
        </div>
      )}

      {lastInspectionNote && (
        <div className="bg-[#0D1526] border border-slate-700/80 rounded-xl px-4 py-3 text-xs text-slate-200">
          {lastInspectionNote}
        </div>
      )}

      {/* CRYSTAL-CLEAR PASSED VEHICLE COUNT BREAKDOWN STRIP */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-[#0D1526] border border-slate-800/90 border-t-2 border-t-blue-500/80 rounded-xl p-4 space-y-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Cars Passed</span>
            <Car className="w-4 h-4 text-blue-400" />
          </div>
          <div className="font-mono text-2xl font-bold tabular-nums text-slate-100">
            {stats.byClass.car}
          </div>
          <div className="text-[11px] text-slate-500 font-mono">
            Line crossed: {stats.crossedByClass.car}
          </div>
        </div>

        <div className="bg-[#0D1526] border border-slate-800/90 border-t-2 border-t-amber-500/80 rounded-xl p-4 space-y-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Bikes / Motorcycles</span>
            <Bike className="w-4 h-4 text-amber-400" />
          </div>
          <div className="font-mono text-2xl font-bold tabular-nums text-amber-300">
            {stats.byClass.motorcycle + stats.byClass.bicycle}
          </div>
          <div className="text-[11px] text-slate-500 font-mono">
            Line crossed: {stats.crossedByClass.motorcycle + stats.crossedByClass.bicycle}
          </div>
        </div>

        <div className="bg-[#0D1526] border border-slate-800/90 border-t-2 border-t-purple-500/80 rounded-xl p-4 space-y-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Trucks Passed</span>
            <Truck className="w-4 h-4 text-purple-400" />
          </div>
          <div className="font-mono text-2xl font-bold tabular-nums text-purple-300">
            {stats.byClass.truck}
          </div>
          <div className="text-[11px] text-slate-500 font-mono">
            Line crossed: {stats.crossedByClass.truck}
          </div>
        </div>

        <div className="bg-[#0D1526] border border-slate-800/90 border-t-2 border-t-emerald-500/80 rounded-xl p-4 space-y-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Buses Passed</span>
            <Bus className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="font-mono text-2xl font-bold tabular-nums text-emerald-300">
            {stats.byClass.bus}
          </div>
          <div className="text-[11px] text-slate-500 font-mono">
            Line crossed: {stats.crossedByClass.bus}
          </div>
        </div>

        <div className="bg-[#0D1526] border border-slate-800/90 border-t-2 border-t-cyan-400/80 rounded-xl p-4 space-y-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <div className="text-xs text-slate-400">Total Vehicles Passed</div>
          <div className="font-mono text-2xl font-bold tabular-nums text-cyan-300">
            {stats.uniqueTotal}
          </div>
          <div className="text-[11px] text-slate-500 font-mono">
            In: {stats.inbound} · Out: {stats.outbound}
          </div>
        </div>

        <div
          className={`rounded-xl p-4 space-y-1 border border-t-2 ${
            sessionViolations.length > 0
              ? 'bg-red-950/25 border-red-800/60 border-t-red-500'
              : 'bg-[#0D1526] border-slate-800/90 border-t-slate-600'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Rule Violations</span>
            <ShieldAlert
              className={`w-4 h-4 ${
                sessionViolations.length > 0 ? 'text-red-400' : 'text-slate-500'
              }`}
            />
          </div>
          <div
            className={`font-mono text-2xl font-bold tabular-nums ${
              sessionViolations.length > 0 ? 'text-red-400' : 'text-slate-100'
            }`}
          >
            {sessionViolations.length}
          </div>
          <div className="text-[11px] text-slate-500 font-mono">
            {violatorVehicleCount} offending vehicle(s)
          </div>
        </div>
      </div>

      {/* Main Split Stage: Annotated Video Viewport (Left) + Live Inspector Sidebar (Right) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-8 space-y-4">
          <div className="relative bg-[#040812] border border-slate-800/90 rounded-xl overflow-hidden aspect-video flex items-center justify-center shadow-lg">
            <video
              ref={videoRef}
              src={
                mode === 'upload' && uploadedMediaType === 'video'
                  ? uploadedObjectUrl ?? undefined
                  : undefined
              }
              playsInline
              muted
              className={
                mode === 'upload' && uploadedMediaType === 'video' && !hasAnalyzedFrame
                  ? 'w-full h-full object-contain'
                  : 'hidden'
              }
              controls={mode === 'upload' && uploadedMediaType === 'video' && !isRunning}
              onPlay={(e) => {
                if (mode === 'upload') {
                  e.currentTarget.playbackRate = playbackRate;
                }
              }}
            />
            {mode === 'upload' && uploadedMediaType === 'image' && uploadedObjectUrl && (
              <img
                ref={imageRef}
                src={uploadedObjectUrl}
                alt="Uploaded traffic scene"
                className={!hasAnalyzedFrame ? 'w-full h-full object-contain' : 'hidden'}
              />
            )}

            <canvas
              ref={canvasRef}
              className={hasAnalyzedFrame ? 'w-full h-full object-contain' : 'hidden'}
            />

            {!isRunning && !hasAnalyzedFrame && !uploadedObjectUrl && (
              <div className="text-center px-6 py-10 max-w-md space-y-3">
                <div className="w-12 h-12 rounded-xl bg-slate-800/70 border border-slate-700/80 flex items-center justify-center mx-auto">
                  {mode === 'live' ? (
                    <Camera className="w-6 h-6 text-blue-400" />
                  ) : (
                    <FileVideo className="w-6 h-6 text-blue-400" />
                  )}
                </div>
                <h3 className="font-display font-semibold text-base text-slate-100">
                  {mode === 'live'
                    ? 'Ready for Live Surveillance Feed'
                    : 'Upload or Load a Traffic Video'}
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {mode === 'live'
                    ? 'Connect your webcam, USB camera, or HTTP/HLS CCTV stream to count passing cars & bikes, track trajectories, and detect rule violations live.'
                    : 'Choose one of the built-in real CCTV videos above or upload your own MP4/AVI/MOV/MKV traffic video to count vehicles and identify every traffic rule violator.'}
                </p>
                <div className="text-xs text-slate-500 font-mono">
                  Camera: {camera.id} · Speed:{' '}
                  {camera.calibration.isCalibrated ? 'Calibrated' : 'Uncalibrated (N/A)'}
                </div>
              </div>
            )}
          </div>

          {/* Progress Bar */}
          {mode === 'upload' && uploadedMediaType === 'video' && (isRunning || analysisCompleted) && (
            <div className="bg-[#0D1526] border border-slate-800/90 rounded-xl px-4 py-3 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300 font-medium">
                  {analysisCompleted ? 'Video Analysis Completed' : 'Analyzing Video Frames'}
                </span>
                <span className="font-mono tabular-nums text-blue-400">{stats.progressPct}%</span>
              </div>
              <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-150 ${
                    analysisCompleted ? 'bg-emerald-500' : 'bg-blue-500'
                  }`}
                  style={{ width: `${stats.progressPct}%` }}
                />
              </div>
            </div>
          )}

          {/* Playback Speed Control Bar (Upload Video Mode) */}
          {mode === 'upload' && uploadedMediaType === 'video' && (
            <div className="bg-[#0D1526] border border-slate-800/90 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-slate-400 font-medium whitespace-nowrap">
                  Video Playback Speed:
                </span>
                <div className="flex items-center bg-[#060B17] border border-slate-800 rounded-lg p-1">
                  {[
                    { rate: 0.25, label: '0.25x Slow' },
                    { rate: 0.5, label: '0.5x' },
                    { rate: 0.75, label: '0.75x' },
                    { rate: 1, label: '1x Normal' },
                    { rate: 1.5, label: '1.5x' },
                    { rate: 2, label: '2x Fast' },
                  ].map((opt) => (
                    <button
                      key={opt.rate}
                      type="button"
                      onClick={() => {
                        setPlaybackRate(opt.rate);
                        if (videoRef.current) {
                          videoRef.current.playbackRate = opt.rate;
                        }
                      }}
                      className={`px-2.5 py-1 rounded-md font-mono font-medium transition-colors whitespace-nowrap ${
                        playbackRate === opt.rate
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-400 hover:text-slate-100'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="font-mono text-slate-300 whitespace-nowrap">
                Total Line Crossed:{' '}
                <span className="text-blue-400 font-semibold">
                  {stats.inbound + stats.outbound}
                </span>{' '}
                · Violators:{' '}
                <span
                  className={
                    violatorVehicleCount > 0
                      ? 'text-red-400 font-semibold'
                      : 'text-emerald-400 font-semibold'
                  }
                >
                  {violatorVehicleCount}
                </span>
              </div>
            </div>
          )}

          {/* Road Direction & Two-Way Divider Control Bar */}
          <div className="bg-[#0D1526] border border-slate-800/90 rounded-xl px-4 py-3 space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-slate-400 font-medium whitespace-nowrap">
                  Road Flow Mode:
                </span>
                <div className="flex flex-wrap items-center bg-[#060B17] border border-slate-800 rounded-lg p-1 gap-0.5">
                  {(
                    [
                      ['two_way_auto', 'Two-Way (Auto)'],
                      ['two_way_left_down_right_up', '2-Way L↓ / R↑'],
                      ['two_way_left_up_right_down', '2-Way L↑ / R↓'],
                      ['one_way_down', 'One-Way ↓'],
                      ['one_way_up', 'One-Way ↑'],
                    ] as const
                  ).map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setRoadMode(val)}
                      className={`px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap ${
                        roadMode === val
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-400 hover:text-slate-100'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-center gap-2 text-slate-300 cursor-pointer select-none whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={multiTileBoost}
                  onChange={(e) => setMultiTileBoost(e.target.checked)}
                  className="rounded border-slate-700 bg-[#060B17] text-blue-600"
                />
                <span>Deep Bike &amp; Truck Scan (Multi-Tile)</span>
              </label>
            </div>

            {roadMode.startsWith('two_way') && (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/70">
                <div className="flex items-center gap-3 flex-1 min-w-[220px]">
                  <span className="text-slate-400 whitespace-nowrap">
                    Road Divider Position:
                  </span>
                  <input
                    type="range"
                    min={0.2}
                    max={0.8}
                    step={0.02}
                    value={dividerX}
                    onChange={(e) => setDividerX(Number(e.target.value))}
                    className="flex-1 max-w-[240px] accent-amber-400"
                  />
                  <span className="font-mono text-amber-300 w-10">
                    {Math.round(dividerX * 100)}%
                  </span>
                </div>
                <span className="text-[11px] text-slate-500">
                  Align yellow dashed divider with your road median so both carriageways track
                  independently without false wrong-side alerts.
                </span>
              </div>
            )}
          </div>

          {/* Overlay Controls & Signal Phase Bar */}
          <div className="bg-[#0D1526] border border-slate-800/90 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-4 text-xs">
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.enableTrajectoryOverlay}
                  onChange={(e) =>
                    onUpdateSettings({ enableTrajectoryOverlay: e.target.checked })
                  }
                />
                <span>Trajectories</span>
              </label>
              <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.enableZonesOverlay}
                  onChange={(e) => onUpdateSettings({ enableZonesOverlay: e.target.checked })}
                />
                <span>Divider, Lanes &amp; Count Line</span>
              </label>
              <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.enableHeatmapOverlay}
                  onChange={(e) => onUpdateSettings({ enableHeatmapOverlay: e.target.checked })}
                />
                <span>Movement Heatmap</span>
              </label>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-slate-500">Signal State:</span>
              <select
                value={signalOverride}
                onChange={(e) => setSignalOverride(e.target.value as SignalState | 'auto')}
                className="h-7 rounded-md bg-[#060B17] border border-slate-700 px-2 text-xs text-slate-200"
              >
                <option value="auto">Auto (HSV ROI)</option>
                <option value="red">Red Phase (Test Red-Light Jump)</option>
                <option value="yellow">Yellow Phase</option>
                <option value="green">Green Phase</option>
              </select>
            </div>
          </div>
        </div>

        {/* Right Column: Live Performance + Active Tracks with 1-Click AI Inspect */}
        <div className="xl:col-span-4 space-y-4">
          <div className="bg-[#0D1526] border border-slate-800/90 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display font-semibold text-sm text-slate-100">
                Live Road Conditions
              </h3>
              <span className="font-mono text-xs tabular-nums text-slate-400">
                {stats.fps} FPS · {stats.congestionLevel}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-[#060B17] border border-slate-800/80 rounded-lg p-3">
                <div className="text-slate-500">Active In Frame</div>
                <div className="font-mono text-xl font-semibold tabular-nums text-blue-400 mt-0.5">
                  {stats.activeCount}
                </div>
              </div>
              <div className="bg-[#060B17] border border-slate-800/80 rounded-lg p-3">
                <div className="text-slate-500">Average Speed</div>
                <div className="font-mono text-base font-semibold tabular-nums text-slate-100 mt-1">
                  {camera.calibration.isCalibrated && stats.avgSpeedKmh !== null
                    ? `${stats.avgSpeedKmh} km/h`
                    : 'Uncalibrated'}
                </div>
              </div>
              <div className="bg-[#060B17] border border-slate-800/80 rounded-lg p-3">
                <div className="text-slate-500">Density (/100m)</div>
                <div className="font-mono text-base font-semibold tabular-nums text-slate-100 mt-0.5">
                  {stats.densityPer100m}
                </div>
              </div>
              <div className="bg-[#060B17] border border-slate-800/80 rounded-lg p-3">
                <div className="text-slate-500">Risk Score</div>
                <div className="font-mono text-base font-semibold tabular-nums text-slate-100 mt-0.5">
                  {stats.riskScore} / 100
                </div>
              </div>
            </div>
          </div>

          {/* Active Tracked Vehicles with Helmet / ANPR Inspect */}
          <div className="bg-[#0D1526] border border-slate-800/90 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display font-semibold text-sm text-slate-100">
                Currently In Frame ({activeTracks.length})
              </h3>
              <span className="text-[11px] text-slate-500">Helmet &amp; Plate Check</span>
            </div>

            {activeTracks.length === 0 ? (
              <div className="text-xs text-slate-500 py-5 text-center">
                Start playback to inspect individual vehicles in real time.
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {activeTracks.map((trk) => (
                  <div
                    key={trk.trackId}
                    className={`flex items-center justify-between gap-2 bg-[#060B17] border rounded-lg px-3 py-2 text-xs ${
                      trk.violations.length > 0 ? 'border-red-800/70' : 'border-slate-800/80'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-mono font-medium text-slate-100 truncate">
                        #{trk.trackId} {trk.category.toUpperCase()} ·{' '}
                        {Math.round(trk.confidence * 100)}%
                      </div>
                      <div className="text-slate-400 font-mono text-[11px] truncate">
                        {camera.calibration.isCalibrated && trk.speedKmh !== null
                          ? `${trk.speedKmh} km/h`
                          : 'Speed N/A'}{' '}
                        · {trk.direction}
                        {trk.violations.length > 0 && (
                          <span className="text-red-400">
                            {' '}
                            · {trk.violations.length} violation(s)
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleInspectTrackWithAI(trk)}
                      disabled={inspectingTrackId === trk.trackId}
                      className="px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-blue-600 text-slate-200 hover:text-white text-[11px] font-medium flex items-center gap-1 shrink-0 whitespace-nowrap disabled:opacity-50"
                    >
                      <Eye className="w-3 h-3" />
                      <span>{inspectingTrackId === trk.trackId ? 'Checking...' : 'Inspect'}</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* DEDICATED SECTION 1: WHO VIOLATED TRAFFIC RULES (VISUAL VIOLATOR CARDS) */}
      <div className="bg-[#0D1526] border border-slate-800/90 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display font-semibold text-base text-slate-100">
              Traffic Rule Violators Detected ({sessionViolations.length})
            </h3>
            <p className="text-xs text-slate-400">
              Every vehicle that broke a traffic rule (wrong-side driving, overspeeding, red-light
              jumping, no helmet, lane violation, or restricted zone) with captured visual evidence
            </p>
          </div>
          <span className="text-xs font-mono text-slate-400">
            Compliant: <span className="text-emerald-400">{compliantVehicleCount}</span> ·
            Violators: <span className="text-red-400">{violatorVehicleCount}</span>
          </span>
        </div>

        {sessionViolations.length === 0 ? (
          <div className="bg-[#060B17] border border-slate-800/80 rounded-lg p-8 text-center space-y-1.5">
            <CheckCircle2 className="w-6 h-6 text-slate-600 mx-auto" />
            <div className="text-xs font-medium text-slate-300">
              No Traffic Rule Violations Flagged Yet
            </div>
            <p className="text-xs text-slate-500 max-w-lg mx-auto">
              Run AI analysis on your uploaded video or live feed. Tip: To test Red-Light Jumping,
              switch Signal State to &ldquo;Red Phase&rdquo;; to check Helmet &amp; Indian Number
              Plates, click &ldquo;Inspect Frame (Helmet &amp; ANPR)&rdquo;.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {sessionViolations.map((v, idx) => (
              <div
                key={`${v.trackId}-${v.violationType}-${idx}`}
                className="bg-[#060B17] border border-red-900/50 rounded-xl overflow-hidden flex flex-col"
              >
                <div className="aspect-video bg-[#040812] relative overflow-hidden">
                  {v.cropDataUrl ? (
                    <img
                      src={v.cropDataUrl}
                      alt={`Violator vehicle track #${v.trackId}`}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-slate-600">
                      Snapshot saved to Evidence Gallery
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/45 to-transparent px-3 py-2 flex items-center justify-between text-xs">
                    <span className="font-semibold text-red-300">
                      {VIOLATION_LABELS[v.violationType] ?? v.violationType}
                    </span>
                    <span className="font-mono text-slate-200">
                      Track #{v.trackId} · {v.vehicleClass.toUpperCase()}
                    </span>
                  </div>
                </div>
                <div className="p-3.5 space-y-1.5 text-xs flex-1 flex flex-col justify-between">
                  <div className="text-slate-300 leading-relaxed">{v.notes}</div>
                  <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-slate-400">
                    <span>
                      Plate: {v.plateNumber || 'Unreadable'} ·{' '}
                      {v.speedKmh !== null ? `${v.speedKmh} km/h` : 'Speed N/A'}
                    </span>
                    <span
                      className={
                        v.verificationStatus === 'verified' ? 'text-red-400' : 'text-amber-400'
                      }
                    >
                      {v.verificationStatus === 'verified' ? 'Verified' : 'Review'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* DEDICATED SECTION 2: COMPLETE PASSED VEHICLES & RULE COMPLIANCE TABLE */}
      <div className="bg-[#0D1526] border border-slate-800/90 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800/90 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display font-semibold text-sm text-slate-100">
              All Vehicles Passed in This Video ({sessionVehicles.length})
            </h3>
            <p className="text-xs text-slate-500">
              Clear per-vehicle breakdown of every car, bike, bus &amp; truck — showing whether they
              followed rules or violated them
            </p>
          </div>

          <div className="flex flex-wrap items-center bg-[#060B17] border border-slate-800 rounded-lg p-1 text-xs">
            {(
              [
                ['all', `All (${sessionVehicles.length})`],
                ['car', `Cars (${stats.byClass.car})`],
                ['motorcycle', `Bikes (${stats.byClass.motorcycle + stats.byClass.bicycle})`],
                ['truck', `Trucks (${stats.byClass.truck})`],
                ['bus', `Buses (${stats.byClass.bus})`],
                ['violators', `Violators (${violatorVehicleCount})`],
                ['compliant', `Followed Rules (${compliantVehicleCount})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setVehicleLogFilter(key)}
                className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap ${
                  vehicleLogFilter === key
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800/90 text-slate-400 bg-[#080F1E]">
                <th className="py-3 px-4 font-medium">Vehicle ID</th>
                <th className="py-3 px-4 font-medium">Vehicle Type</th>
                <th className="py-3 px-4 font-medium">Direction</th>
                <th className="py-3 px-4 font-medium">Crossed Line</th>
                <th className="py-3 px-4 font-medium text-right">Speed</th>
                <th className="py-3 px-4 font-medium">Number Plate</th>
                <th className="py-3 px-4 font-medium">Helmet</th>
                <th className="py-3 px-4 font-medium">Traffic Rule Compliance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredSessionVehicles.length > 0 ? (
                filteredSessionVehicles.map((v) => {
                  const violated = v.violations.length > 0;
                  return (
                    <tr
                      key={v.trackId}
                      className={
                        violated
                          ? 'bg-red-950/15 hover:bg-red-950/25'
                          : 'hover:bg-slate-800/30'
                      }
                    >
                      <td className="py-2.5 px-4 font-mono font-semibold text-blue-300">
                        #{v.trackId}
                      </td>
                      <td className="py-2.5 px-4 capitalize text-slate-100 font-medium">
                        {v.category === 'motorcycle' ? 'Bike / Motorcycle' : v.category}
                      </td>
                      <td className="py-2.5 px-4 capitalize text-slate-300">{v.direction}</td>
                      <td className="py-2.5 px-4 font-mono text-slate-300">
                        {v.countedEntry
                          ? 'Yes (Inbound)'
                          : v.countedExit
                          ? 'Yes (Outbound)'
                          : 'Tracked'}
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-right text-slate-200">
                        {camera.calibration.isCalibrated && v.speedKmh !== null
                          ? `${v.speedKmh} km/h`
                          : 'Uncalibrated'}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-slate-200">
                        {v.plateNumber || <span className="text-slate-600">—</span>}
                      </td>
                      <td className="py-2.5 px-4 text-slate-300">
                        {v.category === 'motorcycle'
                          ? v.helmetStatus.replace('_', ' ')
                          : 'N/A'}
                      </td>
                      <td className="py-2.5 px-4 font-medium">
                        {violated ? (
                          <span className="text-red-400">
                            Violated:{' '}
                            {v.violations
                              .map((vt) => VIOLATION_LABELS[vt] ?? vt)
                              .join(', ')}
                          </span>
                        ) : (
                          <span className="text-emerald-400">Followed Rules</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-500">
                    No vehicles recorded in this session yet. Load a sample CCTV video or upload
                    your traffic clip and click Start AI Analysis.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
