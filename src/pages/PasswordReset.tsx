import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, ArrowRight, CheckCircle2 } from 'lucide-react';
import { useApp } from '../lib/store';
import { CLOUDBASE_PASSWORD_HINT, registrationPasswordError } from '../lib/registration';
import { resetEmail, type PasswordResetChallenge } from '../lib/passwordReset';

export function PasswordReset() {
  const { api, clearSession } = useApp();
  const [email, setEmail] = useState(''),
    [code, setCode] = useState('');
  const [password, setPassword] = useState(''),
    [repeat, setRepeat] = useState('');
  const [challenge, setChallenge] = useState<PasswordResetChallenge | null>(null);
  const [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  const [error, setError] = useState(''),
    [cooldown, setCooldown] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (busy || cooldown || !api.requestPasswordReset) return;
    setError('');
    let address: string;
    try {
      address = resetEmail(challenge?.email ?? email);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    setBusy(true);
    // A new code supersedes the challenge in this page, even when delivery fails.
    setChallenge(null);
    setCode('');
    setPassword('');
    setRepeat('');
    try {
      const result = await api.requestPasswordReset(address);
      if (!mounted.current) return;
      setEmail(result.email);
      setChallenge(result);
      setCooldown(60);
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !challenge) return;
    setError('');
    if (password !== repeat) {
      setError('两次输入的密码不一致');
      return;
    }
    const invalid = registrationPasswordError(password, api.mode);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    try {
      await challenge.complete(code, password);
      if (!mounted.current) return;
      clearSession();
      setChallenge(null);
      setCode('');
      setPassword('');
      setRepeat('');
      setDone(true);
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <section className="auth-card">
      <span className="eyebrow">
        <KeyRound size={15} />
        账号安全
      </span>
      <h1>{done ? '密码已重置' : '找回密码'}</h1>
      {done ? (
        <>
          <p className="info-box">
            <CheckCircle2 size={18} /> 请使用注册邮箱和新密码重新登录。
          </p>
          <Link className="button full" to="/login">
            返回登录
            <ArrowRight size={17} />
          </Link>
        </>
      ) : !api.requestPasswordReset ? (
        <>
          <p>
            当前{api.mode === 'demo' ? '演示模式不发送邮件' : '数据服务尚未接入邮箱找回'}
            。请在正式网站使用注册邮箱找回密码。
          </p>
          <Link to="/login">返回登录</Link>
        </>
      ) : (
        <>
          <p>通过注册邮箱接收验证码，验证本人身份后设置新密码。</p>
          {!challenge ? (
            <form className="form-stack" onSubmit={send}>
              <label className="form-field">
                注册邮箱
                <input
                  type="email"
                  required
                  autoComplete="email"
                  maxLength={254}
                  value={email}
                  disabled={busy}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="请输入注册时使用的邮箱"
                />
              </label>
              <button className="button full" disabled={busy || cooldown > 0}>
                {busy ? '正在发送…' : cooldown > 0 ? `${cooldown} 秒后可重新发送` : '发送验证码'}
                <ArrowRight size={17} />
              </button>
            </form>
          ) : (
            <form className="form-stack" onSubmit={submit}>
              <p className="info-box">
                验证码已发送至 {challenge.email}
                ，请检查收件箱或垃圾邮件。验证码的有效期以邮件提示为准，刷新页面后需重新获取。
              </p>
              <label className="form-field">
                邮箱验证码
                <input
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={code}
                  disabled={busy}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="6 位验证码"
                />
              </label>
              <button type="button" disabled={busy || cooldown > 0} onClick={() => send()}>
                {cooldown > 0 ? `${cooldown} 秒后可重新发送` : '重新发送验证码'}
              </button>
              <label className="form-field">
                新密码
                <input
                  required
                  type="password"
                  autoComplete="new-password"
                  minLength={10}
                  maxLength={api.mode === 'cloudbase' ? 32 : 128}
                  value={password}
                  disabled={busy}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <small>
                  {api.mode === 'cloudbase' ? CLOUDBASE_PASSWORD_HINT : '密码须为 10–128 位'}
                </small>
              </label>
              <label className="form-field">
                再次输入新密码
                <input
                  required
                  type="password"
                  autoComplete="new-password"
                  value={repeat}
                  disabled={busy}
                  onChange={(e) => setRepeat(e.target.value)}
                />
              </label>
              <button className="button full" disabled={busy}>
                {busy ? '正在重置…' : '确认重置密码'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setChallenge(null);
                  setCode('');
                  setPassword('');
                  setRepeat('');
                  setError('');
                }}
              >
                更换邮箱
              </button>
            </form>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <p className="auth-footer">
            <Link to="/login">返回登录</Link>
          </p>
        </>
      )}
    </section>
  );
}
