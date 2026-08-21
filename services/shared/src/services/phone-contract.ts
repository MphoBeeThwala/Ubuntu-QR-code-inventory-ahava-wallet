/**
 * Phone Contract Standardization Service
 * Standardizes phone number handling across the Ubuntu Pay platform
 * Ensures all phone numbers are in E.164 format for South Africa (+27XXXXXXXXXX)
 */

import { z } from 'zod';

export const SA_PHONE_CONFIG = {
  COUNTRY_CODE: '+27',
  COUNTRY_CODE_WITHOUT_PLUS: '27',
  MIN_LENGTH: 9,
  MAX_LENGTH: 9,
  FULL_LENGTH: 11,
  LOCAL_PREFIX: '0',
} as const;

export type PhoneNumberFormat = 'E164' | 'INTERNATIONAL' | 'NATIONAL' | 'LOCAL';

export const RawPhoneNumberSchema = z.string()
  .min(9)
  .max(15)
  .regex(/^[\+0-9\s\-\(\)]+$/);

export const E164PhoneNumberSchema = z.string()
  .length(11)
  .regex(/^\+27[1-9]\d{8}$/);

export type RawPhoneNumber = z.infer<typeof RawPhoneNumberSchema>;
export type E164PhoneNumber = z.infer<typeof E164PhoneNumberSchema>;

interface ParsedPhoneNumber {
  digits: string;
  hasCountryCode: boolean;
  hasPlus: boolean;
}

interface PhoneValidationResult {
  valid: boolean;
  e164?: E164PhoneNumber;
  error?: string;
  original: string;
}