import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Plus,
  Settings2,
  ShieldCheck,
  Check,
  Users,
  ClipboardCheck,
  Box,
  Upload,
} from 'lucide-react';
import { MembershipReview } from '../components/MembershipReview';
import { isAdministrator, isApproved, isSuperAdministrator, ROLE_LABELS } from '../lib/membership';
import { useApp } from '../lib/store';
import { DEFAULT_CATEGORIES, cnDate, accessState, equipmentScheduleError } from '../lib/domain';
import { Badge, Empty, Modal } from '../components/ui';
import type { Equipment, Booking, Profile } from '../lib/types';
export function Admin() {
  const { api, user, data, refresh, toast } = useApp(),
    [params, setParams] = useSearchParams(),
    [editing, setEditing] = useState<Partial<Equipment> | null>(null),
    [review, setReview] = useState<{ b: Booking; action: 'approve' | 'reject' } | null>(null),
    [violation, setViolation] = useState<Profile | null>(null),
    [note, setNote] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const requestedTab = params.get('tab') ?? 'equipment';
  const tab = [
    'equipment',
    'approvals',
    'users',
    ...(isSuperAdministrator(user) ? ['registration'] : []),
  ].includes(requestedTab)
    ? requestedTab
    : 'equipment';
  const setTab = (value: string) => setParams({ tab: value });
  if (!user)
    return (
      <Empty title="请使用管理员账号登录">
        <Link className="button" to="/login?admin=1">
          管理员登录
        </Link>
      </Empty>
    );
  if (!isAdministrator(user))
    return (
      <Empty title="仅管理员可访问管理后台">
        当前账号为普通用户。<Link to="/">返回工作台</Link>
      </Empty>
    );
  const pending = data.bookings.filter((b) => b.status === 'pending');
  function newEquipment() {
    setEditing({
      name: '',
      model: '',
      asset_code: '',
      category: '机器人本体',
      project: '公共设备',
      room: '504',
      location: '',
      manager_id: user!.id,
      status: 'available',
      open_time: '08:00',
      close_time: '22:00',
      weekdays: [1, 2, 3, 4, 5],
      description: '',
      precautions: '',
      image_url: '',
    });
    setError('');
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const scheduleError = equipmentScheduleError(
        editing?.open_time,
        editing?.close_time,
        editing?.weekdays,
      );
      if (scheduleError) throw new Error(scheduleError);
      await api.saveEquipment(editing!);
      await refresh();
      setEditing(null);
      toast('设备信息已保存，分类与地点已同步更新');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function action() {
    setBusy(true);
    setError('');
    try {
      if (review) await api.bookingAction(review.b.id, review.action, note);
      if (violation) await api.recordViolation(violation.id, note);
      await refresh();
      setReview(null);
      setViolation(null);
      toast('处理结果已保存并通知用户');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const update = (key: string, value: unknown) => setEditing((x) => ({ ...x, [key]: value }));
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <ShieldCheck size={14} />
            管理员工作空间
          </div>
          <h1>
            管理后台<span className="heading-dot">.</span>
          </h1>
          <p>维护设备信息、协调预约时间，共同守护实验室安全。</p>
        </div>
        {tab === 'equipment' && (
          <button className="button" onClick={newEquipment}>
            <Plus size={17} />
            新增设备
          </button>
        )}
      </div>
      <div className="admin-tabs">
        {[
          ['equipment', '设备管理', Box],
          ['approvals', '预约审批', ClipboardCheck],
          ['users', '成员与准入', Users],
          ...(isSuperAdministrator(user) ? [['registration', '注册审核', ShieldCheck]] : []),
        ].map(([key, label, Icon]) => {
          const I = Icon as typeof Box;
          return (
            <button
              key={String(key)}
              className={tab === key ? 'active' : ''}
              onClick={() => setTab(String(key))}
            >
              <I size={17} />
              {String(label)}
              {key === 'approvals' && pending.length > 0 && <span>{pending.length}</span>}
              {key === 'registration' && data.applications.some((a) => a.status === 'pending') && (
                <span>{data.applications.filter((a) => a.status === 'pending').length}</span>
              )}
            </button>
          );
        })}
      </div>
      {tab === 'registration' && <MembershipReview />}
      {tab === 'equipment' && (
        <section className="panel">
          <div className="section-heading">
            <h2>
              实验室设备 <span className="subtle-count">{data.equipment.length}</span>
            </h2>
            <span className="muted">分类、项目与地点随设备录入自动汇总</span>
          </div>
          {data.equipment.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>设备</th>
                    <th>分类 / 项目</th>
                    <th>位置 / 管理员</th>
                    <th>状态</th>
                    <th>开放时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data.equipment.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <Link className="table-title" to={`/equipment/${e.id}`}>
                          {e.name}
                        </Link>
                        <small>{e.model}</small>
                        <span className="record-id">{e.asset_code}</span>
                      </td>
                      <td>
                        {e.category}
                        <small>{e.project}</small>
                      </td>
                      <td>
                        {e.room} · {e.location}
                        <small>{e.manager_name}</small>
                      </td>
                      <td>
                        <Badge status={e.status} />
                      </td>
                      <td>
                        {e.open_time.slice(0, 5)} — {e.close_time.slice(0, 5)}
                      </td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => {
                            setEditing({ ...e });
                            setError('');
                          }}
                        >
                          <Settings2 size={14} /> 编辑
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="还没有设备">
              <button onClick={newEquipment} className="text-button">
                录入第一台设备
              </button>
            </Empty>
          )}
        </section>
      )}
      {tab === 'approvals' && (
        <section className="panel">
          <div className="section-heading">
            <h2>
              待审批申请 <span className="subtle-count">{pending.length}</span>
            </h2>
            <Link to="/records">查看全部记录 →</Link>
          </div>
          {pending.length ? (
            <div className="approval-list">
              {pending.map((b) => (
                <article key={b.id}>
                  <div className="approval-icon">
                    <ClipboardCheck size={24} />
                  </div>
                  <div>
                    <h3>
                      {data.equipment.find((e) => e.id === b.equipment_id)?.name}
                      {b.parent_id && <span className="filter-tag">续约</span>}
                    </h3>
                    <p>
                      {b.user_name} · {cnDate(b.starts_at)} — {cnDate(b.ends_at)}
                    </p>
                    <p className="muted">{b.purpose}</p>
                  </div>
                  <div className="approval-actions">
                    <button
                      className="button small"
                      onClick={() => {
                        setReview({ b, action: 'approve' });
                        setNote('');
                        setError('');
                      }}
                    >
                      <Check size={14} />
                      批准
                    </button>
                    <button
                      onClick={() => {
                        setReview({ b, action: 'reject' });
                        setNote('');
                        setError('');
                      }}
                    >
                      驳回
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <Empty title="当前没有待审批申请">新的设备申请会在这里显示。</Empty>
          )}
        </section>
      )}
      {tab === 'users' && (
        <section className="panel">
          <div className="section-heading">
            <h2>成员与准入状态</h2>
            <span className="muted">首次警告 / 1 周 / 1 个月 / 永久</span>
          </div>
          <div className="info-box warning-box">
            此处维护平台准入状态；实体电磁门的权限请由管理员同步处理。管理员账号通过数据服务单独配置，不开放注册提权。
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>成员</th>
                  <th>项目归属</th>
                  <th>准入状态</th>
                  <th>累计违规</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data.profiles.filter(isApproved).map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong className="table-title">{p.name}</strong>
                      <small>{p.email}</small>
                      <small>
                        {p.student_id} · {ROLE_LABELS[p.role]}
                      </small>
                    </td>
                    <td>{p.project}</td>
                    <td>
                      <span className={accessState(p) ? 'access-ok' : 'danger'}>
                        {p.banned ? '永久停用' : accessState(p) ? '正常' : '暂停准入'}
                      </span>
                      {!accessState(p) && !p.banned && (
                        <small>至 {cnDate(p.suspended_until!)}</small>
                      )}
                    </td>
                    <td>{p.violations_count} 次</td>
                    <td>
                      {p.role === 'user' ? (
                        <button
                          className="text-button"
                          onClick={() => {
                            setViolation(p);
                            setNote('');
                            setError('');
                          }}
                        >
                          记录违规
                        </button>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.violations.length > 0 && (
            <div className="violation-history">
              <h3>违规处理记录</h3>
              {data.violations.map((v) => (
                <div key={v.id}>
                  <strong>
                    {data.profiles.find((p) => p.id === v.user_id)?.name} · {v.penalty}
                  </strong>
                  <p>{v.reason}</p>
                  <small>{cnDate(v.created_at)}</small>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      {editing && (
        <Modal
          title={editing.id ? '编辑设备' : '新增仪器与设备'}
          wide
          onClose={() => {
            if (!busy) setEditing(null);
          }}
        >
          <form onSubmit={save}>
            <div className="form-grid">
              {[
                ['name', '仪器名称'],
                ['model', '型号'],
                ['asset_code', '资产编号'],
                ['project', '项目归属'],
              ].map(([k, l]) => (
                <label key={k} className="form-field">
                  {l}
                  <input
                    required
                    maxLength={120}
                    value={String(editing[k as keyof Equipment] ?? '')}
                    onChange={(e) => update(k, e.target.value)}
                  />
                </label>
              ))}
              <label className="form-field">
                设备分类
                <input
                  required
                  list="categories"
                  maxLength={60}
                  value={editing.category ?? ''}
                  onChange={(e) => update('category', e.target.value)}
                />
                <datalist id="categories">
                  {[
                    ...new Set([...DEFAULT_CATEGORIES, ...data.equipment.map((e) => e.category)]),
                  ].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </datalist>
                <small>可选择预设分类，或直接输入新分类。</small>
              </label>
              <label className="form-field">
                设备状态
                <select value={editing.status} onChange={(e) => update('status', e.target.value)}>
                  <option value="available">正常可预约</option>
                  <option value="maintenance">维护中</option>
                  <option value="offline">已停用</option>
                </select>
              </label>
              <label className="form-field">
                实验室
                <select value={editing.room} onChange={(e) => update('room', e.target.value)}>
                  <option>504</option>
                  <option>505</option>
                </select>
              </label>
              <label className="form-field">
                具体存放位置
                <input
                  required
                  maxLength={150}
                  placeholder="如：绿色工作台 · 工具区 T01"
                  value={editing.location}
                  onChange={(e) => update('location', e.target.value)}
                />
              </label>
              <label className="form-field span-2">
                负责管理员
                <select
                  required
                  value={editing.manager_id}
                  onChange={(e) => update('manager_id', e.target.value)}
                >
                  {data.profiles.filter(isAdministrator).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                每日开放时间
                <input
                  required
                  type="time"
                  step="60"
                  value={editing.open_time?.slice(0, 5)}
                  onChange={(e) => update('open_time', e.target.value)}
                />
              </label>
              <label className="form-field">
                每日结束时间
                <input
                  required
                  type="time"
                  step="60"
                  value={editing.close_time?.slice(0, 5)}
                  onChange={(e) => update('close_time', e.target.value)}
                />
              </label>
              <p className="muted span-2">
                开放时间可精确到分钟，例如 00:00—23:59；预约仅列出范围内完整的半小时时段。
              </p>
              <div className="form-field span-2">
                每周开放日
                <div className="weekday-picker">
                  {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                    <label key={d}>
                      <input
                        type="checkbox"
                        checked={editing.weekdays?.includes(d) ?? false}
                        onChange={(e) =>
                          update(
                            'weekdays',
                            e.target.checked
                              ? [...(editing.weekdays ?? []), d]
                              : (editing.weekdays ?? []).filter((x) => x !== d),
                          )
                        }
                      />
                      {['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d]}
                    </label>
                  ))}
                </div>
              </div>
              <label className="form-field span-2">
                设备介绍
                <textarea
                  maxLength={2000}
                  value={editing.description}
                  onChange={(e) => update('description', e.target.value)}
                />
              </label>
              <label className="form-field span-2">
                专项操作规程 / 使用注意事项
                <textarea
                  maxLength={5000}
                  value={editing.precautions}
                  onChange={(e) => update('precautions', e.target.value)}
                  placeholder="请补充设备专项培训要求、操作步骤和安全注意事项"
                />
              </label>
              <label className="form-field span-2">
                <span>
                  <Upload size={14} /> 设备图片（JPG / PNG / WebP，最大 2 MB）
                </span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={busy}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setBusy(true);
                    setError('');
                    try {
                      update('image_url', await api.uploadImage(file));
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
                {editing.image_url && (
                  <img className="upload-preview" src={editing.image_url} alt="设备图片预览" />
                )}
              </label>
            </div>
            {error && (
              <p role="alert" className="inline-error">
                {error}
              </p>
            )}
            <div className="form-actions">
              <button type="button" disabled={busy} onClick={() => setEditing(null)}>
                取消
              </button>
              <button className="button" disabled={busy}>
                {busy ? '正在处理…' : '保存设备'}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {(review || violation) && (
        <Modal
          title={
            violation
              ? '记录违规并更新准入权限'
              : review?.action === 'approve'
                ? '批准这条预约'
                : '驳回这条预约'
          }
          onClose={() => {
            if (!busy) {
              setReview(null);
              setViolation(null);
            }
          }}
        >
          <div className="form-stack">
            {violation ? (
              <div className="info-box warning-box">
                {violation.name} 当前累计 {violation.violations_count} 次违规。本次记录将执行：
                {violation.violations_count === 0
                  ? '首次警告'
                  : violation.violations_count === 1
                    ? '停用准入 1 周'
                    : violation.violations_count === 2
                      ? '停用准入 1 个月'
                      : '永久停用准入'}
                。请在核实事实后提交。
              </div>
            ) : (
              <div className="info-box">
                {review?.b.user_name} ·{' '}
                {data.equipment.find((e) => e.id === review?.b.equipment_id)?.name}
                <br />
                {cnDate(review!.b.starts_at)} — {cnDate(review!.b.ends_at)}
              </div>
            )}
            <label className="form-field">
              {violation
                ? '违规事实与处理依据'
                : review?.action === 'reject'
                  ? '驳回原因（必填）'
                  : '审批备注（选填）'}
              <textarea
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  violation ? '记录经核实的时间、行为与设备信息' : '填写说明，将通知申请人'
                }
              />
            </label>
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="form-actions">
            <button
              disabled={busy}
              onClick={() => {
                setReview(null);
                setViolation(null);
              }}
            >
              返回
            </button>
            <button
              className="button"
              disabled={
                busy || ((!!violation || review?.action === 'reject') && note.trim().length < 2)
              }
              onClick={action}
            >
              {busy ? '正在提交…' : '确认提交'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
