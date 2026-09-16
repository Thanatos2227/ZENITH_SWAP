export const MAX_SWAP_AMOUNT_STR = '9999999.999';
export const MAX_SWAP_AMOUNT_NUM = 9999999.999;
export const MAX_DECIMAL_PLACES = 3;
export const MAX_INTEGER_DIGITS = 7;

export interface AmountValidationResult {
  isValid: boolean;
  sanitized: string;
  numericValue: number;
  error?: string;
  isTruncated: boolean;
}

export function validateAndSanitizeAmount(rawInput: string): AmountValidationResult {
  if (rawInput === undefined || rawInput === null) {
    return { isValid: true, sanitized: '', numericValue: 0, isTruncated: false };
  }

  const trimmed = rawInput.trim();
  if (trimmed === '') {
    return { isValid: true, sanitized: '', numericValue: 0, isTruncated: false };
  }

  const withoutCommas = trimmed.replace(/,/g, '');

  if (/[eE+-]/.test(withoutCommas)) {
    return {
      isValid: false,
      sanitized: '',
      numericValue: 0,
      error: 'Invalid characters in amount',
      isTruncated: false
    };
  }

  const dotCount = (withoutCommas.match(/\./g) || []).length;
  if (dotCount > 1) {
    return {
      isValid: false,
      sanitized: '',
      numericValue: 0,
      error: 'Multiple decimal points are not allowed',
      isTruncated: false
    };
  }

  let working = withoutCommas;
  if (working === '.') {
    return {
      isValid: true,
      sanitized: '0.',
      numericValue: 0,
      isTruncated: false
    };
  }

  if (working.startsWith('.')) {
    working = '0' + working;
  }

  if (!/^\d+(\.\d*)?$/.test(working)) {
    return {
      isValid: false,
      sanitized: '',
      numericValue: 0,
      error: 'Invalid numeric format',
      isTruncated: false
    };
  }

  const hasTrailingDot = working.endsWith('.');
  const [rawInteger, rawFractional] = working.split('.');

  const normalizedInteger = rawInteger.replace(/^0+/, '') || '0';

  if (normalizedInteger.length > MAX_INTEGER_DIGITS) {
    return {
      isValid: false,
      sanitized: '',
      numericValue: 0,
      error: 'Amount exceeds maximum allowed limit of 9,999,999.999',
      isTruncated: false
    };
  }

  if (BigInt(normalizedInteger) > 9999999n) {
    return {
      isValid: false,
      sanitized: '',
      numericValue: 0,
      error: 'Amount exceeds maximum allowed limit of 9,999,999.999',
      isTruncated: false
    };
  }

  let isTruncated = false;
  let sanitizedFractional: string | undefined = undefined;

  if (rawFractional !== undefined) {

    if (rawFractional.length > MAX_DECIMAL_PLACES) {
      sanitizedFractional = rawFractional.slice(0, MAX_DECIMAL_PLACES);
      isTruncated = true;
    } else {
      sanitizedFractional = rawFractional;
    }
  }

  let sanitized = normalizedInteger;
  if (hasTrailingDot && (sanitizedFractional === undefined || sanitizedFractional === '')) {
    sanitized += '.';
  } else if (sanitizedFractional !== undefined && sanitizedFractional !== '') {
    sanitized += '.' + sanitizedFractional;
  }

  const numericValue = parseFloat(sanitized) || 0;

  if (numericValue > MAX_SWAP_AMOUNT_NUM) {
    return {
      isValid: false,
      sanitized: '',
      numericValue: 0,
      error: 'Amount exceeds maximum allowed limit of 9,999,999.999',
      isTruncated: false
    };
  }

  return {
    isValid: true,
    sanitized,
    numericValue,
    isTruncated
  };
}

export function truncateToThreeDecimals(val: number | string): string {
  if (typeof val === 'number') {
    if (isNaN(val) || val <= 0) return '0.0';
    if (val > MAX_SWAP_AMOUNT_NUM) return MAX_SWAP_AMOUNT_STR;

    const fixedStr = val.toFixed(8);
    const [whole = '0', frac = ''] = fixedStr.split('.');
    const truncatedFrac = frac.slice(0, MAX_DECIMAL_PLACES);
    return truncatedFrac ? `${whole}.${truncatedFrac}` : whole;
  }

  const [whole = '0', frac = ''] = val.trim().replace(/,/g, '').split('.');
  if (BigInt(whole.replace(/^0+/, '') || '0') > 9999999n) {
    return MAX_SWAP_AMOUNT_STR;
  }
  if (!frac) return whole;
  const truncatedFrac = frac.slice(0, MAX_DECIMAL_PLACES);
  return truncatedFrac ? `${whole}.${truncatedFrac}` : whole;
}
