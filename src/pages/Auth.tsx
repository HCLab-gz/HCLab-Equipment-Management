import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ShieldCheck, ArrowRight, CheckCircle2, BookOpen, ArrowLeft } from 'lucide-react';
import { useApp } from '../lib/store';
import { CLOUDBASE_PASSWORD_HINT, registrationPasswordError } from '../lib/registration';
import { RulesReader } from '../components/RulesReader';
import type { Exam, ExamResult } from '../lib/types';
export function Login() {
  const { api, refresh, clearSession, toast } = useApp(),
    navigate = useNavigate(),
    [params] = useSearchParams(),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const admin = params.get('admin') === '1';
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      clearSession();
      const p = await api.login(email, password);
      if (admin && p.role !== 'admin') {
        await api.logout();
        throw new Error('此入口仅供管理员使用，请通过用户登录入口登录');
      }
      await refresh();
      navigate(admin ? '/admin' : '/');
      toast('登录成功');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="auth-card">
      <span className="eyebrow">
        <ShieldCheck size={15} />
        {admin ? '管理员专属入口' : '欢迎回到实验室'}
      </span>
      <h1>{admin ? '管理后台登录' : '登录 HCLab'}</h1>
      <p>
        {admin
          ? '使用已分配管理员权限的账号登录。管理员权限由课题组负责人在数据服务中设置。'
          : '登录后查看可预约时间，提交申请并跟进设备使用记录。'}
      </p>
      <form className="form-stack" onSubmit={submit}>
        <label className="form-field">
          邮箱
          <input
            autoComplete="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="请输入注册邮箱"
          />
        </label>
        <label className="form-field">
          密码
          <input
            autoComplete="current-password"
            required
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="请输入密码"
          />
        </label>
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        <button disabled={busy} className="button full">
          {busy ? '正在登录…' : admin ? '登录管理后台' : '登录'}
          <ArrowRight size={17} />
        </button>
      </form>
      <p className="auth-footer">
        {admin ? (
          <Link to="/login">返回用户登录</Link>
        ) : (
          <>
            还没有账号？<Link to="/register">阅读条例并注册</Link>
            <br />
            <Link to="/login?admin=1">管理员登录入口</Link>
          </>
        )}
      </p>
      {api.mode === 'demo' && (
        <div className="demo-login">
          <p>演示体验（不连接真实实验室数据）</p>
          <div>
            {(['user', 'admin'] as const).map((role) => (
              <button
                disabled={busy}
                key={role}
                onClick={async () => {
                  setBusy(true);
                  try {
                    clearSession();
                    await api.demoLogin!(role);
                    await refresh();
                    navigate(role === 'admin' ? '/admin' : '/');
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {role === 'user' ? '体验普通用户' : '体验管理员'}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
export function RulesPage() {
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">共同遵守，安全共享</div>
          <h1>
            实验室管理条例<span className="heading-dot">.</span>
          </h1>
          <p>适用于 504 / 505 实验室。请在使用任何设备前认真阅读。</p>
        </div>
        <Link className="button secondary" to="/register">
          阅读并注册
          <ArrowRight size={16} />
        </Link>
      </div>
      <section className="panel">
        <RulesReader />
      </section>
    </>
  );
}
export function Register() {
  const { api, refresh, clearSession } = useApp(),
    navigate = useNavigate(),
    [step, setStep] = useState(0),
    [info, setInfo] = useState({ name: '', email: '', student_id: '', project: '', password: '' }),
    [accepted, setAccepted] = useState(false),
    [exam, setExam] = useState<Exam | null>(null),
    [answers, setAnswers] = useState<Record<number, number>>({}),
    [result, setResult] = useState<ExamResult | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [confirmation, setConfirmation] = useState(false);
  async function start() {
    setBusy(true);
    setError('');
    try {
      const passwordError = registrationPasswordError(info.password, api.mode);
      if (passwordError) throw new Error(passwordError);
      setExam(await api.startExam(info.email));
      setAnswers({});
      setResult(null);
      setStep(2);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    setBusy(true);
    setError('');
    try {
      let r = result;
      if (!r?.passed) {
        r = await api.submitExam(exam!.id, answers);
        setResult(r);
      }
      if (r.passed) {
        clearSession();
        const registration = await api.register({ ...info, token: r.token! });
        setConfirmation(registration.needsConfirmation);
        await refresh();
        setStep(3);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="registration">
      <div className="page-heading">
        <div>
          <div className="eyebrow">新成员准入</div>
          <h1>
            加入 HCLab<span className="heading-dot">.</span>
          </h1>
          <p>阅读管理条例，通过简单考试，成为负责任的设备使用者。</p>
        </div>
        <Link className="muted" to="/login">
          已有账号？登录
        </Link>
      </div>
      <div className="steps">
        {['填写信息', '阅读条例', '准入考试'].map((s, i) => (
          <div key={s} className={step >= i ? 'active' : ''}>
            <span>{step > i ? <CheckCircle2 size={18} /> : String(i + 1).padStart(2, '0')}</span>
            {s}
            {i < 2 && <i />}
          </div>
        ))}
      </div>
      <section className="panel registration-panel">
        {step === 0 && (
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              const passwordError = registrationPasswordError(info.password, api.mode);
              setError(passwordError ?? '');
              if (passwordError) return;
              setStep(1);
            }}
          >
            <h2>创建你的用户账号</h2>
            <p className="muted">此入口仅注册普通用户；所有设备申请均须管理员审批。</p>
            <div className="form-grid">
              {[
                ['name', '姓名', 'text'],
                ['student_id', '学号 / 成员工号', 'text'],
                ['email', '邮箱', 'email'],
                ['project', '项目归属', 'text'],
              ].map(([key, label, type]) => (
                <label className="form-field" key={key}>
                  {label}
                  <input
                    required
                    type={type}
                    value={info[key as keyof typeof info]}
                    maxLength={key === 'email' ? 254 : 80}
                    onChange={(e) => setInfo({ ...info, [key]: e.target.value })}
                  />
                </label>
              ))}
              <label className="form-field span-2">
                密码
                <input
                  required
                  minLength={10}
                  maxLength={api.mode === 'cloudbase' ? 32 : 128}
                  type="password"
                  autoComplete="new-password"
                  placeholder={
                    api.mode === 'cloudbase'
                      ? '10–32 位，至少包含三类字符'
                      : '至少 10 位，请勿使用其他网站的密码'
                  }
                  aria-describedby={api.mode === 'cloudbase' ? 'password-hint' : undefined}
                  value={info.password}
                  onChange={(e) => setInfo({ ...info, password: e.target.value })}
                />
                {api.mode === 'cloudbase' && (
                  <small id="password-hint">{CLOUDBASE_PASSWORD_HINT}</small>
                )}
              </label>
            </div>
            <div className="form-actions">
              <button className="button">
                下一步：阅读条例
                <ArrowRight size={16} />
              </button>
            </div>
          </form>
        )}
        {step === 1 && (
          <>
            <div className="section-heading">
              <h2>
                <BookOpen size={18} />
                请完整阅读管理条例
              </h2>
            </div>
            <RulesReader />
            <label className="check-label rule-agree">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              我已阅读并理解本版实验室管理条例，承诺按批准时段使用并按要求归还设备。
            </label>
            <div className="form-actions">
              <button onClick={() => setStep(0)}>
                <ArrowLeft size={14} /> 上一步
              </button>
              <button disabled={!accepted || busy} onClick={start} className="button">
                {busy ? '正在抽题…' : '开始准入考试'}
                <ArrowRight size={16} />
              </button>
            </div>
          </>
        )}
        {step === 2 && exam && (
          <>
            <div className="exam-header">
              <div>
                <h2>实验室准入考试</h2>
                <p>随机 10 道单选题 · 每题 10 分 · 100 分满分合格 · 30 分钟内提交</p>
              </div>
              <strong>
                {Object.keys(answers).length}
                <span> / 10 已作答</span>
              </strong>
            </div>
            {result && (
              <div className={`exam-result ${result.passed ? 'passed' : ''}`}>
                <h3>
                  本次得分 {result.score} 分 · {result.passed ? '考试通过' : '尚未通过'}
                </h3>
                <p>
                  {result.passed
                    ? busy
                      ? '已获得准入合格凭证，正在完成账号注册。'
                      : '考试已通过，注册流程尚未完成。请按下方提示重试；若凭证已过期，可重新考试获取新凭证，已填资料会保留。'
                    : '请复习以下内容，再重新抽题作答。'}
                </p>
                {result.review?.map((r) => (
                  <div key={r.question}>
                    <strong>{r.question}</strong>
                    <p>
                      正确答案：{r.correct}。{r.explanation}
                    </p>
                  </div>
                ))}
              </div>
            )}
            {exam.questions.map((q, i) => (
              <fieldset className="exam-question" key={q.id} disabled={!!result}>
                <legend>
                  <span>{String(i + 1).padStart(2, '0')}</span>
                  {q.question}
                </legend>
                {q.options.map((o, j) => (
                  <label className={answers[q.id] === j ? 'chosen' : ''} key={o}>
                    <input
                      type="radio"
                      name={`q-${q.id}`}
                      checked={answers[q.id] === j}
                      onChange={() => setAnswers({ ...answers, [q.id]: j })}
                    />
                    <span>{String.fromCharCode(65 + j)}.</span>
                    {o}
                  </label>
                ))}
              </fieldset>
            ))}
            <div className="form-actions">
              {result?.passed && (
                <button disabled={busy} className="button secondary" onClick={start}>
                  重新考试获取新凭证
                </button>
              )}
              {result && !result.passed ? (
                <button disabled={busy} className="button" onClick={start}>
                  重新抽题考试
                </button>
              ) : (
                <button
                  disabled={Object.keys(answers).length !== 10 || busy}
                  className="button"
                  onClick={submit}
                >
                  {busy
                    ? '正在验证并注册…'
                    : result?.passed
                      ? '重试完成注册'
                      : '提交答案并完成注册'}
                </button>
              )}
            </div>
          </>
        )}
        {step === 3 && (
          <div className="registration-success">
            <CheckCircle2 size={54} />
            <h2>{confirmation ? '考试已通过，请验证邮箱' : '注册成功，欢迎加入 HCLab'}</h2>
            <p>
              {confirmation
                ? '账号注册已提交。请在邮箱中打开验证链接后登录；未验证前不能预约。'
                : '你的准入考试已通过。预约获批后，请在批准时间内使用设备。'}
            </p>
            <button
              className="button"
              onClick={() => navigate(confirmation ? '/login' : '/equipment')}
            >
              {confirmation ? '前往登录' : '浏览可预约设备'}
              <ArrowRight size={16} />
            </button>
          </div>
        )}
        {error && (
          <p className="inline-error" role="alert" style={{ marginTop: 18 }}>
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
