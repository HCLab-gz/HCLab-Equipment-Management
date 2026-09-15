import { describe, expect, it } from 'vitest';
import { selectBookingSlot, isSlotSelected, type BookingSelection } from '../src/lib/booking-range';

const initial: BookingSelection = {
  range: { startDay: '2099-01-05', startTime: '09:00', endDay: '2099-01-05', endTime: '10:00' },
  awaitingEnd: false,
};
describe('方格选择预约范围', () => {
  it('第一下选起点，第二下含末格，第三下清空终点并开始新范围', () => {
    const first = selectBookingSlot(initial, '2099-01-05', '11:00');
    expect(first).toEqual({
      range: { startDay: '2099-01-05', startTime: '11:00', endDay: '2099-01-05', endTime: '' },
      awaitingEnd: true,
    });
    expect(isSlotSelected(first.range, '2099-01-05', '11:00')).toBe(true);
    expect(isSlotSelected(first.range, '2099-01-05', '11:30')).toBe(false);
    const second = selectBookingSlot(first, '2099-01-05', '12:00');
    expect(second.range.endTime).toBe('12:30');
    expect(second.awaitingEnd).toBe(false);
    const third = selectBookingSlot(second, '2099-01-06', '15:00');
    expect(third).toEqual({
      range: { startDay: '2099-01-06', startTime: '15:00', endDay: '2099-01-06', endTime: '' },
      awaitingEnd: true,
    });
    expect(isSlotSelected(third.range, '2099-01-05', '11:00')).toBe(false);
    expect(selectBookingSlot(third, '2099-01-06', '15:30').range.endTime).toBe('16:00');
  });
  it('切换日期后第二下确定跨天终点，范围在各天正确高亮', () => {
    const first = selectBookingSlot(initial, '2099-01-31', '23:30');
    const second = selectBookingSlot(first, '2099-02-02', '00:30');
    expect(second.range).toEqual({
      startDay: '2099-01-31',
      startTime: '23:30',
      endDay: '2099-02-02',
      endTime: '01:00',
    });
    expect(isSlotSelected(second.range, '2099-01-31', '23:00')).toBe(false);
    expect(isSlotSelected(second.range, '2099-02-01', '12:00')).toBe(true);
    expect(isSlotSelected(second.range, '2099-02-02', '00:30')).toBe(true);
    expect(isSlotSelected(second.range, '2099-02-02', '01:00')).toBe(false);
  });
  it('同一格点两次预约半小时，末格可以结束于次日零点', () => {
    const first = selectBookingSlot(initial, '2099-12-31', '23:30');
    const second = selectBookingSlot(first, '2099-12-31', '23:30');
    expect(second.range).toEqual({
      startDay: '2099-12-31',
      startTime: '23:30',
      endDay: '2099-12-31',
      endTime: '24:00',
    });
    expect(isSlotSelected(second.range, '2100-01-01', '00:00')).toBe(false);
  });
  it('第二下不能选在起点之前，不改变原起点', () => {
    const first = selectBookingSlot(initial, '2099-01-06', '11:00');
    expect(() => selectBookingSlot(first, '2099-01-05', '15:00')).toThrow(/结束.*开始/);
    expect(() => selectBookingSlot(first, '2099-01-06', '10:30')).toThrow(/结束.*开始/);
    expect(selectBookingSlot(first, '2099-01-06', '12:00').range.startTime).toBe('11:00');
  });
});
