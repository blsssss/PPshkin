import { describe, expect, it } from 'vitest';
import { innKind, isOgrnFormat, isValidInn, okvedMatches } from './inn.ts';

describe('isValidInn', () => {
  it.each(['7707083893', '7736207543', '5003052454', '500100732259', '772208786091', '7727563778'])(
    'accepts the real INN %s',
    (inn) => {
      expect(isValidInn(inn)).toBe(true);
    },
  );

  it.each([
    ['a wrong check digit of 10 digits', '7707083894'],
    ['a wrong first check digit of 12 digits', '500100732269'],
    ['a wrong second check digit of 12 digits', '500100732258'],
    ['9 digits', '770708389'],
    ['11 digits', '77070838930'],
    ['13 digits', '7707083893000'],
    ['letters', '77070838a3'],
    ['an empty string', ''],
    ['spaces', '7707 83893'],
  ])('rejects %s', (_name, inn) => {
    expect(isValidInn(inn)).toBe(false);
  });
});

describe('innKind', () => {
  it('tells a legal entity from an individual by the length', () => {
    expect(innKind('7707083893')).toBe('legal');
    expect(innKind('500100732259')).toBe('individual');
  });
});

describe('isOgrnFormat', () => {
  it.each(['1027700132195', '304500116000157'])('accepts %s', (value) => {
    expect(isOgrnFormat(value)).toBe(true);
  });

  it.each(['102770013219', '10277001321950', '102770013219a', ''])('rejects %s', (value) => {
    expect(isOgrnFormat(value)).toBe(false);
  });
});

describe('okvedMatches', () => {
  it.each(['56', '56.10', '56.30', '10.71', '10.72', '47.24'])('treats %s as catering', (okved) => {
    expect(okvedMatches(okved)).toBe(true);
  });

  it.each(['47.11', '10.7', '10.73', '560', '62.01', ''])('does not treat %s as catering', (okved) => {
    expect(okvedMatches(okved)).toBe(false);
  });

  it('does not match a missing code', () => {
    expect(okvedMatches(null)).toBe(false);
  });
});
