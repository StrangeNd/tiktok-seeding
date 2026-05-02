import { loadEnv } from '@app/shared';

export type UserRole = 'admin' | 'user';
export type Permission =
  | 'users:manage'
  | 'audit:view_all'
  | 'logs:view'
  | 'accounts:import'
  | 'accounts:view'
  | 'accounts:view_masked'
  | 'proxies:import'
  | 'proxies:view'
  | 'proxies:view_masked'
  | 'orders:create'
  | 'orders:view'
  | 'jobs:view'
  | 'dashboard:view'
  | 'admin:recovery'
  | 'backup:view_docs'
  | 'settings:view';

const adminPermissions: Permission[] = [
  'users:manage',
  'audit:view_all',
  'logs:view',
  'accounts:import',
  'accounts:view',
  'accounts:view_masked',
  'proxies:import',
  'proxies:view',
  'proxies:view_masked',
  'orders:create',
  'orders:view',
  'jobs:view',
  'dashboard:view',
  'admin:recovery',
  'backup:view_docs',
  'settings:view',
];

const userPermissions: Permission[] = [
  'logs:view',
  'accounts:import',
  'accounts:view_masked',
  'proxies:view_masked',
  'orders:create',
  'orders:view',
  'jobs:view',
  'dashboard:view',
];

export function permissionsForRole(role: UserRole): Permission[] {
  if (role === 'admin') return adminPermissions;
  const env = loadEnv();
  return env.USER_CAN_IMPORT_PROXIES ? [...userPermissions, 'proxies:import'] : userPermissions;
}

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return permissionsForRole(role).includes(permission);
}
