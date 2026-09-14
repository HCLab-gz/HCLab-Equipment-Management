import { createClient } from '@supabase/supabase-js';
import type { DataService, Profile, Snapshot } from './types';
export function createSupabaseService(): DataService {
  const url = import.meta.env.VITE_SUPABASE_URL,
    key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key)
    throw new Error('正式数据服务尚未配置，请联系管理员设置 Supabase 地址及公开密钥。');
  const client = createClient(url, key);
  async function rpc<T = void>(name: string, args?: Record<string, unknown>): Promise<T> {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error(error.message);
    return data as T;
  }
  async function profile(): Promise<Profile | null> {
    const {
      data: { session },
      error,
    } = await client.auth.getSession();
    if (error) throw error;
    if (!session) return null;
    const r = await client.from('profiles').select('*').eq('id', session.user.id).single();
    if (r.error) throw r.error;
    return r.data;
  }
  return {
    mode: 'supabase',
    session: profile,
    async login(email, password) {
      const r = await client.auth.signInWithPassword({ email, password });
      if (r.error)
        throw new Error(
          r.error.message === 'Invalid login credentials' ? '邮箱或密码不正确' : r.error.message,
        );
      return (await profile())!;
    },
    async logout() {
      const { error } = await client.auth.signOut();
      if (error) throw error;
    },
    async snapshot() {
      return await rpc<Snapshot>('get_snapshot');
    },
    async startExam(email) {
      return rpc('start_exam', { p_email: email });
    },
    async submitExam(id, answers) {
      return rpc('submit_exam', { p_id: id, p_answers: answers });
    },
    async register(input) {
      const { data, error } = await client.auth.signUp({
        email: input.email,
        password: input.password,
        options: {
          emailRedirectTo: window.location.href.split('#')[0],
          data: {
            name: input.name,
            student_id: input.student_id,
            project: input.project,
            exam_token: input.token,
            requested_role: input.requested_role ?? 'user',
          },
        },
      });
      if (error) throw new Error(error.message);
      return { needsConfirmation: !data.session, needsApproval: true };
    },
    async reviewMembership(id, action, note = '') {
      await rpc('review_membership', { p_id: id, p_action: action, p_note: note });
    },
    async saveEquipment(input) {
      await rpc('save_equipment', { p_data: input });
    },
    async uploadImage(file) {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2097152)
        throw new Error('仅支持 2 MB 以内的 JPG、PNG、WebP 图片');
      const extension =
          file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp',
        path = `${crypto.randomUUID()}.${extension}`;
      const { error } = await client.storage
        .from('equipment-images')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      return client.storage.from('equipment-images').getPublicUrl(path).data.publicUrl;
    },
    async book(input) {
      await rpc('create_booking', { p_data: input });
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
