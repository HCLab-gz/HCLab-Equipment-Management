import { useState, useEffect } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ChevronRight,
  MapPin,
  UserRound,
  Clock3,
  ShieldCheck,
  CalendarDays,
  ArrowRight,
} from 'lucide-react';
import { useApp } from '../lib/store';
import {
  dateKey,
  offsetDay,
  slots,
  slotEnd,
  bookingDateTime,
  equipmentHoursLabel,
  slotAvailability,
  findBookingConflict,
  validateBooking,
  accessState,
  timeKey,
} from '../lib/domain';
import { EquipmentArt, Badge, Empty } from '../components/ui';
export function EquipmentDetail() {
  const { id } = useParams(),
    { data, user, api, refresh, toast } = useApp(),
    navigate = useNavigate(),
    [params] = useSearchParams();
  const e = data.equipment.find((e) => e.id === id),
    parent = data.bookings.find((b) => b.id === params.get('renew'));
  const [day, setDay] = useState(
      parent ? dateKey(new Date(parent.ends_at)) : offsetDay(dateKey(), 1),
    ),
    [start, setStart] = useState(parent ? timeKey(new Date(parent.ends_at)) : '09:00'),
    [end, setEnd] = useState(
      parent ? timeKey(new Date(+new Date(parent.ends_at) + 1800000)) : '10:00',
    ),
    [purpose, setPurpose] = useState(parent ? `续约：${parent.purpose}` : ''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const updateClock = () => setClock(new Date());
    const timer = window.setInterval(updateClock, 30000);
    window.addEventListener('focus', updateClock);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', updateClock);
    };
  }, []);
  useEffect(() => {
    if (!e) return;
    const startTime = parent
      ? timeKey(new Date(parent.ends_at))
      : (slots(e.open_time, e.close_time)[0] ?? '');
    setDay(parent ? dateKey(new Date(parent.ends_at)) : offsetDay(dateKey(), 1));
    setStart(startTime);
    setEnd(startTime ? slotEnd(startTime) : '');
  }, [e?.id, parent?.id]);
  if (!e)
    return (
      <Empty title="设备不存在或尚未载入">
        <Link to="/equipment">返回设备目录</Link>
      </Empty>
    );
  const allSlots = slots(e.open_time, e.close_time),
    ends = allSlots.map(slotEnd),
    availability = allSlots.map((t) => slotAvailability(e, day, t, data.busy, clock));
  const selected = (t: string) => t >= start && t < end;
  async function book() {
    setError('');
    setBusy(true);
    try {
      const startsAt = bookingDateTime(day, start),
        endsAt = bookingDateTime(day, end);
      if (findBookingConflict(e!.id, startsAt, endsAt, data.busy))
        throw new Error('该时间已被预约');
      const timeError = validateBooking(e!, startsAt, endsAt);
      if (timeError) throw new Error(timeError);
      await api.book({
        equipment_id: e!.id,
        starts_at: startsAt,
        ends_at: endsAt,
        purpose,
        parent_id: parent?.id,
      });
      await refresh();
      toast('预约申请已提交，等待管理员审批');
      navigate('/records');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="breadcrumbs">
        <Link to="/equipment">仪器预约</Link>
        <ChevronRight size={13} />
        <span>{e.category}</span>
        <ChevronRight size={13} />
        <span>{e.name}</span>
      </div>
      <div className="detail-layout">
        <div>
          <div className="detail-overview panel">
            <EquipmentArt equipment={e} large />
            <div className="detail-intro">
              <div className="row-between">
                <span className="eyebrow">
                  {e.category} · {e.asset_code}
                </span>
                <Badge status={e.status} />
              </div>
              <h1>{e.name}</h1>
              <p className="detail-model">{e.model}</p>
              <dl>
                <div>
                  <dt>项目归属</dt>
                  <dd>{e.project}</dd>
                </div>
                <div>
                  <dt>
                    <UserRound size={14} />
                    负责管理员
                  </dt>
                  <dd>{e.manager_name}</dd>
                </div>
                <div>
                  <dt>
                    <MapPin size={14} />
                    放置地点
                  </dt>
                  <dd>
                    {e.room} 实验室 · {e.location}
                  </dd>
                </div>
                <div>
                  <dt>
                    <Clock3 size={14} />
                    开放时间
                  </dt>
                  <dd>
                    {equipmentHoursLabel(e.open_time, e.close_time)}
                    <small>
                      {e.weekdays
                        .map((d) => ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d])
                        .join(' / ')}
                    </small>
                  </dd>
                </div>
              </dl>
            </div>
          </div>
          <section className="panel detail-notes">
            <h2>设备介绍</h2>
            <p>{e.description || '管理员尚未补充设备介绍。'}</p>
            <h2>
              <ShieldCheck size={18} />
              使用注意事项
            </h2>
            <p>{e.precautions || '使用前请联系负责管理员确认设备操作规程。'}</p>
            <div className="info-box">
              使用后须归还至{' '}
              <strong>
                {e.room} · {e.location}
              </strong>
              ，在平台登记归还。需要延长使用时，请提前申请续约并等待批准。
            </div>
          </section>
          <section className="panel calendar-panel">
            <div className="section-heading">
              <h2>
                <CalendarDays size={18} />
                可预约时段
              </h2>
              <span className="muted">北京时间 · 30 分钟 / 格</span>
            </div>
            {user ? (
              <>
                <div className="date-strip">
                  {Array.from({ length: 7 }, (_, i) => offsetDay(dateKey(), i)).map((d) => (
                    <button
                      className={day === d ? 'selected' : ''}
                      key={d}
                      onClick={() => setDay(d)}
                    >
                      <span>
                        {d === dateKey()
                          ? '今天'
                          : new Intl.DateTimeFormat('zh-CN', {
                              weekday: 'short',
                              timeZone: 'Asia/Shanghai',
                            }).format(new Date(d + 'T12:00+08:00'))}
                      </span>
                      <strong>{d.slice(5).replace('-', '/')}</strong>
                    </button>
                  ))}
                </div>
                <div className="slot-legend">
                  <span>
                    <i />
                    可预约
                  </span>
                  <span>
                    <i className="chosen" />
                    已选择
                  </span>
                  <span>
                    <i className="occupied" />
                    已占用
                  </span>
                  <span>
                    <i className="unavailable" />
                    不开放
                  </span>
                </div>
                <div className="time-slots">
                  {allSlots.map((t, i) => {
                    const state = availability[i];
                    const label = `${t}–${ends[i] === '24:00' ? '次日 00:00' : ends[i]} · ${state.kind === 'occupied' ? '预约人：' : ''}${state.label}`;
                    return (
                      <button
                        title={label}
                        aria-label={label}
                        key={t}
                        disabled={state.kind !== 'available'}
                        className={
                          state.kind === 'available' && selected(t) ? 'selected' : state.kind
                        }
                        onClick={() => {
                          setStart(t);
                          setEnd(ends[i]);
                        }}
                      >
                        <span>{t}</span>
                        <small>{state.label}</small>
                      </button>
                    );
                  })}
                </div>
                <p className="muted calendar-help">
                  点选起始时段，再在右侧调整结束时间。已结束的时段标记为不开放；已占用时段显示预约人姓名，待审批申请也会暂占时段。全天开放设备的最后一格为
                  23:30—次日 00:00。
                </p>
              </>
            ) : (
              <Empty title="登录后查看预约日历">
                <Link to="/login">登录账号</Link>，查看实时占用情况。
              </Empty>
            )}
          </section>
        </div>
        <aside className="booking-panel panel">
          <span className="eyebrow">安排下一次实验</span>
          <h2>{parent ? '申请续约' : '申请机时预约'}</h2>
          <p className="booking-subtitle">提交申请，待管理员批准后使用。</p>
          {parent && (
            <div className="info-box warning-box">
              续约应紧接原结束时间。获批前仍须按原时间归还；获批后可在记录查询中衔接使用。
            </div>
          )}
          {user ? (
            <>
              <div className="form-stack">
                <label className="form-field">
                  预约日期
                  <input
                    type="date"
                    min={dateKey()}
                    value={day}
                    onChange={(ev) => setDay(ev.target.value)}
                  />
                </label>
                <div className="form-grid">
                  <label className="form-field">
                    开始时间
                    <select
                      value={start}
                      onChange={(ev) => {
                        setStart(ev.target.value);
                        if (end <= ev.target.value) setEnd(ends[allSlots.indexOf(ev.target.value)]);
                      }}
                    >
                      {allSlots.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                  <label className="form-field">
                    结束时间
                    <select value={end} onChange={(ev) => setEnd(ev.target.value)}>
                      {ends.map((t) => (
                        <option key={t} value={t} disabled={t <= start}>
                          {t === '24:00' ? '次日 00:00' : t}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="form-field">
                  使用用途
                  <textarea
                    required
                    minLength={2}
                    maxLength={500}
                    placeholder="简要说明实验内容或项目需求"
                    value={purpose}
                    onChange={(ev) => setPurpose(ev.target.value)}
                  />
                </label>
              </div>
              <div className="booking-duration">
                <span>本次申请时长</span>
                <strong>
                  {Math.max(
                    0,
                    (+new Date(bookingDateTime(day, end)) -
                      +new Date(bookingDateTime(day, start))) /
                      3600000,
                  ) || 0}{' '}
                  <small>小时</small>
                </strong>
              </div>
              {!accessState(user) && (
                <div className="inline-error">你的准入权限已停用，请联系管理员。</div>
              )}
              {error && (
                <p className="inline-error" role="alert">
                  {error}
                </p>
              )}
              <button
                className="button full"
                disabled={
                  busy ||
                  !allSlots.length ||
                  e.status !== 'available' ||
                  !accessState(user) ||
                  purpose.trim().length < 2
                }
                onClick={book}
              >
                {busy ? '正在提交…' : '提交预约申请'}
                <ArrowRight size={17} />
              </button>
            </>
          ) : (
            <Link className="button full" to="/login">
              登录后预约
              <ArrowRight size={16} />
            </Link>
          )}
          <div className="booking-reminder">
            <ShieldCheck size={17} />
            <p>
              预约申请经批准后生效
              <br />
              请遵守实验室管理条例，按时归还
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
