import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const envId = 'hclab-equipments-d0ehkkk05991a35';
function publicKey(overrides: Record<string, unknown> = {}) {
  const payload = {
    iss: `https://${envId}.ap-shanghai.tcb-api.tencentcloudapi.com`,
    sub: 'anon',
    aud: envId,
    role: 'anon',
    is_system_admin: false,
    ...overrides,
  };
  return `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.test-signature`;
}
function environment(key = publicKey()) {
  return {
    ...process.env,
    VITE_DATA_MODE: 'cloudbase',
    VITE_CLOUDBASE_ENV_ID: envId,
    VITE_CLOUDBASE_REGION: '',
    VITE_CLOUDBASE_PUBLISHABLE_KEY: key,
  };
}
describe('前端构建公开配置', () => {
  it('接受 CloudBase 匿名公开 Key，默认上海且不输出 Key', () => {
    const key = publicKey();
    const out = execFileSync(process.execPath, ['scripts/check-config.mjs'], {
      env: environment(key),
      encoding: 'utf8',
    });
    expect(out).toContain('CloudBase');
    expect(out).not.toContain(key);
  });
  it.each([
    { role: 'service_role' },
    { role: 'admin' },
    { is_system_admin: true },
    { sub: 'administrator' },
    { aud: 'another-environment' },
    { iss: `http://${envId}.ap-shanghai.tcb-api.tencentcloudapi.com` },
    { iss: `https://${envId}.ap-shanghai.tcb-api.tencentcloudapi.com.attacker.invalid` },
    { project_id: 'another-environment' },
  ])('拒绝权限或所属环境不匹配的 Key %j', (claims) => {
    const key = publicKey(claims);
    const result = spawnSync(process.execPath, ['scripts/check-config.mjs'], {
      env: environment(key),
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).not.toContain(key);
  });
  it('缺少公开 Key 不能构建正式模式', () => {
    const result = spawnSync(process.execPath, ['scripts/check-config.mjs'], {
      env: environment(''),
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
  });
  it('演示模式保持可构建', () => {
    const result = spawnSync(process.execPath, ['scripts/check-config.mjs'], {
      env: { ...environment(''), VITE_DATA_MODE: 'demo' },
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
  });
  it.each(['demo', 'supabase'])('备用 CloudBase 配置含管理员 Key 时 %s 模式也拒绝打包', (mode) => {
    const result = spawnSync(process.execPath, ['scripts/check-config.mjs'], {
      env: {
        ...environment(publicKey({ role: 'admin' })),
        VITE_DATA_MODE: mode,
        VITE_SUPABASE_URL: 'https://project.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'sb_publishable_example',
      },
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
  });
});
