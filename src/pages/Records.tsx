import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, Search, ArrowUpRight } from 'lucide-react';
import { useApp } from '../lib/store';
import { BOOKING_LABELS, cnDate, accessState } from '../lib/domain';
import { Badge, Empty, Modal } from '../components/ui';
import type { Booking } from '../lib/types';
export function Records() {
  const { user, data, api, refresh, toast } = useApp(),
    [status, setStatus] = useState(''),
    [search, setSearch] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [dialog, setDialog] = useState<{ b: Booking; action: 'return' | 'cancel' | 'checkout' } | null>(
      null,
    ),
    [note, setNote] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  if (!user)
    return (
      <Empty title="登录后查询预约记录">
        <Link className="button" to="/login">
          登录账号
        </Link>
      </Empty>
    );
  const filtered = data.bookings.filter(
    (b) =>
      (!status || b.status === status) &&
      (!from || new Date(b.starts_at) >= new Date(from + 'T00:00+08:00')) &&
      (!to || new Date(b.starts_at) <= new Date(to + 'T23:59:59+08:00')) &&
      `${data.equipment.find((e) => e.id === b.equipment_id)?.name} ${b.user_name} ${b.purpose}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const open = (b: Booking, action: 'return' | 'cancel' | 'checkout') => {
    setDialog({ b, action });
    setError('');
    setNote('');
    setConfirmed(false);
  };
  async function act() {
    if (!dialog) return;
    setBusy(true);
    setError('');
    try {
      const eq = data.equipment.find((e) => e.id === dialog.b.equipment_id);
      await api.bookingAction(
        dialog.b.id,
        dialog.action,
        dialog.action === 'return' ? `已归还至 ${eq?.room} · ${eq?.location}；${note}` : note,
      );
      await refresh();
      setDialog(null);
      toast('预约状态已更新');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">每一次使用，都有迹可循</div>
          <h1>
            记录查询<span className="heading-dot">.</span>
          </h1>
          <p>
            {user.role === 'admin'
              ? '查看全组预约及领用、归还记录。'
              : '查看你的预约进度，登记开始使用与归还，或申请续约。'}
          </p>
        </div>
        <Link to="/equipment" className="button secondary">
          新建预约
          <ArrowUpRight size={16} />
        </Link>
      </div>
      {!accessState(user) && (
        <div className="inline-error access-warning">
          准入权限已停用：{user.banned ? '永久停用' : `停用至 ${cnDate(user.suspended_until!)}`}
          。如有异议请联系管理员复核。
        </div>
      )}
      <section className="panel records-panel">
        <div className="record-tabs">
          {[
            '',
            'pending',
            'approved',
            'in_use',
            'returned',
            'renewed',
            'rejected',
            'cancelled',
          ].map((s) => (
            <button className={status === s ? 'active' : ''} key={s} onClick={() => setStatus(s)}>
              {s ? BOOKING_LABELS[s] : '全部记录'}
              <span>{data.bookings.filter((b) => !s || b.status === s).length}</span>
            </button>
          ))}
        </div>
        <div className="record-filters">
          <label className="search-input">
            <Search size={16} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索设备、用途或申请人"
            />
          </label>
          <label>
            开始日期
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            结束日期
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        {filtered.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>仪器 / 申请信息</th>
                  <th>使用时间</th>
                  <th>状态</th>
                  <th>审批与归还</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => {
                  const e = data.equipment.find((e) => e.id === b.equipment_id),
                    own = b.user_id === user.id;
                  return (
                    <tr key={b.id}>
                      <td>
                        <Link className="table-title" to={`/equipment/${b.equipment_id}`}>
                          {e?.name ?? '设备'}
                        </Link>
                        <small>
                          {e?.room} · {b.user_name}
                          {b.parent_id ? ' · 续约申请' : ''}
                        </small>
                        <small className="record-purpose">{b.purpose}</small>
                        <span className="record-id">#{b.id.slice(0, 8)}</span>
                      </td>
                      <td className="time-cell">
                        {cnDate(b.starts_at)}
                        <small>至 {cnDate(b.ends_at)}</small>
                      </td>
                      <td>
                        <Badge status={b.status} />
                        {b.status === 'in_use' && new Date(b.ends_at) < new Date() && (
                          <small className="danger">已超时，请立即归还</small>
                        )}
                      </td>
                      <td className="note-cell">
                        {b.review_note && <small>审批：{b.review_note}</small>}
                        {b.return_note && (
                          <small>
                            {b.status === 'renewed' ? '交接' : '归还'}：{b.return_note}
                          </small>
                        )}
                        {b.returned_at && <small>{cnDate(b.returned_at)}</small>}
                        {!b.review_note && !b.return_note && <span className="muted">—</span>}
                      </td>
                      <td>
                        <div className="table-actions">
                          {own && ['pending', 'approved'].includes(b.status) && (
                            <button onClick={() => open(b, 'cancel')}>取消</button>
                          )}
                          {own && b.status === 'approved' && (
                            <button
                              disabled={
                                new Date() < new Date(b.starts_at) ||
                                new Date() >= new Date(b.ends_at) ||
                                !accessState(user)
                              }
                              onClick={() => open(b, 'checkout')}
                            >
                              {b.parent_id ? '开始 / 衔接续约' : '开始使用'}
                            </button>
                          )}
                          {own && b.status === 'in_use' && (
                            <button onClick={() => open(b, 'return')}>登记归还</button>
                          )}
                          {own &&
                            ['approved', 'in_use'].includes(b.status) &&
                            new Date(b.ends_at) > new Date() &&
                            new Intl.DateTimeFormat('en-GB', {
                              timeZone: 'Asia/Shanghai',
                              hour: '2-digit',
                              minute: '2-digit',
                              hourCycle: 'h23',
                            }).format(new Date(b.ends_at)) < (e?.close_time.slice(0, 5) ?? '') && (
                              <Link to={`/equipment/${b.equipment_id}?renew=${b.id}`}>
                                申请续约
                              </Link>
                            )}
                          {!own && <span className="muted">申请人操作</span>}
                          {own &&
                            ['returned', 'renewed', 'rejected', 'cancelled'].includes(b.status) && (
                              <span className="muted">已归档</span>
                            )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="暂无符合条件的预约">
            <ClipboardList size={25} />
          </Empty>
        )}
        <div className="table-foot">
          共 {filtered.length} 条记录 · 北京时间 · 记录按申请时间倒序排列
        </div>
      </section>
      {dialog && (
        <Modal
          title={
            dialog.action === 'return'
              ? '登记设备归还'
              : dialog.action === 'cancel'
                ? '取消这条预约'
                : '确认开始使用'
          }
          onClose={() => {
            if (!busy) setDialog(null);
          }}
        >
          <div className="form-stack">
            <p>{data.equipment.find((e) => e.id === dialog.b.equipment_id)?.name}</p>
            <p className="muted">
              {cnDate(dialog.b.starts_at)} — {cnDate(dialog.b.ends_at)}
            </p>
            {dialog.action === 'return' ? (
              <>
                <div className="info-box">
                  指定归还位置：{data.equipment.find((e) => e.id === dialog.b.equipment_id)?.room} ·{' '}
                  {data.equipment.find((e) => e.id === dialog.b.equipment_id)?.location}
                </div>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  我已关闭设备并实际放回上述位置
                </label>
                <label className="form-field">
                  设备情况 / 异常说明
                  <textarea
                    maxLength={500}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="例如：外观与功能正常，附件齐全"
                  />
                </label>
              </>
            ) : (
              <p className="info-box">
                {dialog.action === 'cancel'
                  ? '取消后释放该预约时段，取消记录仍会保留。'
                  : '请确认已完成设备专项培训、检查设备与工作区域，且仅本人使用本预约。'}
              </p>
            )}
            {error && (
              <p role="alert" className="inline-error">
                {error}
              </p>
            )}
          </div>
          <div className="form-actions">
            <button disabled={busy} onClick={() => setDialog(null)}>
              返回
            </button>
            <button
              className="button"
              disabled={busy || (dialog.action === 'return' && (!confirmed || !note.trim()))}
              onClick={act}
            >
              {busy ? '正在提交…' : '确认提交'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
