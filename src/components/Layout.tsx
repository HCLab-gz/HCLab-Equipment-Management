import {
  Bell,
  LogOut,
  UserRound,
  LayoutDashboard,
  CalendarDays,
  ClipboardList,
  ArrowUpRight,
  ShieldCheck,
  FlaskConical,
} from 'lucide-react';
import { NavLink, Outlet, Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useApp } from '../lib/store';
import { accountLabel, isApproved, isSuperAdministrator } from '../lib/membership';
import { cnDate } from '../lib/domain';
import { Modal, Empty } from './ui';
export function Layout() {
  const { user, api, data, refresh, clearSession, toast } = useApp(),
    [notices, setNotices] = useState(false),
    navigate = useNavigate(),
    location = useLocation();
  const unread = data.notices.filter((n) => !n.read).length;
  return (
    <>
      <header className="header">
        <Link to="/" className="brand">
          <span className="brand-mark">
            <FlaskConical size={23} />
          </span>
          <span>
            <strong>
              HCLab<span className="brand-divider"> / </span>
              <b>仪器管理平台</b>
            </strong>
          </span>
        </Link>
        <nav className="main-nav" aria-label="主导航">
          <NavLink end to="/">
            <LayoutDashboard size={17} />
            工作台
          </NavLink>
          <NavLink to="/equipment">
            <CalendarDays size={17} />
            仪器预约
          </NavLink>
          <NavLink to="/records">
            <ClipboardList size={17} />
            记录查询
          </NavLink>
        </nav>
        <div className="account-nav">
          {user ? (
            <>
              <button
                className="notification-button icon-button"
                aria-label={`站内通知，${unread} 条未读`}
                onClick={() => setNotices(true)}
              >
                <Bell size={20} />
                {unread > 0 && <i>{unread}</i>}
              </button>
              <div className="account-chip">
                <span className="avatar">{user.name.slice(0, 1)}</span>
                <span>
                  {user.name}
                  <small>{accountLabel(user)}</small>
                </span>
              </div>
              <button
                className="icon-button"
                aria-label="退出登录"
                onClick={async () => {
                  try {
                    clearSession();
                    await api.logout();
                    await refresh();
                    navigate('/');
                    toast('已退出登录');
                  } catch (e) {
                    toast((e as Error).message);
                  }
                }}
              >
                <LogOut size={17} />
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="login-link">
                <UserRound size={17} />
                登录
              </Link>
              <Link className="button small" to="/register">
                注册
              </Link>
            </>
          )}
        </div>
      </header>
      {api.mode === 'demo' && (
        <div className="demo-bar">
          <span>
            <i />
            演示模式 ·
            管理员、项目、实验室分配和存放位置均为示例，未经核实；数据仅保存在当前浏览器，不与其他同学同步
          </span>
          <Link to="/login">
            体验用户 / 管理员 <ArrowUpRight size={13} />
          </Link>
        </div>
      )}
      <main className="page-shell">
        {user && !isApproved(user) && !['/membership', '/rules'].includes(location.pathname) ? (
          <Navigate to="/membership" replace />
        ) : (
          <Outlet />
        )}
      </main>
      <footer>
        <span>Humanoid Computing Lab</span>
        <span>
          <Link to="/rules">实验室管理条例</Link>
          <span className="footer-dot">·</span>
          <Link to="/admin">
            <ShieldCheck size={13} />
            管理后台
          </Link>
        </span>
        <span>共享有序 · 安全先行</span>
      </footer>
      {notices && (
        <Modal title="站内通知" onClose={() => setNotices(false)}>
          <div className="row-between">
            <p className="muted">{unread} 条未读通知</p>
            {data.notices.some((n) => n.title.includes('注册')) && (
              <Link
                className="text-button"
                to={isSuperAdministrator(user) ? '/admin?tab=registration' : '/membership'}
                onClick={() => setNotices(false)}
              >
                {isSuperAdministrator(user) ? '查看注册申请' : '查看审核结果'}
              </Link>
            )}
            <button
              className="text-button"
              onClick={async () => {
                try {
                  await api.markRead();
                  await refresh();
                } catch (e) {
                  toast((e as Error).message);
                }
              }}
            >
              全部标为已读
            </button>
          </div>
          {data.notices.length === 0 ? (
            <Empty title="暂无通知">预约状态更新后会显示在这里。</Empty>
          ) : (
            <div className="notice-list">
              {data.notices.map((n) => (
                <article key={n.id} className={n.read ? '' : 'unread'}>
                  <h3>{n.title}</h3>
                  <p>{n.body}</p>
                  <small>{cnDate(n.created_at)}</small>
                </article>
              ))}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
