/**
 * Phone Contract Constants
 * Standard phone number configurations for the Ubuntu Pay platform
 */

// South African phone number configuration
export const PHONE_CONFIG = {
  COUNTRY_CODE: '+27',
  COUNTRY_CODE_NUMERIC: '27',
  MIN_DIGITS: 9,
  MAX_DIGITS: 9,
  E164_LENGTH: 11,
  LOCAL_PREFIX: '0',
  DEFAULT_FORMAT: 'INTERNATIONAL' as const,
  MASK_VISIBLE_DIGITS: 4,
} as const;

// Supported phone number formats
export type PhoneFormat = 'E164' | 'INTERNATIONAL' | 'NATIONAL' | 'LOCAL';

// Phone number regex patterns
export const PHONE_PATTERNS = {
  // Raw input pattern (accepts various formats)
  RAW: /^[\+0-9\s\-\(\)]+$/,
  // E.164 pattern for South Africa
  E164: /^\+27[1-9]\d{8}$/,
  // Local pattern (starts with 0)
  LOCAL: /^0[1-9]\d{8}$/,
  // International pattern (starts with +27)
  INTERNATIONAL: /^\+27[1-9]\d{8}$/,
  // Numeric with country code (starts with 27)
  NUMERIC: /^27[1-9]\d{8}$/,
} as const;

// Phone validation error messages
export const PHONE_ERRORS = {
  INVALID_LENGTH: 'Phone number must be exactly 9 digits (excluding country code)',
  INVALID_FORMAT: 'Invalid phone number format',
  INVALID_COUNTRY_CODE: 'Phone number must be a South African number',
  LEADING_ZERO: 'Phone number cannot start with 0 after removing country code',
  INVALID_CHARACTERS: 'Phone number contains invalid characters',
} as const;

// Default phone number for testing
export const TEST_PHONE_NUMBERS = {
  LOCAL: '0721234567',
  E164: '+27721234567',
  NUMERIC: '27721234567',
  WITH_SPACES: '0 72 123 4567',
  WITH_DASHES: '072-123-4567',
  WITH_PARENS: '0(72)1234567',
} as const;

export default PHONE_CONFIG;
