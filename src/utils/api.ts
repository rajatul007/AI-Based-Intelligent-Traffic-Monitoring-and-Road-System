import type {
  CameraConfiguration,
  DashboardSummary,
  EvidenceRecord,
  NumberPlateRecord,
  TrafficRecommendation,
  VehicleRecord,
  VerificationStatus,
  ViolationRecord,
  VisionVerificationResult,
} from '../types/traffic';

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  health: () =>
    requestJson<{ status: string; geminiConfigured: boolean; timestamp: string }>('/api/health'),

  getCameras: () => requestJson<CameraConfiguration[]>('/api/cameras'),

  createCamera: (payload: Partial<CameraConfiguration>) =>
    requestJson<CameraConfiguration>('/api/cameras', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateCamera: (id: string, payload: Partial<CameraConfiguration>) =>
    requestJson<CameraConfiguration>(`/api/cameras/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deleteCamera: (id: string) =>
    requestJson<{ deleted: boolean }>(`/api/cameras/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  getDashboardSummary: (cameraId?: string) => {
    const qs = cameraId && cameraId !== 'all' ? `?cameraId=${encodeURIComponent(cameraId)}` : '';
    return requestJson<DashboardSummary>(`/api/dashboard/summary${qs}`);
  },

  ingestBatch: (payload: Record<string, unknown>) =>
    requestJson<{ ok: boolean; vehiclesSaved: number; violationsSaved: number; platesSaved: number }>(
      '/api/ingest/batch',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  getVehicles: (cameraId?: string, vehicleClass?: string) => {
    const params = new URLSearchParams();
    if (cameraId && cameraId !== 'all') params.set('cameraId', cameraId);
    if (vehicleClass && vehicleClass !== 'all') params.set('vehicleClass', vehicleClass);
    const qs = params.toString();
    return requestJson<VehicleRecord[]>(`/api/vehicles${qs ? `?${qs}` : ''}`);
  },

  getTracks: (cameraId?: string) => {
    const qs = cameraId && cameraId !== 'all' ? `?cameraId=${encodeURIComponent(cameraId)}` : '';
    return requestJson<
      Array<{
        id: number;
        cameraId: string;
        trackId: number;
        sessionId: string;
        points: Array<{ x: number; y: number; t: number }>;
        direction: string;
        enteredLine: boolean;
        exitedLine: boolean;
        createdAt: string;
      }>
    >(`/api/tracks${qs}`);
  },

  getViolations: (filters?: {
    cameraId?: string;
    violationType?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
  }) => {
    const params = new URLSearchParams();
    if (filters?.cameraId && filters.cameraId !== 'all') params.set('cameraId', filters.cameraId);
    if (filters?.violationType && filters.violationType !== 'all')
      params.set('violationType', filters.violationType);
    if (filters?.status && filters.status !== 'all') params.set('status', filters.status);
    if (filters?.dateFrom) params.set('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.set('dateTo', filters.dateTo);
    const qs = params.toString();
    return requestJson<ViolationRecord[]>(`/api/violations${qs ? `?${qs}` : ''}`);
  },

  updateViolationStatus: (id: number, verificationStatus: VerificationStatus, notes?: string) =>
    requestJson<{ ok: boolean }>(`/api/violations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ verificationStatus, notes }),
    }),

  getPlates: (cameraId?: string) => {
    const qs = cameraId && cameraId !== 'all' ? `?cameraId=${encodeURIComponent(cameraId)}` : '';
    return requestJson<NumberPlateRecord[]>(`/api/plates${qs}`);
  },

  correctPlate: (id: number, correctedPlate: string) =>
    requestJson<{ ok: boolean }>(`/api/plates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ correctedPlate }),
    }),

  getEvidence: (cameraId?: string) => {
    const qs = cameraId && cameraId !== 'all' ? `?cameraId=${encodeURIComponent(cameraId)}` : '';
    return requestJson<EvidenceRecord[]>(`/api/evidence${qs}`);
  },

  verifyVehicleVision: (payload: {
    vehicleCropBase64: string;
    fullFrameBase64?: string;
    vehicleClass: string;
  }) =>
    requestJson<VisionVerificationResult>('/api/vision/verify-vehicle', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  inspectFullFrameVision: (frameBase64: string) =>
    requestJson<{
      signalState: 'red' | 'yellow' | 'green' | 'unknown';
      autoRickshawCount: number;
      readablePlates: Array<{
        plateText: string;
        normalizedPlate: string | null;
        isValidIndianFormat: boolean;
        vehicleType: string;
        confidence: number;
      }>;
      observedSafetyIssues: Array<{
        violationType: string;
        vehicleType: string;
        confidence: number;
        requiresReview: boolean;
        description: string;
      }>;
      sceneSummary: string;
    }>('/api/vision/inspect-frame', {
      method: 'POST',
      body: JSON.stringify({ frameBase64 }),
    }),

  getRecommendations: (cameraId?: string) =>
    requestJson<{ recommendations: TrafficRecommendation[]; advisoryMode: boolean }>(
      '/api/analytics/recommendations',
      {
        method: 'POST',
        body: JSON.stringify({ cameraId }),
      }
    ),

  clearTelemetry: () => requestJson<{ cleared: boolean }>('/api/data/clear', { method: 'DELETE' }),
};
