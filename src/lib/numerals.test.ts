import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDigits,
  normalizeNumericString,
  parseLocalizedInt,
  parseLocalizedNumber,
  preprocessLocalizedNumber,
  sanitizeNumericInputValue,
} from './numerals.ts';

test('normalizeDigits converts Arabic-Indic and Extended Arabic-Indic digits to ASCII', () => {
  assert.equal(normalizeDigits('٠١٢٣٤٥٦٧٨٩'), '0123456789');
  assert.equal(normalizeDigits('۰۱۲۳۴۵۶۷۸۹'), '0123456789');
  assert.equal(normalizeDigits('١٢٫٥'), '12.5');
  assert.equal(normalizeDigits('450'), '450');
  assert.equal(normalizeDigits('٣٠ دقيقة'), '30 دقيقة');
});

test('parseLocalizedNumber handles Arabic, English, mixed, decimals, and rejects invalid text', () => {
  assert.equal(parseLocalizedNumber('٤٥'), 45);
  assert.equal(parseLocalizedNumber('١٢٫٥'), 12.5);
  assert.equal(parseLocalizedNumber('١٢,٧٥'), 12.75);
  assert.equal(parseLocalizedNumber('1,250.5'), 1250.5);
  assert.equal(parseLocalizedNumber('٢0.٥'), 20.5);
  assert.equal(parseLocalizedNumber('−٣.٥'), -3.5);
  assert.equal(parseLocalizedNumber(99.5), 99.5);
  assert.equal(parseLocalizedNumber(''), null);
  assert.equal(parseLocalizedNumber('abc'), null);
  assert.equal(parseLocalizedNumber('١٢abc'), null);
});

test('parseLocalizedInt enforces whole numbers only', () => {
  assert.equal(parseLocalizedInt('٦٠'), 60);
  assert.equal(parseLocalizedInt('120'), 120);
  assert.equal(parseLocalizedInt('١٢.٥'), null);
  assert.equal(parseLocalizedInt(''), null);
});

test('sanitizeNumericInputValue supports live Arabic and English typing', () => {
  assert.equal(sanitizeNumericInputValue('٤٥٠', { allowDecimal: false }), '450');
  assert.equal(sanitizeNumericInputValue('١٢٫٥', { allowDecimal: true }), '12.5');
  assert.equal(sanitizeNumericInputValue('١٢,٥', { allowDecimal: true }), '12.5');
  assert.equal(sanitizeNumericInputValue('١٢.٣.٤', { allowDecimal: true }), '12.34');
  assert.equal(sanitizeNumericInputValue('−٥.٢', { allowDecimal: true, allowNegative: true }), '-5.2');
  assert.equal(sanitizeNumericInputValue('abc٤٥xyz', { allowDecimal: false }), '45');
});

test('preprocessLocalizedNumber leaves null/undefined untouched and normalizes localized strings', () => {
  assert.equal(preprocessLocalizedNumber(undefined), undefined);
  assert.equal(preprocessLocalizedNumber(null), null);
  assert.equal(preprocessLocalizedNumber(''), '');
  assert.equal(preprocessLocalizedNumber('٣٠'), 30);
  assert.equal(preprocessLocalizedNumber('٢.٥'), 2.5);
  assert.equal(preprocessLocalizedNumber('not-a-num'), 'not-a-num');
  assert.equal(normalizeNumericString('١٬٥٠٠'), '1500');
});
