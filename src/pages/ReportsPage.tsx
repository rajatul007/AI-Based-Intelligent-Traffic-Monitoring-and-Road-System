import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  CameraConfiguration,
  DashboardSummary,
  NumberPlateRecord,
  VehicleRecord,
  ViolationRecord,
  ViolationType,
} from '../types/traffic';
import { VIOLATION_LABELS } from '../types/traffic';
import { api } from '../utils/api';
import {
  exportFullExcelWorkbook,
  exportTrafficPdfReport,
  exportViolationsCsv,
} from '../utils/reports';

interface ReportsPageProps {
  cameras: CameraConfiguration[];
  summary: DashboardSummary | null;
  refreshTick: number;
}

export function ReportsPage({ cameras, summary, refreshTick }: ReportsPageProps) {
  const [cameraFilter, setCameraFilter] = useState<string>('all');
  const [violationFilter, setViolationFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');

  const [violations, setViolations] = useState<ViolationRecord[]>([]);
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [plates, setPlates] = useState<NumberPlateRecord[]>([]);
  const [filteredSummary, setFilteredSummary] = useState<DashboardSummary | null>(summary);

  useEffect(() => {
    let active = true;
    const isoFrom = dateFrom ? `${dateFrom}T00:00:00.000Z` : undefined;
    const isoTo = dateTo ? `${dateTo}T23:59:59.999Z` : undefined;

    Promise.all([
      api.getViolations({
        cameraId: cameraFilter,
        violationType: violationFilter,
        dateFrom: isoFrom,
        dateTo: isoTo,
      }),
      api.getVehicles(cameraFilter),
      api.getPlates(cameraFilter),
      api.getDashboardSummary(cameraFilter),
    ])
      .then(([v, veh, p, sum]) => {
        if (!active) return;
        setViolations(v);
        setVehicles(veh);
        setPlates(p);
        setFilteredSummary(sum);
      })
      .catch(console.error);

    return () => {
      active = false;
    };
  }, [cameraFilter, violationFilter, dateFrom, dateTo, refreshTick]);

  const filterLabel = `${cameraFilter === 'all' ? 'All Cameras' : cameraFilter}${
    violationFilter !== 'all' ? ` · ${VIOLATION_LABELS[violationFilter as ViolationType]}` : ''
  }${dateFrom || dateTo ? ` · ${dateFrom || 'Start'} to ${dateTo || 'Now'}` : ''}`;

  const allTypes = Object.keys(VIOLATION_LABELS) as ViolationType[];

  return (
    <div className="space-y-6">
      {/* Filter & Export Controls */}
      <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-5 space-y-5">
        <div>
          <h2 className="font-display font-semibold text-base text-slate-100">
            Traffic & Violation Report Generator
          </h2>
          <p className="text-xs text-slate-400">
            Filter records by camera, violation category, and date range, then export real CSV,
            multi-sheet Excel (.xlsx), or formatted PDF reports.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          <div>
            <label className="block text-slate-400 mb-1.5">Camera Scope</label>
            <select
              value={cameraFilter}
              onChange={(e) => setCameraFilter(e.target.value)}
              className="w-full h-9 rounded-lg bg-[#0B1120] border border-slate-700 px-3 text-slate-200"
            >
              <option value="all">All Cameras</option>
              {cameras.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id} — {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-slate-400 mb-1.5">Violation Category</label>
            <select
              value={violationFilter}
              onChange={(e) => setViolationFilter(e.target.value)}
              className="w-full h-9 rounded-lg bg-[#0B1120] border border-slate-700 px-3 text-slate-200"
            >
              <option value="all">All Violations</option>
              {allTypes.map((t) => (
                <option key={t} value={t}>
                  {VIOLATION_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-slate-400 mb-1.5">Date From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full h-9 rounded-lg bg-[#0B1120] border border-slate-700 px-3 text-slate-200 font-mono"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1.5">Date To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full h-9 rounded-lg bg-[#0B1120] border border-slate-700 px-3 text-slate-200 font-mono"
            />
          </div>
        </div>

        {/* Export Action Row */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-800/80">
          <button
            type="button"
            onClick={() => exportViolationsCsv(violations, cameraFilter)}
            className="h-9 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 text-blue-400" />
            <span>Export CSV ({violations.length} rows)</span>
          </button>

          <button
            type="button"
            disabled={!filteredSummary}
            onClick={() => {
              if (!filteredSummary) return;
              void exportFullExcelWorkbook({
                summary: filteredSummary,
                vehicles,
                violations,
                plates,
                filterLabel,
              });
            }}
            className="h-9 px-4 rounded-lg bg-emerald-600/90 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Export Excel Workbook (.xlsx)</span>
          </button>

          <button
            type="button"
            disabled={!filteredSummary}
            onClick={() => {
              if (!filteredSummary) return;
              exportTrafficPdfReport({
                summary: filteredSummary,
                violations,
                plates,
                filterLabel,
              });
            }}
            className="h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Download PDF Report</span>
          </button>
        </div>
      </div>

      {/* Daily Traffic & Congestion Summary Preview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-4">
          <div className="text-xs text-slate-400">Matched Violations</div>
          <div className="font-mono text-2xl font-semibold tabular-nums text-slate-100 mt-1">
            {violations.length}
          </div>
        </div>
        <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-4">
          <div className="text-xs text-slate-400">Unique Vehicles</div>
          <div className="font-mono text-2xl font-semibold tabular-nums text-slate-100 mt-1">
            {vehicles.length}
          </div>
        </div>
        <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-4">
          <div className="text-xs text-slate-400">Recognized Plates</div>
          <div className="font-mono text-2xl font-semibold tabular-nums text-slate-100 mt-1">
            {plates.length}
          </div>
        </div>
        <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-4">
          <div className="text-xs text-slate-400">Congestion / Risk</div>
          <div className="font-mono text-xl font-semibold tabular-nums text-slate-100 mt-1">
            {filteredSummary?.kpis.congestionLevel ?? 'LOW'} ·{' '}
            {filteredSummary?.kpis.riskScore ?? 0}/100
          </div>
        </div>
      </div>

      {/* Filtered Report Preview Table */}
      <div className="bg-[#111827] border border-slate-800/80 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800/80">
          <h3 className="font-display font-semibold text-sm text-slate-100">
            Report Data Preview — {filterLabel}
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800/80 text-slate-400">
                <th className="py-3 px-4 font-medium">Timestamp</th>
                <th className="py-3 px-4 font-medium">Camera</th>
                <th className="py-3 px-4 font-medium">Violation</th>
                <th className="py-3 px-4 font-medium">Track / Class</th>
                <th className="py-3 px-4 font-medium">Number Plate</th>
                <th className="py-3 px-4 font-medium text-right">Speed</th>
                <th className="py-3 px-4 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {violations.length > 0 ? (
                violations.slice(0, 50).map((v) => (
                  <tr key={v.id} className="hover:bg-slate-800/30">
                    <td className="py-2.5 px-4 font-mono text-slate-300">
                      {new Date(v.timestamp).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-300">{v.cameraId}</td>
                    <td className="py-2.5 px-4 font-medium text-slate-100">
                      {VIOLATION_LABELS[v.violationType] ?? v.violationType}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-300">
                      #{v.trackId} · {v.vehicleClass}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-200">
                      {v.plateNumber || 'Unreadable'}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-right text-slate-300">
                      {v.speedKmh !== null ? `${v.speedKmh} km/h` : 'Uncalibrated'}
                    </td>
                    <td className="py-2.5 px-4 text-slate-300 capitalize">
                      {v.verificationStatus.replace('_', ' ')}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    No violation records match the active report filters.
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
