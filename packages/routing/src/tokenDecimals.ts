import { parseUnits, formatUnits } from 'ethers';

export function parseTokenUnits(humanAmount: string | number, decimals: number): string {
  if (humanAmount === undefined || humanAmount === null) return '0';

  const str = typeof humanAmount === 'number' ? humanAmount.toFixed(Math.min(decimals, 18)) : humanAmount.toString().trim();
  const clean = str.replace(/,/g, '');

  if (!clean || clean === '.' || clean === '0' || isNaN(Number(clean))) {
    return '0';
  }

  const [rawWhole = '0', rawFrac = ''] = clean.split('.');
  const whole = rawWhole === '' ? '0' : rawWhole.replace(/^0+(?=\d)/, '');
  const truncatedFrac = rawFrac.slice(0, decimals);
  const normalized = truncatedFrac.length > 0 ? `${whole}.${truncatedFrac}` : whole;

  try {
    return parseUnits(normalized, decimals).toString();
  } catch {

    const paddedFrac = truncatedFrac.padEnd(decimals, '0');
    return (whole + paddedFrac).replace(/^0+/, '') || '0';
  }
}

export function formatTokenUnits(rawAmount: bigint | string | number, decimals: number): string {
  if (rawAmount === undefined || rawAmount === null) return '0.0';
  try {
    const rawBig = typeof rawAmount === 'bigint' ? rawAmount : BigInt(rawAmount.toString().split('.')[0] || '0');
    return formatUnits(rawBig, decimals);
  } catch {
    return '0.0';
  }
}

export function formatDisplayAmount(amount: number, maxDecimals: number = 6): string {
  if (!amount || isNaN(amount) || amount <= 0) return '0.00';
  if (amount >= 1000) {
    return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (amount >= 1) {
    return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: Math.min(4, maxDecimals) });
  }
  if (amount >= 0.0001) {
    return amount.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: maxDecimals });
  }
  return amount.toFixed(maxDecimals);
}
