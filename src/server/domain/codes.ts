import crypto from 'node:crypto';
import { getCodePepper, getPreviousCodePepper } from '../config/secrets.ts';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function normalizeActivationCode(code: string): string {
  return code
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/[‐‑‒–—―−﹣－]/g, '-')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

export function generateActivationCode(prefix = 'PHY'): string {
  const bytes = crypto.randomBytes(12);
  let chars = '';
  for (let i = 0; i < 12; i++) {
    chars += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return `${prefix}-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

export function hashActivationCode(rawCode: string, pepper = getCodePepper()): string {
  const normalized = normalizeActivationCode(rawCode);
  return crypto.createHmac('sha256', pepper).update(normalized).digest('hex');
}

/**
 * Computes lookup hashes for activation code redemption.
 * Always checks the primary CODE_PEPPER first; if CODE_PEPPER_PREVIOUS is explicitly
 * configured during a controlled rotation window, also checks the previous pepper
 * so legacy unused codes remain redeemable without breaking students.
 */
export function getActivationCodeLookupHashes(
  rawCode: string,
  options?: { primaryPepper?: string; previousPepper?: string | null },
): string[] {
  const primary = options?.primaryPepper ?? getCodePepper();
  const previous = options !== undefined ? (options.previousPepper ?? null) : getPreviousCodePepper();
  const hashes = [hashActivationCode(rawCode, primary)];
  if (previous && previous !== primary) {
    hashes.push(hashActivationCode(rawCode, previous));
  }
  return hashes;
}

export function maskActivationCode(rawCode: string): string {
  const normalized = normalizeActivationCode(rawCode);
  const parts = normalized.split('-');
  if (parts.length >= 4) {
    return `${parts[0]}-${parts[1]}-••••-${parts[parts.length - 1]}`;
  }
  if (normalized.length <= 6) return '••••••';
  return `${normalized.slice(0, 4)}••••${normalized.slice(-3)}`;
}

export interface CodeValidationTarget {
  status: string;
  usedCount: number;
  maxUses: number;
  expiresAt: Date | string | null;
  disabledUntil?: Date | string | null;
  boundUserId: number | null;
  gradeId: number | null;
  codeCategory?: string | null;
}

export interface CodeValidationResult {
  valid: boolean;
  errorCode?:
    | 'CODE_REVOKED'
    | 'CODE_CANCELLED'
    | 'CODE_DISABLED'
    | 'CODE_EXPIRED'
    | 'CODE_EXHAUSTED'
    | 'CODE_BOUND_TO_OTHER_STUDENT'
    | 'CODE_GRADE_MISMATCH';
}

export function validateCodeForRedemption(
  code: CodeValidationTarget,
  userId: number,
  approvedGradeIds: number[],
  now = new Date(),
): CodeValidationResult {
  if (code.status === 'REVOKED') {
    return { valid: false, errorCode: 'CODE_REVOKED' };
  }
  if (code.status === 'CANCELLED') {
    return { valid: false, errorCode: 'CODE_CANCELLED' };
  }
  if (code.status === 'DISABLED') {
    const untilMs = code.disabledUntil ? new Date(code.disabledUntil).getTime() : Number.NaN;
    if (!code.disabledUntil || Number.isNaN(untilMs) || untilMs > now.getTime()) {
      return { valid: false, errorCode: 'CODE_DISABLED' };
    }
  }
  if (code.status === 'EXPIRED' || (code.expiresAt && new Date(code.expiresAt).getTime() <= now.getTime())) {
    return { valid: false, errorCode: 'CODE_EXPIRED' };
  }
  if (code.status === 'REDEEMED' || code.usedCount >= code.maxUses) {
    return { valid: false, errorCode: 'CODE_EXHAUSTED' };
  }
  if (code.boundUserId !== null && code.boundUserId !== userId) {
    return { valid: false, errorCode: 'CODE_BOUND_TO_OTHER_STUDENT' };
  }
  if (code.gradeId !== null && !approvedGradeIds.includes(code.gradeId)) {
    return { valid: false, errorCode: 'CODE_GRADE_MISMATCH' };
  }
  return { valid: true };
}

export function canDeleteActivationCode(code: { usedCount: number; redemptionsCount?: number }): {
  allowed: boolean;
  errorAr?: string;
} {
  const redemptions = code.redemptionsCount ?? 0;
  if (code.usedCount > 0 || redemptions > 0) {
    return {
      allowed: false,
      errorAr:
        'لا يمكن حذف كود تم استخدامه مسبقًا حفاظًا على سجل التفعيلات والمراجعة. يمكنك إلغاؤه أو تعطيله بدلًا من ذلك.',
    };
  }
  return { allowed: true };
}

export function computePlatformSubscriptionState(
  sub: { status: string; startsAt: Date | string; expiresAt: Date | string },
  now = new Date(),
): {
  effectiveStatus: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  isActive: boolean;
  remainingDays: number;
} {
  if (sub.status === 'REVOKED') {
    return { effectiveStatus: 'REVOKED', isActive: false, remainingDays: 0 };
  }
  const expMs = new Date(sub.expiresAt).getTime();
  const diffMs = expMs - now.getTime();
  if (Number.isNaN(expMs) || diffMs <= 0) {
    return { effectiveStatus: 'EXPIRED', isActive: false, remainingDays: 0 };
  }
  return {
    effectiveStatus: 'ACTIVE',
    isActive: true,
    remainingDays: Math.max(1, Math.ceil(diffMs / 86400_000)),
  };
}
