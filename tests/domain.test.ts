import { describe, expect, it } from 'vitest';
import {
  overlaps,
  validateBooking,
  accessState,
  nextPenalty,
  gradeExam,
  slots,
  slotEnd,
  equipmentScheduleError,
  bookingDateTime,
} from '../src/lib/domain';
const equipment = {
  status: 'available',
  weekdays: [1, 2, 3, 4, 5, 6, 0],
  open_time: '08:00',
  close_time: '22:00',
};
describe('预约边界', () => {
  it('预约提交将 24:00 转为次日零点，包括月底和年底', () => {
    expect(bookingDateTime('2099-01-31', '24:00')).toBe('2099-02-01T00:00:00+08:00');
    expect(bookingDateTime('2099-12-31', '24:00')).toBe('2100-01-01T00:00:00+08:00');
    expect(bookingDateTime('2099-01-05', '23:30')).toBe('2099-01-05T23:30:00+08:00');
    expect(bookingDateTime('', '24:00')).toBe('');
    expect(bookingDateTime('2099-01-05', '')).toBe('');
  });
  it('全天开放包含 48 格，最后一格结束于次日零点', () => {
    expect(equipmentScheduleError('00:00', '24:00', [1])).toBeNull();
    expect(equipmentScheduleError('24:00', '24:00', [1])).toBeTruthy();
    expect(equipmentScheduleError('00:00', '24:01', [1])).toBeTruthy();
    expect(slots('00:00:00', '24:00:00')).toHaveLength(48);
    expect(slots('23:30', '24:00')).toEqual(['23:30']);
    expect(slotEnd('23:30')).toBe('24:00');
  });
  it('零点结束不占用结束日，跨天包含非开放日时拒绝', () => {
    const allDay = { ...equipment, open_time: '00:00', close_time: '24:00', weekdays: [1] };
    expect(validateBooking(allDay, '2099-01-05T23:30+08:00', '2099-01-06T00:00+08:00')).toBeNull();
    expect(validateBooking(allDay, '2099-01-05T00:00+08:00', '2099-01-06T00:00+08:00')).toBeNull();
    expect(
      validateBooking(allDay, '2099-01-05T23:30+08:00', '2099-01-06T00:30+08:00'),
    ).toBeTruthy();
    expect(
      validateBooking(allDay, '2099-01-05T23:30+08:00', '2099-01-07T00:00+08:00'),
    ).toBeTruthy();
    expect(
      validateBooking(allDay, '2099-01-06T00:00+08:00', '2099-01-06T00:30+08:00'),
    ).toBeTruthy();
    expect(
      validateBooking(
        { ...allDay, close_time: '23:59' },
        '2099-01-05T23:30+08:00',
        '2099-01-06T00:00+08:00',
      ),
    ).toBeTruthy();
  });
  it('全天设备一次预约可以跨多天、月底和年底', () => {
    const allDay = { ...equipment, open_time: '00:00', close_time: '24:00' };
    for (const [start, end] of [
      ['2099-01-05T23:30+08:00', '2099-01-06T01:30+08:00'],
      ['2099-01-05T09:00+08:00', '2099-01-08T15:00+08:00'],
      ['2099-01-31T23:30+08:00', '2099-02-02T00:00+08:00'],
      ['2099-12-31T23:30+08:00', '2100-01-02T08:00+08:00'],
    ])
      expect(validateBooking(allDay, start, end)).toBeNull();
  });
  it('跨天检查中间开放日和夜间时段，长预约也不能跳过每周休息日', () => {
    const allDay = { ...equipment, open_time: '00:00', close_time: '24:00', weekdays: [1, 3] };
    expect(validateBooking(allDay, '2099-01-05T23:30+08:00', '2099-01-07T01:00+08:00')).toMatch(
      /开放日/,
    );
    expect(
      validateBooking(
        { ...allDay, weekdays: [0, 1, 2, 3, 4, 5] },
        '2099-01-05T09:00+08:00',
        '2099-02-05T09:00+08:00',
      ),
    ).toMatch(/开放日/);
    expect(validateBooking(equipment, '2099-01-05T21:00+08:00', '2099-01-06T09:00+08:00')).toMatch(
      /不开放|开放时段/,
    );
  });
  it('跨天仍拒绝倒置、过去和非半小时的起止时间', () => {
    const allDay = { ...equipment, open_time: '00:00', close_time: '24:00' };
    expect(
      validateBooking(allDay, '2099-01-06T09:00+08:00', '2099-01-05T10:00+08:00'),
    ).toBeTruthy();
    expect(validateBooking(allDay, '2099-01-05T09:00+08:00', '2099-01-06T10:15+08:00')).toMatch(
      /半小时/,
    );
    expect(
      validateBooking(
        allDay,
        '2099-01-05T09:00+08:00',
        '2099-01-06T10:00+08:00',
        new Date('2099-01-05T10:00+08:00'),
      ),
    ).toMatch(/当前时间/);
  });
  it('23:59 和非半点开放时间只生成开放范围内完整的半小时时段', () => {
    expect(slots('23:00', '23:59')).toEqual(['23:00']);
    expect(slots('08:10:00', '10:15:00')).toEqual(['08:30', '09:00', '09:30']);
    expect(slots('08:10', '08:40')).toEqual([]);
    expect(slots('00:00', '23:59')).toHaveLength(47);
    const e = { ...equipment, open_time: '08:10', close_time: '10:15' };
    for (const start of slots(e.open_time, e.close_time))
      expect(
        validateBooking(e, `2099-01-04T${start}+08:00`, `2099-01-04T${slotEnd(start)}+08:00`),
      ).toBeNull();
  });
  it('设备开放时间按分钟设置，无有效时段或开放日时给出明确提示', () => {
    expect(equipmentScheduleError('00:00', '23:59', [0, 1, 2, 3, 4, 5, 6])).toBeNull();
    expect(equipmentScheduleError('08:10:00', '10:15:00', [1])).toBeNull();
    expect(equipmentScheduleError('08:00', '10:00', [])).toMatch(/开放日/);
    expect(equipmentScheduleError('10:00', '08:00', [1])).toMatch(/结束时间/);
    expect(equipmentScheduleError('08:10', '08:40', [1])).toMatch(/完整.*半小时/);
    expect(equipmentScheduleError('25:00', '26:00', [1])).toMatch(/有效.*时间/);
    expect(equipmentScheduleError('08:00:30', '10:00', [1])).toMatch(/有效.*时间/);
  });
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
