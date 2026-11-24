import { useEffect, useRef, useState } from 'react';
import type { VehicleRecord } from '../types/traffic';
import { api } from '../utils/api';

interface TrackingPageProps {
  selectedCameraId: string;
  refreshTick: number;
}

interface TrackRow {
  id: number;
  cameraId: string;
  trackId: number;
  sessionId: string;
  points: Array<{ x: number; y: number; t: number }>;
  direction: string;
  enteredLine: boolean;
  exitedLine: boolean;
  createdAt: string;
}

export function TrackingPage({ selectedCameraId, refreshTick }: TrackingPageProps) {
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [classFilter, setClassFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'both' | 'trajectories' | 'heatmap'>('both');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.getTracks(selectedCameraId),
      api.getVehicles(selectedCameraId, classFilter),
    ])
      .then(([tData, vData]) => {
        if (!active) return;
        setTracks(tData);
        setVehicles(vData);
      })
      .catch(console.error);
    return () => {
      active = false;
    };
  }, [selectedCameraId, classFilter, refreshTick]);

  // Render recorded trajectories & density heatmap onto canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#070B14';
    ctx.fillRect(0, 0, W, H);

    // Subtle reference grid
    ctx.strokeStyle = 'rgba(51, 65, 85, 0.25)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += W / 8) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 0; y <= H; y += H / 6) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // Density heatmap layer
    if (viewMode === 'both' || viewMode === 'heatmap') {
      for (const trk of tracks) {
        for (const pt of trk.points) {
          const px = pt.x * W;
          const py = pt.y * H;
          const grad = ctx.createRadialGradient(px, py, 1, px, py, 22);
          grad.addColorStop(
            0,
            trk.direction === 'outbound'
              ? 'rgba(249, 115, 22, 0.18)'
              : 'rgba(59, 130, 246, 0.18)'
          );
          grad.addColorStop(1, 'rgba(59, 130, 246, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(px, py, 22, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Trajectory polylines
    if (viewMode === 'both' || viewMode === 'trajectories') {
      for (const trk of tracks) {
        if (trk.points.length < 2) continue;
        ctx.beginPath();
        trk.points.forEach((pt, idx) => {
          const px = pt.x * W;
          const py = pt.y * H;
          if (idx === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.strokeStyle =
          trk.direction === 'inbound'
            ? 'rgba(16, 185, 129, 0.8)'
            : trk.direction === 'outbound'
            ? 'rgba(249, 115, 22, 0.8)'
            : 'rgba(148, 163, 184, 0.65)';
        ctx.lineWidth = 2;
        ctx.stroke();

        const last = trk.points[trk.points.length - 1];
        ctx.fillStyle = '#F8FAFC';
        ctx.beginPath();
        ctx.arc(last.x * W, last.y * H, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [tracks, viewMode]);

  const inboundTotal = tracks.filter((t) => t.direction === 'inbound').length;
  const outboundTotal = tracks.filter((t) => t.direction === 'outbound').length;

  return (
    <div className="space-y-6">
      {/* Trajectory & Spatial Heatmap Visualizer */}
      <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display font-semibold text-base text-slate-100">
              Vehicle Movement Trajectories & Spatial Heatmap
            </h2>
            <p className="text-xs text-slate-500">
              Recorded normalized ground-contact paths from ByteTrack ({tracks.length} persisted
              tracks · Inbound: {inboundTotal} · Outbound: {outboundTotal})
            </p>
          </div>
          <div className="flex items-center bg-[#0B1120] border border-slate-800 rounded-lg p-1 text-xs">
            {(['both', 'trajectories', 'heatmap'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setViewMode(m)}
                className={`px-3 py-1 rounded-md font-medium capitalize transition-colors ${
                  viewMode === m ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <div className="relative rounded-lg overflow-hidden border border-slate-800 bg-[#070B14]">
          <canvas ref={canvasRef} width={960} height={440} className="w-full h-auto block" />
          {tracks.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-500">
              Run Live Camera or Upload Traffic Video to record real vehicle movement trajectories.
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-6 text-xs text-slate-400">
          <span>Green lines: Inbound / Permitted heading</span>
          <span>Orange lines: Outbound / Opposing heading</span>
          <span>Blue glow: High-density vehicle flow corridor</span>
        </div>
      </div>

      {/* Tracked Vehicles Ledger */}
      <div className="bg-[#111827] border border-slate-800/80 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display font-semibold text-sm text-slate-100">
              Unique Tracked Vehicles Ledger ({vehicles.length})
            </h3>
            <p className="text-xs text-slate-500">
              Each tracked vehicle is deduplicated by (Camera ID, Session, Track ID)
            </p>
          </div>
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="h-8 rounded-lg bg-[#0B1120] border border-slate-700 px-3 text-xs text-slate-200"
          >
            <option value="all">All Classes</option>
            <option value="car">Car</option>
            <option value="motorcycle">Motorcycle</option>
            <option value="bus">Bus</option>
            <option value="truck">Truck</option>
            <option value="auto_rickshaw">Auto-rickshaw</option>
            <option value="bicycle">Bicycle</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800/80 text-slate-400">
                <th className="py-3 px-4 font-medium">Track ID</th>
                <th className="py-3 px-4 font-medium">Camera</th>
                <th className="py-3 px-4 font-medium">Class</th>
                <th className="py-3 px-4 font-medium">Direction</th>
                <th className="py-3 px-4 font-medium">Plate</th>
                <th className="py-3 px-4 font-medium text-right">Avg Speed</th>
                <th className="py-3 px-4 font-medium text-right">Max Speed</th>
                <th className="py-3 px-4 font-medium text-right">Confidence</th>
                <th className="py-3 px-4 font-medium">Last Seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {vehicles.length > 0 ? (
                vehicles.map((v) => (
                  <tr key={v.id} className="hover:bg-slate-800/30">
                    <td className="py-2.5 px-4 font-mono text-blue-300">#{v.trackId}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-300">{v.cameraId}</td>
                    <td className="py-2.5 px-4 capitalize text-slate-100">{v.vehicleClass}</td>
                    <td className="py-2.5 px-4 capitalize text-slate-300">{v.direction}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-200">
                      {v.plateNumber || <span className="text-slate-500">—</span>}
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-right text-slate-200">
                      {v.avgSpeedKmh !== null ? `${v.avgSpeedKmh} km/h` : 'Uncalibrated'}
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-right text-slate-300">
                      {v.maxSpeedKmh !== null ? `${v.maxSpeedKmh} km/h` : '—'}
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-right text-slate-300">
                      {Math.round(v.confidence * 100)}%
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-400 whitespace-nowrap">
                      {new Date(v.lastSeen).toLocaleTimeString()}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-500">
                    No tracked vehicles recorded for this filter.
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
