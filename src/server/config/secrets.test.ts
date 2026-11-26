import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  assertProductionSecretsOnStartup,
  getCodePepper,
  getHomeworkFileSigningSecret,
  getVideoSigningSecret,
  validateProductionSecretsConfig,
} from './secrets.ts';
import { getActivationCodeLookupHashes, hashActivationCode } from '../domain/codes.ts';
import { signHomeworkFileToken, verifyHomeworkFileToken } from '../domain/homework.ts';
import { signPlaybackToken, verifyPlaybackToken } from '../domain/security.ts';

function makeStrongSecret(seed: string): string {
  return crypto.createHash('sha256').update(`unit-test-${seed}`).digest('hex');
}

test('production config safely rejects missing critical secrets without leaking values', () => {
  const result = validateProductionSecretsConfig({ NODE_ENV: 'production' });
  assert.equal(result.ok, false);
  assert.equal(result.environment, 'production');

  const missingVars = result.issues.filter((i) => i.reason === 'MISSING').map((i) => i.variable);
  assert.ok(missingVars.includes('VIDEO_SIGNING_SECRET'));
  assert.ok(missingVars.includes('HOMEWORK_FILE_SIGNING_SECRET'));
  assert.ok(missingVars.includes('CODE_PEPPER'));

  assert.throws(
    () => assertProductionSecretsOnStartup({ NODE_ENV: 'production' }),
    /VIDEO_SIGNING_SECRET/,
  );
});

test('production config rejects known insecure default signing keys, short keys, and reused keys', () => {
  const knownBad = validateProductionSecretsConfig({
    NODE_ENV: 'production',
    VIDEO_SIGNING_SECRET: 'physics-lms-dev-ephemeral-signing-key-change-in-production',
    HOMEWORK_FILE_SIGNING_SECRET: 'short-key',
    CODE_PEPPER: 'physics-lms-activation-code-pepper-dev',
  });
  assert.equal(knownBad.ok, false);
  assert.equal(
    knownBad.issues.find((i) => i.variable === 'VIDEO_SIGNING_SECRET')?.reason,
    'KNOWN_INSECURE_DEFAULT',
  );
  assert.equal(
    knownBad.issues.find((i) => i.variable === 'HOMEWORK_FILE_SIGNING_SECRET')?.reason,
    'TOO_SHORT',
  );
  assert.equal(
    knownBad.issues.find((i) => i.variable === 'CODE_PEPPER')?.reason,
    'KNOWN_INSECURE_DEFAULT',
  );

  // Reject identical secret reused across distinct security purposes
  const sameStrong = makeStrongSecret('reused-key');
  const reused = validateProductionSecretsConfig({
    NODE_ENV: 'production',
    VIDEO_SIGNING_SECRET: sameStrong,
    HOMEWORK_FILE_SIGNING_SECRET: sameStrong,
    CODE_PEPPER: makeStrongSecret('distinct-pepper'),
  });
  assert.equal(reused.ok, false);
  assert.ok(reused.issues.some((i) => i.reason === 'REUSED_ACROSS_PURPOSES'));

  // Low-entropy repeated string rejected
  const lowEntropy = validateProductionSecretsConfig({
    NODE_ENV: 'production',
    VIDEO_SIGNING_SECRET: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    HOMEWORK_FILE_SIGNING_SECRET: makeStrongSecret('hw-ok'),
    CODE_PEPPER: makeStrongSecret('pepper-ok'),
  });
  assert.equal(lowEntropy.ok, false);
  assert.equal(
    lowEntropy.issues.find((i) => i.variable === 'VIDEO_SIGNING_SECRET')?.reason,
    'LOW_ENTROPY',
  );
});

test('production config succeeds with 3 independent strong secrets and never exposes secret values', () => {
  const videoKey = makeStrongSecret('prod-video');
  const hwKey = makeStrongSecret('prod-hw');
  const pepper = makeStrongSecret('prod-pepper');

  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    VIDEO_SIGNING_SECRET: videoKey,
    HOMEWORK_FILE_SIGNING_SECRET: hwKey,
    CODE_PEPPER: pepper,
  };

  const result = validateProductionSecretsConfig(env);
  assert.equal(result.ok, true);
  assert.equal(result.issues.length, 0);
  assert.doesNotThrow(() => assertProductionSecretsOnStartup(env));

  // Ensure serialized validation result never contains any secret value
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(videoKey), false);
  assert.equal(serialized.includes(hwKey), false);
  assert.equal(serialized.includes(pepper), false);

  assert.equal(getVideoSigningSecret(env), videoKey);
  assert.equal(getHomeworkFileSigningSecret(env), hwKey);
  assert.equal(getCodePepper(env), pepper);
});

test('homework file signing remains valid across simulated server restarts when configured with a stable secret', () => {
  const stableSecret = makeStrongSecret('stable-hw-key');
  const differentSecret = makeStrongSecret('other-hw-key');

  // Instance A signs token before restart
  const token = signHomeworkFileToken(
    {
      storageKey: 'hwf_abc123',
      userId: 7,
      roleSlug: 'STUDENT',
      ttlSec: 900,
    },
    stableSecret,
  );

  // Instance B / post-restart verifies using the same stable configured secret
  const verified = verifyHomeworkFileToken(token, stableSecret);
  assert.ok(verified);
  assert.equal(verified?.storageKey, 'hwf_abc123');
  assert.equal(verified?.userId, 7);

  // Token fails if verified with a different secret or tampered payload
  assert.equal(verifyHomeworkFileToken(token, differentSecret), null);
  assert.equal(verifyHomeworkFileToken(`${token}tampered`, stableSecret), null);
});

test('video playback signing works cleanly with configured secret and rejects tampering', () => {
  const videoSecret = makeStrongSecret('stable-video-key');
  const otherSecret = makeStrongSecret('other-video-key');

  const token = signPlaybackToken(
    {
      videoId: 12,
      userId: 4,
      sessionId: 99,
      assetKey: 'asset-12',
      watermarkText: '010••••5678',
    },
    600,
    videoSecret,
  );

  const verified = verifyPlaybackToken(token, videoSecret);
  assert.ok(verified);
  assert.equal(verified?.videoId, 12);
  assert.equal(verified?.userId, 4);

  assert.equal(verifyPlaybackToken(token, otherSecret), null);
  assert.equal(verifyPlaybackToken(`${token}x`, videoSecret), null);
});

test('existing development activation codes stay compatible and CODE_PEPPER_PREVIOUS supports controlled rotation', () => {
  // Development mode without CODE_PEPPER preserves legacy hash compatibility for existing dev codes
  const devEnv: NodeJS.ProcessEnv = { NODE_ENV: 'development' };
  const devPepper = getCodePepper(devEnv);
  const legacyHash = hashActivationCode('PHY-CRSE-2026-ELEC', 'physics-lms-activation-code-pepper-dev');
  assert.equal(hashActivationCode('PHY-CRSE-2026-ELEC', devPepper), legacyHash);

  // Controlled rotation: new CODE_PEPPER hashes new codes, while CODE_PEPPER_PREVIOUS still allows redeeming legacy codes
  const newPepper = makeStrongSecret('rotated-prod-pepper');
  const lookupHashes = getActivationCodeLookupHashes('PHY-CRSE-2026-ELEC', {
    primaryPepper: newPepper,
    previousPepper: 'physics-lms-activation-code-pepper-dev',
  });
  assert.equal(lookupHashes.length, 2);
  assert.equal(lookupHashes[0], hashActivationCode('PHY-CRSE-2026-ELEC', newPepper));
  assert.equal(lookupHashes[1], legacyHash);
});
