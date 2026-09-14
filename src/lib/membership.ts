import type { Profile, Role } from './types';
import { accessState } from './domain';

export const ROLE_LABELS: Record<Role, string> = {
  user: '普通成员',
  admin: '管理员',
  super_admin: '超级管理员',
};
export function isApproved(user: Profile | null | undefined): user is Profile {
  return !!user && user.membership_status === 'approved';
}
export function isAdministrator(user: Profile | null | undefined): boolean {
  return isApproved(user) && ['admin', 'super_admin'].includes(user.role) && accessState(user);
}
export function isSuperAdministrator(user: Profile | null | undefined): boolean {
  return isAdministrator(user) && user?.role === 'super_admin';
}
export function accountLabel(user: Profile): string {
  if (user.membership_status === 'pending') return '注册待审核';
  if (user.membership_status === 'rejected') return '注册未通过';
  return ROLE_LABELS[user.role];
}
