const { createHash } = require('node:crypto');

class InputError extends Error {}
function normalize(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InputError('注册信息格式不正确');
  const string = (key, max, min = 1) => {
    if (typeof input[key] !== 'string') throw new InputError('请完整填写注册信息');
    const value = input[key].trim();
    if (value.length < min || value.length > max) throw new InputError('注册信息长度不符合要求');
    return value;
  };
  const email = string('email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InputError('请输入有效邮箱');
  const token = string('token', 36);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(token)) throw new InputError('考试凭证无效，请重新考试');
  const password = input.password;
  const requested_role = input.requested_role === undefined ? 'user' : input.requested_role;
  if (!['user', 'admin'].includes(requested_role)) throw new InputError('申请身份只能选择普通成员或管理员');
  if (typeof password !== 'string' || password.length < 10 || password.length > 32 || !/^[A-Za-z0-9]/.test(password)
    || [/[a-z]/, /[A-Z]/, /[0-9]/, /[()!@#$%^&*|?><_-]/].filter(re => re.test(password)).length < 3)
    throw new InputError('密码须以字母或数字开头，10–32位，并包含大写、小写、数字、特殊符号中至少三类');
  return {
    password,
    data: { email, token, requested_role, name: string('name', 80), student_id: string('student_id', 80), project: string('project', 120),
      username: `hclab_${createHash('sha256').update(email).digest('hex').slice(0, 40)}` },
  };
}

// Keep SQL arguments as string literals; never interpolate identifiers from a request.
function sqlLiteral(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function parseSqlJson(result) {
  if (!Array.isArray(result.Rows) || result.Rows.length !== 1) throw new Error('Unexpected SQL result');
  const row = typeof result.Rows[0] === 'string' ? JSON.parse(result.Rows[0]) : result.Rows[0];
  const value = typeof row[0] === 'string' ? JSON.parse(row[0]) : row[0];
  if (!value || typeof value !== 'object') throw new Error('Unexpected SQL value');
  return value;
}
function publicError(error) {
  if (error instanceof InputError) return error.message;
  // PostgreSQL business errors are explicitly raised in Chinese. Provider diagnostics stay private.
  const msg = error?.message || '';
  const match = msg.match(/(请先[^\n;]{0,120}|本[^\n;]{0,100}凭证[^\n;]{0,100}|考试凭证[^\n;]{0,120}|该邮箱[^\n;]{0,120}|注册资料[^\n;]{0,120}|请完整填写[^\n;]{0,100}|尚未配置可用的超级管理员[^\n;]{0,100})/);
  return match?.[1]?.replace(/\s*\(SQLSTATE [^)]*\)/g, '') || '注册暂未完成，请重试；如已创建账号，请尝试登录。';
}
function createRegistrationHandler(adapter) {
  return async input => {
    try {
      const { data, password } = normalize(input);
      const claim = await adapter.claim(data);
      if (claim.completed) return { ok: true };
      try {
        await adapter.createUser({ name: claim.username, uid: claim.uid, type: 'externalUser', password, email: data.email, userStatus: 'ACTIVE' });
      } catch {
        // A timed-out create may already have succeeded. finish independently checks the
        // reserved native UID; it cannot bind an unrelated pre-existing account.
        await adapter.finish(data.token);
        return { ok: true };
      }
      await adapter.finish(data.token);
      return { ok: true };
    } catch (error) {
      if (!(error instanceof InputError)) adapter.reportError?.(error);
      return { ok: false, error: publicError(error) };
    }
  };
}
module.exports = { createRegistrationHandler, sqlLiteral, parseSqlJson };
