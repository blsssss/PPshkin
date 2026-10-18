export type AuditAction =
  | 'booking.redeem'
  | 'deal.create'
  | 'deal.update'
  | 'deal.cancel'
  | 'menu_item.create'
  | 'menu_item.update'
  | 'menu_item.archive'
  | 'menu_import.apply'
  | 'venue.update';

export type AuditTarget = 'booking' | 'deal' | 'menu_item' | 'menu_import' | 'venue' | 'staff';

export type AuditChannel = 'bot' | 'miniapp';

export const AUDIT_PAGE_SIZE = 100;

export function changedFields(patch: object): string[] {
  return Object.entries(patch)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key)
    .sort();
}
