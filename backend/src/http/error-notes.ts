export const ERROR_NOTES = {
  validationFailed: 'validation_failed (400): исправьте поля, перечисленные в errors.',
  consentRequired:
    'consent_required (403): нет согласия на обработку данных, покажите его текст из GET /api/v1/consents и отправьте PUT /api/v1/consents/personal_data.',
  userNotFound: 'user_not_found (404): аккаунт удалён, войдите заново.',
  mealNotFound: 'meal_not_found (404): записи нет или она принадлежит другому пользователю.',
  eatenAtOutOfRange:
    'eaten_at_out_of_range (422): время приёма пищи должно быть не раньше чем 7 дней назад и не позже чем через 5 минут.',
} as const;

export function describeErrors(...notes: string[]): string {
  return `Коды ошибок: ${notes.join(' ')}`;
}
