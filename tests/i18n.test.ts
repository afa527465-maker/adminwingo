import test from 'node:test';
import assert from 'node:assert/strict';
import { en } from '../src/locales/en.ts';
import {
  LOCALES,
  SUPPORTED_LANGUAGES,
  SUPPORTED_LANGUAGE_CODES,
  detectBrowserLanguage,
  getLanguageMeta,
  isSupportedLanguage,
} from '../src/locales/registry.ts';
import {
  formatLocaleCurrency,
  formatLocaleDate,
  formatLocaleDateTime,
  formatLocaleNumber,
  formatLocaleTime,
  t,
  translateCategory,
  translateError,
  translateStatus,
} from '../src/lib/i18n.ts';

const MASTER_KEYS = Object.keys(en) as Array<keyof typeof en>;

function extractPlaceholders(str: string): string[] {
  const matches = str.match(/\{(\w+)\}/g) || [];
  return [...new Set(matches)].sort();
}

test('All 25 required international languages are registered with native names and valid metadata', () => {
  const required = [
    'en',
    'zh-CN',
    'km',
    'zh-TW',
    'th',
    'vi',
    'lo',
    'id',
    'ms',
    'hi',
    'bn',
    'my',
    'ja',
    'ko',
    'fr',
    'es',
    'pt',
    'de',
    'it',
    'ru',
    'ar',
    'tr',
    'fil',
    'ur',
    'ne',
  ];

  for (const code of required) {
    assert.ok(isSupportedLanguage(code), `Expected language "${code}" to be supported`);
    const meta = getLanguageMeta(code);
    assert.equal(meta.code, code);
    assert.ok(meta.nativeName.trim().length > 0, `Missing nativeName for ${code}`);
    assert.ok(meta.englishName.trim().length > 0, `Missing englishName for ${code}`);
    assert.ok(meta.localeTag.trim().length > 0, `Missing localeTag for ${code}`);
  }

  assert.equal(SUPPORTED_LANGUAGES.length, SUPPORTED_LANGUAGE_CODES.length);
  assert.equal(getLanguageMeta('ar').dir, 'rtl');
  assert.equal(getLanguageMeta('ur').dir, 'rtl');
  assert.equal(getLanguageMeta('en').dir, 'ltr');
  assert.equal(getLanguageMeta('km').dir, 'ltr');
  assert.equal(getLanguageMeta('zh-CN').dir, 'ltr');
});

test('Every locale dictionary has 100% key parity with English, non-empty strings, and matching placeholders', () => {
  for (const code of SUPPORTED_LANGUAGE_CODES) {
    const dict = LOCALES[code];
    assert.ok(dict, `Locale dictionary missing for ${code}`);

    const dictKeys = Object.keys(dict);
    assert.equal(
      dictKeys.length,
      MASTER_KEYS.length,
      `Locale "${code}" key count (${dictKeys.length}) does not match en (${MASTER_KEYS.length})`
    );

    for (const key of MASTER_KEYS) {
      const value = dict[key];
      assert.equal(typeof value, 'string', `Locale "${code}" key "${key}" must be a string`);
      assert.ok(value.trim().length > 0, `Locale "${code}" key "${key}" must not be empty`);

      const expectedTokens = extractPlaceholders(en[key]);
      const actualTokens = extractPlaceholders(value);
      assert.deepEqual(
        actualTokens,
        expectedTokens,
        `Placeholder mismatch in locale "${code}" for key "${key}": expected ${JSON.stringify(expectedTokens)}, got ${JSON.stringify(actualTokens)}`
      );
    }
  }
});

test('t() interpolates parameters and falls back cleanly to English for unknown languages or keys', () => {
  assert.equal(t('en', 'common_page_of', { page: 2, total: 9 }), 'Page 2 / 9');
  assert.equal(t('zh-CN', 'nav_play'), LOCALES['zh-CN'].nav_play);
  assert.equal(t('km', 'nav_wallet'), LOCALES.km.nav_wallet);
  assert.equal(t('ar', 'nav_support'), LOCALES.ar.nav_support);

  // Unknown language falls back to English
  assert.equal(t('xx-UNKNOWN', 'auth_login'), en.auth_login);
  // Unknown key returns key itself safely
  assert.equal(t('fr', 'nonexistent_custom_key'), 'nonexistent_custom_key');
});

test('detectBrowserLanguage maps regional tags accurately and falls back to English', () => {
  assert.equal(detectBrowserLanguage(['zh-Hant-HK', 'en-US']), 'zh-TW');
  assert.equal(detectBrowserLanguage(['zh-TW']), 'zh-TW');
  assert.equal(detectBrowserLanguage(['zh-Hans-CN']), 'zh-CN');
  assert.equal(detectBrowserLanguage(['zh-SG']), 'zh-CN');
  assert.equal(detectBrowserLanguage(['km-KH']), 'km');
  assert.equal(detectBrowserLanguage(['es-MX']), 'es');
  assert.equal(detectBrowserLanguage(['ar-AE']), 'ar');
  assert.equal(detectBrowserLanguage(['ur-PK']), 'ur');
  assert.equal(detectBrowserLanguage(['tl-PH']), 'fil');
  assert.equal(detectBrowserLanguage(['fil-PH']), 'fil');
  assert.equal(detectBrowserLanguage(['pt-BR']), 'pt');
  assert.equal(detectBrowserLanguage(['xx-YY']), 'en');
  assert.equal(detectBrowserLanguage([]), 'en');
});

test('Dynamic status, support category, and backend error translators work across locales', () => {
  assert.equal(translateStatus('fr', 'pending_verification'), LOCALES.fr.status_pending_verification);
  assert.equal(translateStatus('ar', 'completed'), LOCALES.ar.status_completed);
  assert.equal(translateStatus('ja', 'settled'), LOCALES.ja.status_completed);
  assert.equal(translateStatus('es', 'suspended'), LOCALES.es.status_suspended);

  assert.equal(translateCategory('th', 'Deposit problem'), LOCALES.th.support_cat_deposit);
  assert.equal(translateCategory('vi', 'Withdrawal problem'), LOCALES.vi.support_cat_withdrawal);
  assert.equal(translateCategory('de', 'Custom Unmapped'), 'Custom Unmapped');

  assert.equal(
    translateError('es', 'Insufficient available wallet balance for this wager.'),
    LOCALES.es.err_insufficient_balance
  );
  assert.equal(
    translateError('ko', 'Betting is closed for this round'),
    LOCALES.ko.err_betting_closed
  );
  assert.equal(
    translateError('en', 'Some specific custom server error'),
    'Some specific custom server error'
  );
});

test('International currency, number, and date formatters format by locale without converting balance values', () => {
  // Value 1234.56 stays 1234.56 (digits preserved; no FX conversion)
  const enUsd = formatLocaleCurrency(1234.56, 'USD', 'en');
  const deUsd = formatLocaleCurrency(1234.56, 'USD', 'de');
  const frInr = formatLocaleCurrency(1234.56, 'INR', 'fr');

  assert.ok(enUsd.includes('1,234.56'), `Expected US formatting, got ${enUsd}`);
  assert.ok(deUsd.includes('1.234,56'), `Expected German decimal/grouping separators, got ${deUsd}`);
  assert.ok(frInr.includes('234,56') && (frInr.includes('₹') || frInr.includes('INR')), `Expected INR preserved without FX conversion, got ${frInr}`);

  assert.ok(formatLocaleNumber(98765, 'de').includes('98.765'));

  const sampleDate = '2026-11-21T15:30:00.000Z';
  assert.ok(formatLocaleDate(sampleDate, 'ja').length > 0);
  assert.ok(formatLocaleTime(sampleDate, 'ar').length > 0);
  assert.ok(formatLocaleDateTime(sampleDate, 'km').length > 0);
});
