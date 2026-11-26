const TOKEN_STORAGE_KEY = 'physics_lms_session_token';
const DEVICE_FP_KEY = 'physics_lms_device_fp';

let memoryToken: string | null = null;

export function getAuthToken(): string | null {
  if (memoryToken) return memoryToken;
  try {
    const stored = sessionStorage.getItem(TOKEN_STORAGE_KEY);
    if (stored) {
      memoryToken = stored;
      return stored;
    }
  } catch {
    // ignore storage errors
  }
  return null;
}

const SAFE_CACHEABLE_PREFIXES = [
  '/api/public/bootstrap',
  '/api/admin/catalog',
  '/api/admin/notifications',
  '/api/exams/student/list',
  '/api/student/homework',
];
const SAFE_CACHE_TTL_MS = 10_000;

function isSafeCacheableUrl(url: string): boolean {
  const pathOnly = url.split('?')[0];
  return SAFE_CACHEABLE_PREFIXES.includes(pathOnly);
}

const inflightGetMap = new Map<string, Promise<unknown>>();
const shortGetCache = new Map<string, { data: unknown; expiresAt: number }>();

export function invalidateApiCache(urlPrefix?: string) {
  if (!urlPrefix) {
    shortGetCache.clear();
    return;
  }
  for (const key of shortGetCache.keys()) {
    if (key.includes(urlPrefix)) {
      shortGetCache.delete(key);
    }
  }
}

export function setAuthToken(token: string | null) {
  if (memoryToken !== token) {
    shortGetCache.clear();
    inflightGetMap.clear();
  }
  memoryToken = token;
  try {
    if (token) {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export function getDeviceFingerprint(): string {
  try {
    let fp = localStorage.getItem(DEVICE_FP_KEY);
    if (!fp) {
      fp = `dev-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
      localStorage.setItem(DEVICE_FP_KEY, fp);
    }
    return fp;
  } catch {
    return 'dev-web-client';
  }
}

export function getDeviceLabel(): string {
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'هاتف Android';
  if (/iPhone|iPad/i.test(ua)) return 'جهاز iOS';
  if (/Windows/i.test(ua)) return 'كمبيوتر Windows';
  if (/Mac/i.test(ua)) return 'كمبيوتر Mac';
  return 'متصفح ويب';
}

export async function apiRequest<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const token = getAuthToken();

  // Any mutating request immediately clears short-lived reference cache so views stay fresh
  if (method !== 'GET' && method !== 'HEAD') {
    shortGetCache.clear();
  }

  const cacheKey = `${token ? token.slice(-10) : 'anon'}::${url}`;
  const isSafeCacheable = method === 'GET' && isSafeCacheableUrl(url);

  if (isSafeCacheable) {
    const cached = shortGetCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data as T;
    }
  }

  if (method === 'GET' && !options.signal) {
    const existing = inflightGetMap.get(cacheKey);
    if (existing) {
      return existing as Promise<T>;
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Device-Fingerprint': getDeviceFingerprint(),
    'X-Proxy-Safe-Errors': '1',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token && !headers.Authorization) {
    headers.Authorization = `Bearer ${token}`;
  }

  const trackInflight = method === 'GET' && !options.signal;

  let execPromise!: Promise<T>;
  execPromise = (async () => {
    try {
      const performFetch = () =>
        fetch(url, {
          ...options,
          headers,
        });

      let response = await performFetch();
      if (
        (response.status === 502 || response.status === 503 || response.status === 504) &&
        !options.signal?.aborted
      ) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        response = await performFetch();
      }

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        reasonCode?: string;
      };
      if (!response.ok) {
        const originalStatusHeader = Number(response.headers?.get?.('X-Original-Status') || 0);
        const effectiveStatus = originalStatusHeader >= 400 ? originalStatusHeader : response.status;
        const fallbackMsg =
          effectiveStatus === 502 || effectiveStatus === 503 || effectiveStatus === 504
            ? 'الخادم قيد التجهيز مؤقتًا، يرجى المحاولة مرة أخرى بعد ثوانٍ'
            : 'حدث خطأ غير متوقع أثناء الاتصال بالخادم';
        const err = new Error(data.error || data.message || fallbackMsg) as Error & {
          status?: number;
          reasonCode?: string;
        };
        err.status = effectiveStatus;
        err.reasonCode = data.reasonCode;
        throw err;
      }
      if (isSafeCacheable) {
        shortGetCache.set(cacheKey, { data, expiresAt: Date.now() + SAFE_CACHE_TTL_MS });
      }
      return data as T;
    } finally {
      if (trackInflight && inflightGetMap.get(cacheKey) === execPromise) {
        inflightGetMap.delete(cacheKey);
      }
    }
  })();

  if (trackInflight) {
    inflightGetMap.set(cacheKey, execPromise);
  }

  return execPromise;
}

export function formatDurationAr(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hrs > 0) return `${hrs} س ${remMins} د`;
  return `${mins} دقيقة`;
}

export function formatDateAr(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('ar-EG', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function formatDateTimeAr(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('ar-EG', {
      timeZone: 'Africa/Cairo',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
