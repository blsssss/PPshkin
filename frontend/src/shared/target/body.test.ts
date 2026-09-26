import { describe, expect, it } from 'vitest';
import { validateBody, validateKcalTarget, type BodyForm } from './body.ts';

const VALID: BodyForm = { sex: 'female', ageYears: '30', heightCm: '165', weightKg: '60', activity: 'light' };

describe('validateBody', () => {
  it('builds the request from a valid form', () => {
    expect(validateBody(VALID, 'lose')).toEqual({
      values: { sex: 'female', ageYears: 30, heightCm: 165, weightKg: 60, activity: 'light', goal: 'lose' },
      errors: {},
    });
  });

  it.each([
    ['ageYears', '14', true],
    ['ageYears', '100', true],
    ['ageYears', '13', false],
    ['ageYears', '101', false],
    ['ageYears', '30.5', false],
    ['heightCm', '120', true],
    ['heightCm', '230', true],
    ['heightCm', '119', false],
    ['heightCm', '231', false],
    ['weightKg', '35', true],
    ['weightKg', '250', true],
    ['weightKg', '62,5', true],
    ['weightKg', '34.9', false],
    ['weightKg', '250.1', false],
    ['weightKg', '60.25', false],
    ['weightKg', 'шестьдесят', false],
  ] as const)('%s = %s is valid: %s', (field, value, valid) => {
    const result = validateBody({ ...VALID, [field]: value }, 'maintain');
    expect(result.values !== null).toBe(valid);
    expect(result.errors[field] === undefined).toBe(valid);
  });

  it('accepts a decimal comma for weight', () => {
    expect(validateBody({ ...VALID, weightKg: '62,5' }, 'gain').values?.weightKg).toBe(62.5);
  });

  it('requires sex, activity and a goal', () => {
    const result = validateBody({ ...VALID, sex: null, activity: null }, null);
    expect(result.values).toBeNull();
    expect(Object.keys(result.errors).sort()).toEqual(['activity', 'goal', 'sex']);
  });
});

describe('validateKcalTarget', () => {
  it.each([
    ['1000', 1000],
    ['5000', 5000],
    [' 1850 ', 1850],
  ])('accepts %s', (text, value) => {
    expect(validateKcalTarget(text)).toBe(value);
  });

  it.each(['999', '5001', '1850.5', '', 'много'])('rejects %j', (text) => {
    expect(typeof validateKcalTarget(text)).toBe('string');
  });
});
