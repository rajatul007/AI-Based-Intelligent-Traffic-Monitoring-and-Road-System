import { Camera, Menu, Upload } from 'lucide-react';
import type { CameraConfiguration } from '../types/traffic';
import { NAV_ITEMS, type NavSectionId } from './Sidebar';

interface TopBarProps {
  activeSection: NavSectionId;
  cameras: CameraConfiguration[];
  selectedCameraId: string;
  onSelectCamera: (id: string) => void;
  onOpenMobileMenu: () => void;
  onNavigate: (id: NavSectionId) => void;
}

export function TopBar({
  activeSection,
  cameras,
  selectedCameraId,
  onSelectCamera,
  onOpenMobileMenu,
  onNavigate,
}: TopBarProps) {
  const current = NAV_ITEMS.find((n) => n.id === activeSection);
  const showAllOption =
    activeSection !== 'live-camera' &&
    activeSection !== 'video-upload' &&
    activeSection !== 'speed';

  return (
    <header className="sticky top-0 z-30 h-16 bg-[#060B17]/90 backdrop-blur-md border-b border-slate-800/80 px-4 lg:px-6 flex items-center justify-between gap-6">
      {/* Left: Mobile trigger + Breadcrumb trail */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          className="lg:hidden p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800/60"
          aria-label="Open navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 text-sm min-w-0">
          <span className="text-slate-500 hidden sm:inline whitespace-nowrap">
            Traffic Operations
          </span>
          <span className="text-slate-700 hidden sm:inline" aria-hidden="true">
            /
          </span>
          <h1 className="font-display font-semibold text-slate-100 truncate">
            {current?.label ?? 'Dashboard Overview'}
          </h1>
        </div>
      </div>

      {/* Right: Camera selector + single primary action */}
      <div className="flex items-center gap-3 shrink-0">
        <label className="sr-only" htmlFor="topbar-camera-select">
          Select Active Camera
        </label>
        <select
          id="topbar-camera-select"
          value={selectedCameraId}
          onChange={(e) => onSelectCamera(e.target.value)}
          className="h-9 rounded-lg bg-[#0D1526] border border-slate-700/80 px-3 text-xs font-medium text-slate-200 focus:outline-none focus:border-blue-500 max-w-[230px] truncate"
        >
          {showAllOption && <option value="all">All Cameras ({cameras.length})</option>}
          {cameras.map((cam) => (
            <option key={cam.id} value={cam.id}>
              {cam.id} — {cam.name}
            </option>
          ))}
        </select>

        {activeSection !== 'video-upload' ? (
          <button
            type="button"
            onClick={() => onNavigate('video-upload')}
            className="h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 shadow-[0_1px_12px_rgba(37,99,235,0.3)]"
          >
            <Upload className="w-3.5 h-3.5 shrink-0" />
            <span>Analyze Video</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onNavigate('live-camera')}
            className="h-9 px-4 rounded-lg bg-[#0D1526] hover:bg-slate-800 border border-slate-700 text-slate-100 text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
          >
            <Camera className="w-3.5 h-3.5 shrink-0 text-blue-400" />
            <span>Live Monitor</span>
          </button>
        )}
      </div>
    </header>
  );
}
