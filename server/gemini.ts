import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  DashboardSummary,
  TrafficRecommendation,
  VisionVerificationResult,
} from '../src/types/traffic.ts';

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Configure it in Settings > Secrets to enable AI ANPR OCR, Helmet inspection, and Advisory Recommendations.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function stripDataUrl(input: string): { mimeType: string; data: string } {
  const match = input.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (match) {
    return { mimeType: match[1], data: match[2] };
  }
  return { mimeType: 'image/jpeg', data: input };
}

export function normalizeIndianPlateServer(raw: string | null): {
  normalizedPlate: string | null;
  isValidIndianFormat: boolean;
} {
  if (!raw) return { normalizedPlate: null, isValidIndianFormat: false };
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length < 6 || cleaned.length > 12) {
    return { normalizedPlate: cleaned || null, isValidIndianFormat: false };
  }

  const standardRegex = /^[A-Z]{2}[0-9]{2}[A-Z]{1,3}[0-9]{4}$/;
  const bhRegex = /^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$/;

  if (standardRegex.test(cleaned) || bhRegex.test(cleaned)) {
    return { normalizedPlate: cleaned, isValidIndianFormat: true };
  }

  // Apply positional character repair only for 9-10 char standard plates
  if (cleaned.length === 10 || cleaned.length === 9) {
    const toLetter: Record<string, string> = { '0': 'O', '1': 'I', '5': 'S', '8': 'B', '2': 'Z' };
    const toDigit: Record<string, string> = { O: '0', Q: '0', D: '0', I: '1', L: '1', S: '5', B: '8', Z: '2' };
    const chars = cleaned.split('');
    const seriesLen = cleaned.length === 10 ? 2 : 1;

    for (let i = 0; i < 2; i++) chars[i] = toLetter[chars[i]] ?? chars[i];
    for (let i = 2; i < 4; i++) chars[i] = toDigit[chars[i]] ?? chars[i];
    for (let i = 4; i < 4 + seriesLen; i++) chars[i] = toLetter[chars[i]] ?? chars[i];
    for (let i = 4 + seriesLen; i < cleaned.length; i++) chars[i] = toDigit[chars[i]] ?? chars[i];

    const repaired = chars.join('');
    if (standardRegex.test(repaired)) {
      return { normalizedPlate: repaired, isValidIndianFormat: true };
    }
  }

  return { normalizedPlate: cleaned, isValidIndianFormat: false };
}

export async function verifyVehicleCropWithGemini(params: {
  vehicleCropBase64: string;
  fullFrameBase64?: string;
  vehicleClass: string;
}): Promise<VisionVerificationResult> {
  const ai = getAiClient();
  const parts: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }> = [];

  const crop = stripDataUrl(params.vehicleCropBase64);
  parts.push({ inlineData: crop });

  if (params.fullFrameBase64) {
    parts.push({ inlineData: stripDataUrl(params.fullFrameBase64) });
  }

  parts.push({
    text: `You are a forensic Indian traffic surveillance computer-vision verifier.
Inspect the provided cropped vehicle image (and optional full intersection frame).
Reported detector class: "${params.vehicleClass}".

STRICT HONESTY RULES:
1. Indian Number Plate (ANPR): Read the registration plate ONLY if characters are genuinely legible in the pixels (e.g., DL01AB1234, HR26DK1234, UP16AB1234, MH12AB1234, 22BH1234AA). If the plate is blurry, obscured, too small, or not visible, you MUST return plateText as "" (empty string) and ocrConfidence as 0. NEVER fabricate or guess a plate number.
2. Helmet Detection (for motorcycles/scooters): Return "helmet_present", "helmet_absent", "uncertain", or "not_applicable". Return "helmet_absent" ONLY if a rider's bare head is clearly visible without a helmet. If ambiguous or low resolution, return "uncertain".
3. Triple Riding: Count clearly visible riders on a two-wheeler. Return "detected" only if 3 or more riders are clearly seated on one motorcycle/scooter; otherwise "not_detected", "uncertain", or "not_applicable".
4. Seat Belt & Mobile Phone Usage: Return "absent" or "detected" ONLY if the front cabin / driver is clearly visible through the windshield. Otherwise return "uncertain" or "not_applicable".
5. Traffic Signal State: If a traffic light is clearly visible in the full frame, return "red", "yellow", or "green", otherwise "unknown".
6. Indian Vehicle Sub-Type: Identify if this is an "auto_rickshaw", "e_rickshaw", "sedan", "suv", "hatchback", "motorcycle", "scooter", "bus", "truck", "bicycle", or "other".`,
  });

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: { parts },
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          plateText: {
            type: Type.STRING,
            description: 'Exact readable license plate characters or empty string if unreadable.',
          },
          ocrConfidence: {
            type: Type.NUMBER,
            description: 'Confidence from 0.0 to 1.0 (0 if unreadable).',
          },
          helmetStatus: {
            type: Type.STRING,
            description: 'One of: helmet_present, helmet_absent, uncertain, not_applicable',
          },
          riderCount: {
            type: Type.INTEGER,
            description: 'Visible rider count on motorcycle, or 0 if not a motorcycle.',
          },
          tripleRidingStatus: {
            type: Type.STRING,
            description: 'One of: detected, not_detected, uncertain, not_applicable',
          },
          seatBeltStatus: {
            type: Type.STRING,
            description: 'One of: present, absent, uncertain, not_applicable',
          },
          mobileUsageStatus: {
            type: Type.STRING,
            description: 'One of: detected, not_detected, uncertain, not_applicable',
          },
          signalState: {
            type: Type.STRING,
            description: 'One of: red, yellow, green, unknown',
          },
          vehicleSubType: {
            type: Type.STRING,
            description: 'Specific vehicle class including auto_rickshaw if applicable.',
          },
          evidenceSummary: {
            type: Type.STRING,
            description: 'Brief factual visual observation noting any occlusion or blur.',
          },
        },
        required: [
          'plateText',
          'ocrConfidence',
          'helmetStatus',
          'riderCount',
          'tripleRidingStatus',
          'seatBeltStatus',
          'mobileUsageStatus',
          'signalState',
          'vehicleSubType',
          'evidenceSummary',
        ],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as Record<string, unknown>;
  const rawPlate = typeof parsed.plateText === 'string' && parsed.plateText.trim().length > 0
    ? parsed.plateText.trim()
    : null;
  const { normalizedPlate, isValidIndianFormat } = normalizeIndianPlateServer(rawPlate);

  return {
    plateText: rawPlate,
    normalizedPlate,
    isValidIndianFormat,
    ocrConfidence: rawPlate ? Math.max(0, Math.min(1, Number(parsed.ocrConfidence ?? 0))) : 0,
    helmetStatus: (['helmet_present', 'helmet_absent', 'uncertain', 'not_applicable'].includes(
      String(parsed.helmetStatus)
    )
      ? String(parsed.helmetStatus)
      : 'uncertain') as VisionVerificationResult['helmetStatus'],
    riderCount: typeof parsed.riderCount === 'number' ? parsed.riderCount : null,
    tripleRidingStatus: (['detected', 'not_detected', 'uncertain', 'not_applicable'].includes(
      String(parsed.tripleRidingStatus)
    )
      ? String(parsed.tripleRidingStatus)
      : 'uncertain') as VisionVerificationResult['tripleRidingStatus'],
    seatBeltStatus: (['present', 'absent', 'uncertain', 'not_applicable'].includes(
      String(parsed.seatBeltStatus)
    )
      ? String(parsed.seatBeltStatus)
      : 'uncertain') as VisionVerificationResult['seatBeltStatus'],
    mobileUsageStatus: (['detected', 'not_detected', 'uncertain', 'not_applicable'].includes(
      String(parsed.mobileUsageStatus)
    )
      ? String(parsed.mobileUsageStatus)
      : 'uncertain') as VisionVerificationResult['mobileUsageStatus'],
    signalState: (['red', 'yellow', 'green', 'unknown'].includes(String(parsed.signalState))
      ? String(parsed.signalState)
      : 'unknown') as VisionVerificationResult['signalState'],
    vehicleSubType: typeof parsed.vehicleSubType === 'string' ? parsed.vehicleSubType : null,
    evidenceSummary:
      typeof parsed.evidenceSummary === 'string'
        ? parsed.evidenceSummary
        : 'Inspection completed.',
  };
}

export interface FullFrameInspectionResult {
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
    violationType: 'no_helmet' | 'triple_riding' | 'seat_belt' | 'mobile_phone_usage' | 'zebra_crossing_blocking' | 'wrong_way';
    vehicleType: string;
    confidence: number;
    requiresReview: boolean;
    description: string;
  }>;
  sceneSummary: string;
}

export async function inspectFullFrameWithGemini(frameBase64: string): Promise<FullFrameInspectionResult> {
  const ai = getAiClient();
  const img = stripDataUrl(frameBase64);

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: {
      parts: [
        { inlineData: img },
        {
          text: `Inspect this traffic surveillance frame honestly for Indian road analytics.
1. Detect traffic signal light state if visible ("red", "yellow", "green", or "unknown").
2. Count auto-rickshaws / three-wheelers if present (0 if none).
3. List ONLY clearly legible license plates (never guess or fabricate plates; return empty array if none are readable).
4. List observable safety issues (no_helmet, triple_riding, seat_belt, mobile_phone_usage, zebra_crossing_blocking, wrong_way) ONLY when supported by visual evidence. Mark requiresReview: true whenever visibility is partial or uncertain.`,
        },
      ],
    },
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          signalState: { type: Type.STRING },
          autoRickshawCount: { type: Type.INTEGER },
          readablePlates: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                plateText: { type: Type.STRING },
                vehicleType: { type: Type.STRING },
                confidence: { type: Type.NUMBER },
              },
              required: ['plateText', 'vehicleType', 'confidence'],
            },
          },
          observedSafetyIssues: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                violationType: { type: Type.STRING },
                vehicleType: { type: Type.STRING },
                confidence: { type: Type.NUMBER },
                requiresReview: { type: Type.BOOLEAN },
                description: { type: Type.STRING },
              },
              required: ['violationType', 'vehicleType', 'confidence', 'requiresReview', 'description'],
            },
          },
          sceneSummary: { type: Type.STRING },
        },
        required: [
          'signalState',
          'autoRickshawCount',
          'readablePlates',
          'observedSafetyIssues',
          'sceneSummary',
        ],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as Record<string, unknown>;
  const rawPlates = Array.isArray(parsed.readablePlates) ? parsed.readablePlates : [];
  const rawIssues = Array.isArray(parsed.observedSafetyIssues) ? parsed.observedSafetyIssues : [];

  return {
    signalState: (['red', 'yellow', 'green', 'unknown'].includes(String(parsed.signalState))
      ? String(parsed.signalState)
      : 'unknown') as FullFrameInspectionResult['signalState'],
    autoRickshawCount: Math.max(0, Number(parsed.autoRickshawCount ?? 0)),
    readablePlates: rawPlates
      .filter((p: Record<string, unknown>) => typeof p.plateText === 'string' && p.plateText.trim().length >= 5)
      .map((p: Record<string, unknown>) => {
        const { normalizedPlate, isValidIndianFormat } = normalizeIndianPlateServer(String(p.plateText));
        return {
          plateText: String(p.plateText).trim(),
          normalizedPlate,
          isValidIndianFormat,
          vehicleType: String(p.vehicleType || 'car'),
          confidence: Math.max(0, Math.min(1, Number(p.confidence ?? 0.5))),
        };
      }),
    observedSafetyIssues: rawIssues.map((iss: Record<string, unknown>) => ({
      violationType: String(iss.violationType || 'no_helmet') as FullFrameInspectionResult['observedSafetyIssues'][0]['violationType'],
      vehicleType: String(iss.vehicleType || 'motorcycle'),
      confidence: Math.max(0, Math.min(1, Number(iss.confidence ?? 0.5))),
      requiresReview: Boolean(iss.requiresReview ?? true),
      description: String(iss.description || 'Visual anomaly flagged for review.'),
    })),
    sceneSummary: String(parsed.sceneSummary || 'Frame analyzed.'),
  };
}

export async function generateTrafficRecommendations(
  summary: DashboardSummary
): Promise<TrafficRecommendation[]> {
  const ai = getAiClient();

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `You are an urban traffic engineering advisor operating strictly in ADVISORY / SIMULATION MODE (never automated signal control).
Analyze these real observed traffic surveillance statistics from our SQLite database and produce 4 concrete, data-grounded recommendations covering:
1. Congestion hotspots
2. Peak traffic management
3. Possible signal timing improvements (advisory simulation only)
4. Road safety & monitoring priorities

Observed Database Summary:
${JSON.stringify(
  {
    kpis: summary.kpis,
    vehicleCountsByType: summary.vehicleCountsByType,
    violationsByType: summary.violationsByType,
    directionalCounts: summary.directionalCounts,
    multiViolationCount: summary.multiViolationVehicles.length,
  },
  null,
  2
)}

If counts are currently low or zero, honestly note the baseline state and provide actionable camera calibration, zone tuning, and pilot monitoring recommendations without fabricating traffic numbers.`,
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            category: {
              type: Type.STRING,
              description:
                'One of: congestion_hotspot, peak_management, signal_timing_advisory, monitoring_priority',
            },
            priority: {
              type: Type.STRING,
              description: 'One of: high, medium, low',
            },
            title: { type: Type.STRING },
            rationale: { type: Type.STRING },
            suggestedAction: { type: Type.STRING },
            advisoryModeNote: {
              type: Type.STRING,
              description: 'Explicit disclaimer that this is advisory/simulation only.',
            },
          },
          required: [
            'category',
            'priority',
            'title',
            'rationale',
            'suggestedAction',
            'advisoryModeNote',
          ],
        },
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '[]').trim()) as TrafficRecommendation[];
  return Array.isArray(parsed) ? parsed : [];
}
