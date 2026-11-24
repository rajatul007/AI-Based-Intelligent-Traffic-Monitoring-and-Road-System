import { CheckCircle2, Eye, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  DashboardSummary,
  VerificationStatus,
  ViolationRecord,
  ViolationType,
} from '../types/traffic';
import { VIOLATION_DETECTION_METHOD, VIOLATION_LABELS } from '../types/traffic';
import { api } from '../utils/api';

interface ViolationsPageProps {
  selectedCameraId: string;
  summary: DashboardSummary | null;
  refreshTick: number;
  onDataUpdated: () => void;
}

export function ViolationsPage({
  selectedCameraId,
  summary,
  refreshTick,
  onDataUpdated,
}: ViolationsPageProps) {
  const [violations, setViolations] = useState<ViolationRecord[]>([]);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showMatrix, setShowMatrix] = useState<boolean>(false);

  const loadViolations = () => {
    api
      .getViolations({
        cameraId: selectedCameraId,
        violationType: typeFilter,
        status: statusFilter,
      })
      .then(setViolations)
      .catch(console.error);
  };

  useEffect(() => {
    loadViolations();
  }, [selectedCameraId, typeFilter, statusFilter, refreshTick]);

  const handleStatusChange = async (id: number, status: VerificationStatus) => {
    try {
      await api.updateViolationStatus(id, status);
      loadViolations();
      onDataUpdated();
    } catch (err) {
      console.error(err);
    }
  };

  const allTypes = Object.keys(VIOLATION_LABELS) as ViolationType[];

  return (
    <div className="space-y-6">
      {/* Header Controls & Honest 14-Rule Architecture Disclosure */}
      <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display font-semibold text-base text-slate-100">
              Traffic Violations, Helmet Detection & Review Queue
            </h2>
            <p className="text-xs text-slate-400">
              All 14 modular violation rules enforce deduplication per tracked vehicle. Uncertain
              visual detections route to human review rather than firing false citations.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowMatrix(!showMatrix)}
            className="h-9 px-3.5 rounded-lg bg-[#0B1120] hover:bg-slate-800 border border-slate-700 text-xs font-medium text-slate-200 whitespace-nowrap"
          >
            {showMatrix ? 'Hide 14-Rule Methodology Matrix' : 'View 14-Rule Methodology Matrix'}
          </button>
        </div>

        {showMatrix && (
          <div className="overflow-x-auto border-t border-slate-800/80 pt-4">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 px-3 font-medium">Violation Rule</th>
                  <th className="py-2 px-3 font-medium">Detection Architecture</th>
                  <th className="py-2 px-3 font-medium">Reliability</th>
                  <th className="py-2 px-3 font-medium">Honest Safeguards</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {allTypes.map((t) => {
                  const info = VIOLATION_DETECTION_METHOD[t];
                  return (
                    <tr key={t}>
                      <td className="py-2 px-3 font-medium text-slate-200 whitespace-nowrap">
                        {VIOLATION_LABELS[t]}
                      </td>
                      <td className="py-2 px-3 text-slate-300">{info.engine}</td>
                      <td className="py-2 px-3 text-slate-400 whitespace-nowrap">
                        {info.reliability}
                      </td>
                      <td className="py-2 px-3 text-slate-400">{info.notes}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Multi-Violation Intelligence Panel */}
      {summary && summary.multiViolationVehicles.length > 0 && (
        <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-5 space-y-3">
          <div>
            <h3 className="font-display font-semibold text-sm text-slate-100">
              Multi-Violation Intelligence ({summary.multiViolationVehicles.length} Tracked Vehicles)
            </h3>
            <p className="text-xs text-slate-500">
              Vehicles linked to multiple distinct violations under the same unique tracking ID
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {summary.multiViolationVehicles.map((mv) => (
              <div
                key={`${mv.cameraId}-${mv.trackId}`}
                className="bg-[#0B1120] border border-slate-800 rounded-lg p-3 text-xs space-y-1"
              >
                <div className="flex items-center justify-between font-mono">
                  <span className="text-slate-100 font-semibold">
                    {mv.cameraId} · #{mv.trackId}
                  </span>
                  <span className="text-red-400 font-semibold">{mv.violationCount} violations</span>
                </div>
                <div className="text-slate-400">
                  {mv.vehicleClass} · Plate: {mv.plateNumber || 'Unreadable'}
                </div>
                <div className="text-slate-300 text-[11px]">
                  {mv.types.map((t) => VIOLATION_LABELS[t as ViolationType] ?? t).join(' · ')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Violations Table */}
      <div className="bg-[#111827] border border-slate-800/80 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-display font-semibold text-sm text-slate-100">
            Violation Incidents ({violations.length})
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="h-8 rounded-lg bg-[#0B1120] border border-slate-700 px-3 text-xs text-slate-200"
            >
              <option value="all">All Violation Types</option>
              {allTypes.map((t) => (
                <option key={t} value={t}>
                  {VIOLATION_LABELS[t]}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-8 rounded-lg bg-[#0B1120] border border-slate-700 px-3 text-xs text-slate-200"
            >
              <option value="all">All Statuses</option>
              <option value="verified">Verified</option>
              <option value="requires_review">Requires Review</option>
              <option value="dismissed">Dismissed</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800/80 text-slate-400">
                <th className="py-3 px-4 font-medium">Time</th>
                <th className="py-3 px-4 font-medium">Camera</th>
                <th className="py-3 px-4 font-medium">Violation</th>
                <th className="py-3 px-4 font-medium">Track / Class</th>
                <th className="py-3 px-4 font-medium">Plate</th>
                <th className="py-3 px-4 font-medium">Evidence</th>
                <th className="py-3 px-4 font-medium text-right">Conf</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-4 font-medium text-right">Review Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {violations.length > 0 ? (
                violations.map((v) => (
                  <tr key={v.id} className="hover:bg-slate-800/30">
                    <td className="py-3 px-4 font-mono text-slate-300 whitespace-nowrap">
                      {new Date(v.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-300">{v.cameraId}</td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-100">
                        {VIOLATION_LABELS[v.violationType] ?? v.violationType}
                      </div>
                      {v.notes && (
                        <div className="text-[11px] text-slate-500 max-w-xs truncate" title={v.notes}>
                          {v.notes}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-300">
                      #{v.trackId} · {v.vehicleClass}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-200">
                      {v.plateNumber || <span className="text-slate-500">Unreadable</span>}
                    </td>
                    <td className="py-3 px-4">
                      {v.vehicleCropUrl || v.fullFrameUrl ? (
                        <img
                          src={v.vehicleCropUrl || v.fullFrameUrl || ''}
                          alt="Violation evidence thumbnail"
                          className="w-16 h-10 object-cover rounded border border-slate-700"
                        />
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-right text-slate-300">
                      {Math.round(v.confidence * 100)}%
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap font-medium">
                      <span
                        className={
                          v.verificationStatus === 'verified'
                            ? 'text-red-400'
                            : v.verificationStatus === 'requires_review'
                            ? 'text-amber-400'
                            : 'text-slate-500'
                        }
                      >
                        {v.verificationStatus === 'verified'
                          ? 'Verified'
                          : v.verificationStatus === 'requires_review'
                          ? 'Review Needed'
                          : 'Dismissed'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void handleStatusChange(v.id, 'verified')}
                          title="Confirm violation"
                          className="p-1.5 rounded bg-slate-800 hover:bg-emerald-600 text-slate-300 hover:text-white transition-colors"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleStatusChange(v.id, 'requires_review')}
                          title="Flag for review"
                          className="p-1.5 rounded bg-slate-800 hover:bg-amber-600 text-slate-300 hover:text-white transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleStatusChange(v.id, 'dismissed')}
                          title="Dismiss false positive"
                          className="p-1.5 rounded bg-slate-800 hover:bg-red-600 text-slate-300 hover:text-white transition-colors"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-500">
                    No violations match the selected filters.
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
