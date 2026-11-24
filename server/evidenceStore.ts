import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export const EVIDENCE_DIR = path.resolve(process.cwd(), 'data', 'evidence');

if (!fs.existsSync(EVIDENCE_DIR)) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
}

const MAX_IMAGE_BYTES = 6 * 1024 * 1024; // 6 MB cap per saved crop/frame
const SAFE_FILENAME_REGEX = /^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp)$/;

export function saveBase64Evidence(
  dataUrlOrBase64: string | null | undefined,
  prefix: string
): string | null {
  if (!dataUrlOrBase64 || typeof dataUrlOrBase64 !== 'string') return null;

  let ext = 'jpg';
  let rawBase64 = dataUrlOrBase64;
  const match = dataUrlOrBase64.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
  if (match) {
    ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
    rawBase64 = match[2];
  }

  const buffer = Buffer.from(rawBase64, 'base64');
  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
    return null;
  }

  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'ev';
  const uniqueName = `${safePrefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
  const resolved = path.resolve(EVIDENCE_DIR, uniqueName);

  // Strict directory confinement boundary check
  if (!resolved.startsWith(EVIDENCE_DIR + path.sep)) {
    throw new Error('Invalid evidence path');
  }

  fs.writeFileSync(resolved, buffer);
  return uniqueName;
}

export function resolveEvidenceFile(filename: string): string | null {
  if (!SAFE_FILENAME_REGEX.test(filename)) {
    return null;
  }
  const resolved = path.resolve(EVIDENCE_DIR, filename);
  if (!resolved.startsWith(EVIDENCE_DIR + path.sep)) {
    return null;
  }
  if (!fs.existsSync(resolved)) {
    return null;
  }
  return resolved;
}
