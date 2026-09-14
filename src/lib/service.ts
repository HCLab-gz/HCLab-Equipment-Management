import type { DataService } from './types';
import { readBrowserConfig } from './browserConfig';
export async function loadService(): Promise<DataService> {
  readBrowserConfig();
  // Keep the mode a build-time constant so unused adapters and demo answers are removed.
  const mode = import.meta.env.VITE_DATA_MODE ?? 'demo';
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
