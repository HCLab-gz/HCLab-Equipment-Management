import { describe, expect, it } from 'vitest';
import { slotAvailability, findBookingConflict } from '../src/lib/domain';
import type { BusySlot } from '../src/lib/types';
const equipment = {
  id: 'g1',
  status: 'available',
  open_time: '00:00',
  close_time: '24:00',
  weekdays: [0, 1, 2, 3, 4, 5, 6],
};
const booking = {
  equipment_id: 'g1',
  starts_at: '2099-01-05T09:00:00+08:00',
  ends_at: '2099-01-05T10:00:00+08:00',
  status: 'pending',
  user_name: '张同学',
} as BusySlot;
const now = new Date('2099-01-05T08:00:00+08:00');
describe('预约时段状态', () => {
  it('结束的时段显示不开放；未预约但已开始的时段也不能申请', () => {
    expect(
      slotAvailability(
        equipment,
        '2099-01-05',
        '09:00',
        [booking],
        new Date('2099-01-05T09:30:00+08:00'),
      ),
    ).toEqual({ kind: 'unavailable', label: '不开放' });
    expect(
      slotAvailability(equipment, '2099-01-05', '09:00', [], new Date('2099-01-05T09:10:00+08:00')),
    ).toEqual({ kind: 'unavailable', label: '不开放' });
  });
  it.each(['pending', 'approved', 'in_use'] as const)(
    '%s 占用在每个重叠的半小时格显示姓名，包括使用中的格',
    (status) => {
      for (const start of ['09:00', '09:30'])
        expect(
          slotAvailability(equipment, '2099-01-05', start, [{ ...booking, status }], now),
        ).toEqual({ kind: 'occupied', label: '张同学' });
      expect(
        slotAvailability(
          equipment,
          '2099-01-05',
          '09:00',
          [{ ...booking, status }],
          new Date('2099-01-05T09:10:00+08:00'),
        ),
      ).toEqual({ kind: 'occupied', label: '张同学' });
    },
  );
  it('相邻时段、其他设备以及已取消或归还记录不占用', () => {
    expect(slotAvailability(equipment, '2099-01-05', '10:00', [booking], now)).toEqual({
      kind: 'available',
      label: '可预约',
    });
    for (const status of ['cancelled', 'returned', 'rejected', 'renewed'] as const)
      expect(
        slotAvailability(equipment, '2099-01-05', '09:00', [{ ...booking, status }], now).kind,
      ).toBe('available');
    expect(
      slotAvailability(
        equipment,
        '2099-01-05',
        '09:00',
        [{ ...booking, equipment_id: 'franka' }],
        now,
      ).kind,
    ).toBe('available');
  });
  it('非开放日或设备维护中显示不开放', () => {
    expect(
      slotAvailability({ ...equipment, weekdays: [0] }, '2099-01-05', '09:00', [booking], now).kind,
    ).toBe('unavailable');
    expect(
      slotAvailability(
        { ...equipment, status: 'maintenance' },
        '2099-01-05',
        '09:00',
        [booking],
        now,
      ).kind,
    ).toBe('unavailable');
  });
  it('跨零点最后一格能显示姓名，已过期后转为不开放', () => {
    const midnight = {
      ...booking,
      starts_at: '2099-01-05T23:30:00+08:00',
      ends_at: '2099-01-06T00:00:00+08:00',
    };
    expect(slotAvailability(equipment, '2099-01-05', '23:30', [midnight], now)).toEqual({
      kind: 'occupied',
      label: '张同学',
    });
    expect(
      slotAvailability(equipment, '2099-01-05', '23:30', [midnight], new Date(midnight.ends_at))
        .kind,
    ).toBe('unavailable');
  });
});

it('提交前检查整个申请范围，中间占用同样冲突，相邻和其他设备不冲突', () => {
  expect(
    findBookingConflict('g1', '2099-01-05T08:30+08:00', '2099-01-05T10:30+08:00', [booking]),
  ).toBe(booking);
  expect(
    findBookingConflict('g1', '2099-01-05T10:00+08:00', '2099-01-05T10:30+08:00', [booking]),
  ).toBeUndefined();
  expect(
    findBookingConflict('franka', '2099-01-05T09:00+08:00', '2099-01-05T09:30+08:00', [booking]),
  ).toBeUndefined();
  expect(
    findBookingConflict('g1', '2099-01-05T09:00+08:00', '2099-01-05T09:30+08:00', [
      { ...booking, status: 'cancelled' },
    ]),
  ).toBeUndefined();
});
