import type { DataService } from './types';

export const CLOUDBASE_PASSWORD_HINT =
  '密码须以字母或数字开头，10–32 位，并包含大写字母、小写字母、数字、符号 ()!@#$%^&*|?><_- 中至少三类';

export function registrationPasswordError(
  password: string,
  mode: DataService['mode'],
): string | null {
  if (mode === 'cloudbase') {
    const categories = [/[a-z]/, /[A-Z]/, /[0-9]/, /[()!@#$%^&*|?><_-]/];
    if (
      password.length < 10 ||
      password.length > 32 ||
      !/^[A-Za-z0-9]/.test(password) ||
      categories.filter((pattern) => pattern.test(password)).length < 3
    )
      return CLOUDBASE_PASSWORD_HINT;
  } else if (password.length < 10 || password.length > 128) {
    return '密码须为 10–128 位';
  }
  return null;
}
