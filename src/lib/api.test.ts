import test from 'node:test';
import assert from 'node:assert/strict';
import { apiRequest, invalidateApiCache, setAuthToken } from './api.ts';

test('apiRequest does not trigger unhandledRejection when a deduplicated GET request fails', async () => {
  const originalFetch = globalThis.fetch;
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason);
  };
  process.on('unhandledRejection', onUnhandled);

  let fetchCount = 0;
  globalThis.fetch = (async () => {
    fetchCount += 1;
    return new Response(JSON.stringify({ error: 'غير مصرح' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    setAuthToken(null);
    invalidateApiCache();

    await assert.rejects(
      () => apiRequest('/api/auth/me'),
      (err: Error & { status?: number }) => err.status === 401 && err.message === 'غير مصرح',
    );

    // Give Node's microtask/event loop a tick to surface any detached unhandled rejection
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(unhandled.length, 0, 'Expected zero unhandled rejections on caught GET failure');

    // Subsequent retry after failure must perform a fresh fetch (inflight map cleaned up)
    await assert.rejects(() => apiRequest('/api/auth/me'));
    assert.equal(fetchCount, 2);
  } finally {
    process.off('unhandledRejection', onUnhandled);
    globalThis.fetch = originalFetch;
  }
});

test('apiRequest deduplicates concurrent in-flight GET calls and clears entry afterward', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;

  globalThis.fetch = (async () => {
    fetchCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return new Response(JSON.stringify({ ok: true, seq: fetchCount }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    setAuthToken(null);
    invalidateApiCache();

    const [a, b] = await Promise.all([
      apiRequest<{ ok: boolean; seq: number }>('/api/student/dashboard'),
      apiRequest<{ ok: boolean; seq: number }>('/api/student/dashboard'),
    ]);

    assert.equal(fetchCount, 1);
    assert.deepEqual(a, b);

    const c = await apiRequest<{ ok: boolean; seq: number }>('/api/student/dashboard');
    assert.equal(fetchCount, 2);
    assert.equal(c.seq, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('apiRequest automatically retries once on transient 503 HTML gateway response', async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;

  globalThis.fetch = (async () => {
    attempts += 1;
    if (attempts === 1) {
      return new Response('<html><body>503 Service Unavailable</body></html>', {
        status: 503,
        headers: { 'Content-Type': 'text/html' },
      });
    }
    return new Response(JSON.stringify({ token: 'ok-token' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    setAuthToken(null);
    invalidateApiCache();
    const res = await apiRequest<{ token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone: '01012345678', password: 'x' }),
    });
    assert.equal(attempts, 2);
    assert.equal(res.token, 'ok-token');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('apiRequest sends X-Proxy-Safe-Errors and restores original 403 status and reasonCode from 423 proxy-safe responses', async () => {
  const originalFetch = globalThis.fetch;
  let receivedHeader = '';

  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const hdrs = (init?.headers || {}) as Record<string, string>;
    receivedHeader = hdrs['X-Proxy-Safe-Errors'] || '';
    return new Response(
      JSON.stringify({
        error: 'لقد وصلت للحد الأقصى من الأجهزة المسموحة (2 أجهزة).',
        reasonCode: 'DEVICE_LIMIT_EXCEEDED',
      }),
      {
        status: 423,
        headers: {
          'Content-Type': 'application/json',
          'X-Original-Status': '403',
        },
      },
    );
  }) as typeof fetch;

  try {
    setAuthToken(null);
    invalidateApiCache();
    await assert.rejects(
      () =>
        apiRequest('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ phone: '01012345678', password: 'x' }),
        }),
      (err: Error & { status?: number; reasonCode?: string }) =>
        err.status === 403 &&
        err.reasonCode === 'DEVICE_LIMIT_EXCEEDED' &&
        err.message.includes('للحد الأقصى من الأجهزة'),
    );
    assert.equal(receivedHeader, '1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

