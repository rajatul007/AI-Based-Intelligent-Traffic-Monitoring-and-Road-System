import { Plus, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { AiModelSettings, CameraConfiguration, VehicleCategory } from '../types/traffic';
import { api } from '../utils/api';

interface SettingsPageProps {
  cameras: CameraConfiguration[];
  settings: AiModelSettings;
  onUpdateSettings: (patch: Partial<AiModelSettings>) => void;
  onCamerasChanged: () => void;
  onTelemetryCleared: () => void;
}

const ALL_VEHICLE_CLASSES: VehicleCategory[] = [
  'car',
  'motorcycle',
  'bus',
  'truck',
  'auto_rickshaw',
  'bicycle',
];

export function SettingsPage({
  cameras,
  settings,
  onUpdateSettings,
  onCamerasChanged,
  onTelemetryCleared,
}: SettingsPageProps) {
  const [newCamId, setNewCamId] = useState('');
  const [newCamName, setNewCamName] = useState('');
  const [newCamLocation, setNewCamLocation] = useState('');
  const [newCamSourceType, setNewCamSourceType] =
    useState<CameraConfiguration['sourceType']>('webcam');
  const [newCamUri, setNewCamUri] = useState('');
  const [newCamSpeedLimit, setNewCamSpeedLimit] = useState(50);
  const [newCamDirDeg, setNewCamDirDeg] = useState(90);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const handleAddCamera = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      await api.createCamera({
        id: newCamId.trim() || undefined,
        name: newCamName.trim() || 'Traffic Corridor Camera',
        location: newCamLocation.trim() || 'Smart City Sector',
        sourceType: newCamSourceType,
        sourceUri: newCamUri.trim(),
        speedLimitKmh: newCamSpeedLimit,
        permittedDirection:
          newCamDirDeg === 90
            ? 'Southbound (Top → Bottom)'
            : newCamDirDeg === 270
            ? 'Northbound (Bottom → Top)'
            : newCamDirDeg === 0
            ? 'Eastbound (Left → Right)'
            : 'Westbound (Right → Left)',
      });
      setNewCamId('');
      setNewCamName('');
      setNewCamLocation('');
      setNewCamUri('');
      setFeedback('Camera profile saved to SQLite.');
      onCamerasChanged();
    } catch (err) {
      setFeedback((err as Error).message);
    }
  };

  const handleDeleteCamera = async (id: string) => {
    if (cameras.length <= 1) {
      setFeedback('At least one active camera configuration is required.');
      return;
    }
    try {
      await api.deleteCamera(id);
      setFeedback(`Deleted camera ${id}.`);
      onCamerasChanged();
    } catch (err) {
      setFeedback((err as Error).message);
    }
  };

  const handleToggleClass = (cls: VehicleCategory) => {
    const exists = settings.enabledClasses.includes(cls);
    const next = exists
      ? settings.enabledClasses.filter((c) => c !== cls)
      : [...settings.enabledClasses, cls];
    if (next.length > 0) {
      onUpdateSettings({ enabledClasses: next });
    }
  };

  const handleClearDb = async () => {
    try {
      await api.clearTelemetry();
      setConfirmClear(false);
      setFeedback('All recorded vehicles, tracks, plates, violations, and statistics cleared.');
      onTelemetryCleared();
    } catch (err) {
      setFeedback((err as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      {feedback && (
        <div className="bg-[#111827] border border-blue-800/60 rounded-xl px-4 py-3 text-xs text-blue-200">
          {feedback}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* AI Model & Congestion Threshold Settings */}
        <div className="xl:col-span-6 bg-[#111827] border border-slate-800/80 rounded-xl p-5 space-y-5">
          <div>
            <h2 className="font-display font-semibold text-base text-slate-100">
              AI Detection & Analytics Parameters
            </h2>
            <p className="text-xs text-slate-400">
              Configure real-time COCO-SSD inference sensitivity, class filters, and congestion
              density thresholds
            </p>
          </div>

          <div className="space-y-4 text-xs">
            <div>
              <div className="flex justify-between text-slate-300 mb-1">
                <span>Detection Confidence Threshold</span>
                <span className="font-mono">{Math.round(settings.confidenceThreshold * 100)}%</span>
              </div>
              <input
                type="range"
                min={0.2}
                max={0.85}
                step={0.05}
                value={settings.confidenceThreshold}
                onChange={(e) =>
                  onUpdateSettings({ confidenceThreshold: Number(e.target.value) })
                }
                className="w-full accent-blue-500"
              />
            </div>

            <div>
              <div className="flex justify-between text-slate-300 mb-1">
                <span>Frame Inference Interval</span>
                <span className="font-mono">{settings.inferenceIntervalMs} ms</span>
              </div>
              <input
                type="range"
                min={60}
                max={500}
                step={20}
                value={settings.inferenceIntervalMs}
                onChange={(e) =>
                  onUpdateSettings({ inferenceIntervalMs: Number(e.target.value) })
                }
                className="w-full accent-blue-500"
              />
            </div>

            <div>
              <div className="text-slate-300 mb-2">Tracked Vehicle Classes</div>
              <div className="flex flex-wrap gap-2">
                {ALL_VEHICLE_CLASSES.map((cls) => {
                  const active = settings.enabledClasses.includes(cls);
                  return (
                    <button
                      key={cls}
                      type="button"
                      onClick={() => handleToggleClass(cls)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                        active
                          ? 'bg-blue-600 text-white'
                          : 'bg-[#0B1120] text-slate-400 border border-slate-800'
                      }`}
                    >
                      {cls.replace('_', '-')}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800/80 space-y-3">
              <div className="text-slate-300 font-medium">
                Congestion Thresholds (Vehicles per 100m)
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-500 mb-1">Moderate ≥</label>
                  <input
                    type="number"
                    min={2}
                    max={40}
                    value={settings.congestionThresholds.moderateDensity}
                    onChange={(e) =>
                      onUpdateSettings({
                        congestionThresholds: {
                          ...settings.congestionThresholds,
                          moderateDensity: Number(e.target.value) || 6,
                        },
                      })
                    }
                    className="w-full h-8 rounded-lg bg-[#0B1120] border border-slate-700 px-2.5 font-mono text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 mb-1">High ≥</label>
                  <input
                    type="number"
                    min={4}
                    max={60}
                    value={settings.congestionThresholds.highDensity}
                    onChange={(e) =>
                      onUpdateSettings({
                        congestionThresholds: {
                          ...settings.congestionThresholds,
                          highDensity: Number(e.target.value) || 12,
                        },
                      })
                    }
                    className="w-full h-8 rounded-lg bg-[#0B1120] border border-slate-700 px-2.5 font-mono text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 mb-1">Severe ≥</label>
                  <input
                    type="number"
                    min={8}
                    max={100}
                    value={settings.congestionThresholds.severeDensity}
                    onChange={(e) =>
                      onUpdateSettings({
                        congestionThresholds: {
                          ...settings.congestionThresholds,
                          severeDensity: Number(e.target.value) || 20,
                        },
                      })
                    }
                    className="w-full h-8 rounded-lg bg-[#0B1120] border border-slate-700 px-2.5 font-mono text-slate-100"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Database Maintenance */}
          <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between gap-4">
            <div className="text-xs text-slate-400">
              Clear recorded telemetry while keeping camera profiles
            </div>
            {!confirmClear ? (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="h-8 px-3 rounded-lg bg-red-950/60 hover:bg-red-900/70 border border-red-800/60 text-red-200 text-xs font-medium whitespace-nowrap"
              >
                Reset Telemetry DB
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleClearDb()}
                  className="h-8 px-3 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold"
                >
                  Confirm Clear
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="h-8 px-3 rounded-lg bg-slate-800 text-slate-300 text-xs"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Add New Camera Form */}
        <form
          onSubmit={(e) => void handleAddCamera(e)}
          className="xl:col-span-6 bg-[#111827] border border-slate-800/80 rounded-xl p-5 space-y-4 text-xs"
        >
          <div>
            <h2 className="font-display font-semibold text-base text-slate-100">
              Add Camera Configuration
            </h2>
            <p className="text-xs text-slate-400">
              Register a new CCTV, USB, webcam, or video corridor profile in SQLite
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Camera ID</label>
              <input
                type="text"
                value={newCamId}
                onChange={(e) => setNewCamId(e.target.value)}
                placeholder="CAM-PUN-04"
                className="w-full h-9 rounded-lg bg-[#0B1120] border border-slate-700 px-3 font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Camera Name *</label>
              <input
                type="text"
                required
                value={newCamName}
                onChange={(e) => setNewCamName(e.target.value)}
                placeholder="Hinjewadi Phase 1 Junction"
                className="w-full h-9 rounded-lg bg-[#0B1120] border border-slate-700 px-3 text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">City / Intersection Location</label>
              <input
                type="text"
                value={newCamLocation}
                onChange={(e) => setNewCamLocation(e.target.value)}
                placeholder="Pune, MH"
                className="w-full h-9 rounded-lg bg-[#0B1120] border border-slate-700 px-3 text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Source Type</label>
              <select
                value={newCamSourceType}
                onChange={(e) =>
                  setNewCamSourceType(e.target.value as CameraConfiguration['sourceType'])
                }
                className="w-full h-9 rounded-lg bg-[#0B1120] border border-slate-700 px-3 text-slate-100"
              >
                <option value="webcam">Laptop Webcam</option>
                <option value="usb">USB Camera</option>
                <option value="ip_http">IP CCTV (HTTP/HLS)</option>
                <option value="rtsp">RTSP Stream (via Gateway)</option>
                <option value="video_file">Uploaded Video Archive</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Speed Limit (km/h)</label>
              <input
                type="number"
                min={10}
                max={160}
                value={newCamSpeedLimit}
                onChange={(e) => setNewCamSpeedLimit(Number(e.target.value) || 50)}
                className="w-full h-9 rounded-lg bg-[#0B1120] border border-slate-700 px-3 font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Permitted Road Heading</label>
              <select
                value={newCamDirDeg}
                onChange={(e) => setNewCamDirDeg(Number(e.target.value))}
                className="w-full h-9 rounded-lg bg-[#0B1120] border border-slate-700 px-3 text-slate-100"
              >
                <option value={90}>Southbound (Top → Bottom)</option>
                <option value={270}>Northbound (Bottom → Top)</option>
                <option value={0}>Eastbound (Left → Right)</option>
                <option value={180}>Westbound (Right → Left)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Stream URL / Camera URI (Optional)</label>
            <input
              type="text"
              value={newCamUri}
              onChange={(e) => setNewCamUri(e.target.value)}
              placeholder="https://gateway.local/cam04/index.m3u8"
              className="w-full h-9 rounded-lg bg-[#0B1120] border border-slate-700 px-3 font-mono text-slate-100"
            />
          </div>

          <button
            type="submit"
            className="h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Register Camera</span>
          </button>
        </form>
      </div>

      {/* Registered Cameras Table */}
      <div className="bg-[#111827] border border-slate-800/80 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800/80">
          <h3 className="font-display font-semibold text-sm text-slate-100">
            Configured Cameras ({cameras.length})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800/80 text-slate-400">
                <th className="py-3 px-4 font-medium">Camera ID</th>
                <th className="py-3 px-4 font-medium">Name & Location</th>
                <th className="py-3 px-4 font-medium">Source Type</th>
                <th className="py-3 px-4 font-medium text-right">Speed Limit</th>
                <th className="py-3 px-4 font-medium">Calibration</th>
                <th className="py-3 px-4 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {cameras.map((c) => (
                <tr key={c.id} className="hover:bg-slate-800/30">
                  <td className="py-3 px-4 font-mono text-blue-300">{c.id}</td>
                  <td className="py-3 px-4">
                    <div className="font-medium text-slate-100">{c.name}</div>
                    <div className="text-[11px] text-slate-500">{c.location}</div>
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-300">{c.sourceType}</td>
                  <td className="py-3 px-4 font-mono text-right text-slate-200">
                    {c.speedLimitKmh} km/h
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={
                        c.calibration.isCalibrated ? 'text-emerald-400' : 'text-amber-400'
                      }
                    >
                      {c.calibration.isCalibrated ? 'Homography Active' : 'Uncalibrated'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => void handleDeleteCamera(c.id)}
                      className="p-1.5 rounded text-slate-400 hover:text-red-400 hover:bg-slate-800"
                      title="Delete camera"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Honest Model Limitations & Validation Note */}
      <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-5 space-y-2 text-xs text-slate-400 leading-relaxed">
        <div className="flex items-center gap-2 text-slate-200 font-display font-semibold text-sm">
          <Save className="w-4 h-4 text-blue-400" />
          <span>Model Capabilities, Honest Limitations & Validation Guidelines</span>
        </div>
        <p>
          Real-time vehicle bounding boxes run on TensorFlow.js COCO-SSD (cars, motorcycles, buses,
          trucks, bicycles, persons, traffic lights) paired with a two-stage ByteTrack-style tracker.
          Because standard COCO weights do not contain a dedicated Indian auto-rickshaw class or
          helmet head-crop class, use the Inspect Track / Inspect Frame AI Vision actions to perform
          server-side Indian ANPR OCR, auto-rickshaw recognition, helmet verification, triple riding
          verification, and cabin seat-belt/mobile checks. Any ambiguous or low-resolution frame is
          flagged as Requires Review rather than issuing fabricated violations.
        </p>
      </div>
    </div>
  );
}
