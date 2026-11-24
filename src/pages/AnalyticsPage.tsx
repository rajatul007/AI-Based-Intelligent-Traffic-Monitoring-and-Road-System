import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  AiModelSettings,
  DashboardSummary,
  TrafficRecommendation,
} from '../types/traffic';
import { api } from '../utils/api';

interface AnalyticsPageProps {
  selectedCameraId: string;
  summary: DashboardSummary | null;
  settings: AiModelSettings;
}

export function AnalyticsPage({ selectedCameraId, summary, settings }: AnalyticsPageProps) {
  const [recommendations, setRecommendations] = useState<TrafficRecommendation[]>([]);
  const [loadingRecs, setLoadingRecs] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);

  const handleGenerateRecommendations = async () => {
    setLoadingRecs(true);
    setRecError(null);
    try {
      const res = await api.getRecommendations(selectedCameraId);
      setRecommendations(res.recommendations);
    } catch (err) {
      setRecError((err as Error).message || 'Unable to generate advisory recommendations.');
    } finally {
      setLoadingRecs(false);
    }
  };

  const kpis = summary?.kpis;
  const thresholds = settings.congestionThresholds;

  return (
    <div className="space-y-6">
      {/* Congestion Classification & Smart Traffic Risk Score */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 bg-[#111827] border border-slate-800/80 rounded-xl p-5 space-y-4">
          <div>
            <h2 className="font-display font-semibold text-base text-slate-100">
              Congestion Detection Methodology
            </h2>
            <p className="text-xs text-slate-400">
              Vehicle density per 100m calibrated road length mapped to configurable operational
              thresholds
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="bg-[#0B1120] border border-slate-800 rounded-lg p-3 space-y-1">
              <div className="font-semibold text-emerald-400">LOW</div>
              <div className="font-mono text-slate-300">
                &lt; {thresholds.moderateDensity} /100m
              </div>
              <div className="text-[11px] text-slate-500">Free-flow travel</div>
            </div>
            <div className="bg-[#0B1120] border border-slate-800 rounded-lg p-3 space-y-1">
              <div className="font-semibold text-amber-400">MODERATE</div>
              <div className="font-mono text-slate-300">
                {thresholds.moderateDensity}–{thresholds.highDensity - 1} /100m
              </div>
              <div className="text-[11px] text-slate-500">Steady platoon flow</div>
            </div>
            <div className="bg-[#0B1120] border border-slate-800 rounded-lg p-3 space-y-1">
              <div className="font-semibold text-orange-400">HIGH</div>
              <div className="font-mono text-slate-300">
                {thresholds.highDensity}–{thresholds.severeDensity - 1} /100m
              </div>
              <div className="text-[11px] text-slate-500">Queue formation</div>
            </div>
            <div className="bg-[#0B1120] border border-slate-800 rounded-lg p-3 space-y-1">
              <div className="font-semibold text-red-400">SEVERE</div>
              <div className="font-mono text-slate-300">
                ≥ {thresholds.severeDensity} /100m
              </div>
              <div className="text-[11px] text-slate-500">Saturation / gridlock</div>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
            <span className="text-slate-400">Current Observed Density</span>
            <span className="font-mono text-sm font-semibold text-slate-100 tabular-nums">
              {kpis?.trafficDensity ?? 0} veh/100m · {kpis?.congestionLevel ?? 'LOW'}
            </span>
          </div>
        </div>

        <div className="lg:col-span-6 bg-[#111827] border border-slate-800/80 rounded-xl p-5 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display font-semibold text-base text-slate-100">
                Smart Traffic Risk Score
              </h2>
              <p className="text-xs text-slate-400">
                Composite safety index derived strictly from observed violations, density, and
                calibrated speed deviation
              </p>
            </div>
            <div className="text-right">
              <div className="font-mono text-3xl font-semibold tabular-nums text-slate-100">
                {kpis?.riskScore ?? 0}
                <span className="text-sm text-slate-500">/100</span>
              </div>
            </div>
          </div>

          <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                (kpis?.riskScore ?? 0) >= 70
                  ? 'bg-red-500'
                  : (kpis?.riskScore ?? 0) >= 40
                  ? 'bg-amber-500'
                  : 'bg-emerald-500'
              }`}
              style={{ width: `${kpis?.riskScore ?? 0}%` }}
            />
          </div>

          <div className="grid grid-cols-3 gap-3 text-xs pt-1">
            <div className="bg-[#0B1120] border border-slate-800 rounded-lg p-3">
              <div className="text-slate-500">Violation Weight</div>
              <div className="font-mono font-semibold text-slate-200 mt-1">50% max</div>
            </div>
            <div className="bg-[#0B1120] border border-slate-800 rounded-lg p-3">
              <div className="text-slate-500">Density Weight</div>
              <div className="font-mono font-semibold text-slate-200 mt-1">35% max</div>
            </div>
            <div className="bg-[#0B1120] border border-slate-800 rounded-lg p-3">
              <div className="text-slate-500">Speed Variance</div>
              <div className="font-mono font-semibold text-slate-200 mt-1">15% max</div>
            </div>
          </div>
        </div>
      </div>

      {/* Observed vs Forecasted Traffic Flow Chart */}
      <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-5 space-y-4">
        <div>
          <h3 className="font-display font-semibold text-sm text-slate-100">
            Traffic Flow Forecasting (Observed vs Projected Demand)
          </h3>
          <p className="text-xs text-slate-500">
            Linear trend projection computed from ≥3 historical SQLite observation buckets.
            Forecast intervals (+1T to +4T) are clearly separated from actual observations.
          </p>
        </div>

        <div className="h-72 w-full">
          {summary && summary.trafficFlowSeries.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={summary.trafficFlowSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                <XAxis dataKey="label" stroke="#64748B" fontSize={11} />
                <YAxis stroke="#64748B" fontSize={11} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0F172A',
                    borderColor: '#334155',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Area
                  type="monotone"
                  dataKey="observed"
                  name="Observed Vehicle Volume"
                  stroke="#3B82F6"
                  fill="#3B82F6"
                  fillOpacity={0.18}
                  strokeWidth={2}
                  connectNulls={false}
                />
                <Area
                  type="monotone"
                  dataKey="forecast"
                  name="Forecasted Demand (Projected)"
                  stroke="#F59E0B"
                  fill="#F59E0B"
                  fillOpacity={0.12}
                  strokeDasharray="6 4"
                  strokeWidth={2}
                  connectNulls
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-slate-500">
              Record at least 3 traffic intervals to compute short-horizon traffic demand
              forecasts.
            </div>
          )}
        </div>
      </div>

      {/* Intelligent Advisory Traffic Recommendations */}
      <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="font-display font-semibold text-base text-slate-100">
              Intelligent Traffic Recommendations (Advisory / Simulation Mode)
            </h3>
            <p className="text-xs text-slate-400">
              Generates data-grounded suggestions for congestion hotspots, peak traffic management,
              advisory signal timing simulations, and enforcement priorities. Does not actuate
              physical traffic controllers.
            </p>
          </div>
          <button
            type="button"
            disabled={loadingRecs}
            onClick={() => void handleGenerateRecommendations()}
            className="h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingRecs ? 'animate-spin' : ''}`} />
            <span>{loadingRecs ? 'Analyzing Telemetry...' : 'Generate Advisory Brief'}</span>
          </button>
        </div>

        {recError && (
          <div className="bg-red-950/40 border border-red-800/60 rounded-lg px-4 py-3 text-xs text-red-200">
            {recError}
          </div>
        )}

        {recommendations.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {recommendations.map((rec, idx) => (
              <div
                key={idx}
                className="bg-[#0B1120] border border-slate-800 rounded-xl p-4 space-y-2.5 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-slate-400 uppercase">
                    {rec.category.replace(/_/g, ' ')}
                  </span>
                  <span
                    className={`font-semibold uppercase text-[11px] ${
                      rec.priority === 'high'
                        ? 'text-red-400'
                        : rec.priority === 'medium'
                        ? 'text-amber-400'
                        : 'text-emerald-400'
                    }`}
                  >
                    {rec.priority} priority
                  </span>
                </div>
                <h4 className="font-display font-semibold text-sm text-slate-100">{rec.title}</h4>
                <p className="text-slate-400 leading-relaxed">{rec.rationale}</p>
                <div className="pt-2 border-t border-slate-800/80 text-slate-200">
                  <span className="text-slate-500">Suggested Action: </span>
                  {rec.suggestedAction}
                </div>
                <div className="text-[11px] text-slate-500 italic">{rec.advisoryModeNote}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-[#0B1120] border border-slate-800/80 rounded-lg p-6 text-center text-xs text-slate-500">
            Click Generate Advisory Brief to synthesize congestion, safety, and simulated signal
            timing insights from your recorded SQLite surveillance data.
          </div>
        )}
      </div>
    </div>
  );
}
