export const DEFAULT_CATEGORIES = ['机器人本体', '机器人传感器', '工具'];
export const ACTIVE_STATUSES = ['pending', 'approved', 'in_use'];
export const BOOKING_LABELS: Record<string, string> = {
  pending: '待审批',
  approved: '已批准',
  in_use: '使用中',
  returned: '已归还',
  renewed: '已续约衔接',
  rejected: '已驳回',
  cancelled: '已取消',
};
export const EQUIPMENT_LABELS: Record<string, string> = {
  available: '正常可预约',
  maintenance: '维护中',
  offline: '已停用',
};
export function dateKey(d: Date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
export function timeKey(d: Date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d);
}
export function offsetDay(day: string, amount: number) {
  const d = new Date(day + 'T12:00:00+08:00');
  d.setUTCDate(d.getUTCDate() + amount);
  return dateKey(d);
}
export function cnDate(value: string, withTime = true) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    ...(withTime ? ({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } as const) : {}),
  }).format(new Date(value));
}
export function overlaps(a: string, b: string, c: string, d: string) {
  return (
    new Date(a).getTime() < new Date(d).getTime() && new Date(b).getTime() > new Date(c).getTime()
  );
}
export function validateBooking(
  eq: { status: string; weekdays: number[]; open_time: string; close_time: string },
  start: string,
  end: string,
  now = new Date(),
): string | null {
  const s = new Date(start),
    e = new Date(end);
  if (!Number.isFinite(+s) || !Number.isFinite(+e) || e <= s) return '请选择有效的起止时间';
  if (eq.status !== 'available') return '该设备当前不可预约';
  if (s <= now) return '预约开始时间必须晚于当前时间';
  if (dateKey(s) !== dateKey(e)) return '每次预约限同一天，跨日请分别申请';
  const day = new Date(dateKey(s) + 'T12:00:00+08:00').getUTCDay();
  if (!eq.weekdays.includes(day)) return '所选日期不在设备开放日内';
  if (timeKey(s) < eq.open_time.slice(0, 5) || timeKey(e) > eq.close_time.slice(0, 5))
    return '所选时间超出设备开放时段';
  if (
    +e - +s < 1800000 ||
    s.getUTCMinutes() % 30 ||
    e.getUTCMinutes() % 30 ||
    s.getUTCSeconds() ||
    e.getUTCSeconds()
  )
    return '请按半小时选择，至少预约 30 分钟';
  return null;
}
export function accessState(
  p: { banned: boolean; suspended_until: string | null },
  now = new Date(),
) {
  return !p.banned && (!p.suspended_until || new Date(p.suspended_until) <= now);
}
export function nextPenalty(previous: number, now = new Date()) {
  const count = previous + 1,
    d = new Date(now);
  let until: string | null = null;
  if (count === 2) {
    d.setUTCDate(d.getUTCDate() + 7);
    until = d.toISOString();
  }
  if (count === 3) {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + 1);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    until = d.toISOString();
  }
  return {
    violations_count: count,
    banned: count >= 4,
    suspended_until: until,
    penalty:
      count === 1
        ? '首次警告'
        : count === 2
          ? '停用准入 1 周'
          : count === 3
            ? '停用准入 1 个月'
            : '永久停止准入',
  };
}
export function gradeExam(correct: number[], answers: Record<number, number>) {
  const score = Math.round(
    (correct.filter((a, i) => a === answers[i]).length / correct.length) * 100,
  );
  return {
    score,
    passed: correct.length === 10 && Object.keys(answers).length === 10 && score === 100,
  };
}
function timeMinutes(value: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(value)) return NaN;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}
function formatMinutes(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
export function slotEnd(start: string) {
  return formatMinutes(timeMinutes(start) + 30);
}
export function equipmentScheduleError(
  open: string | undefined,
  close: string | undefined,
  weekdays: number[] | undefined,
): string | null {
  if (!weekdays?.length || weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6))
    return '请至少选择一个有效的每周开放日';
  const start = timeMinutes(open ?? ''),
    end = timeMinutes(close ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(end))
    return '请填写有效的每日开放时间和结束时间（精确到分钟）';
  if (end <= start) return '每日结束时间必须晚于开放时间';
  if (!slots(open!, close!).length)
    return '开放范围至少需要包含一个完整的半小时预约时段，例如 08:30—09:00';
  return null;
}
export function slots(open: string, close: string) {
  const result: string[] = [];
  const first = Math.ceil(timeMinutes(open) / 30) * 30,
    max = timeMinutes(close);
  for (let min = first; min + 30 <= max; min += 30) result.push(formatMinutes(min));
  return result;
}
