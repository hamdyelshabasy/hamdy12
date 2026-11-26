import crypto from 'node:crypto';

/**
 * Centralized, server-only security secrets configuration and validation.
 * NEVER import this file from frontend/client code.
 * NEVER log or expose actual secret values in errors, responses, or diagnostics.
 */

export const MIN_PRODUCTION_SECRET_LENGTH = 32;

// Fingerprints (SHA-256 of trimmed lowercase value) of known insecure dev defaults
// and common weak placeholders so production rejects them without leaking secrets.
const KNOWN_INSECURE_SECRET_HASHES = new Set<string>([
  // Known legacy development defaults from earlier versions of this codebase
  '8f1c7a7c66cc3a9f3f8b5d2b3e3b4e0b8c9a1a4e4f8f4e2a5d6c7b8a9e0f1a2b', // placeholder guard
  sha256Lower('physics-lms-dev-ephemeral-signing-key-change-in-production'),
  sha256Lower('physics-lms-activation-code-pepper-dev'),
  sha256Lower('changeme'),
  sha256Lower('change-me-in-production'),
  sha256Lower('replace-with-strong-secret'),
  sha256Lower('supersecretkey12345678901234567890'),
  sha256Lower('secret'),
  sha256Lower('default-secret'),
  sha256Lower('dev-secret'),
  sha256Lower('test-secret'),
]);

// Preserved strictly for development/preview backward compatibility with
// existing unused activation codes in the development database.
// NEVER permitted when NODE_ENV === 'production'.
const LEGACY_DEV_CODE_PEPPER = 'physics-lms-activation-code-pepper-dev';

// Process-scoped ephemeral keys used ONLY in non-production when env vars are unset.
// Generated independently via CSPRNG so development does not use hardcoded signing literals.
const DEV_EPHEMERAL_VIDEO_SECRET = crypto.randomBytes(32).toString('hex');
const DEV_EPHEMERAL_HOMEWORK_SECRET = crypto.randomBytes(32).toString('hex');

function sha256Lower(value: string): string {
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

export function isProductionEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

export type SecretIssueReason =
  | 'MISSING'
  | 'TOO_SHORT'
  | 'KNOWN_INSECURE_DEFAULT'
  | 'LOW_ENTROPY'
  | 'REUSED_ACROSS_PURPOSES';

export interface SecretConfigIssue {
  variable: string;
  reason: SecretIssueReason;
  message: string;
}

export interface ProductionSecretsValidationResult {
  ok: boolean;
  environment: 'production' | 'development';
  issues: SecretConfigIssue[];
  configuredVariables: string[];
  missingOptionalVariables: string[];
}

function hasSufficientEntropy(value: string): boolean {
  const uniqueChars = new Set(value).size;
  return uniqueChars >= 8;
}

function validateSingleProductionSecret(
  variable: string,
  rawValue: string | undefined,
): SecretConfigIssue | null {
  const value = (rawValue || '').trim();
  if (!value) {
    return {
      variable,
      reason: 'MISSING',
      message: `${variable} is required in production and must be set in environment secrets.`,
    };
  }

  if (KNOWN_INSECURE_SECRET_HASHES.has(sha256Lower(value))) {
    return {
      variable,
      reason: 'KNOWN_INSECURE_DEFAULT',
      message: `${variable} matches a known insecure default or placeholder value and is rejected in production.`,
    };
  }

  if (value.length < MIN_PRODUCTION_SECRET_LENGTH) {
    return {
      variable,
      reason: 'TOO_SHORT',
      message: `${variable} must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters long in production.`,
    };
  }

  if (!hasSufficientEntropy(value)) {
    return {
      variable,
      reason: 'LOW_ENTROPY',
      message: `${variable} has insufficient randomness/entropy for production use.`,
    };
  }

  return null;
}

/**
 * Validates all critical production signing keys and peppers without ever
 * returning or logging actual secret values.
 */
export function validateProductionSecretsConfig(
  env: NodeJS.ProcessEnv = process.env,
): ProductionSecretsValidationResult {
  const prod = isProductionEnv(env);
  const videoSecret = (env.VIDEO_SIGNING_SECRET || '').trim();
  const homeworkSecret = (env.HOMEWORK_FILE_SIGNING_SECRET || '').trim();
  const codePepper = (env.CODE_PEPPER || '').trim();
  const previousCodePepper = (env.CODE_PEPPER_PREVIOUS || '').trim();

  const configuredVariables: string[] = [];
  if (videoSecret) configuredVariables.push('VIDEO_SIGNING_SECRET');
  if (homeworkSecret) configuredVariables.push('HOMEWORK_FILE_SIGNING_SECRET');
  if (codePepper) configuredVariables.push('CODE_PEPPER');
  if (previousCodePepper) configuredVariables.push('CODE_PEPPER_PREVIOUS');

  const missingOptionalVariables: string[] = [];
  if (!previousCodePepper) missingOptionalVariables.push('CODE_PEPPER_PREVIOUS');

  const issues: SecretConfigIssue[] = [];

  const videoIssue = validateSingleProductionSecret('VIDEO_SIGNING_SECRET', videoSecret);
  if (videoIssue) issues.push(videoIssue);

  const homeworkIssue = validateSingleProductionSecret('HOMEWORK_FILE_SIGNING_SECRET', homeworkSecret);
  if (homeworkIssue) issues.push(homeworkIssue);

  const pepperIssue = validateSingleProductionSecret('CODE_PEPPER', codePepper);
  if (pepperIssue) issues.push(pepperIssue);

  // Enforce independent keys for distinct security purposes
  if (videoSecret && homeworkSecret && videoSecret === homeworkSecret) {
    issues.push({
      variable: 'HOMEWORK_FILE_SIGNING_SECRET',
      reason: 'REUSED_ACROSS_PURPOSES',
      message: 'HOMEWORK_FILE_SIGNING_SECRET must be independently generated and distinct from VIDEO_SIGNING_SECRET.',
    });
  }
  if (videoSecret && codePepper && videoSecret === codePepper) {
    issues.push({
      variable: 'CODE_PEPPER',
      reason: 'REUSED_ACROSS_PURPOSES',
      message: 'CODE_PEPPER must be independently generated and distinct from VIDEO_SIGNING_SECRET.',
    });
  }
  if (homeworkSecret && codePepper && homeworkSecret === codePepper) {
    issues.push({
      variable: 'CODE_PEPPER',
      reason: 'REUSED_ACROSS_PURPOSES',
      message: 'CODE_PEPPER must be independently generated and distinct from HOMEWORK_FILE_SIGNING_SECRET.',
    });
  }
  if (previousCodePepper && codePepper && previousCodePepper === codePepper) {
    issues.push({
      variable: 'CODE_PEPPER_PREVIOUS',
      reason: 'REUSED_ACROSS_PURPOSES',
      message: 'CODE_PEPPER_PREVIOUS should differ from CODE_PEPPER (or be unset when not rotating).',
    });
  }

  return {
    ok: prod ? issues.length === 0 : true,
    environment: prod ? 'production' : 'development',
    issues,
    configuredVariables,
    missingOptionalVariables,
  };
}

/**
 * Returns the server-only signing secret for temporary video playback tokens.
 * - Production: strictly requires a valid VIDEO_SIGNING_SECRET (fails securely if invalid/missing).
 * - Development/Preview: uses VIDEO_SIGNING_SECRET (or legacy SESSION_SECRET if provided),
 *   falling back to a process-scoped CSPRNG key (never a hardcoded predictable string).
 */
export function getVideoSigningSecret(env: NodeJS.ProcessEnv = process.env): string {
  const configured = (env.VIDEO_SIGNING_SECRET || '').trim();
  if (isProductionEnv(env)) {
    const issue = validateSingleProductionSecret('VIDEO_SIGNING_SECRET', configured);
    if (issue) {
      throw new Error(`Production secret configuration error: ${issue.message}`);
    }
    return configured;
  }

  if (configured) return configured;
  const legacyAlias = (env.SESSION_SECRET || '').trim();
  if (legacyAlias) return legacyAlias;
  return DEV_EPHEMERAL_VIDEO_SECRET;
}

/**
 * Returns the server-only signing secret for temporary homework file access tokens.
 * - Production: strictly requires a valid, stable HOMEWORK_FILE_SIGNING_SECRET so links
 *   remain valid across restarts and multiple instances.
 * - Development/Preview: uses HOMEWORK_FILE_SIGNING_SECRET when configured, falling back
 *   to an independent process-scoped CSPRNG key.
 */
export function getHomeworkFileSigningSecret(env: NodeJS.ProcessEnv = process.env): string {
  const configured = (env.HOMEWORK_FILE_SIGNING_SECRET || '').trim();
  if (isProductionEnv(env)) {
    const issue = validateSingleProductionSecret('HOMEWORK_FILE_SIGNING_SECRET', configured);
    if (issue) {
      throw new Error(`Production secret configuration error: ${issue.message}`);
    }
    return configured;
  }

  if (configured) return configured;
  return DEV_EPHEMERAL_HOMEWORK_SECRET;
}

/**
 * Returns the activation-code HMAC pepper.
 * - Production: strictly requires a valid, non-default CODE_PEPPER.
 * - Development/Preview: uses CODE_PEPPER when set; preserves legacy development
 *   compatibility ONLY in non-production so existing unused dev activation codes remain valid.
 */
export function getCodePepper(env: NodeJS.ProcessEnv = process.env): string {
  const configured = (env.CODE_PEPPER || '').trim();
  if (isProductionEnv(env)) {
    const issue = validateSingleProductionSecret('CODE_PEPPER', configured);
    if (issue) {
      throw new Error(`Production secret configuration error: ${issue.message}`);
    }
    return configured;
  }

  return configured || LEGACY_DEV_CODE_PEPPER;
}

/**
 * Optional secondary pepper used ONLY during a controlled, operator-approved
 * activation-code rotation transition window. Never used for generating new codes.
 */
export function getPreviousCodePepper(env: NodeJS.ProcessEnv = process.env): string | null {
  const previous = (env.CODE_PEPPER_PREVIOUS || '').trim();
  if (!previous) return null;
  const primary = (env.CODE_PEPPER || '').trim();
  if (primary && previous === primary) return null;
  return previous;
}

/**
 * Startup guard called by server.ts before listening.
 * - In production: fails fast and securely if any critical signing secret is missing,
 *   weak, equal to a known dev default, or reused across purposes.
 * - In development/preview: logs a concise non-sensitive notice without breaking dev preview.
 */
export function assertProductionSecretsOnStartup(env: NodeJS.ProcessEnv = process.env): void {
  const validation = validateProductionSecretsConfig(env);
  if (validation.environment === 'production') {
    if (!validation.ok) {
      const summary = validation.issues.map((i) => `- [${i.reason}] ${i.variable}: ${i.message}`).join('\n');
      throw new Error(
        `Refusing to start in production mode due to missing or insecure security secrets:\n${summary}`,
      );
    }
    return;
  }

  if (validation.issues.length > 0) {
    const pendingVars = Array.from(new Set(validation.issues.map((i) => i.variable)));
    console.warn(
      `[Security Config - Development Mode] Running with development-safe fallbacks. Before production deployment, configure strong independent secrets for: ${pendingVars.join(', ')}.`,
    );
  }
}
