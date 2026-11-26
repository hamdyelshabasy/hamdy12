/**
 * Shared Arabic-Indic / Extended Arabic-Indic / Western numeral normalization helper.
 *
 * Scope:
 * - Numeric form fields (prices, durations, marks, scores, percentages, limits, counts, tolerances).
 * - NEVER mutate activation codes, passwords, or non-numeric identifiers.
 */

const ARABIC_INDIC_MAP: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
  // Extended Arabic-Indic (Persian/Urdu) digits
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
  // Arabic decimal separator & minus signs
  '٫': '.',
  '−': '-',
};

/**
 * Converts Arabic-Indic (٠-٩) and Extended Arabic-Indic (۰-۹) digits to Western ASCII digits (0-9).
 */
export function normalizeDigits(value: string): string {
  if (!value) return '';
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    out += ARABIC_INDIC_MAP[ch] ?? ch;
  }
  return out;
}

/**
 * Normalizes a numeric input string (supports Arabic/English digits, Arabic decimal separator ٫,
 * comma decimal separator like "12,5" or "١٢٬٥", and strips thousands separators/spaces).
 * Returns cleaned ASCII numeric string suitable for Number(), or empty string if blank.
 */
export function normalizeNumericString(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? String(raw) : '';
  }
  const str = normalizeDigits(String(raw)).trim();
  if (!str) return '';

  // Remove Arabic thousands separator (٬) and regular whitespace
  let cleaned = str.replace(/[٬\s_]/g, '');

  // Handle comma: if there is no dot and a single comma, treat comma as decimal separator (e.g. "2,5" -> "2.5")
  if (!cleaned.includes('.') && cleaned.includes(',')) {
    const parts = cleaned.split(',');
    if (parts.length === 2 && parts[1].length > 0) {
      cleaned = `${parts[0]}.${parts[1]}`;
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  } else {
    // Otherwise commas are thousands separators (e.g. "1,250.5")
    cleaned = cleaned.replace(/,/g, '');
  }

  return cleaned;
}

/**
 * Parses a localized numeric value into a finite number, or returns null if invalid/empty.
 */
export function parseLocalizedNumber(raw: unknown): number | null {
  const cleaned = normalizeNumericString(raw);
  if (!cleaned) return null;
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(cleaned)) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

/**
 * Parses a localized integer value, returning fallback (default null) if invalid.
 */
export function parseLocalizedInt(raw: unknown): number | null {
  const num = parseLocalizedNumber(raw);
  if (num === null || !Number.isInteger(num)) return null;
  return num;
}

/**
 * Sanitizes live text input for numeric fields in React forms while allowing intermediate typing
 * like "-", "12.", or Arabic numerals (automatically normalized to ASCII digits or kept clean).
 */
export function sanitizeNumericInputValue(
  raw: string,
  options: { allowDecimal?: boolean; allowNegative?: boolean } = {},
): string {
  const { allowDecimal = true, allowNegative = false } = options;
  const normalized = normalizeDigits(raw).replace(/,/g, '.');
  let result = '';
  let seenDot = false;

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch >= '0' && ch <= '9') {
      result += ch;
    } else if (ch === '.' && allowDecimal && !seenDot) {
      result += '.';
      seenDot = true;
    } else if (ch === '-' && allowNegative && result.length === 0) {
      result += '-';
    }
  }
  return result;
}

/**
 * Preprocessor helper for Zod schemas: converts localized numeric strings to numbers before validation.
 * Preserves undefined/null so `.optional()` / `.nullable()` / `.default()` continue to work identically.
 */
export function preprocessLocalizedNumber(val: unknown): unknown {
  if (val === undefined || val === null || val === '') return val;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const cleaned = normalizeNumericString(val);
    if (!cleaned) return val;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : val;
  }
  return val;
}
