import { bookingDateTime, slotEnd } from './domain';

export type BookingRange = {
  startDay: string;
  startTime: string;
  endDay: string;
  endTime: string;
};
export type BookingSelection = { range: BookingRange; awaitingEnd: boolean };

export function selectBookingSlot(
  selection: BookingSelection,
  day: string,
  time: string,
): BookingSelection {
  if (!selection.awaitingEnd)
    return {
      range: { startDay: day, startTime: time, endDay: day, endTime: '' },
      awaitingEnd: true,
    };
  const start = bookingDateTime(selection.range.startDay, selection.range.startTime);
  if (+new Date(bookingDateTime(day, time)) < +new Date(start))
    throw new Error('结束时段不能早于开始时段，请选择开始方格或之后的方格');
  return {
    range: { ...selection.range, endDay: day, endTime: slotEnd(time) },
    awaitingEnd: false,
  };
}

export function isSlotSelected(range: BookingRange, day: string, time: string) {
  const slot = +new Date(bookingDateTime(day, time)),
    start = +new Date(bookingDateTime(range.startDay, range.startTime));
  if (!range.endTime) return slot === start;
  return slot >= start && slot < +new Date(bookingDateTime(range.endDay, range.endTime));
}
