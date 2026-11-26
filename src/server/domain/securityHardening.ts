import path from 'node:path';

/**
 * Escapes HTML special characters to prevent reflected or stored XSS
 * when rendering dynamic values inside server-generated HTML responses.
 */
export function escapeHtml(input: unknown): string {
  const str = String(input ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;');
}

/**
 * Demo/preview quick-fill accounts are strictly disabled in production.
 * In non-production environments they remain enabled unless explicitly
 * turned off via ENABLE_DEMO_ACCOUNTS=false.
 */
export function isDemoModeEnabled(
  nodeEnv: string | undefined = process.env.NODE_ENV,
  enableFlag: string | undefined = process.env.ENABLE_DEMO_ACCOUNTS,
): boolean {
  if (String(nodeEnv || '').toLowerCase() === 'production') {
    return false;
  }
  return String(enableFlag ?? 'true').toLowerCase() !== 'false';
}

/**
 * Parses comma-separated ALLOWED_ORIGINS into a normalized Set of lowercase origins.
 */
export function parseAllowedOrigins(allowedOriginsEnv: string | undefined): Set<string> {
  const result = new Set<string>();
  if (!allowedOriginsEnv) return result;
  for (const raw of allowedOriginsEnv.split(',')) {
    const trimmed = raw.trim().replace(/\/+$/, '').toLowerCase();
    if (trimmed) result.add(trimmed);
  }
  return result;
}

/**
 * Evaluates whether a CORS Origin header should be permitted for API requests.
 * - Requests without an Origin header (same-origin navigations, curl, server-to-server) are allowed.
 * - Requests whose Origin host matches the request Host / X-Forwarded-Host are allowed.
 * - Explicitly configured ALLOWED_ORIGINS are allowed.
 * - In non-production mode, localhost / 127.0.0.1 origins are allowed for local dev.
 */
export function isAllowedCorsOrigin(params: {
  origin: string | undefined;
  requestHost?: string | undefined;
  allowedOriginsEnv?: string | undefined;
  isProd?: boolean;
}): boolean {
  const { origin, requestHost, allowedOriginsEnv, isProd = false } = params;
  if (!origin) return true;

  const normalizedOrigin = origin.trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(normalizedOrigin);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  // Allow explicit whitelist from environment
  const allowed = parseAllowedOrigins(allowedOriginsEnv);
  if (allowed.has(parsed.origin.toLowerCase())) {
    return true;
  }

  // Allow same-host origin (handles reverse proxies & AI Studio preview subdomains safely)
  if (requestHost) {
    const primaryHost = requestHost.split(',')[0].trim().toLowerCase();
    if (primaryHost && parsed.host.toLowerCase() === primaryHost) {
      return true;
    }
  }

  // Allow localhost / 127.0.0.1 in non-production environments
  if (!isProd) {
    const h = parsed.hostname.toLowerCase();
    if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') {
      return true;
    }
  }

  return false;
}

/**
 * Verifies that a resolved candidate filesystem path stays strictly inside
 * the resolved base directory, preventing sibling-prefix bypasses such as
 * `/app/public_evil` matching `/app/public`.
 */
export function isPathWithinBaseDir(baseDir: string, candidatePath: string): boolean {
  if (!baseDir || !candidatePath) return false;
  if (candidatePath.includes('\0') || baseDir.includes('\0')) return false;
  const resolvedBase = path.resolve(baseDir);
  const resolvedCandidate = path.resolve(candidatePath);
  if (resolvedCandidate === resolvedBase) return false;
  const prefix = resolvedBase.endsWith(path.sep) ? resolvedBase : `${resolvedBase}${path.sep}`;
  return resolvedCandidate.startsWith(prefix);
}

const SAFE_UPLOAD_DATA_URL_REGEX =
  /^data:(image\/(?:png|jpeg|jpg|webp|gif)|application\/pdf);base64,[A-Za-z0-9+/=\s]+$/i;

/**
 * Validates that an uploaded data URL (payment receipt or exam answer file)
 * uses only an allowlisted safe image or PDF MIME type and base64 payload,
 * blocking `data:text/html`, `data:image/svg+xml`, `javascript:`, etc.
 */
export function isSafeUploadDataUrl(value: unknown, maxLength = 7_500_000): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return false;
  return SAFE_UPLOAD_DATA_URL_REGEX.test(trimmed);
}

export interface ParentExamAttemptRecord {
  status: string;
  resultPublished: boolean;
  percentScore: number | null;
  examTitleAr?: string;
  submittedAt?: Date | string | null;
}

/**
 * Filters exam attempts shown on the public parent report to ONLY finished,
 * teacher-published results so unpublished or in-progress scores are never leaked.
 */
export function filterPublishedParentExamAttempts<T extends ParentExamAttemptRecord>(
  attempts: T[],
): T[] {
  return attempts.filter(
    (a) =>
      Boolean(a.resultPublished) &&
      (a.status === 'GRADED' || a.status === 'SUBMITTED' || a.status === 'AUTO_SUBMITTED'),
  );
}

/**
 * Computes average exam percentage from already-filtered published attempts.
 */
export function computePublishedExamAverage(attempts: ParentExamAttemptRecord[]): number {
  const published = filterPublishedParentExamAttempts(attempts);
  if (published.length === 0) return 0;
  const sum = published.reduce((acc, a) => acc + Number(a.percentScore || 0), 0);
  return Math.round(sum / published.length);
}
