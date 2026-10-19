const INN10_WEIGHTS = [2, 4, 10, 3, 5, 9, 4, 6, 8] as const;
const INN12_FIRST_WEIGHTS = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8] as const;
const INN12_SECOND_WEIGHTS = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8] as const;
const CHECK_MODULUS = 11;
const DIGIT_MODULUS = 10;

function checkDigit(digits: readonly number[], weights: readonly number[]): number {
  const sum = weights.reduce((total, weight, index) => total + weight * (digits[index] ?? 0), 0);
  return (sum % CHECK_MODULUS) % DIGIT_MODULUS;
}

export function isValidInn(value: string): boolean {
  if (!/^(\d{10}|\d{12})$/.test(value)) return false;
  const digits = value.split('').map(Number);
  if (digits.length === 10) return checkDigit(digits, INN10_WEIGHTS) === digits[9];
  return (
    checkDigit(digits, INN12_FIRST_WEIGHTS) === digits[10] &&
    checkDigit(digits, INN12_SECOND_WEIGHTS) === digits[11]
  );
}

export function isOgrnFormat(value: string): boolean {
  return /^(\d{13}|\d{15})$/.test(value);
}

export function innKind(inn: string): 'legal' | 'individual' {
  return inn.length === 10 ? 'legal' : 'individual';
}

const FOOD_OKVED = /^56(\.|$)/;
const FOOD_OKVED_EXACT = ['10.71', '10.72', '47.24'];

export function okvedMatches(okved: string | null): boolean {
  if (okved === null) return false;
  return FOOD_OKVED.test(okved) || FOOD_OKVED_EXACT.includes(okved);
}
