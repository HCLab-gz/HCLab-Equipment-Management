import { describe, expect, it } from 'vitest';
import { overlaps, validateBooking, accessState, nextPenalty, gradeExam } from '../src/lib/domain';
const equipment = {
  status: 'available',
  weekdays: [1, 2, 3, 4, 5, 6, 0],
  open_time: '08:00',
  close_time: '22:00',
};
describe('预约边界', () => {
  it('相邻预约允许，交叉和包含拒绝', () => {
    expect(
      overlaps(
        '2026-09-14T08:00:00+08:00',
        '2026-09-14T09:00:00+08:00',
        '2026-09-14T09:00:00+08:00',
        '2026-09-14T10:00:00+08:00',
      ),
    ).toBe(false);
    expect(
      overlaps(
        '2026-09-14T08:00:00+08:00',
        '2026-09-14T10:00:00+08:00',
        '2026-09-14T09:00:00+08:00',
        '2026-09-14T11:00:00+08:00',
      ),
    ).toBe(true);
  });
  it('拒绝关闭设备、跨日、过期、非开放日与非半小时边界', () => {
    const now = new Date('2026-09-13T00:00Z');
    expect(
      validateBooking(equipment, '2026-09-14T09:00+08:00', '2026-09-14T10:00+08:00', now),
    ).toBeNull();
    expect(
      validateBooking(
        { ...equipment, status: 'maintenance' },
        '2026-09-14T09:00+08:00',
        '2026-09-14T10:00+08:00',
        now,
      ),
    ).toBeTruthy();
    expect(
      validateBooking(equipment, '2026-09-14T21:00+08:00', '2026-09-15T09:00+08:00', now),
    ).toBeTruthy();
    expect(
      validateBooking(equipment, '2026-09-12T09:00+08:00', '2026-09-12T10:00+08:00', now),
    ).toBeTruthy();
    expect(
      validateBooking(
        { ...equipment, weekdays: [0] },
        '2026-09-14T09:00+08:00',
        '2026-09-14T10:00+08:00',
        now,
      ),
    ).toBeTruthy();
    expect(
      validateBooking(equipment, '2026-09-14T09:15+08:00', '2026-09-14T10:00+08:00', now),
    ).toBeTruthy();
  });
});
describe('准入与考试', () => {
  it('处罚逐级为警告、7天、一个月、永久', () => {
    const now = new Date('2026-01-31T10:00Z');
    expect(nextPenalty(0, now).suspended_until).toBeNull();
    expect(nextPenalty(1, now).suspended_until).toBe('2026-02-07T10:00:00.000Z');
    expect(nextPenalty(2, now).suspended_until).toBe('2026-02-28T10:00:00.000Z');
    expect(nextPenalty(3, now).banned).toBe(true);
    expect(
      accessState(
        { banned: false, suspended_until: '2026-09-15T00:00Z' },
        new Date('2026-09-14T00:00Z'),
      ),
    ).toBe(false);
  });
  it('必须完整答对十题，80、90 分和漏答均不能通过', () => {
    const correct = [0, 1, 2, 3, 0, 1, 2, 3, 0, 1];
    const answers = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 0, 5: 1, 6: 2, 7: 3, 8: 0, 9: 1 };
    expect(gradeExam(correct, {}).passed).toBe(false);
    expect(gradeExam(correct, { ...answers, 8: 2, 9: 2 })).toEqual({ score: 80, passed: false });
    expect(gradeExam(correct, { ...answers, 9: 2 })).toEqual({ score: 90, passed: false });
    expect(gradeExam(correct, answers)).toEqual({ score: 100, passed: true });
  });
});
