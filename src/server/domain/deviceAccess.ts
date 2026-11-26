/**
 * Pure domain logic for student device blocking, session revocation separation,
 * and concurrent/maximum device limits.
 *
 * Key invariant:
 * - Session revocation (`isRevoked = true`) terminates a specific login token.
 * - Device blocking (`isBlocked = true`) blocks the recognized `deviceFingerprint`
 *   for that user across ALL sessions — including revoked and expired rows — until
 *   explicitly unblocked by an authorized administrator.
 */

export interface DeviceSessionRecord {
  id: number;
  deviceFingerprint: string;
  isRevoked: boolean;
  isBlocked: boolean;
  expiresAt: Date | string;
}

export interface DeviceLoginPolicyInput {
  sessions: DeviceSessionRecord[];
  deviceFingerprint: string;
  maxDevices: number;
  now?: Date;
}

export type DeviceLoginPolicyDecision =
  | { allowed: true; activeDistinctDevices: number }
  | {
      allowed: false;
      reason: 'DEVICE_BLOCKED' | 'DEVICE_LIMIT_EXCEEDED';
      statusCode: 403;
      errorAr: string;
    };

export const DEVICE_BLOCKED_ERROR_AR =
  'تم حظر هذا الجهاز من قِبل إدارة المنصة. تواصل مع الدعم الفني.';

export function normalizeDeviceFingerprint(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Returns the set of all currently blocked device fingerprints for a user.
 * Intentionally evaluates ALL session records (including revoked and expired rows)
 * so revoking or expiring a session never erases or bypasses an active block.
 */
export function getBlockedDeviceFingerprints(
  sessions: ReadonlyArray<Pick<DeviceSessionRecord, 'deviceFingerprint' | 'isBlocked'>>,
): Set<string> {
  const blocked = new Set<string>();
  for (const s of sessions) {
    if (!s.isBlocked) continue;
    const fp = normalizeDeviceFingerprint(s.deviceFingerprint);
    if (fp) blocked.add(fp);
  }
  return blocked;
}

/**
 * Checks whether a recognized device fingerprint is blocked for a user,
 * independent of session revocation or expiration state.
 */
export function isDeviceBlockedForUser(
  sessions: ReadonlyArray<Pick<DeviceSessionRecord, 'deviceFingerprint' | 'isBlocked'>>,
  deviceFingerprint: string | null | undefined,
): boolean {
  const fp = normalizeDeviceFingerprint(deviceFingerprint);
  if (!fp) return false;
  return getBlockedDeviceFingerprints(sessions).has(fp);
}

/**
 * Evaluates whether a user may create a new session from `deviceFingerprint`.
 * 1. Rejects immediately if the recognized device fingerprint is blocked (even if revoked/expired).
 * 2. Counts distinct active, unblocked, unexpired device fingerprints against `maxDevices`.
 */
export function evaluateDeviceLoginPolicy(
  input: DeviceLoginPolicyInput,
): DeviceLoginPolicyDecision {
  const now = input.now ?? new Date();
  const fp = normalizeDeviceFingerprint(input.deviceFingerprint);

  const blockedSet = getBlockedDeviceFingerprints(input.sessions);
  if (fp && blockedSet.has(fp)) {
    return {
      allowed: false,
      reason: 'DEVICE_BLOCKED',
      statusCode: 403,
      errorAr: DEVICE_BLOCKED_ERROR_AR,
    };
  }

  const activeDistinctDevices = new Set<string>();
  for (const s of input.sessions) {
    if (s.isRevoked || s.isBlocked) continue;
    const exp = new Date(s.expiresAt).getTime();
    if (Number.isNaN(exp) || exp <= now.getTime()) continue;
    const sfp = normalizeDeviceFingerprint(s.deviceFingerprint);
    if (!sfp || blockedSet.has(sfp)) continue;
    activeDistinctDevices.add(sfp);
  }

  const safeMaxDevices = Math.max(1, Number(input.maxDevices) || 1);
  if (fp && !activeDistinctDevices.has(fp) && activeDistinctDevices.size >= safeMaxDevices) {
    return {
      allowed: false,
      reason: 'DEVICE_LIMIT_EXCEEDED',
      statusCode: 403,
      errorAr: `لقد وصلت للحد الأقصى من الأجهزة المسموحة (${safeMaxDevices} أجهزة). يمكنك إنهاء جلسة قديمة من شاشة إدارة الأجهزة أدناه أو التواصل مع الإدارة.`,
    };
  }

  return {
    allowed: true,
    activeDistinctDevices: activeDistinctDevices.size,
  };
}

export function describeUserAgent(
  userAgent: string | null | undefined,
  fallbackLabel?: string | null,
): string {
  const ua = String(userAgent || '');
  let browser = '';
  if (/Edg\//i.test(ua)) browser = 'Microsoft Edge';
  else if (/OPR\//i.test(ua) || /Opera/i.test(ua)) browser = 'Opera';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) browser = 'Google Chrome';
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = 'Safari';

  let os = '';
  if (/iPhone/i.test(ua)) os = 'iPhone';
  else if (/iPad/i.test(ua)) os = 'iPad';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  if (browser && os) return `${browser} على ${os}`;
  if (browser) return browser;
  if (os) return os;
  return (fallbackLabel || '').trim() || 'متصفح ويب';
}

export function classifySessionStatus(
  session: { isRevoked: boolean; isBlocked: boolean; expiresAt: Date | string },
  now: Date = new Date(),
): 'ACTIVE' | 'REVOKED' | 'BLOCKED' | 'EXPIRED' {
  if (session.isBlocked) return 'BLOCKED';
  if (session.isRevoked) return 'REVOKED';
  const exp = new Date(session.expiresAt).getTime();
  if (Number.isNaN(exp) || exp <= now.getTime()) return 'EXPIRED';
  return 'ACTIVE';
}
