import { loadEnv } from 'vite';
const env = { ...loadEnv('production', process.cwd(), ''), ...process.env };
const mode = env.VITE_DATA_MODE ?? 'demo';
if (!['demo', 'supabase'].includes(mode)) throw new Error('VITE_DATA_MODE 必须是 demo 或 supabase');
if (mode === 'supabase') {
  if (!env.VITE_SUPABASE_URL?.startsWith('https://') || !env.VITE_SUPABASE_ANON_KEY)
    throw new Error('正式模式需配置 HTTPS Supabase URL 及公开密钥');
  const key = env.VITE_SUPABASE_ANON_KEY;
  if (key.startsWith('sb_secret_')) throw new Error('禁止将 Supabase secret key 放入前端');
  if (!key.startsWith('sb_publishable_')) {
    let payload;
    try {
      payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
    } catch {
      throw new Error('请使用 Supabase publishable key 或 legacy anon key');
    }
    if (payload.role !== 'anon')
      throw new Error('前端只允许 anon / publishable key，不能使用 service_role');
  }
}
console.log(
  mode === 'demo'
    ? '构建演示模式：数据仅保存在当前浏览器。'
    : '构建正式模式：已检查 Supabase 公开配置。',
);
