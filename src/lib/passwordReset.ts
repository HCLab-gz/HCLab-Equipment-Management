import type { DataService } from './types';
import { registrationPasswordError } from './registration';

export interface PasswordResetChallenge {
  email: string;
  complete(code: string, password: string): Promise<void>;
}

export function resetEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error('请输入有效的注册邮箱');
  return email;
}

export function validateResetPassword(code: string, password: string, mode: DataService['mode']) {
  if (!/^\d{6}$/.test(code.trim())) throw new Error('请输入邮件中的 6 位验证码');
  const error = registrationPasswordError(password, mode);
  if (error) throw new Error(error);
}

export function passwordResetError(error: unknown): Error {
  const e = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  const category = String(e.category ?? ''),
    code = String(e.code ?? '');
  const message = String(e.message ?? e.error_description ?? '').toLowerCase();
  if (category === 'RATE_LIMITED' || code === 'resource_exhausted')
    return new Error('验证码请求过于频繁，请稍后重试');
  if (
    category === 'PROVIDER_NOT_ENABLED' ||
    /smtp|sender.*config|provider.*not.*enabled/.test(message)
  )
    return new Error('邮箱找回服务尚未配置完成，请联系管理员');
  if (['CAPTCHA_REQUIRED', 'CAPTCHA_INVALID'].includes(category))
    return new Error('发送验证码需要额外安全验证，请稍后重试或联系管理员');
  if (
    category === 'USER_NOT_FOUND' ||
    code === 'not_found' ||
    /账号不存在|用户不存在|未注册/.test(message)
  )
    return new Error('暂时无法发送验证码，请核对注册邮箱或联系管理员');
  if (
    ['VERIFICATION_FAILED', 'INVALID_CREDENTIALS'].includes(category) ||
    /verification|验证码|expired|过期/.test(message)
  )
    return new Error('验证码不正确或已过期，请重新获取后再试');
  if (/password|密码/.test(message)) return new Error('新密码未被接受，请检查密码要求后重试');
  return new Error('密码找回服务暂时不可用，请稍后重试');
}
