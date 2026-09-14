import type { DataService } from './types';
import { readBrowserConfig } from './browserConfig';
export async function loadService(): Promise<DataService> {
  const { mode } = readBrowserConfig();
  if (mode === 'cloudbase') {
    const { createCloudBaseService } = await import('./cloudbase');
    return createCloudBaseService();
  }
  if (mode === 'supabase') {
    const { createSupabaseService } = await import('./supabase');
    return createSupabaseService();
  }
  if (mode === 'demo') {
    const { createDemoService } = await import('./demo');
    return createDemoService(localStorage);
  }
  throw new Error('VITE_DATA_MODE 只支持 demo、supabase 或 cloudbase，请检查部署配置');
}
