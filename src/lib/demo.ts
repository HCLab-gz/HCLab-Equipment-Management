import { seed, superAdministrator } from '../data/seed';
import { questions } from '../data/questions';
import { RULES_VERSION } from '../data/rules';
import { isApproved, isAdministrator, isSuperAdministrator, ROLE_LABELS } from './membership';
import {
  ACTIVE_STATUSES,
  accessState,
  nextPenalty,
  overlaps,
  validateBooking,
  equipmentScheduleError,
} from './domain';
import type { DataService, Snapshot, Equipment, Profile, AnswerQuestion } from './types';
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Database = Snapshot & { passwords: Record<string, { salt: string; hash: string }> };
const KEY = 'hclab-demo-v1',
  SESSION = 'hclab-demo-session';
async function digest(password: string, salt: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bytes = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' },
    key,
    256,
  );
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
export function createDemoService(storage: StorageLike): DataService {
  const exams = new Map<
      string,
      { email: string; questions: AnswerQuestion[]; used: boolean; expires: number }
    >(),
    proofs = new Map<string, string>();
  function read(): Database {
    const saved = storage.getItem(KEY);
    if (saved) {
      try {
        const db = JSON.parse(saved) as Database;
        db.applications ??= [];
        db.profiles.forEach((p) => {
          p.membership_status ??= 'approved';
        });
        if (!db.profiles.some((p) => p.id === superAdministrator.id))
          db.profiles.unshift({ ...superAdministrator });
        return db;
      } catch {
        throw new Error('演示数据无法读取，请清除此网站的演示存储后重试');
      }
    }
    const db = { ...seed(), passwords: {} };
    save(db);
    return db;
  }
  function save(db: Database) {
    try {
      storage.setItem(KEY, JSON.stringify(db));
    } catch {
      throw new Error('本浏览器存储空间不足，保存失败。请减小图片或清理演示数据。');
    }
  }
  function current(db = read()) {
    return db.profiles.find((p) => p.id === storage.getItem(SESSION)) ?? null;
  }
  function requireUser(db: Database, admin = false): Profile {
    const p = current(db);
    if (!p) throw new Error('请先登录');
    if (!isApproved(p)) throw new Error('注册申请尚未通过审核');
    if (admin && !isAdministrator(p)) throw new Error('仅管理员可以执行此操作');
    return p;
  }
  function notify(db: Database, id: string, title: string, body: string) {
    db.notices.unshift({
      id: crypto.randomUUID(),
      user_id: id,
      title,
      body,
      read: false,
      created_at: new Date().toISOString(),
    });
  }
  return {
    mode: 'demo',
    async session() {
      return current();
    },
    async demoLogin(role) {
      const p = read().profiles.find((x) => x.id === `demo-${role}`)!;
      storage.setItem(SESSION, p.id);
      return p;
    },
    async login(email, password) {
      const db = read(),
        p = db.profiles.find((p) => p.email === email.trim().toLowerCase()),
        record = p && db.passwords[p.id];
      if (!p || !record || (await digest(password, record.salt)) !== record.hash)
        throw new Error('邮箱或密码不正确；内置账号请使用演示体验入口');
      storage.setItem(SESSION, p.id);
      return p;
    },
    async logout() {
      storage.removeItem(SESSION);
    },
    async snapshot() {
      const db = read(),
        p = current(db),
        admin = isAdministrator(p),
        approved = isApproved(p),
        superAdmin = isSuperAdministrator(p);
      return {
        equipment: db.equipment,
        bookings: db.bookings.filter((b) => approved && (admin || b.user_id === p!.id)),
        profiles: db.profiles.filter(
          (u) => p && (u.id === p.id || superAdmin || (admin && isApproved(u))),
        ),
        applications: db.applications.filter((a) => p && (superAdmin || a.user_id === p.id)),
        notices: db.notices.filter((n) => n.user_id === p?.id),
        violations: db.violations.filter((v) => approved && (admin || v.user_id === p!.id)),
        busy: approved
          ? db.bookings
              .filter((b) => ACTIVE_STATUSES.includes(b.status))
              .map(({ equipment_id, starts_at, ends_at, status, user_name }) => ({
                equipment_id,
                user_name,
                starts_at,
                ends_at,
                status,
              }))
          : [],
      };
    },
    async startExam(email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('请输入有效邮箱');
      const shuffled = [...questions];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const id = crypto.randomUUID(),
        selected = shuffled.slice(0, 10);
      exams.set(id, {
        email: email.trim().toLowerCase(),
        questions: selected,
        used: false,
        expires: Date.now() + 1800000,
      });
      return {
        id,
        questions: selected.map(({ id, question, options }) => ({ id, question, options })),
      };
    },
    async submitExam(id, answers) {
      const exam = exams.get(id);
      if (!exam || exam.used || exam.expires < Date.now())
        throw new Error('本次考试已提交或已超时，请重新抽题');
      if (exam.questions.some((q) => answers[q.id] === undefined))
        throw new Error('请完成全部 10 道题');
      exam.used = true;
      const score = exam.questions.filter((q) => answers[q.id] === q.answer).length * 10,
        passed = score === 100;
      const token = passed ? crypto.randomUUID() : undefined;
      if (token) proofs.set(token, exam.email);
      return {
        score,
        passed,
        token,
        review: exam.questions
          .filter((q) => answers[q.id] !== q.answer)
          .map((q) => ({
            question: q.question,
            correct: q.options[q.answer],
            explanation: q.explanation,
          })),
      };
    },
    async register(input) {
      const email = input.email.trim().toLowerCase();
      const requested = input.requested_role ?? 'user';
      if (!['user', 'admin'].includes(requested))
        throw new Error('申请身份只能选择普通成员或管理员');
      if (proofs.get(input.token) !== email) throw new Error('请先阅读条例并通过准入考试');
      if (input.password.length < 10 || !input.name.trim() || !input.student_id.trim())
        throw new Error('请填写姓名、学号及至少 10 位密码');
      const db = read();
      if (db.profiles.some((p) => p.email === email)) throw new Error('该邮箱已注册');
      const id = crypto.randomUUID(),
        salt = crypto.randomUUID();
      db.passwords[id] = { salt, hash: await digest(input.password, salt) };
      db.profiles.push({
        id,
        name: input.name.trim(),
        email,
        student_id: input.student_id.trim(),
        project: input.project.trim(),
        role: 'user',
        membership_status: 'pending',
        banned: false,
        suspended_until: null,
        violations_count: 0,
      });
      db.applications.unshift({
        id: crypto.randomUUID(),
        user_id: id,
        name: input.name.trim(),
        email,
        student_id: input.student_id.trim(),
        project: input.project.trim(),
        requested_role: requested,
        status: 'pending',
        score: 100,
        rules_version: RULES_VERSION,
        created_at: new Date().toISOString(),
        reviewed_at: null,
        reviewer_name: null,
        review_note: '',
      });
      notify(db, id, '注册申请已提交', '满分考试已通过，正在等待超级管理员审核。');
      notify(
        db,
        superAdministrator.id,
        '新的注册申请',
        `${input.name.trim()} 申请成为${ROLE_LABELS[requested]}，请前往注册审核核实身份。`,
      );
      save(db);
      proofs.delete(input.token);
      storage.setItem(SESSION, id);
      return { needsConfirmation: false, needsApproval: true };
    },
    async reviewMembership(id, action, note = '') {
      const db = read(),
        actor = requireUser(db);
      if (!isSuperAdministrator(actor)) throw new Error('仅超级管理员可以审核注册申请');
      if (!['approve', 'reject'].includes(action)) throw new Error('请选择同意或拒绝');
      if (note.length > 1000 || (action === 'reject' && note.trim().length < 2))
        throw new Error('请填写有效的拒绝原因或审核说明');
      const app = db.applications.find((a) => a.id === id),
        target = app && db.profiles.find((p) => p.id === app.user_id);
      if (!app || !target) throw new Error('注册申请不存在');
      if (target.id === actor.id || target.role === 'super_admin')
        throw new Error('不能审核自己的身份或修改超级管理员');
      const status = action === 'approve' ? 'approved' : 'rejected';
      if (app.status !== 'pending') {
        if (app.status === status) return;
        throw new Error('该申请已审核，请刷新后查看结果');
      }
      if (app.score !== 100) throw new Error('须通过满分考试才可审核');
      target.membership_status = status;
      target.role = action === 'approve' ? app.requested_role : 'user';
      Object.assign(app, {
        status,
        reviewed_at: new Date().toISOString(),
        reviewer_name: actor.name,
        review_note: note.trim(),
      });
      notify(
        db,
        target.id,
        action === 'approve' ? '注册申请已通过' : '注册申请未通过',
        action === 'approve'
          ? `成员身份已核实，你已获准以${ROLE_LABELS[target.role]}身份使用平台。`
          : `原因：${note.trim()}。如需复核，请联系超级管理员。`,
      );
      save(db);
    },
    async saveEquipment(input) {
      const db = read();
      requireUser(db, true);
      if (
        !input.name?.trim() ||
        !input.model?.trim() ||
        !input.category?.trim() ||
        !input.location?.trim() ||
        !input.project?.trim() ||
        !['504', '505'].includes(input.room ?? '')
      )
        throw new Error('请完整填写设备必填信息');
      if (!db.profiles.some((p) => p.id === input.manager_id && isAdministrator(p)))
        throw new Error('请选择有效的负责管理员');
      const scheduleError = equipmentScheduleError(
        input.open_time,
        input.close_time,
        input.weekdays,
      );
      if (scheduleError) throw new Error(scheduleError);
      const existing = db.equipment.find((e) => e.id === input.id),
        id = existing?.id ?? crypto.randomUUID();
      const eq = {
        ...input,
        id,
        manager_name: db.profiles.find((p) => p.id === input.manager_id)!.name,
        created_at: existing?.created_at ?? new Date().toISOString(),
      } as Equipment;
      db.equipment = existing
        ? db.equipment.map((e) => (e.id === id ? eq : e))
        : [eq, ...db.equipment];
      save(db);
    },
    async uploadImage(file) {
      requireUser(read(), true);
      if (
        !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
        file.size > 2 * 1024 * 1024
      )
        throw new Error('仅支持 2 MB 以内的 JPG、PNG、WebP 图片');
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('图片读取失败'));
        reader.readAsDataURL(file);
      });
    },
    async book(input) {
      const db = read(),
        p = requireUser(db);
      if (!accessState(p)) throw new Error('准入权限已停用，暂不能预约');
      const eq = db.equipment.find((e) => e.id === input.equipment_id);
      if (!eq) throw new Error('设备不存在');
      const error = validateBooking(eq, input.starts_at, input.ends_at);
      if (error) throw new Error(error);
      if (input.purpose.trim().length < 2) throw new Error('请填写使用用途');
      if (
        db.bookings.some(
          (b) =>
            b.equipment_id === eq.id &&
            ACTIVE_STATUSES.includes(b.status) &&
            overlaps(input.starts_at, input.ends_at, b.starts_at, b.ends_at),
        )
      )
        throw new Error('该时段已有预约，请选择其他时间');
      if (input.parent_id) {
        const old = db.bookings.find((b) => b.id === input.parent_id);
        if (
          !old ||
          old.user_id !== p.id ||
          old.equipment_id !== eq.id ||
          !['approved', 'in_use'].includes(old.status) ||
          +new Date(old.ends_at) !== +new Date(input.starts_at)
        )
          throw new Error('续约需紧接本人已批准预约的结束时间');
      }
      db.bookings.unshift({
        ...input,
        id: crypto.randomUUID(),
        user_id: p.id,
        user_name: p.name,
        status: 'pending',
        review_note: '',
        return_note: '',
        returned_at: null,
        parent_id: input.parent_id ?? null,
        created_at: new Date().toISOString(),
      });
      notify(
        db,
        eq.manager_id,
        '有新的预约申请',
        `${p.name} 申请了 ${eq.name}，请前往管理后台审批。`,
      );
      save(db);
    },
    async bookingAction(id, action, note = '') {
      const db = read(),
        p = requireUser(db),
        b = db.bookings.find((x) => x.id === id);
      if (!b) throw new Error('预约不存在');
      const eq = db.equipment.find((x) => x.id === b.equipment_id)!;
      if (action === 'approve' || action === 'reject') {
        requireUser(db, true);
        if (b.status !== 'pending') throw new Error('仅能审批待审批记录');
        if (
          action === 'approve' &&
          (!accessState(db.profiles.find((x) => x.id === b.user_id)!) ||
            eq.status !== 'available' ||
            new Date(b.starts_at) <= new Date())
        )
          throw new Error('设备、准入状态或预约时间已变化，无法批准');
        if (action === 'reject' && !note.trim()) throw new Error('请填写驳回原因');
        b.status = action === 'approve' ? 'approved' : 'rejected';
        b.review_note = note;
        notify(
          db,
          b.user_id,
          action === 'approve' ? '预约已批准' : '预约已驳回',
          `${eq.name}${note ? '：' + note : ''}`,
        );
      } else {
        if (b.user_id !== p.id) throw new Error('仅申请人可以执行此操作');
        if (action === 'cancel') {
          if (!['pending', 'approved'].includes(b.status)) throw new Error('当前状态无法取消');
          b.status = 'cancelled';
        }
        if (action === 'checkout') {
          if (
            b.status !== 'approved' ||
            !accessState(p) ||
            eq.status !== 'available' ||
            new Date() < new Date(b.starts_at) ||
            new Date() >= new Date(b.ends_at)
          )
            throw new Error('仅能在批准时间内且准入、设备状态正常时开始使用');
          if (
            db.bookings.some(
              (x) =>
                x.id !== b.id &&
                x.equipment_id === b.equipment_id &&
                x.status === 'in_use' &&
                !(
                  x.id === b.parent_id &&
                  x.user_id === p.id &&
                  +new Date(x.ends_at) === +new Date(b.starts_at)
                ),
            )
          )
            throw new Error('上一位使用者尚未归还，请联系管理员');
          const parent = db.bookings.find(
            (x) =>
              x.id === b.parent_id &&
              x.status === 'in_use' &&
              x.user_id === p.id &&
              x.equipment_id === b.equipment_id &&
              +new Date(x.ends_at) === +new Date(b.starts_at),
          );
          if (parent) {
            parent.status = 'renewed';
            parent.return_note = '已衔接批准的续约，设备由同一使用者继续使用，未作物理归还';
          }
          b.status = 'in_use';
        }
        if (action === 'return') {
          if (b.status !== 'in_use' || !note.trim()) throw new Error('使用中的设备须填写归还情况');
          b.status = 'returned';
          b.return_note = note;
          b.returned_at = new Date().toISOString();
        }
        notify(db, eq.manager_id, '预约状态更新', `${p.name} 的 ${eq.name} 预约已更新。`);
      }
      save(db);
    },
    async markRead() {
      const db = read(),
        p = current(db);
      if (!p) throw new Error('请先登录');
      db.notices
        .filter((n) => n.user_id === p.id)
        .forEach((n) => {
          n.read = true;
        });
      save(db);
    },
    async recordViolation(userId, reason) {
      const db = read();
      requireUser(db, true);
      const p = db.profiles.find((p) => p.id === userId && p.role === 'user');
      if (!p || reason.trim().length < 2) throw new Error('请选择普通用户并填写违规事实');
      const penalty = nextPenalty(p.violations_count);
      Object.assign(p, penalty);
      db.violations.unshift({
        id: crypto.randomUUID(),
        user_id: userId,
        reason: reason.trim(),
        penalty: penalty.penalty,
        created_at: new Date().toISOString(),
      });
      notify(db, p.id, '准入状态更新', `${penalty.penalty}。记录：${reason}`);
      save(db);
    },
  };
}
