import { validatePublicConfig } from './publicConfig.mjs';

export function readBrowserConfig() {
  // Refer to specific public fields so Vite never serializes the entire environment object.
  return validatePublicConfig({
    VITE_DATA_MODE: import.meta.env.VITE_DATA_MODE,
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
    VITE_CLOUDBASE_ENV_ID: import.meta.env.VITE_CLOUDBASE_ENV_ID,
    VITE_CLOUDBASE_REGION: import.meta.env.VITE_CLOUDBASE_REGION,
    VITE_CLOUDBASE_PUBLISHABLE_KEY: import.meta.env.VITE_CLOUDBASE_PUBLISHABLE_KEY,
  });
}
