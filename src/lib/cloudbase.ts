import cloudbase from '@cloudbase/js-sdk';
import type { generatePGClient } from '@cloudbase/js-sdk/mysql';
import { readBrowserConfig } from './browserConfig';
import { registrationPasswordError } from './registration';
import type { DataService, Profile, Snapshot } from './types';

class SessionInvalidError extends Error {}

function serviceError(error: unknown, operation: 'auth' | 'data' | 'register' | 'image') {
  const e = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  if (
    [
      'PGRST301',
      'PGRST302',
      'invalid_grant',
      'invalid_token',
      'login_required',
      'unauthenticated',
    ].includes(String(e.code)) ||
    e.errorCode === 16
  )
    return new SessionInvalidError('登录状态已失效，请重新登录');
  if (operation === 'auth') {
    if (['INVALID_CREDENTIALS', 'USER_NOT_FOUND'].includes(String(e.category)))
      return new Error('邮箱或密码不正确');
    if (e.category === 'RATE_LIMITED') return new Error('登录请求过于频繁，请稍后重试');
    if (e.category === 'USER_STATUS_ABNORMAL') return new Error('账号已停用，请联系管理员');
    if (['CAPTCHA_REQUIRED', 'CAPTCHA_INVALID', 'MFA_REQUIRED'].includes(String(e.category)))
      return new Error('登录需要额外验证，请联系管理员检查认证设置');
    return new Error('认证服务暂时不可用，请稍后重试');
  }
  if (e.code === 'P0001' && typeof e.message === 'string' && /[\u3400-\u9fff]/.test(e.message))
    return new Error(e.message);
  if (e.code === '42501') return new Error('没有执行此操作的权限，请确认登录账号');
  return new Error(
    operation === 'register'
      ? '注册服务暂时不可用，请稍后重试'
      : operation === 'image'
        ? '图片上传失败，请稍后重试或联系管理员'
        : '数据服务暂时不可用，请稍后重试',
  );
}

async function request<T>(
  action: () => PromiseLike<T>,
  operation: Parameters<typeof serviceError>[1],
): Promise<T> {
  try {
    const result = await action();
    if (result && typeof result === 'object' && 'error' in result && result.error)
      throw result.error;
    return result;
  } catch (error) {
    throw serviceError(error, operation);
  }
}

async function usernameForEmail(email: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(email.trim().toLowerCase()),
  );
  return (
    'hclab_' +
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      // Native password sign-in accepts at most 48 characters, including the prefix.
      .slice(0, 40)
  );
}

export function createCloudBaseService(): DataService {
  const config = readBrowserConfig();
  if (config.mode !== 'cloudbase') throw new Error('CloudBase 数据服务尚未配置');
  const app = cloudbase.init(config.cloudbase);
  // SDK 3.9.3 exposes a PG client at runtime but declares rdb() as MySQL.
  // Verify the capability before applying the SDK's actual PG return type.
  const candidate: unknown = app.rdb();
  if (
    !candidate ||
    typeof candidate !== 'object' ||
    !('rpc' in candidate) ||
    typeof candidate.rpc !== 'function'
  )
    throw new Error('当前 CloudBase SDK 未提供 PostgreSQL RPC，请联系管理员');
  const db = candidate as ReturnType<ReturnType<typeof generatePGClient>>;

  async function rpc<T = void>(name: string, args?: Record<string, unknown>): Promise<T> {
    try {
      const { data } = await request(() => db.rpc(name, args), 'data');
      return data as T;
    } catch (error) {
      if (error instanceof SessionInvalidError) await logout().catch(() => {});
      throw error;
    }
  }
  async function logout() {
    // Passing {} makes SDK 3.9.3 clear local credentials even if remote signout fails.
    await request(() => app.auth.signOut({}), 'auth');
  }
  async function profile(): Promise<Profile | null> {
    try {
      const {
        data: { session },
      } = await request(() => app.auth.getSession(), 'auth');
      if (!session) return null;
      if (!session.user?.id || session.user.id === 'anon' || session.user.is_anonymous) {
        await logout();
        return null;
      }
      const snapshot = await rpc<Snapshot>('get_snapshot');
      const user = snapshot.profiles.find(
        (item) =>
          item.id === session.user.id && ['user', 'admin', 'super_admin'].includes(item.role),
      );
      if (!user) throw new SessionInvalidError('账号注册资料不完整，请完成准入注册或联系管理员');
      return user;
    } catch (error) {
      if (error instanceof SessionInvalidError) await logout().catch(() => {});
      throw error;
    }
  }
  async function login(email: string, password: string) {
    try {
      const username = await usernameForEmail(email);
      await request(() => app.auth.signInWithPassword({ username, password }), 'auth');
      const user = await profile();
      if (!user) throw new Error('登录未完成，请重新登录');
      return user;
    } catch (error) {
      await logout().catch(() => {});
      throw error;
    }
  }
  return {
    mode: 'cloudbase',
    session: profile,
    login,
    logout,
    onSessionInvalidated(callback) {
      const {
        data: { subscription },
      } = app.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') callback();
      });
      return () => subscription.unsubscribe();
    },
    snapshot: () => rpc<Snapshot>('get_snapshot'),
    startExam: (email) => rpc('start_exam', { p_email: email.trim().toLowerCase() }),
    submitExam: (id, answers) => rpc('submit_exam', { p_id: id, p_answers: answers }),
    async register(input) {
      const passwordError = registrationPasswordError(input.password, 'cloudbase');
      if (passwordError) throw new Error(passwordError);
      let result: unknown;
      try {
        const response = await app.callFunction({
          name: 'hclab-register',
          data: { ...input, email: input.email.trim().toLowerCase() },
        });
        result =
          typeof response.result === 'string' ? JSON.parse(response.result) : response.result;
      } catch (error) {
        throw serviceError(error, 'register');
      }
      if (!result || typeof result !== 'object' || !('ok' in result))
        throw new Error('注册服务返回异常，请稍后重试');
      if (result.ok !== true) {
        const message =
          'error' in result &&
          typeof result.error === 'string' &&
          /[\u3400-\u9fff]/.test(result.error)
            ? result.error
            : '注册服务暂时不可用，请稍后重试';
        throw new Error(message);
      }
      const user = await login(input.email, input.password);
      return {
        needsConfirmation: false,
        ...(user.membership_status !== 'approved' ? { needsApproval: true } : {}),
      };
    },
    async reviewMembership(id, action, note = '') {
      await rpc('review_membership', { p_id: id, p_action: action, p_note: note });
    },
    async saveEquipment(input) {
      await rpc('save_equipment_result', { p_data: input });
    },
    async uploadImage(file) {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2097152)
        throw new Error('仅支持 2 MB 以内的 JPG、PNG、WebP 图片');
      const extension =
        file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp';
      const path = `${crypto.randomUUID()}.${extension}`;
      const bucket = app.storage.from('equipment-images');
      await request(
        () => bucket.upload(path, file, { contentType: file.type, upsert: false }),
        'image',
      );
      return bucket.getPublicUrl(path).data.publicUrl;
    },
    async book(input) {
      await rpc('create_booking_result', { p_data: input });
    },
    async bookingAction(id, action, note = '') {
      await rpc('booking_action', { p_id: id, p_action: action, p_note: note });
    },
    async markRead() {
      await rpc('mark_notices_read');
    },
    async recordViolation(userId, reason) {
      await rpc('record_violation', { p_user_id: userId, p_reason: reason });
    },
  };
}
