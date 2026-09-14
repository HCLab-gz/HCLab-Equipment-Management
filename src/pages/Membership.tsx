import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock3, ShieldCheck, CircleX, RefreshCw, ArrowRight } from 'lucide-react';
import { useApp } from '../lib/store';
import { ROLE_LABELS, isAdministrator, isApproved } from '../lib/membership';
import { cnDate } from '../lib/domain';
import { Empty } from '../components/ui';

export function Membership() {
  const { user, data, refresh } = useApp();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  if (!user)
    return (
      <Empty title="登录后查看注册申请">
        <Link className="button" to="/login">
          前往登录
        </Link>
      </Empty>
    );
  const application = data.applications.find((a) => a.user_id === user.id);
  const approved = isApproved(user),
    rejected = user.membership_status === 'rejected';
  const Icon = approved ? ShieldCheck : rejected ? CircleX : Clock3;
  return (
    <section className="panel membership-status">
      <div className={`membership-status-icon ${rejected ? 'rejected' : ''}`}>
        <Icon size={34} />
      </div>
      <span className="eyebrow">实验室成员准入 · 身份审核</span>
      <h1>{approved ? '注册已完成' : rejected ? '注册申请未通过' : '注册申请已提交，等待审核'}</h1>
      <p className="muted">
        {approved
          ? `你已获准以${ROLE_LABELS[user.role]}身份使用平台。`
          : rejected
            ? '本次申请未获准开通。若对审核结果有疑问，请联系超级管理员复核。'
            : '100 分准入考试已通过。超级管理员将核对你是否为实验室成员；通过审核后，才能预约设备或使用获批的管理权限。'}
      </p>
      <dl className="membership-details">
        <div>
          <dt>姓名</dt>
          <dd>{user.name}</dd>
        </div>
        <div>
          <dt>邮箱</dt>
          <dd>{user.email}</dd>
        </div>
        <div>
          <dt>学号 / 成员工号</dt>
          <dd>{user.student_id}</dd>
        </div>
        <div>
          <dt>项目归属</dt>
          <dd>{user.project}</dd>
        </div>
        <div>
          <dt>申请身份</dt>
          <dd>{application ? ROLE_LABELS[application.requested_role] : ROLE_LABELS[user.role]}</dd>
        </div>
        {application && (
          <div>
            <dt>准入考试</dt>
            <dd>{application.score} / 100 分</dd>
          </div>
        )}
        {application && (
          <div>
            <dt>提交时间</dt>
            <dd>{cnDate(application.created_at)}</dd>
          </div>
        )}
        {application?.reviewed_at && (
          <div>
            <dt>审核时间</dt>
            <dd>
              {cnDate(application.reviewed_at)} · {application.reviewer_name}
            </dd>
          </div>
        )}
      </dl>
      {application?.review_note && (
        <div className={rejected ? 'membership-review-note rejected' : 'membership-review-note'}>
          <strong>{rejected ? '拒绝原因' : '审核说明'}</strong>
          <p>{application.review_note}</p>
        </div>
      )}
      <div className="form-actions">
        {approved ? (
          <Link className="button" to={isAdministrator(user) ? '/admin' : '/equipment'}>
            {isAdministrator(user) ? '进入管理后台' : '浏览可预约设备'}
            <ArrowRight size={16} />
          </Link>
        ) : (
          <button
            className="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await refresh();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <RefreshCw size={16} />
            {busy ? '正在更新…' : '刷新审核状态'}
          </button>
        )}
        <Link className="text-button" to="/rules">
          重新阅读实验室条例
        </Link>
      </div>
      {!approved && (
        <p className="muted membership-status-hint">
          审核结果会通过站内通知提醒，也可稍后使用注册时的邮箱和密码登录查看。
        </p>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
