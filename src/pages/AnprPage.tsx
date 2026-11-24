import { Check, Edit3, ScanText, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { NumberPlateRecord, VisionVerificationResult } from '../types/traffic';
import { api } from '../utils/api';

interface AnprPageProps {
  selectedCameraId: string;
  activeCameraId: string;
  refreshTick: number;
  onDataUpdated: () => void;
}

export function AnprPage({
  selectedCameraId,
  activeCameraId,
  refreshTick,
  onDataUpdated,
}: AnprPageProps) {
  const [plates, setPlates] = useState<NumberPlateRecord[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<VisionVerificationResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const loadPlates = () => {
    api.getPlates(selectedCameraId).then(setPlates).catch(console.error);
  };

  useEffect(() => {
    loadPlates();
  }, [selectedCameraId, refreshTick]);

  const handleSaveCorrection = async (id: number) => {
    if (!editValue.trim()) return;
    try {
      await api.correctPlate(id, editValue.trim());
      setEditingId(null);
      setEditValue('');
      loadPlates();
      onDataUpdated();
    } catch (err) {
      setScanError((err as Error).message);
    }
  };

  const handleScanPhoto = async (file: File | null) => {
    if (!file) return;
    setScanError(null);
    setScanResult(null);
    setScanning(true);

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result || '');
      setPreviewUrl(dataUrl);
      try {
        const res = await api.verifyVehicleVision({
          vehicleCropBase64: dataUrl,
          vehicleClass: 'vehicle',
        });
        setScanResult(res);

        // Save to SQLite ONLY if OCR returned characters (never invent plates on failure)
        if (res.plateText) {
          await api.ingestBatch({
            cameraId: activeCameraId,
            sessionId: `anpr_manual_${Date.now()}`,
            plates: [
              {
                trackId: Math.floor(Date.now() % 10000),
                rawText: res.plateText,
                normalizedPlate: res.normalizedPlate,
                isValidIndianFormat: res.isValidIndianFormat,
                ocrConfidence: res.ocrConfidence,
                plateImageBase64: dataUrl,
                timestamp: new Date().toISOString(),
              },
            ],
          });
          loadPlates();
          onDataUpdated();
        }
      } catch (err) {
        setScanError((err as Error).message || 'ANPR scan failed.');
      } finally {
        setScanning(false);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-6">
      {/* Direct Indian ANPR Plate Photo Scanner */}
      <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display font-semibold text-base text-slate-100">
              Indian Automatic Number Plate Recognition (ANPR)
            </h2>
            <p className="text-xs text-slate-400">
              Supports Indian RTO formats (DL01AB1234, HR26DK1234, UP16AB1234, MH12AB1234, BH
              series). Never fabricates plate strings when OCR fails.
            </p>
          </div>
          <label className="h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-2 cursor-pointer transition-colors whitespace-nowrap">
            <Upload className="w-3.5 h-3.5" />
            <span>{scanning ? 'Running OCR...' : 'Scan Vehicle / Plate Photo'}</span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={scanning}
              onChange={(e) => void handleScanPhoto(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>

        {scanError && (
          <div className="bg-red-950/40 border border-red-800/60 rounded-lg px-4 py-2.5 text-xs text-red-200">
            {scanError}
          </div>
        )}

        {scanResult && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 bg-[#0B1120] border border-slate-800 rounded-lg p-4 items-center">
            {previewUrl && (
              <div className="md:col-span-3">
                <img
                  src={previewUrl}
                  alt="Scanned vehicle crop"
                  className="w-full h-28 object-cover rounded-md border border-slate-800"
                />
              </div>
            )}
            <div className="md:col-span-9 space-y-2 text-xs">
              <div className="flex flex-wrap items-center gap-4">
                <div>
                  <span className="text-slate-500">Normalized Plate: </span>
                  <span className="font-mono text-base font-semibold text-slate-100">
                    {scanResult.normalizedPlate || 'Unreadable (Not Invented)'}
                  </span>
                </div>
                <span className="text-slate-500">·</span>
                <span
                  className={
                    scanResult.isValidIndianFormat ? 'text-emerald-400 font-medium' : 'text-amber-400'
                  }
                >
                  {scanResult.plateText
                    ? scanResult.isValidIndianFormat
                      ? 'Valid Indian RTO Format'
                      : 'Non-Standard / Manual Check Needed'
                    : 'No Legible Characters'}
                </span>
                <span className="text-slate-500">·</span>
                <span className="font-mono text-slate-300">
                  OCR Conf: {Math.round(scanResult.ocrConfidence * 100)}%
                </span>
              </div>
              <div className="text-slate-400">
                Helmet: {scanResult.helmetStatus} · Vehicle: {scanResult.vehicleSubType || 'Unknown'}{' '}
                · {scanResult.evidenceSummary}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Persisted ANPR Ledger with Manual Correction */}
      <div className="bg-[#111827] border border-slate-800/80 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between">
          <div>
            <h3 className="font-display font-semibold text-sm text-slate-100">
              Recognized Registration Plates ({plates.length})
            </h3>
            <p className="text-xs text-slate-500">
              Click Correct to manually fix unclear OCR reads and synchronize linked violation
              records
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800/80 text-slate-400">
                <th className="py-3 px-4 font-medium">Plate Crop</th>
                <th className="py-3 px-4 font-medium">Camera / Track</th>
                <th className="py-3 px-4 font-medium">Raw OCR</th>
                <th className="py-3 px-4 font-medium">Normalized / Corrected</th>
                <th className="py-3 px-4 font-medium">RTO Format</th>
                <th className="py-3 px-4 font-medium text-right">OCR Conf</th>
                <th className="py-3 px-4 font-medium">Timestamp</th>
                <th className="py-3 px-4 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {plates.length > 0 ? (
                plates.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-800/30">
                    <td className="py-2.5 px-4">
                      {p.plateImageUrl ? (
                        <img
                          src={p.plateImageUrl}
                          alt={`Plate crop for track ${p.trackId}`}
                          className="w-24 h-10 object-cover rounded border border-slate-700 bg-slate-950"
                        />
                      ) : (
                        <span className="text-slate-600 font-mono">No crop</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-300">
                      {p.cameraId} · #{p.trackId}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-400">{p.rawText}</td>
                    <td className="py-2.5 px-4 font-mono font-semibold text-slate-100">
                      {editingId === p.id ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value.toUpperCase())}
                            placeholder="DL01AB1234"
                            className="h-7 w-32 rounded bg-[#0B1120] border border-blue-500 px-2 font-mono text-xs text-white"
                          />
                          <button
                            type="button"
                            onClick={() => void handleSaveCorrection(p.id)}
                            className="p-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white"
                            aria-label="Save plate correction"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <span>
                          {p.correctedPlate || p.normalizedPlate || '—'}
                          {p.correctedPlate && (
                            <span className="text-blue-400 text-[11px] font-normal ml-2">
                              (Edited)
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-4">
                      <span
                        className={
                          p.isValidIndianFormat ? 'text-emerald-400' : 'text-amber-400'
                        }
                      >
                        {p.isValidIndianFormat ? 'Valid RTO' : 'Needs Check'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-right text-slate-300">
                      {Math.round(p.ocrConfidence * 100)}%
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-400 whitespace-nowrap">
                      {new Date(p.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(p.id);
                          setEditValue(p.correctedPlate || p.normalizedPlate || p.rawText);
                        }}
                        className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 font-medium"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Correct</span>
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-500">
                    <div className="flex flex-col items-center gap-2">
                      <ScanText className="w-5 h-5 text-slate-600" />
                      <span>
                        No Indian number plates recorded yet. Inspect a tracked vehicle or upload a
                        plate photo above.
                      </span>
                    </div>
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
