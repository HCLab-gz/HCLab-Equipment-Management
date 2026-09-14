import { loadEnv } from 'vite';
import { validatePublicConfig } from '../src/lib/publicConfig.mjs';
const env = { ...loadEnv('production', process.cwd(), ''), ...process.env };
const { mode } = validatePublicConfig(env);
console.log(
  mode === 'demo'
    ? '构建演示模式：数据仅保存在当前浏览器。'
    : `构建正式模式：已检查 ${mode === 'cloudbase' ? 'CloudBase' : 'Supabase'} 公开配置。`,
);
