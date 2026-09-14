import { beforeAll, afterAll, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
let db: PGlite;
const admin = '00000000-0000-0000-0000-000000000001',
  student = '00000000-0000-0000-0000-000000000002',
  other = '00000000-0000-0000-0000-000000000003';
async function identity(id: string | null, role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id ?? '']);
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
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`,
  );
  await db.exec(readFileSync('supabase/migrations/001_platform.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/002_questions.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/004_exam_full_marks.sql', 'utf8'));
  await db.exec(
    `alter table auth.users disable trigger all;insert into auth.users(id,email) values ('${admin}','admin@test.edu'),('${student}','user@test.edu'),('${other}','other@test.edu');alter table auth.users enable trigger all;insert into public.profiles(id,email,name,student_id,project,role) values ('${admin}','admin@test.edu','管理员','A','公共','admin'),('${student}','user@test.edu','同学甲','U','操作','user'),('${other}','other@test.edu','同学乙','O','控制','user');`,
  );
}, 20000);
afterAll(async () => {
  await db?.close();
});
let eq: string, booking: string;
it('未登录仅能读取设备，普通用户不能改角色、设备或直接写预约', async () => {
  await identity(null, 'anon');
  const s = await rpc('get_snapshot');
  expect(s.profiles).toEqual([]);
  expect(s.bookings).toEqual([]);
  await identity(student);
  await expect(db.exec("update public.profiles set role='admin'")).rejects.toThrow();
  await expect(rpc('save_equipment', [{}])).rejects.toThrow();
  await expect(db.exec('insert into public.bookings default values')).rejects.toThrow();
});
it('管理员录入设备，分类和地点落库，禁止无效地点', async () => {
  await identity(admin);
  const input = {
    name: '测试机械臂',
    model: 'FR3',
    category: '新增分类',
    project: '机器人',
    room: '504',
    location: '绿色工作台',
    manager_id: admin,
    status: 'available',
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    open_time: '08:00',
    close_time: '22:00',
    asset_code: 'TEST-01',
  };
  await expect(rpc('save_equipment', [{ ...input, room: '506' }])).rejects.toThrow();
  eq = await rpc('save_equipment', [input]);
  const s = await rpc('get_snapshot');
  expect(s.equipment[0].category).toBe('新增分类');
  expect(s.equipment[0].location).toBe('绿色工作台');
});
it('预约冲突在数据库拒绝，个人记录隔离但公开匿名占用时段', async () => {
  await identity(student);
  const input = {
    equipment_id: eq,
    starts_at: '2099-01-02T09:00+08:00',
    ends_at: '2099-01-02T10:00+08:00',
    purpose: '抓取实验',
  };
  booking = await rpc('create_booking', [input]);
  await expect(rpc('create_booking', [input])).rejects.toThrow(/已有预约/);
  await identity(other);
  const s = await rpc('get_snapshot');
  expect(s.bookings).toHaveLength(0);
  expect(s.busy).toHaveLength(1);
  expect(s.busy[0].user_id).toBeUndefined();
  await expect(rpc('booking_action', [booking, 'cancel', ''])).rejects.toThrow();
  await expect(rpc('booking_action', [booking, 'approve', ''])).rejects.toThrow();
});
it('管理员审批后通知申请人，未到时间不能借出', async () => {
  await identity(admin);
  await rpc('booking_action', [booking, 'approve', '请按时归还']);
  await identity(student);
  const s = await rpc('get_snapshot');
  expect(s.bookings[0].status).toBe('approved');
  expect(s.notices.some((n: any) => n.title === '预约已批准')).toBe(true);
  await expect(rpc('booking_action', [booking, 'checkout', ''])).rejects.toThrow();
});
it('连续违规由服务端计数并阻止预约', async () => {
  await identity(admin);
  await rpc('record_violation', [other, '首次未归位']);
  let s = await rpc('get_snapshot');
  expect(s.profiles.find((p: any) => p.id === other).suspended_until).toBeNull();
  await rpc('record_violation', [other, '再次未归位']);
  s = await rpc('get_snapshot');
  expect(s.profiles.find((p: any) => p.id === other).violations_count).toBe(2);
  await identity(other);
  await expect(
    rpc('create_booking', [
      {
        equipment_id: eq,
        starts_at: '2099-01-03T09:00+08:00',
        ends_at: '2099-01-03T10:00+08:00',
        purpose: '测试',
      },
    ]),
  ).rejects.toThrow(/准入/);
});
it('考试不泄露答案，提交后不可重判，注册强制普通用户且凭证一次性', async () => {
  await identity(null, 'anon');
  const exam = await rpc('start_exam', ['new@test.edu']);
  expect(exam.questions).toHaveLength(10);
  expect(exam.questions.every((q: any) => q.answer === undefined)).toBe(true);
  await expect(db.exec('select * from private.questions')).rejects.toThrow();
  await expect(rpc('submit_exam', [exam.id, {}])).rejects.toThrow();
  await identity(null, 'postgres');
  const qs = await db.query<{ id: number; answer: number }>(
    'select id,answer from private.questions',
  );
  const answers = Object.fromEntries(
    exam.questions.map((q: any) => [q.id, qs.rows.find((x) => x.id === q.id)!.answer]),
  );
  await identity(null, 'anon');
  const result = await rpc('submit_exam', [exam.id, answers]);
  expect(result.score).toBe(100);
  expect(result.passed).toBe(true);
  await expect(rpc('submit_exam', [exam.id, answers])).rejects.toThrow();
  await identity(null, 'postgres');
  const meta = {
    exam_token: result.token,
    name: '新同学',
    student_id: 'N',
    project: '测试',
    role: 'admin',
  };
  await db.query(
    "insert into auth.users(id,email,raw_user_meta_data) values (gen_random_uuid(),'new@test.edu',$1)",
    [meta],
  );
  const p = (
    await db.query<{ role: string }>("select role from public.profiles where email='new@test.edu'")
  ).rows[0];
  expect(p.role).toBe('user');
  await expect(
    db.query(
      "insert into auth.users(id,email,raw_user_meta_data) values (gen_random_uuid(),'new@test.edu',$1)",
      [meta],
    ),
  ).rejects.toThrow();
  await expect(
    db.exec("insert into auth.users(id,email) values (gen_random_uuid(),'bypass@test.edu')"),
  ).rejects.toThrow();
});
it.each([80, 90])('服务端考试 %i 分不发放凭证，注册时也拒绝非满分凭证', async (score) => {
  const email = `exam-${score}@test.edu`;
  await identity(null, 'anon');
  const exam = await rpc('start_exam', [email]);
  await identity(null, 'postgres');
  const qs = await db.query<{ id: number; answer: number }>(
    'select id,answer from private.questions',
  );
  const answers = Object.fromEntries(
    exam.questions.map((q: any, i: number) => {
      const answer = qs.rows.find((item) => item.id === q.id)!.answer;
      return [q.id, i < score / 10 ? answer : (answer + 1) % 4];
    }),
  );
  await identity(null, 'anon');
  const result = await rpc('submit_exam', [exam.id, answers]);
  expect(result.score).toBe(score);
  expect(result.passed).toBe(false);
  expect(result.token).toBeNull();
  await identity(null, 'postgres');
  // 模拟旧规则签发的凭证；注册入口必须再次检查实际分数。
  const proof = (
    await db.query<{ token: string }>(
      'update private.exam_attempts set token=gen_random_uuid() where id=$1 returning token',
      [exam.id],
    )
  ).rows[0].token;
  await expect(
    db.query(
      'insert into auth.users(id,email,raw_user_meta_data) values(gen_random_uuid(),$1,$2)',
      [email, { exam_token: proof, name: '未满分同学', student_id: 'EXAM', project: '测试' }],
    ),
  ).rejects.toThrow(/考试/);
});
it('续约衔接同一使用者的原预约，保留交接记录而不虚构物理归还', async () => {
  await identity(null, 'postgres');
  const parent = (
    await db.query<{ id: string }>(
      "insert into public.bookings(equipment_id,user_id,user_name,starts_at,ends_at,purpose,status) values($1,$2,'同学甲',now()-interval '2 hours',now()-interval '1 hour','连续测试','in_use') returning id",
      [eq, student],
    )
  ).rows[0].id;
  const child = (
    await db.query<{ id: string }>(
      "insert into public.bookings(equipment_id,user_id,user_name,starts_at,ends_at,purpose,status,parent_id) select equipment_id,user_id,user_name,ends_at,now()+interval '1 hour','连续测试续约','approved',id from public.bookings where id=$1 returning id",
      [parent],
    )
  ).rows[0].id;
  await identity(student);
  await rpc('booking_action', [child, 'checkout', '']);
  const s = await rpc('get_snapshot');
  expect(s.bookings.find((b: any) => b.id === parent).status).toBe('renewed');
  expect(s.bookings.find((b: any) => b.id === parent).returned_at).toBeNull();
  expect(s.bookings.find((b: any) => b.id === child).status).toBe('in_use');
  await rpc('booking_action', [child, 'return', '已归还绿色工作台，功能正常']);
  expect((await rpc('get_snapshot')).bookings.find((b: any) => b.id === child).status).toBe(
    'returned',
  );
});

it('条例 v3 不改写已注册成员的记录，新考试采用新版本', async () => {
  await identity(null, 'anon');
  const old = await rpc('start_exam', ['before-v3@test.edu']);
  await identity(null, 'postgres');
  const before = (await db.query('select id,rules_version from public.profiles order by id')).rows;
  await db.exec(readFileSync('supabase/migrations/005_rules_v3.sql', 'utf8'));
  expect((await db.query('select id,rules_version from public.profiles order by id')).rows).toEqual(
    before,
  );
  expect(
    (
      await db.query('select expires_at<=now() as expired from private.exam_attempts where id=$1', [
        old.id,
      ])
    ).rows[0],
  ).toEqual({ expired: false });
  await identity(null, 'anon');
  const current = await rpc('start_exam', ['after-v3@test.edu']);
  await identity(null, 'postgres');
  expect(
    (await db.query('select rules_version from private.exam_attempts where id=$1', [current.id]))
      .rows[0],
  ).toEqual({ rules_version: '2026-09-v3' });
  for (const [exam, email, version] of [
    [old, 'before-v3@test.edu', '2026-09-v2'],
    [current, 'after-v3@test.edu', '2026-09-v3'],
  ] as const) {
    const attempt = (
      await db.query<{ questions: { id: number; answer: number }[] }>(
        'select questions from private.exam_attempts where id=$1',
        [exam.id],
      )
    ).rows[0];
    const answers = Object.fromEntries(attempt.questions.map((q) => [q.id, q.answer]));
    const result = await rpc('submit_exam', [exam.id, answers]);
    await db.query(
      'insert into auth.users(id,email,raw_user_meta_data) values(gen_random_uuid(),$1,$2)',
      [
        email,
        {
          exam_token: result.token,
          name: '版本测试',
          student_id: 'VERSION',
          accepted_rules_version: 'forged',
        },
      ],
    );
    expect(
      (await db.query('select role,rules_version from public.profiles where email=$1', [email]))
        .rows[0],
    ).toEqual({ role: 'user', rules_version: version });
  }
});
