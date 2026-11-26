import crypto from 'node:crypto';
import { getVideoSigningSecret } from '../config/secrets.ts';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

/**
 * Constant precomputed scrypt hash used to equalize authentication timing
 * when a login phone/email does not exist in the database.
 */
export const DUMMY_PASSWORD_HASH =
  'scrypt$00112233445566778899aabbccddeeff$' +
  '0000000000000000000000000000000000000000000000000000000000000000' +
  '0000000000000000000000000000000000000000000000000000000000000000';

export function verifyPassword(password: string, storedHash: string | null | undefined): boolean {
  if (!storedHash) return false;
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, originalHex] = parts;
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  const originalBuf = Buffer.from(originalHex, 'hex');
  if (derivedBuf.length !== originalBuf.length) return false;
  return crypto.timingSafeEqual(derivedBuf, originalBuf);
}

export async function verifyPasswordAsync(
  password: string,
  storedHash: string | null | undefined,
): Promise<boolean> {
  if (!storedHash) return false;
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, originalHex] = parts;
  const derivedBuf = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
  const originalBuf = Buffer.from(originalHex, 'hex');
  if (derivedBuf.length !== originalBuf.length) return false;
  return crypto.timingSafeEqual(derivedBuf, originalBuf);
}

export function generateOpaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function maskPhoneForWatermark(phone: string | null | undefined): string {
  const clean = (phone || '').replace(/\s+/g, '');
  if (clean.length < 7) return clean || 'ID-PROTECTED';
  return `${clean.slice(0, 3)}••••${clean.slice(-4)}`;
}

export interface SignedPlaybackPayload {
  videoId: number;
  userId: number;
  sessionId: number;
  assetKey: string;
  watermarkText: string;
  exp: number;
}

export function signPlaybackToken(
  payload: Omit<SignedPlaybackPayload, 'exp'>,
  ttlSeconds = 600,
  secretOverride?: string,
): string {
  const signingSecret = secretOverride ?? getVideoSigningSecret();
  const fullPayload: SignedPlaybackPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', signingSecret)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyPlaybackToken(
  token: string,
  secretOverride?: string,
): SignedPlaybackPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const signingSecret = secretOverride ?? getVideoSigningSecret();
  const expectedSig = crypto
    .createHmac('sha256', signingSecret)
    .update(encoded)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SignedPlaybackPayload;
    if (typeof parsed.exp !== 'number' || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function verifyWebhookHmac(rawPayload: string, signatureHeader: string, secret: string): boolean {
  if (!secret || !signatureHeader) return false;
  const computed = crypto.createHmac('sha512', secret).update(rawPayload).digest('hex');
  const a = Buffer.from(computed);
  const b = Buffer.from(signatureHeader.trim());
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function createRateLimiter(maxRequests: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return {
    check(key: string, now = Date.now()): { allowed: boolean; retryAfterSec: number } {
      const windowStart = now - windowMs;
      if (hits.size > 5000) {
        for (const [k, timestamps] of hits) {
          const active = timestamps.filter((ts) => ts > windowStart);
          if (active.length === 0) hits.delete(k);
          else hits.set(k, active);
        }
      }
      const existing = (hits.get(key) || []).filter((ts) => ts > windowStart);
      if (existing.length >= maxRequests) {
        const oldest = existing[0];
        hits.set(key, existing);
        return {
          allowed: false,
          retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
        };
      }
      existing.push(now);
      hits.set(key, existing);
      return { allowed: true, retryAfterSec: 0 };
    },
    reset(key?: string) {
      if (key) hits.delete(key);
      else hits.clear();
    },
  };
}
