function jwtPayload(key) {
  try {
    const parts = key.split('.');
    if (parts.length !== 3 || parts.some((part) => !part)) throw new Error();
    const encoded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error();
    return payload;
  } catch {
    throw new Error('请使用数据服务控制台提供的公开 Key');
  }
}

// Shared by Vite's browser entry and the production build check. Never include a key in errors.
export function validatePublicConfig(env) {
  const mode = env.VITE_DATA_MODE ?? 'demo';
  if (!['demo', 'supabase', 'cloudbase'].includes(mode))
    throw new Error('VITE_DATA_MODE 必须是 demo、supabase 或 cloudbase');
  // Validate configured backup services too: their public fields may appear in browser chunks.
  if (mode === 'supabase' || env.VITE_SUPABASE_ANON_KEY) {
    if (!env.VITE_SUPABASE_URL?.startsWith('https://') || !env.VITE_SUPABASE_ANON_KEY)
      throw new Error('正式模式需配置 HTTPS Supabase URL 及公开密钥');
    const key = env.VITE_SUPABASE_ANON_KEY;
    if (key.startsWith('sb_secret_')) throw new Error('禁止将 Supabase secret key 放入前端');
    if (!key.startsWith('sb_publishable_') && jwtPayload(key).role !== 'anon')
      throw new Error('前端只允许 anon / publishable key，不能使用 service_role');
  }
  if (mode === 'cloudbase' || env.VITE_CLOUDBASE_PUBLISHABLE_KEY) {
    const id = env.VITE_CLOUDBASE_ENV_ID?.trim();
    const region = env.VITE_CLOUDBASE_REGION?.trim() || 'ap-shanghai';
    const accessKey = env.VITE_CLOUDBASE_PUBLISHABLE_KEY?.trim();
    if (!id || !accessKey) throw new Error('正式模式需配置 CloudBase 环境 ID 及 Publishable Key');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]+$/.test(id) || !/^[a-z]{2}-[a-z]+(?:-\d+)?$/.test(region))
      throw new Error('请检查 CloudBase 环境 ID 及地域');
    const payload = jwtPayload(accessKey);
    if (
      payload.role !== 'anon' ||
      payload.sub !== 'anon' ||
      payload.is_system_admin === true ||
      (payload.roles !== undefined &&
        (!Array.isArray(payload.roles) || payload.roles.some((role) => role !== 'anon')))
    )
      throw new Error('CloudBase 前端只允许匿名 Publishable Key，禁止管理员或服务端密钥');
    if (
      payload.aud !== id ||
      (payload.project_id !== undefined && payload.project_id !== id) ||
      payload.iss !== `https://${id}.${region}.tcb-api.tencentcloudapi.com`
    )
      throw new Error('CloudBase 公开 Key 的环境或 HTTPS 签发地址不匹配');
    if (mode === 'cloudbase') return { mode, cloudbase: { env: id, region, accessKey } };
  }
  return { mode };
}
