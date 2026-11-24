import type {
  AiModelSettings,
  CameraConfiguration,
  NormalizedPoint,
  RoadFlowMode,
  SignalState,
  TrackedVehicle,
  VehicleCategory,
} from '../types/traffic';
import type { LearnedRoadFlow } from './violationEngine';

const CLASS_COLORS: Record<VehicleCategory, string> = {
  car: '#3B82F6',
  motorcycle: '#F59E0B',
  bus: '#10B981',
  truck: '#A855F7',
  auto_rickshaw: '#14B8A6',
  bicycle: '#06B6D4',
  other: '#94A3B8',
};

const CLASS_SHORT_LABELS: Record<VehicleCategory, string> = {
  car: 'CAR',
  motorcycle: 'BIKE',
  bus: 'BUS',
  truck: 'TRUCK',
  auto_rickshaw: 'AUTO',
  bicycle: 'CYCLE',
  other: 'VEH',
};

function toPx(pt: NormalizedPoint, w: number, h: number): [number, number] {
  return [pt.x * w, pt.y * h];
}

function angleToArrow(angleDeg: number | null): string {
  if (angleDeg === null) return 'AUTO';
  if (angleDeg === 90) return '↓ DOWN';
  if (angleDeg === 270) return '↑ UP';
  if (angleDeg === 0) return '→ RIGHT';
  if (angleDeg === 180) return '← LEFT';
  return `${angleDeg}°`;
}

function drawCornerBracketBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  hasViolation: boolean
): void {
  // Subtle translucent full outline
  ctx.strokeStyle = hasViolation ? 'rgba(239, 68, 68, 0.55)' : `${color}66`;
  ctx.lineWidth = 1.25;
  ctx.strokeRect(x, y, w, h);

  if (hasViolation) {
    ctx.fillStyle = 'rgba(239, 68, 68, 0.12)';
    ctx.fillRect(x, y, w, h);
  }

  // Crisp tactical corner brackets
  const len = Math.max(8, Math.min(18, Math.min(w, h) * 0.28));
  ctx.strokeStyle = color;
  ctx.lineWidth = hasViolation ? 3 : 2.25;
  ctx.beginPath();
  // Top-left
  ctx.moveTo(x, y + len);
  ctx.lineTo(x, y);
  ctx.lineTo(x + len, y);
  // Top-right
  ctx.moveTo(x + w - len, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + len);
  // Bottom-right
  ctx.moveTo(x + w, y + h - len);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w - len, y + h);
  // Bottom-left
  ctx.moveTo(x + len, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + h - len);
  ctx.stroke();
}

export function renderTrafficOverlays(params: {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  tracks: TrackedVehicle[];
  camera: CameraConfiguration;
  signalState: SignalState;
  settings: AiModelSettings;
  heatmapPoints: Array<{ x: number; y: number; weight: number }>;
  learnedRoadFlow?: LearnedRoadFlow;
}): void {
  const {
    ctx,
    width,
    height,
    tracks,
    camera,
    signalState,
    settings,
    heatmapPoints,
    learnedRoadFlow,
  } = params;

  // 1. Optional Movement / Violation Heatmap overlay
  if (settings.enableHeatmapOverlay && heatmapPoints.length > 0) {
    ctx.save();
    for (const pt of heatmapPoints) {
      const px = pt.x * width;
      const py = pt.y * height;
      const radius = pt.weight > 1.5 ? 28 : 18;
      const grad = ctx.createRadialGradient(px, py, 2, px, py, radius);
      if (pt.weight > 1.5) {
        grad.addColorStop(0, 'rgba(239, 68, 68, 0.34)');
        grad.addColorStop(1, 'rgba(239, 68, 68, 0)');
      } else {
        grad.addColorStop(0, 'rgba(59, 130, 246, 0.22)');
        grad.addColorStop(1, 'rgba(59, 130, 246, 0)');
      }
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 2. Configured Camera Zones, Two-Way Divider & Calibration Quad
  if (settings.enableZonesOverlay) {
    ctx.save();

    const roadMode: RoadFlowMode = camera.zones.roadMode ?? 'two_way_auto';
    const dividerX = camera.zones.dividerX ?? 0.5;
    const isTwoWay = roadMode.startsWith('two_way');

    // Two-Way Center Road Divider & Carriageway Flow Badges
    if (isTwoWay) {
      const dxPx = dividerX * width;
      ctx.beginPath();
      ctx.moveTo(dxPx, height * 0.16);
      ctx.lineTo(dxPx, height * 0.96);
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.72)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.stroke();
      ctx.setLineDash([]);

      const leftDir =
        roadMode === 'two_way_left_down_right_up'
          ? '↓ DOWN'
          : roadMode === 'two_way_left_up_right_down'
          ? '↑ UP'
          : angleToArrow(learnedRoadFlow?.leftAngleDeg ?? null);

      const rightDir =
        roadMode === 'two_way_left_down_right_up'
          ? '↑ UP'
          : roadMode === 'two_way_left_up_right_down'
          ? '↓ DOWN'
          : angleToArrow(learnedRoadFlow?.rightAngleDeg ?? null);

      ctx.font = '600 10px "JetBrains Mono", monospace';
      const drawLaneBadge = (centerX: number, text: string) => {
        const tw = ctx.measureText(text).width + 14;
        const bx = Math.max(8, Math.min(width - tw - 8, centerX - tw / 2));
        const by = 12;
        ctx.fillStyle = 'rgba(6, 11, 23, 0.82)';
        ctx.fillRect(bx, by, tw, 20);
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
        ctx.lineWidth = 1;
        ctx.strokeRect(bx, by, tw, 20);
        ctx.fillStyle = '#E0F2FE';
        ctx.fillText(text, bx + 7, by + 13.5);
      };

      drawLaneBadge(dxPx * 0.5, `LEFT LANE · ${leftDir}`);
      drawLaneBadge(dxPx + (width - dxPx) * 0.5, `RIGHT LANE · ${rightDir}`);
    } else {
      ctx.font = '600 10px "JetBrains Mono", monospace';
      const label =
        roadMode === 'one_way_down'
          ? 'ONE-WAY ROAD · ↓ DOWN'
          : roadMode === 'one_way_up'
          ? 'ONE-WAY ROAD · ↑ UP'
          : roadMode === 'one_way_right'
          ? 'ONE-WAY ROAD · → RIGHT'
          : 'ONE-WAY ROAD · ← LEFT';
      const tw = ctx.measureText(label).width + 14;
      ctx.fillStyle = 'rgba(6, 11, 23, 0.82)';
      ctx.fillRect(12, 12, tw, 20);
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.65)';
      ctx.lineWidth = 1;
      ctx.strokeRect(12, 12, tw, 20);
      ctx.fillStyle = '#DBEAFE';
      ctx.fillText(label, 19, 25.5);
    }

    // Calibration quad
    if (camera.calibration.isCalibrated) {
      const pts = camera.calibration.imagePoints;
      ctx.beginPath();
      pts.forEach((p, idx) => {
        const [x, y] = toPx(p, width, height);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Restricted zone polygon (only when configured)
    if (camera.zones.restrictedPolygon.length >= 3) {
      ctx.beginPath();
      camera.zones.restrictedPolygon.forEach((p, idx) => {
        const [x, y] = toPx(p, width, height);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = 'rgba(239, 68, 68, 0.10)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.55)';
      ctx.lineWidth = 1.25;
      ctx.stroke();
    }

    // Counting line (electric cyan)
    const [c1x, c1y] = toPx(camera.zones.countingLine[0], width, height);
    const [c2x, c2y] = toPx(camera.zones.countingLine[1], width, height);
    ctx.beginPath();
    ctx.moveTo(c1x, c1y);
    ctx.lineTo(c2x, c2y);
    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = 2.25;
    ctx.stroke();
    ctx.fillStyle = 'rgba(6, 11, 23, 0.8)';
    ctx.fillRect(c1x, c1y - 18, 86, 16);
    ctx.fillStyle = '#38BDF8';
    ctx.font = '600 10px "JetBrains Mono", monospace';
    ctx.fillText('COUNT LINE', c1x + 6, c1y - 6);

    // Stop line (red when red signal, subtle slate otherwise)
    const [s1x, s1y] = toPx(camera.zones.stopLine[0], width, height);
    const [s2x, s2y] = toPx(camera.zones.stopLine[1], width, height);
    ctx.beginPath();
    ctx.moveTo(s1x, s1y);
    ctx.lineTo(s2x, s2y);
    ctx.strokeStyle = signalState === 'red' ? '#EF4444' : 'rgba(226, 232, 240, 0.35)';
    ctx.lineWidth = signalState === 'red' ? 2.5 : 1.25;
    ctx.stroke();
    if (signalState === 'red') {
      ctx.fillStyle = 'rgba(185, 28, 28, 0.9)';
      ctx.fillRect(s1x, s1y - 18, 94, 16);
      ctx.fillStyle = '#FEF2F2';
      ctx.fillText('STOP LINE RED', s1x + 6, s1y - 6);
    }

    // Traffic Signal ROI box (only show prominently if signal is known or red)
    const roi = camera.zones.signalRoi;
    const rx = roi.x * width;
    const ry = roi.y * height;
    const rw = roi.w * width;
    const rh = roi.h * height;
    ctx.strokeStyle =
      signalState === 'red'
        ? '#EF4444'
        : signalState === 'yellow'
        ? '#F59E0B'
        : signalState === 'green'
        ? '#10B981'
        : 'rgba(100, 116, 139, 0.55)';
    ctx.lineWidth = 1.25;
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.fillStyle = 'rgba(6, 11, 23, 0.8)';
    ctx.fillRect(rx, Math.max(0, ry - 16), Math.max(rw, 82), 16);
    ctx.fillStyle = '#E2E8F0';
    ctx.font = '600 9.5px "JetBrains Mono", monospace';
    ctx.fillText(`SIG: ${signalState.toUpperCase()}`, rx + 4, Math.max(11, ry - 4));

    ctx.restore();
  }

  // 3. Trajectories & Tactical Corner-Bracket Bounding Boxes
  for (const trk of tracks) {
    const hasViolation = trk.violations.length > 0;
    const color = hasViolation ? '#EF4444' : CLASS_COLORS[trk.category] || '#3B82F6';

    // Trajectory trail
    if (settings.enableTrajectoryOverlay && trk.trajectory.length >= 2) {
      ctx.save();
      ctx.beginPath();
      trk.trajectory.forEach((pt, idx) => {
        const px = pt.x * width;
        const py = pt.y * height;
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.85;
      ctx.stroke();

      // Center point marker
      const last = trk.trajectory[trk.trajectory.length - 1];
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(last.x * width, last.y * height, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Modern corner-bracket bounding box
    const [bx, by, bw, bh] = trk.bbox;
    ctx.save();
    drawCornerBracketBox(ctx, bx, by, bw, bh, color, hasViolation);

    // Label banner with class color accent bar
    const shortName = CLASS_SHORT_LABELS[trk.category] ?? trk.category.toUpperCase();
    const speedSuffix =
      camera.calibration.isCalibrated && trk.speedKmh !== null
        ? ` · ${trk.speedKmh.toFixed(0)} km/h`
        : '';
    const plateSuffix = trk.plateNumber ? ` · ${trk.plateNumber}` : '';
    const label = `#${trk.trackId} ${shortName} ${Math.round(
      trk.confidence * 100
    )}%${speedSuffix}${plateSuffix}`;

    ctx.font = '600 10.5px "JetBrains Mono", monospace';
    const textW = ctx.measureText(label).width;
    const labelY = Math.max(20, by);
    ctx.fillStyle = hasViolation ? 'rgba(185, 28, 28, 0.95)' : 'rgba(6, 11, 23, 0.9)';
    ctx.fillRect(bx, labelY - 18, textW + 14, 18);
    ctx.fillStyle = color;
    ctx.fillRect(bx, labelY - 18, 3.5, 18);
    ctx.fillStyle = '#F8FAFC';
    ctx.fillText(label, bx + 8, labelY - 5.5);

    if (hasViolation) {
      const vText = trk.violations.map((v) => v.replace(/_/g, ' ').toUpperCase()).join(' | ');
      const vW = ctx.measureText(vText).width;
      ctx.fillStyle = 'rgba(220, 38, 38, 0.95)';
      ctx.fillRect(bx, by + bh + 1, vW + 10, 16);
      ctx.fillStyle = '#FEF2F2';
      ctx.fillText(vText, bx + 5, by + bh + 12.5);
    }

    ctx.restore();
  }
}
