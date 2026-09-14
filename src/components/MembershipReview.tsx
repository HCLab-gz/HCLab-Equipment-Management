import { useState, type FormEvent } from 'react';
import { Check, ShieldCheck, CircleX } from 'lucide-react';
import { useApp } from '../lib/store';
import { isSuperAdministrator, ROLE_LABELS } from '../lib/membership';
import { cnDate } from '../lib/domain';
import type { MembershipApplication } from '../lib/types';
import { Empty, Modal } from './ui';

export function MembershipReview() {
  const { api, user, data, refresh, toast } = useApp();
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [selection, setSelection] = useState<{
    application: MembershipApplication;
    action: 'approve' | 'reject';
  } | null>(null);
  const [note, setNote] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  if (!isSuperAdministrator(user)) return <Empty title="仅超级管理员可审核注册申请" />;
  const rows = data.applications.filter((a) => filter === 'all' || a.status === 'pending');
  const choose = (application: MembershipApplication, action: 'approve' | 'reject') => {
    setSelection({ application, action });
    setNote('');
    setConfirmed(false);
    setError('');
  };
  async function review(e: FormEvent) {
    e.preventDefault();
    if (!selection) return;
    setBusy(true);
    setError('');
    try {
      await api.reviewMembership(selection.application.id, selection.action, note);
      await refresh();
      setSelection(null);
      toast('注册申请已审核，结果已通知申请人');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>注册身份审核</h2>
            <p className="muted">
              核对姓名、邮箱、学号和项目，确认申请人确属实验室成员。申请管理员身份需同时核实其管理职责。
            </p>
          </div>
          <label className="form-field">
            显示
            <select value={filter} onChange={(e) => setFilter(e.target.value as 'pending' | 'all')}>
              <option value="pending">待审核</option>
              <option value="all">全部申请</option>
            </select>
          </label>
        </div>
        {rows.length ? (
          <div className="membership-applications">
            {rows.map((a) => (
              <article className="membership-application" key={a.id}>
                <div className="membership-application-heading">
                  <div>
                    <h3>
                      {a.name}
                      <span className="filter-tag">申请{ROLE_LABELS[a.requested_role]}</span>
                    </h3>
                    <p className="muted">{a.email}</p>
                  </div>
                  <span className={`membership-badge ${a.status}`}>
                    {a.status === 'pending'
                      ? '待审核'
                      : a.status === 'approved'
                        ? '已通过'
                        : '未通过'}
                  </span>
                </div>
                <dl className="membership-details">
                  <div>
                    <dt>学号 / 成员工号</dt>
                    <dd>{a.student_id}</dd>
                  </div>
                  <div>
                    <dt>项目归属</dt>
                    <dd>{a.project}</dd>
                  </div>
                  <div>
                    <dt>准入考试</dt>
                    <dd>{a.score} / 100 分</dd>
                  </div>
                  <div>
                    <dt>提交时间</dt>
                    <dd>{cnDate(a.created_at)}</dd>
                  </div>
                </dl>
                {a.status === 'pending' ? (
                  <div className="membership-review-actions">
                    <button className="button small" onClick={() => choose(a, 'approve')}>
                      <Check size={15} />
                      同意注册
                    </button>
                    <button className="button secondary small" onClick={() => choose(a, 'reject')}>
                      <CircleX size={15} />
                      拒绝
                    </button>
                  </div>
                ) : (
                  <p className="muted">
                    {a.reviewer_name} · {a.reviewed_at && cnDate(a.reviewed_at)}
                    {a.review_note && ` · ${a.review_note}`}
                  </p>
                )}
              </article>
            ))}
          </div>
        ) : (
          <Empty title={filter === 'pending' ? '暂无待审核注册申请' : '暂无注册申请'}>
            新申请通过满分考试后会显示在这里。
          </Empty>
        )}
      </section>
      {selection && (
        <Modal
          title={selection.action === 'approve' ? '确认成员身份并同意注册' : '拒绝注册申请'}
          onClose={() => {
            if (!busy) setSelection(null);
          }}
        >
          <form className="form-stack" onSubmit={review}>
            <p>
              <strong>{selection.application.name}</strong> · {selection.application.email}
            </p>
            <p>
              申请身份：<strong>{ROLE_LABELS[selection.application.requested_role]}</strong> · 考试{' '}
              {selection.application.score} 分
            </p>
            {selection.action === 'approve' && (
              <label className="check-label rule-agree">
                <input
                  type="checkbox"
                  required
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                <span>
                  我已核实该申请人为实验室成员，同意授予其
                  {ROLE_LABELS[selection.application.requested_role]}权限。
                </span>
              </label>
            )}
            <label className="form-field">
              {selection.action === 'reject'
                ? '拒绝原因（申请人可见）'
                : '审核说明（选填，申请人可见）'}
              <textarea
                required={selection.action === 'reject'}
                minLength={selection.action === 'reject' ? 2 : undefined}
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
              />
            </label>
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="button"
              disabled={busy || (selection.action === 'approve' && !confirmed)}
            >
              <ShieldCheck size={16} />
              {busy ? '正在保存…' : selection.action === 'approve' ? '确认同意注册' : '确认拒绝'}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
