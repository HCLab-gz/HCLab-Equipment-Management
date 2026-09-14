export interface PublicEnvironment {
  [key: string]: unknown;
  VITE_DATA_MODE?: string;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  VITE_CLOUDBASE_ENV_ID?: string;
  VITE_CLOUDBASE_REGION?: string;
  VITE_CLOUDBASE_PUBLISHABLE_KEY?: string;
}
export function validatePublicConfig(
  env: PublicEnvironment,
):
  | { mode: 'demo' | 'supabase'; cloudbase?: never }
  | { mode: 'cloudbase'; cloudbase: { env: string; region: string; accessKey: string } };
