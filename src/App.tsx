import { useCallback, useEffect, useState } from 'react';
import { type NavSectionId, Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { VideoMonitorStage } from './components/VideoMonitorStage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { AnprPage } from './pages/AnprPage';
import { DashboardOverview } from './pages/DashboardOverview';
import { EvidenceGalleryPage } from './pages/EvidenceGalleryPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { SpeedCalibrationPage } from './pages/SpeedCalibrationPage';
import { TrackingPage } from './pages/TrackingPage';
import { ViolationsPage } from './pages/ViolationsPage';
import type { AiModelSettings, CameraConfiguration, DashboardSummary } from './types/traffic';
import { api } from './utils/api';

const DEFAULT_SETTINGS: AiModelSettings = {
  confidenceThreshold: 0.28,
  inferenceIntervalMs: 95,
  enableTrajectoryOverlay: true,
  enableHeatmapOverlay: false,
  enableZonesOverlay: true,
  enableAutoGeminiVerification: false,
  enableMultiTileBoost: true,
  enabledClasses: ['car', 'motorcycle', 'bus', 'truck', 'auto_rickshaw', 'bicycle'],
  congestionThresholds: {
    moderateDensity: 6,
    highDensity: 12,
    severeDensity: 20,
  },
};

export default function App() {
  const [activeSection, setActiveSection] = useState<NavSectionId>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [cameras, setCameras] = useState<CameraConfiguration[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('all');
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [isLiveActive, setIsLiveActive] = useState(false);
  const [settings, setSettings] = useState<AiModelSettings>(DEFAULT_SETTINGS);

  const loadCameras = useCallback(async () => {
    try {
      const list = await api.getCameras();
      setCameras(list);
    } catch (err) {
      console.error('Failed to load camera configs:', err);
    }
  }, []);

  const loadSummary = useCallback(async () => {
    setLoadingSummary(true);
    try {
      const data = await api.getDashboardSummary(selectedCameraId);
      setSummary(data);
    } catch (err) {
      console.error('Failed to load dashboard summary:', err);
    } finally {
      setLoadingSummary(false);
    }
  }, [selectedCameraId]);

  useEffect(() => {
    void loadCameras();
  }, [loadCameras]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary, refreshTick]);

  const handleUpdateSettings = useCallback((patch: Partial<AiModelSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleTelemetrySaved = useCallback(() => {
    setRefreshTick((t) => t + 1);
  }, []);

  // Resolve concrete camera for camera-specific views (Live, Upload, Calibration)
  const concreteCamera: CameraConfiguration | null =
    cameras.find((c) => c.id === selectedCameraId) ?? cameras[0] ?? null;

  const handleNavigate = (id: NavSectionId) => {
    setActiveSection(id);
    if (
      (id === 'live-camera' || id === 'video-upload' || id === 'speed') &&
      selectedCameraId === 'all' &&
      cameras.length > 0
    ) {
      setSelectedCameraId(cameras[0].id);
    }
  };

  return (
    <div className="min-h-screen bg-[#060B17] text-slate-100 flex">
      <Sidebar
        activeSection={activeSection}
        onSelect={handleNavigate}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        isLiveActive={isLiveActive}
        violationCount={summary?.kpis.totalViolations ?? 0}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          activeSection={activeSection}
          cameras={cameras}
          selectedCameraId={selectedCameraId}
          onSelectCamera={setSelectedCameraId}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onNavigate={handleNavigate}
        />

        <main className="flex-1 p-4 lg:p-6 max-w-[1480px] w-full mx-auto">
          {activeSection === 'dashboard' && (
            <DashboardOverview
              summary={summary}
              loading={loadingSummary}
              onNavigate={handleNavigate}
            />
          )}

          {activeSection === 'live-camera' && concreteCamera && (
            <VideoMonitorStage
              key={`live-${concreteCamera.id}`}
              mode="live"
              camera={concreteCamera}
              settings={settings}
              onUpdateSettings={handleUpdateSettings}
              onTelemetrySaved={handleTelemetrySaved}
              onLiveActiveChange={setIsLiveActive}
            />
          )}

          {activeSection === 'video-upload' && concreteCamera && (
            <VideoMonitorStage
              key={`upload-${concreteCamera.id}`}
              mode="upload"
              camera={concreteCamera}
              settings={settings}
              onUpdateSettings={handleUpdateSettings}
              onTelemetrySaved={handleTelemetrySaved}
            />
          )}

          {activeSection === 'tracking' && (
            <TrackingPage selectedCameraId={selectedCameraId} refreshTick={refreshTick} />
          )}

          {activeSection === 'speed' && concreteCamera && (
            <SpeedCalibrationPage
              camera={concreteCamera}
              onCameraUpdated={() => {
                void loadCameras();
                setRefreshTick((t) => t + 1);
              }}
              refreshTick={refreshTick}
            />
          )}

          {activeSection === 'anpr' && (
            <AnprPage
              selectedCameraId={selectedCameraId}
              activeCameraId={concreteCamera?.id ?? 'CAM-DEL-01'}
              refreshTick={refreshTick}
              onDataUpdated={handleTelemetrySaved}
            />
          )}

          {activeSection === 'violations' && (
            <ViolationsPage
              selectedCameraId={selectedCameraId}
              summary={summary}
              refreshTick={refreshTick}
              onDataUpdated={handleTelemetrySaved}
            />
          )}

          {activeSection === 'analytics' && (
            <AnalyticsPage
              selectedCameraId={selectedCameraId}
              summary={summary}
              settings={settings}
            />
          )}

          {activeSection === 'evidence' && (
            <EvidenceGalleryPage selectedCameraId={selectedCameraId} refreshTick={refreshTick} />
          )}

          {activeSection === 'reports' && (
            <ReportsPage cameras={cameras} summary={summary} refreshTick={refreshTick} />
          )}

          {activeSection === 'settings' && (
            <SettingsPage
              cameras={cameras}
              settings={settings}
              onUpdateSettings={handleUpdateSettings}
              onCamerasChanged={() => void loadCameras()}
              onTelemetryCleared={handleTelemetrySaved}
            />
          )}
        </main>
      </div>
    </div>
  );
}
