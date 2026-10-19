export const ROLES = ['owner', 'manager', 'cashier'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'venue.view',
  'booking.redeem',
  'menu.edit',
  'deal.edit',
  'analytics.view',
  'venue.edit',
  'venue.create',
  'team.invite',
  'team.manage',
  'company.edit',
  'integration.manage',
  'audit.view',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const MANAGER_PERMISSIONS = [
  'venue.view',
  'booking.redeem',
  'menu.edit',
  'deal.edit',
  'analytics.view',
  'venue.edit',
  'team.invite',
  'team.manage',
  'audit.view',
] as const satisfies readonly Permission[];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  manager: MANAGER_PERMISSIONS,
  cashier: ['venue.view', 'booking.redeem'],
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function rolesWith(permission: Permission): Role[] {
  return ROLES.filter((role) => can(role, permission));
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function canInviteRole(role: Role, invited: Role): boolean {
  if (role === 'owner') return true;
  return role === 'manager' && invited === 'cashier';
}

export function canManageRole(role: Role, target: Role): boolean {
  if (role === 'owner') return true;
  return role === 'manager' && target === 'cashier';
}
