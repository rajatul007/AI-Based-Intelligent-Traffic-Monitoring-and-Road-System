import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import {
  clearTelemetryData,
  correctNumberPlate,
  DEFAULT_CALIBRATION,
  DEFAULT_ZONES,
  deleteCamera,
  getCameraById,
  getCameras,
  getDashboardSummary,
  getEvidenceRecords,
  getNumberPlates,
  getTracks,
  getVehicles,
  getViolations,
  ingestBatch,
  updateViolationStatus,
  upsertCamera,
} from './server/db.ts';
import { resolveEvidenceFile, saveBase64Evidence } from './server/evidenceStore.ts';
import {
  generateTrafficRecommendations,
  inspectFullFrameWithGemini,
  verifyVehicleCropWithGemini,
} from './server/gemini.ts';
import type { VerificationStatus } from './src/types/traffic.ts';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '25mb' }));

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      timestamp: new Date().toISOString(),
    });
  });

  // Cameras CRUD
  app.get('/api/cameras', (_req, res) => {
    try {
      res.json(getCameras());
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/cameras', (req, res) => {
    try {
      const body = req.body ?? {};
      const rawId = typeof body.id === 'string' && body.id.trim()
        ? body.id.trim().replace(/[^a-zA-Z0-9_-]/g, '')
        : `CAM-${Date.now().toString().slice(-5)}`;
      const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Unnamed Camera';
      const location = typeof body.location === 'string' ? body.location.trim() : 'Unassigned Corridor';

      const saved = upsertCamera({
        id: rawId,
        name,
        location,
        sourceType: ['webcam', 'usb', 'ip_http', 'rtsp', 'video_file'].includes(body.sourceType)
          ? body.sourceType
          : 'webcam',
        sourceUri: typeof body.sourceUri === 'string' ? body.sourceUri.trim() : '',
        speedLimitKmh: Math.max(10, Math.min(180, Number(body.speedLimitKmh) || 50)),
        permittedDirection:
          typeof body.permittedDirection === 'string' ? body.permittedDirection : 'Southbound',
        isCalibrated: Boolean(body.calibration?.isCalibrated),
        calibration: body.calibration ?? DEFAULT_CALIBRATION,
        zones: body.zones ?? DEFAULT_ZONES,
        active: body.active !== false,
      });
      res.status(201).json(saved);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.put('/api/cameras/:id', (req, res) => {
    try {
      const existing = getCameraById(req.params.id);
      if (!existing) {
        res.status(404).json({ error: 'Camera configuration not found' });
        return;
      }
      const body = req.body ?? {};
      const updated = upsertCamera({
        ...existing,
        name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : existing.name,
        location: typeof body.location === 'string' ? body.location.trim() : existing.location,
        sourceType: ['webcam', 'usb', 'ip_http', 'rtsp', 'video_file'].includes(body.sourceType)
          ? body.sourceType
          : existing.sourceType,
        sourceUri: typeof body.sourceUri === 'string' ? body.sourceUri.trim() : existing.sourceUri,
        speedLimitKmh:
          body.speedLimitKmh !== undefined
            ? Math.max(10, Math.min(180, Number(body.speedLimitKmh) || existing.speedLimitKmh))
            : existing.speedLimitKmh,
        permittedDirection:
          typeof body.permittedDirection === 'string'
            ? body.permittedDirection
            : existing.permittedDirection,
        calibration: body.calibration ?? existing.calibration,
        isCalibrated:
          body.calibration !== undefined
            ? Boolean(body.calibration.isCalibrated)
            : existing.isCalibrated,
        zones: body.zones ?? existing.zones,
        active: body.active !== undefined ? Boolean(body.active) : existing.active,
      });
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/cameras/:id', (req, res) => {
    try {
      const ok = deleteCamera(req.params.id);
      if (!ok) {
        res.status(404).json({ error: 'Camera not found' });
        return;
      }
      res.json({ deleted: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Dashboard aggregated metrics
  app.get('/api/dashboard/summary', (req, res) => {
    try {
      const cameraId = typeof req.query.cameraId === 'string' ? req.query.cameraId : undefined;
      res.json(getDashboardSummary(cameraId));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Batch telemetry ingestion from real CV pipeline
  app.post('/api/ingest/batch', (req, res) => {
    try {
      const body = req.body ?? {};
      const cameraId = typeof body.cameraId === 'string' ? body.cameraId : '';
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : 'default';

      if (!cameraId || !getCameraById(cameraId)) {
        res.status(400).json({ error: 'Valid cameraId is required' });
        return;
      }

      // Save any base64 evidence crops safely to disk before inserting SQLite rows
      const violationsWithPaths = Array.isArray(body.violations)
        ? body.violations.map((v: Record<string, unknown>) => {
            const ev = (v.evidenceBase64 ?? {}) as {
              fullFrame?: string | null;
              vehicleCrop?: string | null;
              plateCrop?: string | null;
              metadata?: Record<string, unknown>;
            };
            const fullFramePath = saveBase64Evidence(ev.fullFrame, `full_${cameraId}_${v.trackId}`);
            const vehicleCropPath = saveBase64Evidence(ev.vehicleCrop, `veh_${cameraId}_${v.trackId}`);
            const plateCropPath = saveBase64Evidence(ev.plateCrop, `plt_${cameraId}_${v.trackId}`);

            return {
              trackId: Number(v.trackId),
              vehicleClass: String(v.vehicleClass || 'other'),
              violationType: v.violationType,
              confidence: Math.max(0, Math.min(1, Number(v.confidence ?? 0))),
              speedKmh: v.speedKmh === null || v.speedKmh === undefined ? null : Number(v.speedKmh),
              plateNumber: typeof v.plateNumber === 'string' ? v.plateNumber : null,
              verificationStatus: (['verified', 'requires_review', 'dismissed'].includes(
                String(v.verificationStatus)
              )
                ? String(v.verificationStatus)
                : 'requires_review') as VerificationStatus,
              notes: typeof v.notes === 'string' ? v.notes : null,
              timestamp: typeof v.timestamp === 'string' ? v.timestamp : new Date().toISOString(),
              evidencePaths:
                fullFramePath || vehicleCropPath || plateCropPath
                  ? {
                      fullFramePath,
                      vehicleCropPath,
                      plateCropPath,
                      metadata: ev.metadata ?? {},
                    }
                  : undefined,
            };
          })
        : undefined;

      const platesWithPaths = Array.isArray(body.plates)
        ? body.plates.map((p: Record<string, unknown>) => ({
            trackId: Number(p.trackId),
            rawText: String(p.rawText || ''),
            normalizedPlate: typeof p.normalizedPlate === 'string' ? p.normalizedPlate : null,
            isValidIndianFormat: Boolean(p.isValidIndianFormat),
            ocrConfidence: Math.max(0, Math.min(1, Number(p.ocrConfidence ?? 0))),
            plateImagePath: saveBase64Evidence(
              typeof p.plateImageBase64 === 'string' ? p.plateImageBase64 : null,
              `anpr_${cameraId}_${p.trackId}`
            ),
            timestamp: typeof p.timestamp === 'string' ? p.timestamp : new Date().toISOString(),
          }))
        : undefined;

      const result = ingestBatch({
        cameraId,
        sessionId,
        vehicles: Array.isArray(body.vehicles) ? body.vehicles : undefined,
        violations: violationsWithPaths,
        plates: platesWithPaths,
        statsBucket: body.statsBucket,
      });

      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Vehicles & Tracks
  app.get('/api/vehicles', (req, res) => {
    try {
      res.json(
        getVehicles({
          cameraId: typeof req.query.cameraId === 'string' ? req.query.cameraId : undefined,
          vehicleClass:
            typeof req.query.vehicleClass === 'string' ? req.query.vehicleClass : undefined,
          limit: req.query.limit ? Number(req.query.limit) : 250,
        })
      );
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/tracks', (req, res) => {
    try {
      const cameraId = typeof req.query.cameraId === 'string' ? req.query.cameraId : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : 150;
      res.json(getTracks(cameraId, limit));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Violations
  app.get('/api/violations', (req, res) => {
    try {
      res.json(
        getViolations({
          cameraId: typeof req.query.cameraId === 'string' ? req.query.cameraId : undefined,
          violationType:
            typeof req.query.violationType === 'string' ? req.query.violationType : undefined,
          status: typeof req.query.status === 'string' ? req.query.status : undefined,
          dateFrom: typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined,
          dateTo: typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined,
          limit: req.query.limit ? Number(req.query.limit) : 250,
        })
      );
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.patch('/api/violations/:id', (req, res) => {
    try {
      const id = Number(req.params.id);
      const status = req.body?.verificationStatus;
      if (!Number.isInteger(id) || !['verified', 'requires_review', 'dismissed'].includes(status)) {
        res.status(400).json({ error: 'Invalid violation ID or verificationStatus' });
        return;
      }
      const notes = typeof req.body?.notes === 'string' ? req.body.notes : undefined;
      const ok = updateViolationStatus(id, status, notes);
      if (!ok) {
        res.status(404).json({ error: 'Violation record not found' });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Indian ANPR Number Plates
  app.get('/api/plates', (req, res) => {
    try {
      const cameraId = typeof req.query.cameraId === 'string' ? req.query.cameraId : undefined;
      res.json(getNumberPlates(cameraId, 250));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.patch('/api/plates/:id', (req, res) => {
    try {
      const id = Number(req.params.id);
      const correctedPlate = typeof req.body?.correctedPlate === 'string' ? req.body.correctedPlate.trim() : '';
      if (!Number.isInteger(id) || correctedPlate.length < 4 || correctedPlate.length > 15) {
        res.status(400).json({ error: 'Provide a valid registration number (4-15 characters).' });
        return;
      }
      const ok = correctNumberPlate(id, correctedPlate);
      if (!ok) {
        res.status(404).json({ error: 'Plate record not found' });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Evidence records & path-confined static file route
  app.get('/api/evidence', (req, res) => {
    try {
      const cameraId = typeof req.query.cameraId === 'string' ? req.query.cameraId : undefined;
      res.json(getEvidenceRecords(cameraId, 120));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/evidence/file/:filename', (req, res) => {
    const resolved = resolveEvidenceFile(req.params.filename);
    if (!resolved) {
      res.status(404).json({ error: 'Evidence file not found' });
      return;
    }
    res.sendFile(resolved);
  });

  // Server-side Gemini Vision ANPR & Specialized Violation Verification
  app.post('/api/vision/verify-vehicle', async (req, res) => {
    try {
      const { vehicleCropBase64, fullFrameBase64, vehicleClass } = req.body ?? {};
      if (typeof vehicleCropBase64 !== 'string' || vehicleCropBase64.length < 50) {
        res.status(400).json({ error: 'vehicleCropBase64 is required' });
        return;
      }
      const result = await verifyVehicleCropWithGemini({
        vehicleCropBase64,
        fullFrameBase64: typeof fullFrameBase64 === 'string' ? fullFrameBase64 : undefined,
        vehicleClass: typeof vehicleClass === 'string' ? vehicleClass : 'vehicle',
      });
      res.json(result);
    } catch (err) {
      const msg = (err as Error).message || 'Vision verification failed';
      res.status(500).json({ error: msg });
    }
  });

  app.post('/api/vision/inspect-frame', async (req, res) => {
    try {
      const { frameBase64 } = req.body ?? {};
      if (typeof frameBase64 !== 'string' || frameBase64.length < 50) {
        res.status(400).json({ error: 'frameBase64 is required' });
        return;
      }
      const result = await inspectFullFrameWithGemini(frameBase64);
      res.json(result);
    } catch (err) {
      const msg = (err as Error).message || 'Full frame vision inspection failed';
      res.status(500).json({ error: msg });
    }
  });

  // Server-side Gemini Advisory Traffic Recommendations
  app.post('/api/analytics/recommendations', async (req, res) => {
    try {
      const cameraId = typeof req.body?.cameraId === 'string' ? req.body.cameraId : undefined;
      const summary = getDashboardSummary(cameraId);
      const recommendations = await generateTrafficRecommendations(summary);
      res.json({ recommendations, advisoryMode: true });
    } catch (err) {
      const msg = (err as Error).message || 'Failed to generate traffic recommendations';
      res.status(500).json({ error: msg });
    }
  });

  // Clear recorded telemetry (keeps camera configs)
  app.delete('/api/data/clear', (_req, res) => {
    try {
      clearTelemetryData();
      res.json({ cleared: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Serve bundled real CCTV presentation sample videos directly with byte-range streaming
  app.use('/samples', express.static(path.resolve(process.cwd(), 'public', 'samples')));

  // Vite middleware for dev / static serving for production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Drishti Traffic AI server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Server startup error:', err);
  process.exit(1);
});
