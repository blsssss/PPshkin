export type AuditAction =
  | 'booking.redeem'
  | 'deal.create'
  | 'deal.update'
  | 'deal.cancel'
  | 'menu_item.create'
  | 'menu_item.update'
  | 'menu_item.archive'
  | 'menu_import.apply'
  | 'venue.update'
  | 'staff.invite'
  | 'staff.invite_revoke'
  | 'staff.join'
  | 'staff.role_change'
  | 'staff.remove'
  | 'admin.company.verify'
  | 'admin.company.reject'
  | 'admin.company.invite'
  | 'admin.complaint.resolve'
  | 'admin.venue.block'
  | 'admin.venue.unblock'
  | 'admin.user.block'
  | 'admin.user.unblock';

export type AuditTarget =
  'booking' | 'deal' | 'menu_item' | 'menu_import' | 'venue' | 'staff' | 'complaint' | 'user' | 'company';

export type AuditChannel = 'bot' | 'miniapp' | 'api';

export const AUDIT_PAGE_SIZE = 100;

export function changedFields(patch: object): string[] {
  return Object.entries(patch)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key)
    .sort();
}
