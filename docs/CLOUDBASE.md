# 腾讯云 CloudBase（上海）接入与维护

当前平台使用 CloudBase 原生身份认证、PostgreSQL、云函数和图片存储。前端仍是可部署到 GitHub Pages 的静态网站；目前只在本地预览，Pages 已取消发布。

## 本地配置

创建不提交到 Git 的 `.env.local`：

```dotenv
VITE_DATA_MODE=cloudbase
VITE_CLOUDBASE_ENV_ID=hclab-equipments-d0ehkkk05991a35
VITE_CLOUDBASE_REGION=ap-shanghai
VITE_CLOUDBASE_PUBLISHABLE_KEY=控制台提供的PublishableKey
```

然后运行 `npm ci`、`npm run dev`。前端只能使用 Publishable Key；不能放入腾讯云 SecretId / SecretKey、数据库密码或服务管理员 Key。构建脚本校验公开 Key 的角色、环境与地域。

CloudBase 控制台 HTTP 网关 → 跨域设置中允许 `http://127.0.0.1:5173` 和需要使用的其他前端来源。未来公开 GitHub Pages 时使用来源 `https://hclab-gz.github.io`（不带仓库路径）。增加来源不会自动发布网站。

## 数据库和注册云函数

此环境已执行 `cloudbase/migrations/` 内四份迁移并部署 `hclab-register`。**不要再把 Supabase 迁移复制到此环境执行**；两者原生身份结构不同。

维护时使用官方 CloudBase CLI 3.8.1 或兼容版本，先 `tcb login` 完成本机授权；部署设置在 `cloudbaserc.json`。在项目根目录运行：

```bash
tcb db pg migration up --dry-run --json
tcb db pg migration up --json
tcb fn deploy hclab-register --force --json
```

已经应用的迁移保持不变，后续变更新增迁移文件。云函数使用 CloudBase 注入的短期凭据调用官方用户管理和数据库接口，不需要把长期管理员密钥配置进项目。

未登录的新成员需要调用注册函数。CloudBase 的“云函数安全规则”独立于 HTTP 网关跨域及 OPA 设置。本项目只为 `hclab-register` 添加 `invoke: true`，其他函数继续保留原规则。可使用维护脚本先检查，再应用：

```bash
node scripts/configure-cloudbase-registration.mjs
node scripts/configure-cloudbase-registration.mjs --apply
```

若 `tcb` 未在 PATH 中，通过环境变量 `HCLAB_TCB_CLI` 指定 CLI 可执行文件。脚本调用官方 `DescribeSecurityRule` / `ModifySecurityRule`（ResourceType 为 `FUNCTION`），合并现有规则，不替换其他函数的权限。控制台规则可能需要 1–3 分钟生效。函数内部仍强制核验有效、未消费、邮箱匹配的满分考试凭证。

## 注册、登录与首个管理员

1. 新成员填写姓名、邮箱、学号/工号、项目、密码，阅读条例，随机回答 10 题。
2. 服务器判卷，只有 100 分才签发绑定邮箱、有效 30 分钟的一次性注册凭证。过期可以重新考试。
3. 云函数先固定身份，再通过官方接口创建原生账号，最后创建普通用户资料；中断后同一资料可以安全重试。
4. 用户仍使用邮箱与密码登录。内部用户名为 `hclab_` 加规范化邮箱 SHA-256 的前 40 位，避免原生登录接口的 48 字符长度上限。

当前采用用户名密码认证，邮箱用作平台登录标识，**尚未验证邮箱所有权，也没有邮箱找回密码流程**。密码为 10–32 位，首位为英文字母或数字，至少包含大写字母、小写字母、数字、允许的特殊字符中的三类。密码由 CloudBase 管理，业务数据库不保存密码。

首个管理员先通过普通注册考试，再由环境所有者核对邮箱、姓名与学号，在 SQL 编辑器执行以下定向操作。请将占位值替换成已核对的真实值；公开注册和前端都不能提升权限。

```sql
select id, name, email, student_id, role
from public.profiles
where email = lower('管理员邮箱');

-- 核对上方结果后，仅更新该身份。
update public.profiles
set role = 'admin'
where id = '上方核对后的完整id'
  and email = lower('管理员邮箱')
returning id, name, email, role;
```

用户重新登录管理员入口 `#/login?admin=1` 后即可录入设备与审批。正式环境不包含默认管理员、演示设备或演示密码；管理员和 504/505 存放位置都由实际录入人员指定。

## 数据与权限

- 公共页面仅展示设备资料。未登录者不能看到成员、预约、通知或违规记录。
- 普通成员只能查看和操作自己的预约；查看其他人的占用时段不暴露姓名或用途。
- 管理员可维护设备、审批、查看记录、上传图片并记录违规。图片限 2 MB 的 JPG/PNG/WebP。
- 所有设备、预约、准入修改由数据库事务再次校验；冲突申请不能同时成功。
- 续约需要单独申请与批准。归还必须登记，超时不会自动改成已归还。
- 平台准入限制不直接控制实验室实体门禁。

## GitHub 配置与发布状态

目前推送 main 只测试和构建，`publish` 默认 false。不得因后端接入而自动恢复发布。未来经课题组确认公开后，仓库管理员配置同名 Actions Variables，再手动运行工作流并勾选 publish。

验证命令为 `npm test` 和 `npm run build`。数据库测试运行真实 PostgreSQL SQL，并模拟本环境的原生身份结构；真实环境联调另见实施记录。

2026-09-14：条例全文提取后升为 `2026-09-v3`。迁移 `20260914000003_rules_update.sql` 使新考试采用新版本；已有考试和凭证保持原有效期，新成员资料记录其实际考试版本。既有成员的准入记录保持不变，无须重新注册。
