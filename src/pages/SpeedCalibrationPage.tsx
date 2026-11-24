import { Check, Gauge, RotateCcw, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { computeHomographyMatrix } from '../cv/speedEstimator';
import type {
  CalibrationConfig,
  CameraConfiguration,
  NormalizedPoint,
  ViolationRecord,
} from '../types/traffic';
import { api } from '../utils/api';

interface SpeedCalibrationPageProps {
  camera: CameraConfiguration;
  onCameraUpdated: (cam: CameraConfiguration) => void;
  refreshTick: number;
}

const CORNER_LABELS = ['P1 (Far Left)', 'P2 (Far Right)', 'P3 (Near Right)', 'P4 (Near Left)'];

export function SpeedCalibrationPage({
  camera,
  onCameraUpdated,
  refreshTick,
}: SpeedCalibrationPageProps) {
  const [cal, setCal] = useState<CalibrationConfig>(camera.calibration);
  const [speedLimit, setSpeedLimit] = useState<number>(camera.speedLimitKmh);
  const [selectedCorner, setSelectedCorner] = useState<number>(0);
  const [refImageUrl, setRefImageUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [speedViolations, setSpeedViolations] = useState<ViolationRecord[]>([]);
  const stageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setCal(camera.calibration);
    setSpeedLimit(camera.speedLimitKmh);
  }, [camera]);

  useEffect(() => {
    api
      .getViolations({ cameraId: camera.id, violationType: 'overspeeding' })
      .then(setSpeedViolations)
      .catch(console.error);
  }, [camera.id, refreshTick]);

  const handleStageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.max(0.02, Math.min(0.98, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0.02, Math.min(0.98, (e.clientY - rect.top) / rect.height));
    const nextPts: [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint] = [
      ...cal.imagePoints,
    ] as [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint];
    nextPts[selectedCorner] = { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
    setCal((prev) => ({ ...prev, imagePoints: nextPts }));
    setSelectedCorner((selectedCorner + 1) % 4);
  };

  const matrixValid = computeHomographyMatrix({ ...cal, isCalibrated: true }) !== null;

  const handleSave = async (enableCalibration: boolean) => {
    setSaving(true);
    setSavedMsg(null);
    try {
      const updated = await api.updateCamera(camera.id, {
        speedLimitKmh: speedLimit,
        calibration: {
          ...cal,
          isCalibrated: enableCalibration && matrixValid,
        },
      });
      onCameraUpdated(updated);
      setSavedMsg(
        updated.calibration.isCalibrated
          ? 'Perspective homography calibration saved and activated. Speed estimation in km/h is now enabled for this camera.'
          : 'Camera marked as uncalibrated. Speed will display honestly as Uncalibrated (N/A).'
      );
    } catch (err) {
      setSavedMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleResetQuad = () => {
    setCal({
      isCalibrated: false,
      imagePoints: [
        { x: 0.32, y: 0.42 },
        { x: 0.68, y: 0.42 },
        { x: 0.88, y: 0.92 },
        { x: 0.12, y: 0.92 },
      ],
      realWidthMeters: 10.5,
      realLengthMeters: 30,
    });
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Interactive 4-Point Road Plane Calibration Canvas */}
        <div className="xl:col-span-8 bg-[#111827] border border-slate-800/80 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display font-semibold text-base text-slate-100">
                4-Point Projective Homography Calibration — {camera.id}
              </h2>
              <p className="text-xs text-slate-400">
                Click the road image to place the 4 ground-plane corners (P1→P4) forming a known
                real-world road rectangle. Speed in km/h is only computed when calibration is active.
              </p>
            </div>
            <label className="h-8 px-3 rounded-lg bg-[#0B1120] hover:bg-slate-800 border border-slate-700 text-xs text-slate-200 flex items-center gap-2 cursor-pointer whitespace-nowrap">
              <Upload className="w-3.5 h-3.5 text-blue-400" />
              <span>Load Camera Snapshot</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setRefImageUrl(URL.createObjectURL(f));
                }}
              />
            </label>
          </div>

          {/* Corner selector pills (interactive buttons) */}
          <div className="flex flex-wrap items-center gap-2">
            {CORNER_LABELS.map((label, idx) => (
              <button
                key={label}
                type="button"
                onClick={() => setSelectedCorner(idx)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  selectedCorner === idx
                    ? 'bg-blue-600 text-white'
                    : 'bg-[#0B1120] text-slate-400 border border-slate-800 hover:text-slate-100'
                }`}
              >
                {label}: ({(cal.imagePoints[idx].x * 100).toFixed(0)}%,{' '}
                {(cal.imagePoints[idx].y * 100).toFixed(0)}%)
              </button>
            ))}
          </div>

          {/* Interactive SVG Overlay Stage */}
          <div
            ref={stageRef}
            onClick={handleStageClick}
            className="relative aspect-video w-full rounded-lg overflow-hidden border border-slate-800 bg-[#070B14] cursor-crosshair select-none"
          >
            {refImageUrl ? (
              <img
                src={refImageUrl}
                alt="Camera reference road view"
                className="w-full h-full object-contain pointer-events-none"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center space-y-1 text-slate-600">
                  <Gauge className="w-8 h-8 mx-auto opacity-50" />
                  <div className="text-xs">
                    Road Perspective Grid (Upload a snapshot from {camera.id} for exact alignment)
                  </div>
                </div>
              </div>
            )}

            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute inset-0 w-full h-full pointer-events-none"
            >
              {/* Calibrated quadrilateral */}
              <polygon
                points={cal.imagePoints.map((p) => `${p.x * 100},${p.y * 100}`).join(' ')}
                fill="rgba(16, 185, 129, 0.16)"
                stroke="#10B981"
                strokeWidth="0.45"
              />
              {cal.imagePoints.map((p, idx) => (
                <g key={idx}>
                  <circle
                    cx={p.x * 100}
                    cy={p.y * 100}
                    r={selectedCorner === idx ? 1.8 : 1.3}
                    fill={selectedCorner === idx ? '#3B82F6' : '#10B981'}
                    stroke="#FFFFFF"
                    strokeWidth="0.35"
                  />
                  <text
                    x={p.x * 100 + 2}
                    y={p.y * 100 - 1.5}
                    fill="#F8FAFC"
                    fontSize="2.8"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    P{idx + 1}
                  </text>
                </g>
              ))}
            </svg>
          </div>
        </div>

        {/* Right Panel: Physical Dimensions & Activation */}
        <div className="xl:col-span-4 bg-[#111827] border border-slate-800/80 rounded-xl p-5 space-y-5">
          <div>
            <h3 className="font-display font-semibold text-sm text-slate-100">
              Physical Road Parameters
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Status:{' '}
              <span
                className={
                  camera.calibration.isCalibrated ? 'text-emerald-400 font-medium' : 'text-amber-400 font-medium'
                }
              >
                {camera.calibration.isCalibrated
                  ? 'Calibrated (Active km/h)'
                  : 'Uncalibrated (Speed N/A)'}
              </span>
            </p>
          </div>

          <div className="space-y-4 text-xs">
            <div>
              <label className="block text-slate-400 mb-1.5">
                Calibrated Road Width (Meters — e.g. 3 lanes × 3.5m = 10.5m)
              </label>
              <input
                type="number"
                min={2}
                max={60}
                step={0.5}
                value={cal.realWidthMeters}
                onChange={(e) =>
                  setCal((prev) => ({
                    ...prev,
                    realWidthMeters: Math.max(1, Number(e.target.value) || 3.5),
                  }))
                }
                className="w-full h-9 rounded-lg bg-[#0B1120] border border-slate-700 px-3 font-mono text-slate-100"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1.5">
                Calibrated Road Segment Length (Meters — P1→P4 distance)
              </label>
              <input
                type="number"
                min={5}
                max={200}
                step={1}
                value={cal.realLengthMeters}
                onChange={(e) =>
                  setCal((prev) => ({
                    ...prev,
                    realLengthMeters: Math.max(5, Number(e.target.value) || 25),
                  }))
                }
                className="w-full h-9 rounded-lg bg-[#0B1120] border border-slate-700 px-3 font-mono text-slate-100"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1.5">
                Enforced Road Speed Limit (km/h)
              </label>
              <input
                type="number"
                min={10}
                max={160}
                step={5}
                value={speedLimit}
                onChange={(e) => setSpeedLimit(Math.max(10, Number(e.target.value) || 50))}
                className="w-full h-9 rounded-lg bg-[#0B1120] border border-slate-700 px-3 font-mono text-slate-100"
              />
            </div>
          </div>

          <div className="pt-2 space-y-2">
            <button
              type="button"
              disabled={saving || !matrixValid}
              onClick={() => void handleSave(true)}
              className="w-full h-9 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              <Check className="w-4 h-4" />
              <span>Save & Enable Calibrated Speed</span>
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSave(false)}
                className="h-9 rounded-lg bg-[#0B1120] hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-medium"
              >
                Mark Uncalibrated
              </button>
              <button
                type="button"
                onClick={handleResetQuad}
                className="h-9 rounded-lg bg-[#0B1120] hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-medium flex items-center justify-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Quad</span>
              </button>
            </div>
          </div>

          {savedMsg && (
            <div className="bg-[#0B1120] border border-slate-700 rounded-lg p-3 text-xs text-slate-300">
              {savedMsg}
            </div>
          )}

          <div className="border-t border-slate-800 pt-4 text-xs text-slate-500 leading-relaxed">
            Methodology: Uses Direct Linear Transform (3×3 projective homography) from ground-contact
            bounding-box bottoms with a rolling median temporal window (≥350ms). Uncalibrated feeds
            never fabricate km/h from raw pixels.
          </div>
        </div>
      </div>

      {/* Overspeeding Violations Log */}
      <div className="bg-[#111827] border border-slate-800/80 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800/80">
          <h3 className="font-display font-semibold text-sm text-slate-100">
            Calibrated Overspeeding Records ({speedViolations.length})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800/80 text-slate-400">
                <th className="py-3 px-4 font-medium">Timestamp</th>
                <th className="py-3 px-4 font-medium">Track</th>
                <th className="py-3 px-4 font-medium">Vehicle</th>
                <th className="py-3 px-4 font-medium">Plate</th>
                <th className="py-3 px-4 font-medium text-right">Measured Speed</th>
                <th className="py-3 px-4 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {speedViolations.length > 0 ? (
                speedViolations.map((v) => (
                  <tr key={v.id} className="hover:bg-slate-800/30">
                    <td className="py-2.5 px-4 font-mono text-slate-300">
                      {new Date(v.timestamp).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-blue-300">#{v.trackId}</td>
                    <td className="py-2.5 px-4 capitalize text-slate-200">{v.vehicleClass}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-200">
                      {v.plateNumber || 'Unreadable'}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-right text-red-400 font-semibold">
                      {v.speedKmh !== null ? `${v.speedKmh} km/h` : 'N/A'}
                    </td>
                    <td className="py-2.5 px-4 text-slate-400">{v.notes}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    No overspeeding incidents recorded for {camera.id}.
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
