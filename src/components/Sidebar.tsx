import {
  Activity,
  BarChart3,
  Camera,
  FileSpreadsheet,
  Gauge,
  Image as ImageIcon,
  LayoutDashboard,
  Route,
  ScanText,
  Settings,
  ShieldAlert,
  Upload,
  X,
} from 'lucide-react';
import type { ComponentType } from 'react';

export type NavSectionId =
  | 'dashboard'
  | 'live-camera'
  | 'video-upload'
  | 'tracking'
  | 'speed'
  | 'anpr'
  | 'violations'
  | 'analytics'
  | 'evidence'
  | 'reports'
  | 'settings';

export interface NavItem {
  id: NavSectionId;
  label: string;
  group: 'Operations' | 'Detection Modules' | 'Intelligence & Admin';
  icon: ComponentType<{ className?: string }>;
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard Overview', group: 'Operations', icon: LayoutDashboard },
  { id: 'live-camera', label: 'Live Camera Monitoring', group: 'Operations', icon: Camera },
  { id: 'video-upload', label: 'Upload Traffic Video', group: 'Operations', icon: Upload },
  { id: 'tracking', label: 'Tracking & Trajectories', group: 'Detection Modules', icon: Route },
  { id: 'speed', label: 'Speed & Calibration', group: 'Detection Modules', icon: Gauge },
  { id: 'anpr', label: 'Indian ANPR Plates', group: 'Detection Modules', icon: ScanText },
  { id: 'violations', label: 'Violations & Helmet', group: 'Detection Modules', icon: ShieldAlert },
  { id: 'analytics', label: 'Congestion & Analytics', group: 'Intelligence & Admin', icon: BarChart3 },
  { id: 'evidence', label: 'Violation Evidence', group: 'Intelligence & Admin', icon: ImageIcon },
  { id: 'reports', label: 'Reports & Export', group: 'Intelligence & Admin', icon: FileSpreadsheet },
  { id: 'settings', label: 'Camera & AI Settings', group: 'Intelligence & Admin', icon: Settings },
];

interface SidebarProps {
  activeSection: NavSectionId;
  onSelect: (id: NavSectionId) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  isLiveActive: boolean;
  violationCount: number;
}

export function Sidebar({
  activeSection,
  onSelect,
  mobileOpen,
  onCloseMobile,
  isLiveActive,
  violationCount,
}: SidebarProps) {
  const groups: NavItem['group'][] = ['Operations', 'Detection Modules', 'Intelligence & Admin'];

  const content = (
    <div className="flex h-full flex-col bg-[#090F1E] border-r border-slate-800/80 w-64 select-none">
      {/* Brand header */}
      <div className="flex items-center justify-between px-5 h-16 border-b border-slate-800/80 shrink-0">
        <button
          type="button"
          onClick={() => onSelect('dashboard')}
          className="flex items-center gap-3 min-w-0 text-left group"
        >
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shrink-0 shadow-[0_0_20px_rgba(37,99,235,0.28)]">
            <Activity className="w-4 h-4 text-white" />
          </div>
          <span className="font-display font-bold text-[15px] tracking-tight text-slate-100 whitespace-nowrap truncate group-hover:text-white">
            Drishti Traffic AI
          </span>
        </button>
        <button
          type="button"
          onClick={onCloseMobile}
          className="lg:hidden p-1.5 text-slate-400 hover:text-slate-100 rounded-md"
          aria-label="Close navigation menu"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Navigation groups */}
      <nav className="flex-1 overflow-y-auto px-3 py-5 space-y-6" aria-label="Primary navigation">
        {groups.map((group) => {
          const items = NAV_ITEMS.filter((item) => item.group === group);
          return (
            <div key={group}>
              <div className="px-3 mb-2 text-[11px] font-semibold text-slate-500 tracking-wide">
                {group}
              </div>
              <div className="space-y-0.5">
                {items.map((item) => {
                  const Icon = item.icon;
                  const active = activeSection === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        onSelect(item.id);
                        onCloseMobile();
                      }}
                      className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors whitespace-nowrap ${
                        active
                          ? 'bg-blue-600/15 text-blue-300 border border-blue-500/30 shadow-[inset_0_1px_0_rgba(147,197,253,0.08)]'
                          : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50 border border-transparent'
                      }`}
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <Icon
                          className={`w-4 h-4 shrink-0 ${
                            active ? 'text-blue-400' : 'text-slate-500'
                          }`}
                        />
                        <span className="truncate">{item.label}</span>
                      </span>
                      {item.id === 'live-camera' && isLiveActive && (
                        <span
                          className="w-2 h-2 rounded-full bg-emerald-400 shrink-0"
                          title="Live stream active"
                        />
                      )}
                      {item.id === 'violations' && violationCount > 0 && (
                        <span className="font-mono text-xs tabular-nums text-red-400 font-semibold shrink-0">
                          {violationCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Footer note */}
      <div className="px-5 py-3.5 border-t border-slate-800/80 text-xs text-slate-500">
        Smart City Command Console
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block shrink-0 h-screen sticky top-0">{content}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-xs"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full">{content}</div>
        </div>
      )}
    </>
  );
}
