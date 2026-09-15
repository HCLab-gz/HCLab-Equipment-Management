import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerMySQL, type generatePGClient } from '@cloudbase/js-sdk/mysql';
import { loadService } from '../src/lib/service';
import type { Profile, Registration } from '../src/lib/types';

const sdk = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock('@cloudbase/js-sdk', () => ({ default: sdk }));
const envId = 'hclab-equipments-d0ehkkk05991a35';
const profile: Profile = {
  id: 'native-sub-123',
  email: 'member@example.com',
  name: '成员',
  student_id: '123',
  project: 'robotics',
  role: 'user',
  membership_status: 'approved',
  banned: false,
  suspended_until: null,
  violations_count: 0,
};
const registration: Registration = {
  email: ' MEMBER@Example.com ',
  password: 'CorrectHorse123!',
  name: '成员',
  student_id: '123',
  project: 'robotics',
  token: 'exam-token',
};
let signedIn: boolean;
let profiles: Profile[];
let app: ReturnType<typeof fakeApp>;
function fakeApp() {
  const rpc = vi.fn(async (name: string) => ({
    data:
      name === 'get_snapshot'
        ? {
            equipment: [],
            bookings: [],
            profiles: signedIn ? profiles : [],
            notices: [],
            violations: [],
            busy: [],
          }
        : { id: 'exam-123', questions: [] },
    error: null as unknown,
  }));
  const bucket = {
    createSignedUrl: vi.fn(async (path: string) => ({
      data: { fullSignedURL: `https://private.example/${path}?token=short-lived` },
      error: null as unknown,
    })),
    upload: vi.fn(async () => ({ data: { path: 'image.png' }, error: null as unknown })),
    getPublicUrl: vi.fn((path: string) => ({
      data: { publicUrl: `https://images.example/${path}` },
    })),
  };
  const authListeners = new Set<(event: string) => void>();
  return {
    auth: {
      getVerification: vi.fn(async () => ({ verification_id: 'recovery-challenge' })),
      verify: vi.fn(async () => ({ verification_token: 'verified-email-token' })),
      resetPassword: vi.fn(async () => undefined),
      onAuthStateChange: vi.fn((callback: (event: string) => void) => {
        authListeners.add(callback);
        return { data: { subscription: { unsubscribe: () => authListeners.delete(callback) } } };
      }),
      getSession: vi.fn(async () => ({
        data: {
          user: signedIn ? { id: profile.id } : null,
          session: signedIn ? { user: { id: profile.id, is_anonymous: false } } : null,
        },
        error: null as unknown,
      })),
      signInWithPassword: vi.fn(async () => {
        signedIn = true;
        return { data: {}, error: null as unknown };
      }),
      signOut: vi.fn(async () => {
        signedIn = false;
        authListeners.forEach((listener) => listener('SIGNED_OUT'));
        return { data: {}, error: null };
      }),
    },
    rdb: () => ({ rpc }),
    rpc,
    bucket,
    storage: { from: vi.fn(() => bucket) },
    callFunction: vi.fn(async () => ({
      requestId: 'request-123',
      result: { ok: true } as unknown,
    })),
  };
}
beforeEach(() => {
  signedIn = false;
  profiles = [profile];
  app = fakeApp();
  sdk.init.mockReturnValue(app);
  vi.stubEnv('VITE_DATA_MODE', 'cloudbase');
  vi.stubEnv('VITE_CLOUDBASE_ENV_ID', envId);
  vi.stubEnv('VITE_CLOUDBASE_REGION', '');
  vi.stubEnv(
    'VITE_CLOUDBASE_PUBLISHABLE_KEY',
    `header.${Buffer.from(
      JSON.stringify({
        iss: `https://${envId}.ap-shanghai.tcb-api.tencentcloudapi.com`,
        sub: 'anon',
        aud: envId,
        role: 'anon',
      }),
    ).toString('base64url')}.signature`,
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('CloudBase DataService', () => {
  it('设备字段约束错误显示可操作提示，不显示服务故障或数据库行内容', async () => {
    const api = await loadService();
    app.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '23514', message: 'equipment_close_time_check', details: 'private row' },
    });
    await expect(api.saveEquipment({})).rejects.toThrow(/填写.*要求/);
  });
  it('公开配置初始化且匿名不会读取个人资料', async () => {
    const api = await loadService();
    expect(api.mode).toBe('cloudbase');
    expect(sdk.init).toHaveBeenCalledWith(
      expect.objectContaining({ env: envId, region: 'ap-shanghai', accessKey: expect.any(String) }),
    );
    expect(await api.session()).toBeNull();
    expect(app.rpc).not.toHaveBeenCalled();
  });
  it('邮箱登录转换为规范化 SHA-256 用户名，仅返回对应的平台资料', async () => {
    const api = await loadService();
    profiles = [{ ...profile, id: 'another-user', role: 'admin' }, profile];
    expect(await api.login(' MEMBER@Example.com ', 'CorrectHorse123!')).toEqual(profile);
    expect(app.auth.signInWithPassword).toHaveBeenCalledWith({
      username:
        'hclab_' + createHash('sha256').update('member@example.com').digest('hex').slice(0, 40),
      password: 'CorrectHorse123!',
    });
  });
  it('原生账号缺少平台资料会退出，不能恢复残留会话', async () => {
    const api = await loadService();
    profiles = [{ ...profile, id: 'another-user', role: 'admin' }];
    await expect(api.login(profile.email, 'CorrectHorse123!')).rejects.toThrow(/资料|注册/);
    expect(app.auth.signOut).toHaveBeenCalledWith({});
    expect(await api.session()).toBeNull();
  });
  it('认证失败也清除之前的登录态，并隐藏 SDK 内部错误', async () => {
    const api = await loadService();
    signedIn = true;
    app.auth.signInWithPassword.mockResolvedValueOnce({
      data: {},
      error: { category: 'INVALID_CREDENTIALS', message: 'internal username' },
    });
    await expect(api.login(profile.email, 'wrong')).rejects.toThrow('邮箱或密码不正确');
    expect(await api.session()).toBeNull();
  });
  it.each(['session', 'snapshot'])('临时 %s 读取失败不会撤销原生登录凭据', async (stage) => {
    const api = await loadService();
    signedIn = true;
    if (stage === 'session')
      app.auth.getSession.mockRejectedValueOnce(new TypeError('fetch failed'));
    else
      app.rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'temporary' } });
    await expect(api.session()).rejects.toThrow(/暂时不可用/);
    expect(app.auth.signOut).not.toHaveBeenCalled();
    expect(await api.session()).toEqual(profile);
  });
  it('确认 token 失效会撤销原生凭据', async () => {
    const api = await loadService();
    signedIn = true;
    app.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST301', message: 'JWT expired' },
    });
    await expect(api.session()).rejects.toThrow('登录状态已失效');
    expect(app.auth.signOut).toHaveBeenCalledWith({});
    expect(await api.session()).toBeNull();
  });
  it('写入时确认 token 失效会立即通知清缓存，取消订阅后不再通知', async () => {
    const api = await loadService();
    const clearCachedState = vi.fn();
    const unsubscribe = api.onSessionInvalidated!(clearCachedState);
    signedIn = true;
    app.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST301', message: 'JWT expired' },
    });
    await expect(
      api.book({ equipment_id: 'eq', starts_at: '', ends_at: '', purpose: '实验' }),
    ).rejects.toThrow('登录状态已失效');
    expect(clearCachedState).toHaveBeenCalledTimes(1);
    unsubscribe();
    await api.logout();
    expect(clearCachedState).toHaveBeenCalledTimes(1);
  });
  it.each([{ ok: true }, JSON.stringify({ ok: true })])(
    '云函数完成注册才登录，不需要邮箱验证码',
    async (result) => {
      const api = await loadService();
      app.callFunction.mockResolvedValueOnce({ requestId: 'request-123', result });
      expect(await api.register(registration)).toEqual({ needsConfirmation: false });
      expect(app.callFunction).toHaveBeenCalledWith({
        name: 'hclab-register',
        data: { ...registration, email: 'member@example.com' },
      });
      expect(await api.session()).toEqual(profile);
    },
  );
  it.each([
    { result: { ok: false, error: '考试凭证已过期，请重新考试' }, error: /考试凭证已过期/ },
    { result: { unexpected: true }, error: /注册服务/ },
    { result: '{bad-json', error: /注册服务/ },
  ])('云函数失败或结果异常时不登录 $result', async ({ result, error }) => {
    const api = await loadService();
    app.callFunction.mockResolvedValueOnce({ requestId: 'request-123', result });
    await expect(api.register(registration)).rejects.toThrow(error);
    expect(app.auth.signInWithPassword).not.toHaveBeenCalled();
  });
  it.each(['Short123!', '!CorrectHorse123', 'lowercase1234', 'Ab1' + 'x'.repeat(30)])(
    '注册前拒绝不符合原生认证规则的密码 %s',
    async (password) => {
      const api = await loadService();
      await expect(api.register({ ...registration, password })).rejects.toThrow(/密码/);
      expect(app.callFunction).not.toHaveBeenCalled();
    },
  );
  it('业务异常保留可操作提示，底层异常不会泄漏内部数据', async () => {
    const api = await loadService();
    app.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: '该时段已有预约，请选择其他时间' },
    });
    await expect(
      api.book({ equipment_id: 'eq', starts_at: '', ends_at: '', purpose: '实验' }),
    ).rejects.toThrow('该时间已被预约');
    app.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'XX000', message: 'private SQL details' },
    });
    await expect(api.snapshot()).rejects.toThrow('数据服务暂时不可用');
  });
  it('腾讯云真实 SDK 的 DATABASE_P0001 时间冲突显示指定提示', async () => {
    let factory: (() => ReturnType<ReturnType<typeof generatePGClient>>) | undefined;
    const nativeApp = {
      config: { env: envId },
      request: {
        fetch: async () => ({
          statusCode: 400,
          data: {
            code: 'DATABASE_P0001',
            message: '该时段已有预约，请选择其他时间',
            requestId: 'regression-request',
          },
          header: { 'Content-Type': 'application/json' },
        }),
      },
      getEndPointWithKey: () => ({
        BASE_URL: `${envId}.api.tcloudbasegateway.com/v1`,
        PROTOCOL: 'https://',
      }),
      registerComponent(component: { name: string; entity: { rdb?: () => unknown } }) {
        if (component.name === 'rdb')
          factory = component.entity.rdb!.bind(nativeApp) as typeof factory;
      },
    };
    registerMySQL(nativeApp as unknown as Parameters<typeof registerMySQL>[0]);
    sdk.init.mockReturnValue({ ...app, rdb: factory });
    const api = await loadService();
    await expect(
      api.book({
        equipment_id: 'eq',
        starts_at: '2099-01-05T09:00+08:00',
        ends_at: '2099-01-05T10:00+08:00',
        purpose: '冲突测试',
      }),
    ).rejects.toThrow(/^该时间已被预约$/);
    expect(app.auth.signOut).not.toHaveBeenCalled();
  });
  it('带 DATABASE 前缀的其他业务错误仍保留原本提示', async () => {
    const api = await loadService();
    app.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'DATABASE_P0001', message: '预约开始时间必须晚于当前时间' },
    });
    await expect(
      api.book({ equipment_id: 'eq', starts_at: '', ends_at: '', purpose: '实验' }),
    ).rejects.toThrow('预约开始时间必须晚于当前时间');
  });
  it('将考试参数发送到 PostgreSQL RPC 并规范化邮箱', async () => {
    const api = await loadService();
    await api.startExam(' MEMBER@Example.com ');
    expect(app.rpc).toHaveBeenCalledWith('start_exam', { p_email: 'member@example.com' });
    await api.submitExam('exam-123', { 2: 1 });
    expect(app.rpc).toHaveBeenCalledWith('submit_exam', { p_id: 'exam-123', p_answers: { 2: 1 } });
  });
  it.each(['book', 'saveEquipment'] as const)(
    '%s 使用真实 SDK 可解析的对象结果接口',
    async (operation) => {
      const uuid = 'db121933-7d76-4fd3-9353-4ea3a7e9ff21';
      const input =
        operation === 'book'
          ? {
              equipment_id: uuid,
              starts_at: '2026-09-15T09:00:00+08:00',
              ends_at: '2026-09-15T09:30:00+08:00',
              purpose: 'SDK 预约验证',
              parent_id: undefined,
            }
          : { id: uuid, name: 'SDK 设备验证' };
      const nativeFetch = vi.fn(async ({ url }: { url: string; body?: string }) => ({
        statusCode: 200,
        // This is the parsed response from the actual SDK transport, not a mock rpc().
        data: url.endsWith('_result') ? { id: uuid } : uuid,
        header: { 'Content-Type': 'application/json' },
      }));
      let rdb!: () => ReturnType<ReturnType<typeof generatePGClient>>;
      const nativeApp = {
        config: { env: envId },
        request: { fetch: nativeFetch },
        getEndPointWithKey: () => ({
          BASE_URL: `${envId}.api.tcloudbasegateway.com/v1`,
          PROTOCOL: 'https://',
        }),
        registerComponent(component: { name: string; entity: { rdb?: () => unknown } }) {
          if (component.name === 'rdb') rdb = component.entity.rdb!.bind(nativeApp) as typeof rdb;
        },
      };
      registerMySQL(nativeApp as unknown as Parameters<typeof registerMySQL>[0]);
      // Pin the SDK 3.9.3 failure: scalar UUIDs are parsed twice and report failure after a write.
      const legacy = await rdb().rpc('legacy_uuid_result_scalar');
      expect(legacy.error?.message).toMatch(/SyntaxError|JSON/);
      nativeFetch.mockClear();
      sdk.init.mockReturnValue({ ...app, rdb });
      const api = await loadService();
      if (operation === 'book') await api.book(input as Parameters<typeof api.book>[0]);
      else await api.saveEquipment(input);
      expect(nativeFetch).toHaveBeenCalledTimes(1);
      const request = nativeFetch.mock.calls[0][0];
      expect(request.url).toBe(
        `https://${envId}.api.tcloudbasegateway.com/v1/rdb/rest/rpc/${operation === 'book' ? 'create_booking_result' : 'save_equipment_result'}`,
      );
      expect(JSON.parse(request.body!)).toEqual({ p_data: JSON.parse(JSON.stringify(input)) });
      expect(app.rpc).not.toHaveBeenCalled();
    },
  );
  it('图片上传验证类型大小并返回原生桶的公开 URL', async () => {
    const api = await loadService();
    await expect(
      api.uploadImage(new File(['bad'], 'bad.svg', { type: 'image/svg+xml' })),
    ).rejects.toThrow('2 MB');
    const file = new File(['image'], 'photo.png', { type: 'image/png' });
    const url = await api.uploadImage(file);
    expect(app.storage.from).toHaveBeenCalledWith('equipment-images');
    expect(app.bucket.upload).toHaveBeenCalledWith(
      expect.stringMatching(/^[a-f0-9-]+\.png$/),
      file,
      { contentType: 'image/png', upsert: false },
    );
    expect(url).toMatch(/^https:\/\/images.example\/[a-f0-9-]+\.png$/);
  });
  it('归还照片上传至预约专属私有路径，查看使用签名地址，归还提交绑定路径', async () => {
    const api = await loadService();
    const id = '10000000-0000-0000-0000-000000000001';
    const file = new File(['image'], 'return.png', { type: 'image/png' });
    const path = await api.uploadReturnPhoto(id, file);
    expect(path).toMatch(new RegExp(`^${id}/[a-f0-9-]+\\.png$`));
    expect(app.storage.from).toHaveBeenCalledWith('return-photos');
    expect(app.bucket.upload).toHaveBeenCalledWith(path, file, {
      contentType: 'image/png',
      upsert: false,
    });
    expect(app.bucket.getPublicUrl).not.toHaveBeenCalled();
    expect(await api.returnPhotoUrl(path)).toMatch(/^https:\/\/private.example\//);
    expect(app.bucket.createSignedUrl).toHaveBeenCalledWith(path, 600);
    await api.bookingAction(id, 'return', '外观正常', path);
    expect(app.rpc).toHaveBeenCalledWith('booking_action', {
      p_id: id,
      p_action: 'return',
      p_note: '外观正常',
      p_return_photo: path,
    });
    await expect(
      api.uploadReturnPhoto(id, new File(['bad'], 'bad.svg', { type: 'image/svg+xml' })),
    ).rejects.toThrow(/图片/);
  });
});
it('超级管理员可登录；待审核申请保留查询会话并提示审核', async () => {
  const api = await loadService();
  profiles = [{ ...profile, role: 'super_admin', membership_status: 'approved' }];
  expect((await api.login(profile.email, 'CorrectHorse123!')).role).toBe('super_admin');
  profiles = [{ ...profile, membership_status: 'pending' }];
  expect(await api.register({ ...registration, requested_role: 'admin' })).toMatchObject({
    needsConfirmation: false,
    needsApproval: true,
  });
  expect(await api.session()).toMatchObject({ membership_status: 'pending' });
  await api.reviewMembership('request-123', 'reject', '无法核实身份');
  expect(app.rpc).toHaveBeenLastCalledWith('review_membership', {
    p_id: 'request-123',
    p_action: 'reject',
    p_note: '无法核实身份',
  });
});

it('邮箱找回只发送原生 recovery 验证码，完成后修改原账号密码且不自动登录', async () => {
  const api = await loadService();
  const challenge = await api.requestPasswordReset!(' MEMBER@Example.com ');
  expect(challenge.email).toBe('member@example.com');
  expect(app.auth.getVerification).toHaveBeenCalledWith({
    email: 'member@example.com',
    usage: 'recovery',
    target: 'USER',
  });
  expect(app.auth.resetPassword).not.toHaveBeenCalled();
  await challenge.complete('123456', 'NewSecure123!');
  expect(app.auth.verify).toHaveBeenCalledWith({
    verification_id: 'recovery-challenge',
    verification_code: '123456',
  });
  expect(app.auth.resetPassword).toHaveBeenCalledWith({
    email: 'member@example.com',
    new_password: 'NewSecure123!',
    verification_token: 'verified-email-token',
  });
  expect(app.auth.signInWithPassword).not.toHaveBeenCalled();
  expect(app.rpc).not.toHaveBeenCalled();
  expect(app.callFunction).not.toHaveBeenCalled();
  expect(app.auth.signOut).toHaveBeenCalled();
  await expect(challenge.complete('123456', 'AgainSecure123!')).rejects.toThrow('密码已重置');
  expect(app.auth.resetPassword).toHaveBeenCalledTimes(1);
});
it('验证码验证失败时绝不修改密码或创建账号', async () => {
  const api = await loadService();
  const challenge = await api.requestPasswordReset!('member@example.com');
  app.auth.verify.mockRejectedValueOnce({
    code: 'invalid_argument',
    message: 'verification code expired',
  });
  await expect(challenge.complete('000000', 'NewSecure123!')).rejects.toThrow(
    '验证码不正确或已过期',
  );
  expect(app.auth.resetPassword).not.toHaveBeenCalled();
  expect(app.auth.signInWithPassword).not.toHaveBeenCalled();
  expect(app.callFunction).not.toHaveBeenCalled();
});
it('无效邮箱、验证码和弱密码在调用服务前拒绝', async () => {
  const api = await loadService();
  await expect(api.requestPasswordReset!('not-an-email')).rejects.toThrow('有效');
  expect(app.auth.getVerification).not.toHaveBeenCalled();
  const challenge = await api.requestPasswordReset!('member@example.com');
  await expect(challenge.complete('123', 'NewSecure123!')).rejects.toThrow('6 位');
  await expect(challenge.complete('123456', 'weak')).rejects.toThrow('密码须');
  expect(app.auth.verify).not.toHaveBeenCalled();
  expect(app.auth.resetPassword).not.toHaveBeenCalled();
});
it('发信限流和未配置时显示中文错误，不回显服务内部信息', async () => {
  const api = await loadService();
  app.auth.getVerification.mockRejectedValueOnce({
    code: 'resource_exhausted',
    message: 'private diagnostic',
  });
  await expect(api.requestPasswordReset!('member@example.com')).rejects.toThrow('过于频繁');
  app.auth.getVerification.mockRejectedValueOnce({ message: 'smtp is not set: secret-value' });
  await expect(api.requestPasswordReset!('member@example.com')).rejects.toThrow('尚未配置');
});
it('重置请求进行中禁止重复提交，并保留首次绑定的邮箱', async () => {
  const api = await loadService();
  const first = await api.requestPasswordReset!('first@example.com');
  await api.requestPasswordReset!('second@example.com');
  let resolve!: (value: { verification_token: string }) => void;
  app.auth.verify.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const pending = first.complete('123456', 'NewSecure123!');
  await expect(first.complete('123456', 'NewSecure123!')).rejects.toThrow('勿重复');
  resolve({ verification_token: 'first-token' });
  await pending;
  expect(app.auth.resetPassword).toHaveBeenCalledWith({
    email: 'first@example.com',
    new_password: 'NewSecure123!',
    verification_token: 'first-token',
  });
});
