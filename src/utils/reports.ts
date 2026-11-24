import ExcelJS from 'exceljs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type {
  DashboardSummary,
  NumberPlateRecord,
  VehicleRecord,
  ViolationRecord,
} from '../types/traffic';
import { VIOLATION_LABELS } from '../types/traffic';

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeCsvCell(val: unknown): string {
  const s = val === null || val === undefined ? '' : String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function exportViolationsCsv(violations: ViolationRecord[], suffix = 'all'): void {
  const headers = [
    'ID',
    'Timestamp',
    'Camera ID',
    'Camera Name',
    'Track ID',
    'Vehicle Category',
    'Violation Type',
    'Number Plate',
    'Speed (km/h)',
    'Confidence (%)',
    'Verification Status',
    'Notes',
  ];
  const rows = violations.map((v) => [
    v.id,
    v.timestamp,
    v.cameraId,
    v.cameraName ?? v.cameraId,
    v.trackId,
    v.vehicleClass,
    VIOLATION_LABELS[v.violationType] ?? v.violationType,
    v.plateNumber ?? 'Unreadable',
    v.speedKmh !== null ? v.speedKmh : 'Uncalibrated',
    Math.round(v.confidence * 100),
    v.verificationStatus,
    v.notes ?? '',
  ]);
  const csv = [headers.join(','), ...rows.map((r) => r.map(escapeCsvCell).join(','))].join('\n');
  triggerDownload(
    new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
    `traffic_violations_${suffix}_${new Date().toISOString().slice(0, 10)}.csv`
  );
}

export async function exportFullExcelWorkbook(params: {
  summary: DashboardSummary;
  vehicles: VehicleRecord[];
  violations: ViolationRecord[];
  plates: NumberPlateRecord[];
  filterLabel: string;
}): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Drishti Traffic AI';
  wb.created = new Date();

  // Sheet 1: Daily Traffic & Congestion Summary
  const wsSummary = wb.addWorksheet('Traffic Summary');
  wsSummary.addRows([
    ['Drishti Traffic AI — Smart Traffic Analytics Report'],
    ['Generated At', new Date().toISOString()],
    ['Filter Scope', params.filterLabel],
    [],
    ['Metric', 'Observed Value'],
    ['Total Unique Vehicles', params.summary.kpis.totalVehicles],
    ['Active Vehicles (Last 60s)', params.summary.kpis.activeVehicles],
    ['Total Active Violations', params.summary.kpis.totalViolations],
    ['Overspeeding Cases', params.summary.kpis.overspeedingCases],
    ['No-Helmet Cases', params.summary.kpis.noHelmetCases],
    ['Wrong-Way Cases', params.summary.kpis.wrongWayCases],
    [
      'Average Calibrated Speed (km/h)',
      params.summary.kpis.averageSpeedKmh !== null
        ? params.summary.kpis.averageSpeedKmh
        : 'Uncalibrated (N/A)',
    ],
    ['Vehicle Density (veh / 100m)', params.summary.kpis.trafficDensity],
    ['Congestion Level', params.summary.kpis.congestionLevel],
    ['Smart Traffic Risk Score (0-100)', params.summary.kpis.riskScore],
  ]);

  // Sheet 2: Violations
  const wsViol = wb.addWorksheet('Violations');
  wsViol.columns = [
    { header: 'ID', key: 'id', width: 8 },
    { header: 'Timestamp', key: 'timestamp', width: 24 },
    { header: 'Camera', key: 'camera', width: 14 },
    { header: 'Track ID', key: 'trackId', width: 10 },
    { header: 'Category', key: 'category', width: 14 },
    { header: 'Violation', key: 'violation', width: 24 },
    { header: 'Number Plate', key: 'plate', width: 16 },
    { header: 'Speed (km/h)', key: 'speed', width: 14 },
    { header: 'Confidence (%)', key: 'conf', width: 14 },
    { header: 'Status', key: 'status', width: 16 },
    { header: 'Notes', key: 'notes', width: 42 },
  ];
  for (const v of params.violations) {
    wsViol.addRow({
      id: v.id,
      timestamp: v.timestamp,
      camera: v.cameraId,
      trackId: v.trackId,
      category: v.vehicleClass,
      violation: VIOLATION_LABELS[v.violationType] ?? v.violationType,
      plate: v.plateNumber ?? 'Unreadable',
      speed: v.speedKmh ?? 'N/A',
      conf: Math.round(v.confidence * 100),
      status: v.verificationStatus,
      notes: v.notes ?? '',
    });
  }

  // Sheet 3: Vehicles
  const wsVeh = wb.addWorksheet('Vehicles');
  wsVeh.columns = [
    { header: 'ID', key: 'id', width: 8 },
    { header: 'Camera', key: 'camera', width: 14 },
    { header: 'Track ID', key: 'trackId', width: 10 },
    { header: 'Category', key: 'category', width: 14 },
    { header: 'Direction', key: 'direction', width: 12 },
    { header: 'Avg Speed (km/h)', key: 'avgSpeed', width: 16 },
    { header: 'Max Speed (km/h)', key: 'maxSpeed', width: 16 },
    { header: 'Plate', key: 'plate', width: 16 },
    { header: 'First Seen', key: 'firstSeen', width: 24 },
    { header: 'Last Seen', key: 'lastSeen', width: 24 },
  ];
  for (const v of params.vehicles) {
    wsVeh.addRow({
      id: v.id,
      camera: v.cameraId,
      trackId: v.trackId,
      category: v.vehicleClass,
      direction: v.direction,
      avgSpeed: v.avgSpeedKmh ?? 'Uncalibrated',
      maxSpeed: v.maxSpeedKmh ?? 'Uncalibrated',
      plate: v.plateNumber ?? '',
      firstSeen: v.firstSeen,
      lastSeen: v.lastSeen,
    });
  }

  // Sheet 4: Indian ANPR Plates
  const wsPlates = wb.addWorksheet('ANPR Plates');
  wsPlates.columns = [
    { header: 'ID', key: 'id', width: 8 },
    { header: 'Camera', key: 'camera', width: 14 },
    { header: 'Track ID', key: 'trackId', width: 10 },
    { header: 'Raw OCR', key: 'raw', width: 16 },
    { header: 'Normalized Plate', key: 'norm', width: 16 },
    { header: 'Manual Correction', key: 'corr', width: 16 },
    { header: 'Valid Indian RTO', key: 'valid', width: 16 },
    { header: 'OCR Confidence (%)', key: 'conf', width: 16 },
    { header: 'Timestamp', key: 'ts', width: 24 },
  ];
  for (const p of params.plates) {
    wsPlates.addRow({
      id: p.id,
      camera: p.cameraId,
      trackId: p.trackId,
      raw: p.rawText,
      norm: p.normalizedPlate ?? '',
      corr: p.correctedPlate ?? '',
      valid: p.isValidIndianFormat ? 'Yes' : 'No',
      conf: Math.round(p.ocrConfidence * 100),
      ts: p.timestamp,
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  triggerDownload(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `drishti_traffic_report_${new Date().toISOString().slice(0, 10)}.xlsx`
  );
}

export function exportTrafficPdfReport(params: {
  summary: DashboardSummary;
  violations: ViolationRecord[];
  plates: NumberPlateRecord[];
  filterLabel: string;
}): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

  doc.setFillColor(11, 17, 32);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 68, 'F');
  doc.setTextColor(248, 250, 252);
  doc.setFontSize(18);
  doc.text('Drishti Traffic AI — Surveillance & Violation Analytics Report', 36, 34);
  doc.setFontSize(10);
  doc.setTextColor(148, 163, 184);
  doc.text(
    `Scope: ${params.filterLabel}   |   Generated: ${new Date().toLocaleString()}   |   Advisory Mode`,
    36,
    52
  );

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(12);
  doc.text('1. Executive Traffic & Congestion Summary', 36, 94);

  autoTable(doc, {
    startY: 104,
    head: [
      [
        'Total Vehicles',
        'Total Violations',
        'Overspeeding',
        'No-Helmet',
        'Wrong-Way',
        'Avg Speed',
        'Density (/100m)',
        'Congestion',
        'Risk Score',
      ],
    ],
    body: [
      [
        String(params.summary.kpis.totalVehicles),
        String(params.summary.kpis.totalViolations),
        String(params.summary.kpis.overspeedingCases),
        String(params.summary.kpis.noHelmetCases),
        String(params.summary.kpis.wrongWayCases),
        params.summary.kpis.averageSpeedKmh !== null
          ? `${params.summary.kpis.averageSpeedKmh} km/h`
          : 'Uncalibrated',
        String(params.summary.kpis.trafficDensity),
        params.summary.kpis.congestionLevel,
        `${params.summary.kpis.riskScore} / 100`,
      ],
    ],
    theme: 'grid',
    headStyles: { fillColor: [30, 41, 59], textColor: [248, 250, 252], fontSize: 9 },
    bodyStyles: { fontSize: 9 },
  });

  const afterKpiY =
    (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 180;
  doc.setFontSize(12);
  doc.text(`2. Recorded Traffic Violations (${params.violations.length})`, 36, afterKpiY + 26);

  autoTable(doc, {
    startY: afterKpiY + 36,
    head: [
      ['Timestamp', 'Camera', 'Track', 'Vehicle', 'Violation', 'Plate', 'Speed', 'Conf', 'Status'],
    ],
    body:
      params.violations.length > 0
        ? params.violations.slice(0, 60).map((v) => [
            new Date(v.timestamp).toLocaleString(),
            v.cameraId,
            `#${v.trackId}`,
            v.vehicleClass,
            VIOLATION_LABELS[v.violationType] ?? v.violationType,
            v.plateNumber ?? 'Unreadable',
            v.speedKmh !== null ? `${v.speedKmh} km/h` : 'N/A',
            `${Math.round(v.confidence * 100)}%`,
            v.verificationStatus,
          ])
        : [['No violation records match the selected filters.', '', '', '', '', '', '', '', '']],
    theme: 'striped',
    headStyles: { fillColor: [30, 41, 59], textColor: [248, 250, 252], fontSize: 8.5 },
    bodyStyles: { fontSize: 8 },
  });

  if (params.plates.length > 0) {
    doc.addPage();
    doc.setFontSize(12);
    doc.text(`3. Indian Number Plate Recognition (ANPR) Log (${params.plates.length})`, 36, 44);
    autoTable(doc, {
      startY: 54,
      head: [
        ['Timestamp', 'Camera', 'Track', 'Raw OCR', 'Normalized / Corrected', 'RTO Valid', 'Confidence'],
      ],
      body: params.plates.slice(0, 80).map((p) => [
        new Date(p.timestamp).toLocaleString(),
        p.cameraId,
        `#${p.trackId}`,
        p.rawText,
        p.correctedPlate || p.normalizedPlate || 'Unreadable',
        p.isValidIndianFormat ? 'Valid' : 'Verify',
        `${Math.round(p.ocrConfidence * 100)}%`,
      ]),
      theme: 'striped',
      headStyles: { fillColor: [30, 41, 59], textColor: [248, 250, 252], fontSize: 8.5 },
      bodyStyles: { fontSize: 8 },
    });
  }

  doc.save(`drishti_traffic_report_${new Date().toISOString().slice(0, 10)}.pdf`);
}
