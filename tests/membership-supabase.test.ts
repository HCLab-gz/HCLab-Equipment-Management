import { beforeAll, afterAll, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
let db: PGlite;
const owner = randomUUID(),
  admin = randomUUID();
const migration = 'supabase/migrations/007_membership_approval.sql';
let applicant: string, applicationId: string;
async function identity(id: string | null, role = 'authenticated') {
  await db.exec('reset role');
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
    [id ?? '', JSON.stringify({ sub: id, role })],
  );
  await db.exec(`set role ${role}`);
}
async function rpc(name: string, args: unknown[] = []) {
  return (
    await db.query<{ value: any }>(
      `select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as value`,
      args,
    )
  ).rows[0].value;
}
async function register(requested_role: string, score = 100) {
  const email = `${randomUUID()}@example.invalid`;
  await identity(null, 'anon');
  const exam = await rpc('start_exam', [email]);
  await identity(null, 'postgres');
  const qs = (
    await db.query<{ questions: any[] }>(
      'select questions from private.exam_attempts where id=$1',
      [exam.id],
    )
  ).rows[0].questions;
  const answers = Object.fromEntries(
    qs.map((q, i) => [q.id, i < score / 10 ? q.answer : (q.answer + 1) % 4]),
  );
  await identity(null, 'anon');
  const result = await rpc('submit_exam', [exam.id, answers]);
  await identity(null, 'postgres');
  const id = randomUUID();
  await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)', [
    id,
    email,
    {
      name: '申请人',
      student_id: 'MEMBERSHIP',
      project: '项目',
      exam_token: result.token,
      requested_role,
      role: 'super_admin',
      membership_status: 'approved',
      accepted_exam_score: 100,
    },
  ]);
  return id;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
  grant usage on schema auth to anon,authenticated;grant execute on function auth.uid(),auth.jwt() to anon,authenticated;`);
  for (const file of [
    '001_platform.sql',
    '002_questions.sql',
    '004_exam_full_marks.sql',
    '005_rules_v3.sql',
    '006_holiday_question.sql',
  ])
    await db.exec(readFileSync('supabase/migrations/' + file, 'utf8'));
  for (const id of [owner, admin]) {
    await db.exec('alter table auth.users disable trigger all');
    await db.query('insert into auth.users(id,email) values($1,$2)', [id, `${id}@example.invalid`]);
    await db.exec('alter table auth.users enable trigger all');
    await db.query(
      "insert into public.profiles(id,name,email,student_id,role) values($1,'现有管理员',$2,'OLD','admin')",
      [id, `${id}@example.invalid`],
    );
  }
  await db.exec(readFileSync(migration, 'utf8'));
  await db.exec(readFileSync('supabase/migrations/008_equipment_hours.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/009_all_day_equipment.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/010_slot_booker_names.sql', 'utf8'));
  await db.query("update public.profiles set role='super_admin' where id=$1", [owner]);
}, 20000);
afterAll(async () => {
  await db?.close();
});
it('Supabase 设备开放时间同样支持 00:00—23:59', async () => {
  await identity(owner);
  const id = await rpc('save_equipment', [
    {
      name: '时间回归测试',
      model: '测试型号',
      category: '工具',
      project: '公共设备',
      room: '505',
      location: '指定位置',
      manager_id: owner,
      status: 'available',
      open_time: '00:00',
      close_time: '23:59',
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      asset_code: randomUUID(),
    },
  ]);
  expect((await rpc('get_snapshot')).equipment.find((e: any) => e.id === id).close_time).toBe(
    '23:59:00',
  );
});
it('Supabase 注册触发器必须将管理员申请置为待审核普通身份', async () => {
  applicant = await register('admin');
  const profile = (
    await db.query('select role,membership_status from public.profiles where id=$1', [applicant])
  ).rows[0];
  expect(profile).toEqual({ role: 'user', membership_status: 'pending' });
  await identity(applicant);
  const s = await rpc('get_snapshot');
  applicationId = s.applications[0].id;
  expect(s.applications[0]).toMatchObject({
    score: 100,
    requested_role: 'admin',
    status: 'pending',
  });
  await expect(rpc('save_equipment', [{}])).rejects.toThrow(/审核/);
});
it('Supabase 普通管理员不能读取或审核他人注册申请，超级管理员审核后才提权', async () => {
  await identity(admin);
  expect((await rpc('get_snapshot')).applications).toEqual([]);
  await expect(rpc('review_membership', [applicationId, 'approve', ''])).rejects.toThrow(
    /超级管理员/,
  );
  await identity(owner);
  await rpc('review_membership', [applicationId, 'approve', '核实完成']);
  await identity(applicant);
  expect(await rpc('is_admin')).toBe(true);
  await expect(db.exec("update public.profiles set role='super_admin'")).rejects.toThrow(
    /permission denied/,
  );
});
it('Supabase 拒绝非法申请身份和未满分凭证，不能通过伪造 metadata 绕过审核', async () => {
  await expect(register('super_admin')).rejects.toThrow(/身份/);
  await expect(register('user', 90)).rejects.toThrow(/考试/);
});

it('Supabase 全天设备可保存并预约最后半小时', async () => {
  await identity(owner);
  const id = await rpc('save_equipment', [
    {
      name: '全天测试',
      model: '测试型号',
      category: '工具',
      project: '公共设备',
      room: '505',
      location: '指定位置',
      manager_id: owner,
      status: 'available',
      open_time: '00:00',
      close_time: '24:00',
      weekdays: [1],
      asset_code: randomUUID(),
    },
  ]);
  const booking = await rpc('create_booking', [
    {
      equipment_id: id,
      starts_at: '2099-01-05T23:30+08:00',
      ends_at: '2099-01-06T00:00+08:00',
      purpose: '全天预约',
    },
  ]);
  expect(booking).toBeTruthy();
});

it('Supabase 时段姓名仅对通过审核的账号可见', async () => {
  await identity(owner);
  expect((await rpc('get_snapshot')).busy[0]).toHaveProperty('user_name', '现有管理员');
  const waiting = await register('user');
  await identity(waiting);
  expect((await rpc('get_snapshot')).busy).toEqual([]);
  await identity(null, 'anon');
  expect((await rpc('get_snapshot')).busy).toEqual([]);
});
