import { it, expect } from 'vitest';
import { createDemoService } from '../src/lib/demo';
import { dateKey, offsetDay } from '../src/lib/domain';
import { questions } from '../src/data/questions';
const memory = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
  };
};
it.each([80, 90, 100])('演示考试 %i 分时，仅满分发放注册凭证', async (score) => {
  const api = createDemoService(memory());
  const email = `exam-${score}@example.test`;
  const exam = await api.startExam(email);
  const answers = Object.fromEntries(
    exam.questions.map((q, i) => {
      const answer = questions.find((item) => item.id === q.id)!.answer;
      return [q.id, i < score / 10 ? answer : (answer + 1) % 4];
    }),
  );
  const result = await api.submitExam(exam.id, answers);
  expect(result.score).toBe(score);
  const registration = {
    email,
    token: result.token ?? 'no-proof',
    password: 'DemoOnly-Exam-2026',
    name: '考试验收',
    student_id: 'DEMO-QA',
    project: '演示',
  };
  if (score < 100) {
    await expect(api.register(registration)).rejects.toThrow(/考试/);
    expect(result.passed).toBe(false);
    expect(result.token).toBeUndefined();
  } else {
    expect(result.passed).toBe(true);
    await api.register(registration);
    expect((await api.snapshot()).profiles.find((p) => p.email === email)?.role).toBe('user');
  }
});
it('普通用户不能新增设备或批准预约，自己可以提交并取消', async () => {
  const api = createDemoService(memory());
  await api.demoLogin!('user');
  await expect(api.saveEquipment({ name: '越权设备' })).rejects.toThrow();
  await expect(api.bookingAction('demo-booking', 'approve')).rejects.toThrow();
  const d = offsetDay(dateKey(), 1),
    input = {
      equipment_id: 'g1',
      starts_at: `${d}T09:00:00+08:00`,
      ends_at: `${d}T10:00:00+08:00`,
      purpose: '测试抓取',
    };
  await api.book(input);
  await expect(api.book(input)).rejects.toThrow();
  const b = (await api.snapshot()).bookings.find((x) => x.equipment_id === 'g1')!;
  expect(b.status).toBe('pending');
  await api.bookingAction(b.id, 'cancel');
  expect((await api.snapshot()).bookings.find((x) => x.id === b.id)?.status).toBe('cancelled');
});
it('管理员批准后不能再次驳回；未到时间不能开始使用', async () => {
  const api = createDemoService(memory());
  await api.demoLogin!('admin');
  await api.bookingAction('demo-booking', 'approve');
  await expect(api.bookingAction('demo-booking', 'reject', '测试')).rejects.toThrow();
  await api.demoLogin!('user');
  await expect(api.bookingAction('demo-booking', 'checkout')).rejects.toThrow();
});
it('未登录看不到个人记录，连续违规后阻止预约', async () => {
  const api = createDemoService(memory());
  expect((await api.snapshot()).bookings).toHaveLength(0);
  await api.demoLogin!('admin');
  await api.recordViolation('demo-user', '未归位');
  await api.recordViolation('demo-user', '再次超时');
  await api.demoLogin!('user');
  const d = offsetDay(dateKey(), 1);
  await expect(
    api.book({
      equipment_id: 'g1',
      starts_at: `${d}T09:00:00+08:00`,
      ends_at: `${d}T10:00:00+08:00`,
      purpose: '测试',
    }),
  ).rejects.toThrow();
});
it('演示模式管理员申请需超级管理员审核，普通管理员不能审核', async () => {
  const api = createDemoService(memory());
  const email = 'review-admin@example.test';
  const exam = await api.startExam(email);
  const result = await api.submitExam(
    exam.id,
    Object.fromEntries(
      exam.questions.map((q) => [q.id, questions.find((x) => x.id === q.id)!.answer]),
    ),
  );
  const registered = await api.register({
    email,
    password: 'DemoOnly-Review-2026',
    name: '申请管理员',
    student_id: 'DEMO-REVIEW',
    project: '演示',
    token: result.token!,
    requested_role: 'admin',
  });
  expect(registered.needsApproval).toBe(true);
  expect((await api.session())?.membership_status).toBe('pending');
  await expect(api.saveEquipment({})).rejects.toThrow(/审核/);
  const app = (await api.snapshot()).applications[0];
  await api.demoLogin!('admin');
  expect((await api.snapshot()).applications).toEqual([]);
  await expect(api.reviewMembership(app.id, 'approve')).rejects.toThrow(/超级管理员/);
  await api.demoLogin!('super_admin');
  expect((await api.snapshot()).applications).toHaveLength(1);
  await api.reviewMembership(app.id, 'approve');
  await api.login(email, 'DemoOnly-Review-2026');
  expect(await api.session()).toMatchObject({ role: 'admin', membership_status: 'approved' });
});
