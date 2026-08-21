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

export const RawPhoneNumberSchema = z.string().min(9).max(15).regex(/^[\+0-9\s\-\(\)]+$/);
export const E164PhoneNumberSchema = z.string().length(11).regex(/^\+27[1-9]\d{8}$/);
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

class PhoneContractService {
  standardize(phoneNumber: string): E164PhoneNumber {
    const parsed = this.parse(phoneNumber);
    return this.toE164(parsed.digits);
  }

  parse(phoneNumber: string): ParsedPhoneNumber {
    const cleaned = phoneNumber.replace(/[^\+0-9]/g, '');
    let hasCountryCode = false;
    let hasPlus = cleaned.startsWith('+');
    let digits = cleaned;
    if (hasPlus) {
      digits = digits.substring(1);
    }
    if (digits.startsWith(SA_PHONE_CONFIG.COUNTRY_CODE_WITHOUT_PLUS)) {
      hasCountryCode = true;
      digits = digits.substring(SA_PHONE_CONFIG.COUNTRY_CODE_WITHOUT_PLUS.length);
    } else if (digits.startsWith('0')) {
      digits = digits.substring(1);
    }
    return { digits, hasCountryCode, hasPlus };
  }

  toE164(digits: string): E164PhoneNumber {
    if (digits.length !== SA_PHONE_CONFIG.MIN_LENGTH) {
      throw new Error('Phone number must be 9 digits (got ' + digits.length + ')');
    }
    if (digits[0] === '0') {
      throw new Error('Phone number cannot start with 0 after removing country code');
    }
    return SA_PHONE_CONFIG.COUNTRY_CODE + digits as E164PhoneNumber;
  }

  validate(phoneNumber: string): boolean {
    try {
      this.standardize(phoneNumber);
      return true;
    } catch {
      return false;
    }
  }

  validateWithDetails(phoneNumber: string): PhoneValidationResult {
    try {
      const e164 = this.standardize(phoneNumber);
      return { valid: true, e164, original: phoneNumber };
    } catch (error) {
      return {
        valid: false,
        original: phoneNumber,
        error: error instanceof Error ? error.message : 'Invalid phone number'
      };
    }
  }

  format(phoneNumber: E164PhoneNumber, formatType: PhoneNumberFormat = 'INTERNATIONAL'): string {
    const validated = E164PhoneNumberSchema.parse(phoneNumber);
    const digits = validated.substring(SA_PHONE_CONFIG.COUNTRY_CODE.length);
    switch (formatType) {
      case 'E164':
        return phoneNumber;
      case 'INTERNATIONAL':
        return '+27 ' + digits.slice(0, 1) + ' ' + digits.slice(1, 4) + ' ' + digits.slice(4, 7) + ' ' + digits.slice(7);
      case 'NATIONAL':
        return '0' + digits.slice(0, 1) + ' ' + digits.slice(1, 4) + ' ' + digits.slice(4, 7) + ' ' + digits.slice(7);
      case 'LOCAL':
        return digits.slice(0, 3) + ' ' + digits.slice(3, 6) + ' ' + digits.slice(6);
      default:
        return phoneNumber;
    }
  }

  mask(phoneNumber: E164PhoneNumber, visibleDigits: number = 4): string {
    const validated = E164PhoneNumberSchema.parse(phoneNumber);
    const digits = validated.substring(SA_PHONE_CONFIG.COUNTRY_CODE.length);
    if (visibleDigits <= 0 || visibleDigits > digits.length) {
      visibleDigits = 4;
    }
    const masked = '*'.repeat(digits.length - visibleDigits) + digits.slice(-visibleDigits);
    return SA_PHONE_CONFIG.COUNTRY_CODE + masked;
  }

  isSame(phone1: string, phone2: string): boolean {
    try {
      const e164_1 = this.standardize(phone1);
      const e164_2 = this.standardize(phone2);
      return e164_1 === e164_2;
    } catch {
      return false;
    }
  }

  getCountryCode(phoneNumber: string): string | null {
    const parsed = this.parse(phoneNumber);
    if (parsed.hasCountryCode) {
      return parsed.hasPlus ? '+' + SA_PHONE_CONFIG.COUNTRY_CODE_WITHOUT_PLUS : SA_PHONE_CONFIG.COUNTRY_CODE_WITHOUT_PLUS;
    }
    return null;
  }

  isSouthAfrican(phoneNumber: string): boolean {
    try {
      const parsed = this.parse(phoneNumber);
      if (parsed.hasCountryCode) {
        return parsed.digits.startsWith(SA_PHONE_CONFIG.COUNTRY_CODE_WITHOUT_PLUS);
      }
      return true;
    } catch {
      return false;
    }
  }
}

export const phoneContractService = new PhoneContractService();

export function standardizePhone(phoneNumber: string): E164PhoneNumber {
  return phoneContractService.standardize(phoneNumber);
}

export function isValidPhone(phoneNumber: string): boolean {
  return phoneContractService.validate(phoneNumber);
}

export function validateAndStandardizePhone(phoneNumber: string): E164PhoneNumber {
  if (!isValidPhone(phoneNumber)) {
    throw new Error('Invalid phone number: ' + phoneNumber);
  }
  return standardizePhone(phoneNumber);
}

export function formatPhone(phoneNumber: E164PhoneNumber, formatType: PhoneNumberFormat = 'INTERNATIONAL'): string {
  return phoneContractService.format(phoneNumber, formatType);
}

export function maskPhone(phoneNumber: E164PhoneNumber, visibleDigits?: number): string {
  return phoneContractService.mask(phoneNumber, visibleDigits);
}

export default phoneContractService;