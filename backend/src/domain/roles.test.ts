import { describe, expect, it } from 'vitest';
import {
  can,
  canInviteRole,
  canManageRole,
  PERMISSIONS,
  rolesWith,
  ROLE_PERMISSIONS,
  ROLES,
  type Permission,
  type Role,
} from './roles.ts';

const MATRIX: Record<Permission, readonly Role[]> = {
  'venue.view': ['owner', 'manager', 'cashier'],
  'booking.redeem': ['owner', 'manager', 'cashier'],
  'menu.edit': ['owner', 'manager'],
  'deal.edit': ['owner', 'manager'],
  'analytics.view': ['owner', 'manager'],
  'venue.edit': ['owner', 'manager'],
  'venue.create': ['owner'],
  'team.invite': ['owner', 'manager'],
  'team.manage': ['owner', 'manager'],
  'company.edit': ['owner'],
  'integration.manage': ['owner'],
  'audit.view': ['owner', 'manager'],
};

describe('role permissions', () => {
  it('lists every permission in the matrix', () => {
    expect(Object.keys(MATRIX).sort()).toEqual([...PERMISSIONS].sort());
  });

  it.each(PERMISSIONS.flatMap((permission) => ROLES.map((role) => [permission, role] as const)))(
    'answers %s for %s as the matrix says',
    (permission, role) => {
      expect(can(role, permission)).toBe(MATRIX[permission].includes(role));
    },
  );

  it('gives the owner everything and the cashier only the counter', () => {
    expect(ROLE_PERMISSIONS.owner).toEqual(PERMISSIONS);
    expect(ROLE_PERMISSIONS.cashier).toEqual(['venue.view', 'booking.redeem']);
  });

  it('lists the roles that hold a permission in the order of the roles', () => {
    expect(rolesWith('booking.redeem')).toEqual(['owner', 'manager', 'cashier']);
    expect(rolesWith('menu.edit')).toEqual(['owner', 'manager']);
    expect(rolesWith('company.edit')).toEqual(['owner']);
  });
});

describe('team rules', () => {
  it('lets the owner invite and manage any role', () => {
    for (const role of ROLES) {
      expect(canInviteRole('owner', role)).toBe(true);
      expect(canManageRole('owner', role)).toBe(true);
    }
  });

  it('lets the manager invite and manage only cashiers', () => {
    expect(ROLES.filter((role) => canInviteRole('manager', role))).toEqual(['cashier']);
    expect(ROLES.filter((role) => canManageRole('manager', role))).toEqual(['cashier']);
  });

  it('lets the cashier do nothing with the team', () => {
    expect(ROLES.some((role) => canInviteRole('cashier', role))).toBe(false);
    expect(ROLES.some((role) => canManageRole('cashier', role))).toBe(false);
  });
});
