import { Download, Image as ImageIcon, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { EvidenceRecord } from '../types/traffic';
import { VIOLATION_LABELS } from '../types/traffic';
import { api } from '../utils/api';

interface EvidenceGalleryPageProps {
  selectedCameraId: string;
  refreshTick: number;
}

export function EvidenceGalleryPage({ selectedCameraId, refreshTick }: EvidenceGalleryPageProps) {
  const [records, setRecords] = useState<EvidenceRecord[]>([]);
  const [selected, setSelected] = useState<EvidenceRecord | null>(null);

  useEffect(() => {
    api.getEvidence(selectedCameraId).then(setRecords).catch(console.error);
  }, [selectedCameraId, refreshTick]);

  return (
    <div className="space-y-6">
      <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-5 flex items-center justify-between gap-4">
        <div>
          <h2 className="font-display font-semibold text-base text-slate-100">
            Smart Violation Evidence Gallery ({records.length})
          </h2>
          <p className="text-xs text-slate-400">
            Automatically archived full-frame snapshots, vehicle crops, and number plate sub-crops
            linked to unique tracking IDs
          </p>
        </div>
      </div>

      {records.length === 0 ? (
        <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-12 text-center space-y-2">
          <ImageIcon className="w-8 h-8 text-slate-600 mx-auto" />
          <div className="text-sm font-medium text-slate-300">No Evidence Snapshots Saved Yet</div>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Evidence screenshots are automatically captured and persisted to disk whenever a traffic
            violation is triggered during Live Camera or Uploaded Video analysis.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {records.map((rec) => (
            <div
              key={rec.id}
              onClick={() => setSelected(rec)}
              className="bg-[#111827] border border-slate-800/80 hover:border-slate-700 rounded-xl overflow-hidden cursor-pointer transition-colors"
            >
              <div className="aspect-video bg-[#070B14] relative overflow-hidden">
                {rec.fullFrameUrl ? (
                  <img
                    src={rec.fullFrameUrl}
                    alt={`Full frame for ${rec.violationType}`}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs text-slate-600">
                    Full frame unavailable
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-3 py-2 flex items-center justify-between text-xs">
                  <span className="font-semibold text-red-300">
                    {VIOLATION_LABELS[rec.violationType] ?? rec.violationType}
                  </span>
                  <span className="font-mono text-slate-300">#{rec.trackId}</span>
                </div>
              </div>

              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
                  <span>{rec.cameraId}</span>
                  <span>{new Date(rec.timestamp).toLocaleString()}</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-[#0B1120] border border-slate-800 rounded-lg p-1.5">
                    <div className="text-[10px] text-slate-500 mb-1">Vehicle Crop</div>
                    {rec.vehicleCropUrl ? (
                      <img
                        src={rec.vehicleCropUrl}
                        alt="Vehicle crop"
                        className="w-full h-16 object-cover rounded"
                      />
                    ) : (
                      <div className="h-16 flex items-center justify-center text-[10px] text-slate-600">
                        N/A
                      </div>
                    )}
                  </div>
                  <div className="bg-[#0B1120] border border-slate-800 rounded-lg p-1.5">
                    <div className="text-[10px] text-slate-500 mb-1">Plate Region Crop</div>
                    {rec.plateCropUrl ? (
                      <img
                        src={rec.plateCropUrl}
                        alt="Plate crop"
                        className="w-full h-16 object-cover rounded"
                      />
                    ) : (
                      <div className="h-16 flex items-center justify-center text-[10px] text-slate-600">
                        N/A
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Evidence Detail Lightbox */}
      {selected && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#111827] border border-slate-700 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto p-5 space-y-4">
            <div className="flex items-center justify-between gap-4 border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-display font-semibold text-base text-slate-100">
                  Evidence Packet #{selected.id} ·{' '}
                  {VIOLATION_LABELS[selected.violationType] ?? selected.violationType}
                </h3>
                <div className="text-xs font-mono text-slate-400">
                  Camera: {selected.cameraId} · Track #{selected.trackId} ·{' '}
                  {new Date(selected.timestamp).toLocaleString()}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                aria-label="Close evidence viewer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {selected.fullFrameUrl && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Full Annotated Surveillance Frame</span>
                  <a
                    href={selected.fullFrameUrl}
                    download={`evidence_${selected.id}_full.jpg`}
                    className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Frame</span>
                  </a>
                </div>
                <img
                  src={selected.fullFrameUrl}
                  alt="Full evidence frame"
                  className="w-full rounded-lg border border-slate-800"
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {selected.vehicleCropUrl && (
                <div className="bg-[#0B1120] border border-slate-800 rounded-lg p-3 space-y-2">
                  <div className="text-xs text-slate-400">Vehicle Crop</div>
                  <img
                    src={selected.vehicleCropUrl}
                    alt="Vehicle crop"
                    className="w-full h-44 object-contain rounded"
                  />
                </div>
              )}
              {selected.plateCropUrl && (
                <div className="bg-[#0B1120] border border-slate-800 rounded-lg p-3 space-y-2">
                  <div className="text-xs text-slate-400">Number Plate Sub-Crop</div>
                  <img
                    src={selected.plateCropUrl}
                    alt="Plate crop"
                    className="w-full h-44 object-contain rounded"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
