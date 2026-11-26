/**
 * Lightweight, bounded, scoped in-memory TTL caches for hot server read paths.
 *
 * Security invariants:
 * - Auth session cache is keyed by SHA-256 tokenHash, short-lived (5s), validates session
 *   expiry on every read, and is deterministically invalidated on logout, session revoke,
 *   device block, user status change, or role/permission mutation.
 * - Content/catalog caches hold ONLY shared grade/platform metadata (never private per-user
 *   entitlements, attempts, submissions, grades, or tokens) and are deterministically
 *   invalidated on any admin/teacher content mutation or student comment creation.
 */

export interface AuthSessionCacheEntry<TUser> {
  user: TUser;
  sessionExpiresAtMs: number;
  cachedUntilMs: number;
}

const AUTH_CACHE_TTL_MS = 5_000;
const AUTH_CACHE_MAX_ENTRIES = 1_000;

const authSessionCache = new Map<string, AuthSessionCacheEntry<unknown>>();

export function getCachedAuthSession<TUser>(tokenHash: string): TUser | null {
  const entry = authSessionCache.get(tokenHash);
  if (!entry) return null;
  const now = Date.now();
  if (entry.cachedUntilMs <= now || entry.sessionExpiresAtMs <= now) {
    authSessionCache.delete(tokenHash);
    return null;
  }
  return entry.user as TUser;
}

export function setCachedAuthSession<TUser>(
  tokenHash: string,
  user: TUser,
  sessionExpiresAt: Date,
): void {
  const now = Date.now();
  const sessionExpiresAtMs = sessionExpiresAt.getTime();
  if (sessionExpiresAtMs <= now) return;
  if (authSessionCache.size >= AUTH_CACHE_MAX_ENTRIES) {
    const oldestKey = authSessionCache.keys().next().value;
    if (oldestKey) authSessionCache.delete(oldestKey);
  }
  authSessionCache.set(tokenHash, {
    user,
    sessionExpiresAtMs,
    cachedUntilMs: Math.min(now + AUTH_CACHE_TTL_MS, sessionExpiresAtMs),
  });
}

export function invalidateAuthCacheByTokenHash(tokenHash: string): void {
  authSessionCache.delete(tokenHash);
}

export function invalidateAuthCacheBySessionId(sessionId: number | null | undefined): void {
  if (!sessionId) return;
  for (const [key, entry] of authSessionCache.entries()) {
    const u = entry.user as { sessionId?: number | null };
    if (u && u.sessionId === sessionId) {
      authSessionCache.delete(key);
    }
  }
}

export function invalidateAuthCacheByUserId(userId: number | null | undefined): void {
  if (!userId) return;
  for (const [key, entry] of authSessionCache.entries()) {
    const u = entry.user as { id?: number };
    if (u && u.id === userId) {
      authSessionCache.delete(key);
    }
  }
}

export function invalidateAllAuthCache(): void {
  authSessionCache.clear();
}

// ---------------------------------------------------------------------------
// Generic bounded TTL cache helper for shared catalog / grade metadata
// ---------------------------------------------------------------------------

interface TtlEntry<T> {
  value: T;
  expiresAtMs: number;
}

export class ScopedTtlCache<T> {
  private readonly store = new Map<string, TtlEntry<T>>();
  private readonly inflight = new Map<string, Promise<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 200,
  ) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAtMs <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey) this.store.delete(oldestKey);
    }
    this.store.set(key, { value, expiresAtMs: Date.now() + this.ttlMs });
  }

  async getOrLoad(key: string, loader: () => Promise<T>): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const promise = loader()
      .then((val) => {
        this.set(key, val);
        return val;
      })
      .finally(() => {
        if (this.inflight.get(key) === promise) {
          this.inflight.delete(key);
        }
      });
    this.inflight.set(key, promise);
    return promise;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

// Shared catalog caches (15s TTL — invalidated deterministically on any write)
export const gradeDashboardCatalogCache = new ScopedTtlCache<unknown>(15_000, 64);
export const curriculumPlanCache = new ScopedTtlCache<unknown>(15_000, 64);
export const publishedAnnouncementsCache = new ScopedTtlCache<unknown>(15_000, 8);
export const homeworkSharedCatalogCache = new ScopedTtlCache<unknown>(15_000, 32);
export const adminCatalogCache = new ScopedTtlCache<unknown>(10_000, 8);

export function invalidateAllContentCaches(): void {
  gradeDashboardCatalogCache.clear();
  curriculumPlanCache.clear();
  publishedAnnouncementsCache.clear();
  homeworkSharedCatalogCache.clear();
  adminCatalogCache.clear();
}
