export const MEAL_FORMS = ['приём', 'приёма', 'приёмов'] as const;

export function plural(count: number, forms: readonly [one: string, few: string, many: string]): string {
  const [one, few, many] = forms;
  const lastDigit = count % 10;
  const lastTwoDigits = count % 100;
  if (lastDigit === 1 && lastTwoDigits !== 11) return one;
  if (lastDigit >= 2 && lastDigit <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14)) return few;
  return many;
}
