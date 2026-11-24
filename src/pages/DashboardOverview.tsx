import { ArrowRight, Camera, ShieldAlert, Upload } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { NavSectionId } from '../components/Sidebar';
import type { CongestionLevel, DashboardSummary } from '../types/traffic';
import { VIOLATION_LABELS } from '../types/traffic';

interface DashboardOverviewProps {
  summary: DashboardSummary | null;
  loading: boolean;
  onNavigate: (id: NavSectionId) => void;
}

const PIE_COLORS = ['#EF4444', '#F59E0B', '#3B82F6', '#10B981', '#8B5CF6', '#EC4899', '#14B8A6'];

function congestionColor(level: CongestionLevel): string {
  switch (level) {
    case 'SEVERE':
      return 'text-red-400';
    case 'HIGH':
      return 'text-orange-400';
    case 'MODERATE':
      return 'text-amber-400';
    default:
      return 'text-emerald-400';
  }
}

export function DashboardOverview({ summary, loading, onNavigate }: DashboardOverviewProps) {
  if (loading && !summary) {
    return (
      <div className="space-y-6">
        <div className="h-32 rounded-xl bg-[#0D1526] border border-slate-800/90 animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, idx) => (
            <div
              key={idx}
              className="h-24 rounded-xl bg-[#0D1526] border border-slate-800/90 animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  const kpis = summary?.kpis ?? {
    totalVehicles: 0,
    activeVehicles: 0,
    totalViolations: 0,
    overspeedingCases: 0,
    noHelmetCases: 0,
    wrongWayCases: 0,
    averageSpeedKmh: null,
    trafficDensity: 0,
    congestionLevel: 'LOW' as CongestionLevel,
    riskScore: 0,
  };

  const carsCount =
    summary?.vehicleCountsByType.find((v) => v.category === 'car')?.count ?? 0;
  const bikesCount =
    summary?.vehicleCountsByType.find((v) => v.category === 'motorcycle')?.count ?? 0;

  const kpiCards = [
    {
      label: 'Total Vehicles Passed',
      value: kpis.totalVehicles.toLocaleString(),
      sub: `${carsCount} Cars · ${bikesCount} Bikes`,
      tone: 'text-slate-100',
    },
    {
      label: 'Active Vehicles',
      value: kpis.activeVehicles.toLocaleString(),
      sub: 'Observed last 60s',
      tone: 'text-blue-400',
    },
    {
      label: 'Total Rule Violations',
      value: kpis.totalViolations.toLocaleString(),
      sub: 'Verified & review queue',
      tone: kpis.totalViolations > 0 ? 'text-red-400' : 'text-slate-100',
    },
    {
      label: 'Overspeeding Cases',
      value: kpis.overspeedingCases.toLocaleString(),
      sub: 'Calibrated speed rules',
      tone: kpis.overspeedingCases > 0 ? 'text-orange-400' : 'text-slate-100',
    },
    {
      label: 'No-Helmet Cases',
      value: kpis.noHelmetCases.toLocaleString(),
      sub: 'AI vision inspected',
      tone: kpis.noHelmetCases > 0 ? 'text-amber-400' : 'text-slate-100',
    },
    {
      label: 'Wrong-Way Cases',
      value: kpis.wrongWayCases.toLocaleString(),
      sub: 'Trajectory heading check',
      tone: kpis.wrongWayCases > 0 ? 'text-red-400' : 'text-slate-100',
    },
    {
      label: 'Average Speed',
      value: kpis.averageSpeedKmh !== null ? `${kpis.averageSpeedKmh} km/h` : 'Uncalibrated',
      sub: kpis.averageSpeedKmh !== null ? 'Homography corrected' : 'Calibrate camera',
      tone: 'text-slate-100',
    },
    {
      label: 'Traffic Density',
      value: `${kpis.trafficDensity} /100m`,
      sub: `${kpis.congestionLevel} congestion`,
      tone: congestionColor(kpis.congestionLevel),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Modern Executive Command Hero */}
      <div className="bg-gradient-to-br from-[#0F1B33] via-[#0D1526] to-[#091020] border border-slate-800/90 rounded-xl p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <div className="space-y-2 max-w-2xl">
          <div className="text-xs font-mono text-blue-400">
            Smart City Traffic Intelligence · SQLite Live Telemetry
          </div>
          <h2 className="font-display font-bold text-xl sm:text-2xl tracking-tight text-slate-50">
            Real-Time Vehicle Counting, Rule Enforcement &amp; Corridor Analytics
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            Upload traffic CCTV footage or connect a live camera to count passing cars, bikes,
            buses, and trucks, track movement trajectories, inspect Indian plates &amp; helmets, and
            automatically flag every traffic rule violator.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row lg:flex-col xl:flex-row items-stretch sm:items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('video-upload')}
            className="h-10 px-5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap shadow-[0_2px_14px_rgba(37,99,235,0.35)]"
          >
            <Upload className="w-4 h-4" />
            <span>Upload &amp; Analyze Video</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('live-camera')}
            className="h-10 px-5 rounded-lg bg-[#060B17] hover:bg-slate-800 border border-slate-700 text-slate-100 text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <Camera className="w-4 h-4 text-blue-400" />
            <span>Start Live Camera</span>
          </button>
        </div>
      </div>

      {/* 8 Executive KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCards.map((card) => (
          <div
            key={card.label}
            className="bg-[#0D1526] border border-slate-800/90 hover:border-slate-700/90 rounded-xl p-4 space-y-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
          >
            <div className="text-xs font-medium text-slate-400">{card.label}</div>
            <div className={`font-mono text-2xl font-bold tabular-nums ${card.tone}`}>
              {card.value}
            </div>
            <div className="text-xs text-slate-500">{card.sub}</div>
          </div>
        ))}
      </div>

      {/* Primary Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Traffic Flow & Forecast */}
        <div className="lg:col-span-7 bg-[#0D1526] border border-slate-800/90 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display font-semibold text-sm text-slate-100">
                Traffic Flow &amp; Short-Horizon Forecast
              </h3>
              <p className="text-xs text-slate-500">
                Observed vehicle volume (solid blue) vs projected demand trend (dashed amber)
              </p>
            </div>
            <div className="text-xs font-mono text-slate-400">
              Risk Score:{' '}
              <span className="text-slate-100 font-semibold">{kpis.riskScore}/100</span>
            </div>
          </div>

          <div className="h-64 w-full">
            {summary && summary.trafficFlowSeries.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={summary.trafficFlowSeries}>
                  <defs>
                    <linearGradient id="obsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                  <XAxis dataKey="label" stroke="#64748B" fontSize={11} />
                  <YAxis stroke="#64748B" fontSize={11} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#060B17',
                      borderColor: '#334155',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Area
                    type="monotone"
                    dataKey="observed"
                    name="Observed Vehicles"
                    stroke="#3B82F6"
                    fill="url(#obsGrad)"
                    strokeWidth={2.5}
                    connectNulls={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="forecast"
                    name="Forecast (Projected)"
                    stroke="#F59E0B"
                    fill="none"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    connectNulls
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                Run video analysis or live camera monitoring to populate traffic flow series.
              </div>
            )}
          </div>
        </div>

        {/* Vehicle Class Composition */}
        <div className="lg:col-span-5 bg-[#0D1526] border border-slate-800/90 rounded-xl p-5 space-y-4">
          <div>
            <h3 className="font-display font-semibold text-sm text-slate-100">
              Passed Vehicles by Category
            </h3>
            <p className="text-xs text-slate-500">Cars, motorcycles, buses, trucks &amp; bicycles</p>
          </div>

          <div className="h-64 w-full">
            {summary && summary.vehicleCountsByType.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={summary.vehicleCountsByType}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                  <XAxis dataKey="category" stroke="#64748B" fontSize={11} />
                  <YAxis stroke="#64748B" fontSize={11} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#060B17',
                      borderColor: '#334155',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="count" name="Unique Count" fill="#3B82F6" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                No vehicles recorded yet.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Secondary Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-[#0D1526] border border-slate-800/90 rounded-xl p-5 space-y-4">
          <div>
            <h3 className="font-display font-semibold text-sm text-slate-100">
              Directional Corridor Volume
            </h3>
            <p className="text-xs text-slate-500">
              Inbound (permitted road heading) vs Outbound (opposing flow)
            </p>
          </div>
          <div className="h-60 w-full">
            {summary && summary.directionalCounts.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={summary.directionalCounts}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                  <XAxis dataKey="cameraName" stroke="#64748B" fontSize={11} />
                  <YAxis stroke="#64748B" fontSize={11} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#060B17',
                      borderColor: '#334155',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Bar dataKey="inbound" name="Inbound" fill="#10B981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="outbound" name="Outbound" fill="#6366F1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                Directional counts update automatically as vehicles cross camera zones.
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-5 bg-[#0D1526] border border-slate-800/90 rounded-xl p-5 space-y-4">
          <div>
            <h3 className="font-display font-semibold text-sm text-slate-100">
              Violations by Rule Category
            </h3>
            <p className="text-xs text-slate-500">Breakdown of non-compliant vehicles</p>
          </div>
          <div className="h-60 w-full">
            {summary && summary.violationsByType.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={summary.violationsByType}
                    dataKey="count"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={82}
                    paddingAngle={2}
                  >
                    {summary.violationsByType.map((_, idx) => (
                      <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#060B17',
                      borderColor: '#334155',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                No rule violations recorded yet.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recent Violators Table with Evidence Thumbnails */}
      <div className="bg-[#0D1526] border border-slate-800/90 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800/90 flex items-center justify-between gap-4">
          <div>
            <h3 className="font-display font-semibold text-sm text-slate-100">
              Recent Traffic Rule Violators
            </h3>
            <p className="text-xs text-slate-500">
              Offending vehicles captured with tracking IDs, timestamps, and evidence snapshots
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('violations')}
            className="text-xs font-medium text-blue-400 hover:text-blue-300 inline-flex items-center gap-1 whitespace-nowrap"
          >
            <span>Open Full Log</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800/90 text-slate-400 bg-[#080F1E]">
                <th className="py-3 px-4 font-medium">Evidence</th>
                <th className="py-3 px-4 font-medium">Time</th>
                <th className="py-3 px-4 font-medium">Camera</th>
                <th className="py-3 px-4 font-medium">Rule Violated</th>
                <th className="py-3 px-4 font-medium">Track / Vehicle</th>
                <th className="py-3 px-4 font-medium">Number Plate</th>
                <th className="py-3 px-4 font-medium text-right">Speed</th>
                <th className="py-3 px-4 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {summary && summary.recentViolations.length > 0 ? (
                summary.recentViolations.map((v) => (
                  <tr key={v.id} className="hover:bg-slate-800/30">
                    <td className="py-2.5 px-4">
                      {v.vehicleCropUrl || v.fullFrameUrl ? (
                        <img
                          src={v.vehicleCropUrl || v.fullFrameUrl || ''}
                          alt="Violator thumbnail"
                          className="w-16 h-10 object-cover rounded border border-slate-700"
                        />
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-300 whitespace-nowrap">
                      {new Date(v.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="py-2.5 px-4 text-slate-300 font-mono">{v.cameraId}</td>
                    <td className="py-2.5 px-4 font-semibold text-red-400">
                      {VIOLATION_LABELS[v.violationType] ?? v.violationType}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-200">
                      #{v.trackId} · {v.vehicleClass}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-200">
                      {v.plateNumber || <span className="text-slate-500">Unreadable</span>}
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-right text-slate-300">
                      {v.speedKmh !== null ? `${v.speedKmh} km/h` : 'N/A'}
                    </td>
                    <td className="py-2.5 px-4 font-medium whitespace-nowrap">
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
                          ? 'Requires Review'
                          : 'Dismissed'}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-500">
                    <div className="flex flex-col items-center gap-2">
                      <ShieldAlert className="w-5 h-5 text-slate-600" />
                      <span>No violations recorded yet. Analyze a video or live camera feed.</span>
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
