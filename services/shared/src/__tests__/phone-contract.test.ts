/**
 * Phone Contract Standardization Tests
 */

import {
  phoneContractService,
  standardizePhone,
  isValidPhone,
  validateAndStandardizePhone,
  formatPhone,
  maskPhone,
  SA_PHONE_CONFIG,
  E164PhoneNumberSchema,
  RawPhoneNumberSchema,
} from '../services/phone-contract';

describe('PhoneContractService', () => {
  describe('standardize()', () => {
    it('should standardize local format to E.164', () => {
      expect(phoneContractService.standardize('0721234567')).toBe('+27721234567');
    });

    it('should standardize international format to E.164', () => {
      expect(phoneContractService.standardize('+27721234567')).toBe('+27721234567');
    });

    it('should standardize format without plus to E.164', () => {
      expect(phoneContractService.standardize('27721234567')).toBe('+27721234567');
    });

    it('should handle spaces', () => {
      expect(phoneContractService.standardize('0 72 123 4567')).toBe('+27721234567');
    });

    it('should handle dashes', () => {
      expect(phoneContractService.standardize('072-123-4567')).toBe('+27721234567');
    });

    it('should throw for invalid length', () => {
      expect(() => phoneContractService.standardize('072123456')).toThrow();
    });
  });

  describe('validate()', () => {
    it('should return true for valid numbers', () => {
      expect(phoneContractService.validate('0721234567')).toBe(true);
      expect(phoneContractService.validate('+27721234567')).toBe(true);
    });

    it('should return false for invalid numbers', () => {
      expect(phoneContractService.validate('123')).toBe(false);
      expect(phoneContractService.validate('abc')).toBe(false);
    });
  });

  describe('format()', () => {
    const e164 = '+27721234567' as const;

    it('should format as E164', () => {
      expect(phoneContractService.format(e164, 'E164')).toBe('+27721234567');
    });

    it('should format as INTERNATIONAL', () => {
      expect(phoneContractService.format(e164, 'INTERNATIONAL')).toBe('+27 7 212 345 67');
    });

    it('should format as NATIONAL', () => {
      expect(phoneContractService.format(e164, 'NATIONAL')).toBe('07 212 345 67');
    });

    it('should format as LOCAL', () => {
      expect(phoneContractService.format(e164, 'LOCAL')).toBe('721 234 567');
    });
  });

  describe('mask()', () => {
    it('should mask showing last 4 digits', () => {
      expect(phoneContractService.mask('+27721234567' as const)).toBe('+27*******4567');
    });
  });

  describe('isSame()', () => {
    it('should return true for equivalent numbers', () => {
      expect(phoneContractService.isSame('0721234567', '+27721234567')).toBe(true);
    });

    it('should return false for different numbers', () => {
      expect(phoneContractService.isSame('0721234567', '0721234568')).toBe(false);
    });
  });

  describe('parse()', () => {
    it('should parse local format', () => {
      const result = phoneContractService.parse('0721234567');
      expect(result.digits).toBe('721234567');
      expect(result.hasCountryCode).toBe(false);
    });

    it('should parse international format', () => {
      const result = phoneContractService.parse('+27721234567');
      expect(result.digits).toBe('721234567');
      expect(result.hasCountryCode).toBe(true);
    });
  });
});

describe('Utility Functions', () => {
  it('should standardize phone', () => {
    expect(standardizePhone('0721234567')).toBe('+27721234567');
  });

  it('should validate phone', () => {
    expect(isValidPhone('0721234567')).toBe(true);
    expect(isValidPhone('123')).toBe(false);
  });

  it('should validate and standardize phone', () => {
    expect(validateAndStandardizePhone('0721234567')).toBe('+27721234567');
  });

  it('should format phone', () => {
    expect(formatPhone('+27721234567' as const)).toBe('+27 7 212 345 67');
  });

  it('should mask phone', () => {
    expect(maskPhone('+27721234567' as const)).toBe('+27*******4567');
  });
});

describe('Zod Schemas', () => {
  it('should validate raw phone numbers', () => {
    expect(() => RawPhoneNumberSchema.parse('0721234567')).not.toThrow();
    expect(() => RawPhoneNumberSchema.parse('+27721234567')).not.toThrow();
  });

  it('should reject invalid raw phone numbers', () => {
    expect(() => RawPhoneNumberSchema.parse('123')).toThrow();
  });

  it('should validate E.164 phone numbers', () => {
    expect(() => E164PhoneNumberSchema.parse('+27721234567')).not.toThrow();
  });

  it('should reject invalid E.164 phone numbers', () => {
    expect(() => E164PhoneNumberSchema.parse('+27012345678')).toThrow();
    expect(() => E164PhoneNumberSchema.parse('0721234567')).toThrow();
  });
});

describe('Edge Cases', () => {
  it('should handle equivalent phone numbers consistently', () => {
    const phone1 = '0721234567';
    const phone2 = '+27721234567';
    const phone3 = '27721234567';

    const std1 = standardizePhone(phone1);
    const std2 = standardizePhone(phone2);
    const std3 = standardizePhone(phone3);

    expect(std1).toBe(std2);
    expect(std2).toBe(std3);
    expect(std1).toBe('+27721234567');
  });

  it('should ensure phone numbers are always in E.164 format', () => {
    const testNumbers = [
      '0721234567',
      '+27721234567',
      '27721234567',
      '072-123-4567',
      '0(72)1234567',
    ];

    testNumbers.forEach(num => {
      const standardized = standardizePhone(num);
      expect(standardized).toMatch(/^\+27\d{9}$/);
      expect(() => E164PhoneNumberSchema.parse(standardized)).not.toThrow();
    });
  });
});