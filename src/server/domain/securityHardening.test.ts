import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  escapeHtml,
  isDemoModeEnabled,
  isAllowedCorsOrigin,
  isPathWithinBaseDir,
  isSafeUploadDataUrl,
  filterPublishedParentExamAttempts,
  computePublishedExamAverage,
} from './securityHardening.ts';

test('escapeHtml neutralizes script tags, quotes, backticks, and ampersands', () => {
  const payload = `<script>alert("xss" & '1' + \`2\`)</script>`;
  const escaped = escapeHtml(payload);
  assert.equal(
    escaped,
    '&lt;script&gt;alert(&quot;xss&quot; &amp; &#39;1&#39; + &#96;2&#96;)&lt;/script&gt;',
  );
  assert.equal(escaped.includes('<script>'), false);
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml('مذكرة الفيزياء - الباب الأول'), 'مذكرة الفيزياء - الباب الأول');
});

test('isDemoModeEnabled strictly disables demo mode in production', () => {
  assert.equal(isDemoModeEnabled('production', undefined), false);
  assert.equal(isDemoModeEnabled('production', 'true'), false);
  assert.equal(isDemoModeEnabled('PRODUCTION', 'true'), false);
  assert.equal(isDemoModeEnabled('development', undefined), true);
  assert.equal(isDemoModeEnabled('development', 'true'), true);
  assert.equal(isDemoModeEnabled('development', 'false'), false);
  assert.equal(isDemoModeEnabled(undefined, 'false'), false);
});

test('isAllowedCorsOrigin enforces strict origin allowlist and blocks untrusted origins', () => {
  // No origin (same-origin / curl / server-to-server)
  assert.equal(isAllowedCorsOrigin({ origin: undefined, isProd: true }), true);

  // Same host match (including proxy/preview host)
  assert.equal(
    isAllowedCorsOrigin({
      origin: 'https://physics.example.com',
      requestHost: 'physics.example.com',
      isProd: true,
    }),
    true,
  );

  // Explicit ALLOWED_ORIGINS match
  assert.equal(
    isAllowedCorsOrigin({
      origin: 'https://app.elshabasy.com',
      requestHost: 'api.elshabasy.com',
      allowedOriginsEnv: 'https://app.elshabasy.com, https://admin.elshabasy.com/',
      isProd: true,
    }),
    true,
  );

  // Untrusted third-party origin must be rejected
  assert.equal(
    isAllowedCorsOrigin({
      origin: 'https://evil-attacker.example',
      requestHost: 'physics.example.com',
      allowedOriginsEnv: 'https://app.elshabasy.com',
      isProd: true,
    }),
    false,
  );

  // Non-http schemes rejected
  assert.equal(
    isAllowedCorsOrigin({
      origin: 'javascript:alert(1)',
      requestHost: 'physics.example.com',
      isProd: false,
    }),
    false,
  );

  // Localhost allowed in dev, blocked in prod unless whitelisted
  assert.equal(
    isAllowedCorsOrigin({
      origin: 'http://localhost:3000',
      requestHost: '127.0.0.1:3000',
      isProd: false,
    }),
    true,
  );
  assert.equal(
    isAllowedCorsOrigin({
      origin: 'http://localhost:3000',
      requestHost: 'physics.example.com',
      isProd: true,
    }),
    false,
  );
});

test('isPathWithinBaseDir blocks traversal and sibling-prefix escapes', () => {
  const base = path.resolve('/app/public');
  assert.equal(isPathWithinBaseDir(base, path.join(base, 'assets/hero.webp')), true);
  assert.equal(isPathWithinBaseDir(base, path.join(base, '../server.ts')), false);
  assert.equal(isPathWithinBaseDir(base, '/app/public_secret/keys.webp'), false);
  assert.equal(isPathWithinBaseDir(base, base), false);
  assert.equal(isPathWithinBaseDir(base, `${base}/assets/a.webp\0.png`), false);
});

test('isSafeUploadDataUrl accepts only safe image/PDF base64 data URLs and blocks HTML/SVG', () => {
  assert.equal(isSafeUploadDataUrl('data:image/png;base64,iVBORw0KGgo='), true);
  assert.equal(isSafeUploadDataUrl('data:image/jpeg;base64,/9j/4AAQSkZJRg=='), true);
  assert.equal(isSafeUploadDataUrl('data:image/webp;base64,UklGRh4AAABXRUJQ'), true);
  assert.equal(isSafeUploadDataUrl('data:application/pdf;base64,JVBERi0xLjQ='), true);

  // Malicious MIME types must be rejected
  assert.equal(isSafeUploadDataUrl('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='), false);
  assert.equal(isSafeUploadDataUrl('data:image/svg+xml;base64,PHN2Zz4='), false);
  assert.equal(isSafeUploadDataUrl('javascript:alert(1)'), false);
  assert.equal(isSafeUploadDataUrl('https://evil.example/receipt.png'), false);
  assert.equal(isSafeUploadDataUrl(''), false);
  assert.equal(isSafeUploadDataUrl('data:image/png;base64,AAAA', 10), false);
});

test('filterPublishedParentExamAttempts excludes in-progress and unpublished results', () => {
  const sample = [
    { status: 'GRADED', resultPublished: true, percentScore: 90 },
    { status: 'GRADED', resultPublished: false, percentScore: 20 },
    { status: 'IN_PROGRESS', resultPublished: false, percentScore: 0 },
    { status: 'SUBMITTED', resultPublished: true, percentScore: 70 },
    { status: 'IN_PROGRESS', resultPublished: true, percentScore: 10 },
  ];
  const filtered = filterPublishedParentExamAttempts(sample);
  assert.equal(filtered.length, 2);
  assert.equal(computePublishedExamAverage(sample), 80);
  assert.equal(computePublishedExamAverage([]), 0);
});
