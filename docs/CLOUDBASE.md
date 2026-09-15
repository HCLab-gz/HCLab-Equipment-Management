# 腾讯云 CloudBase（上海）接入与维护

当前平台使用 CloudBase 原生身份认证、PostgreSQL、云函数和图片存储。前端为部署到 GitHub Pages 的静态网站：[正式入口](https://hclab-gz.github.io/HCLab-Equipment-Management/)。

## 本地配置

创建不提交到 Git 的 `.env.local`：

```dotenv
VITE_DATA_MODE=cloudbase
VITE_CLOUDBASE_ENV_ID=hclab-equipments-d0ehkkk05991a35
VITE_CLOUDBASE_REGION=ap-shanghai
VITE_CLOUDBASE_PUBLISHABLE_KEY=控制台提供的PublishableKey
```

然后运行 `npm ci`、`npm run dev`。前端只能使用 Publishable Key；不能放入腾讯云 SecretId / SecretKey、数据库密码或服务管理员 Key。构建脚本校验公开 Key 的角色、环境与地域。

CloudBase 控制台 HTTP 网关 → 跨域设置中允许 `http://127.0.0.1:5173` 和需要使用的其他前端来源。GitHub Pages 使用来源 `https://hclab-gz.github.io`（不带仓库路径）；该来源的预检及匿名设备读取已验证通过。增加来源不会自动发布网站。

## 数据库和注册云函数

数据库维护使用 `cloudbase/migrations/` 内的增量迁移，注册由已部署的 `hclab-register` 处理。**不要把 Supabase 迁移复制到此环境执行**；两者原生身份结构不同。

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

## 注册、登录与超级管理员

1. 新成员填写姓名、邮箱、学号/工号、项目、密码，选择申请身份（普通成员或管理员），阅读条例并随机回答 10 题。
2. 服务器判卷，只有 100 分才签发绑定邮箱、有效 30 分钟的一次性注册凭证。
3. 云函数验证凭证后保存原生登录身份；业务资料固定为普通身份、待审核状态。申请身份不能直接转为实际权限，密码只交给原生认证服务。
4. 申请进入超级管理员后台的“注册审核”，并发送站内小铃铛通知。普通管理员看不到他人的注册申请，也不能审批。
5. 超级管理员核实成员身份并同意后，按申请身份授予普通成员或管理员权限。拒绝必须填写原因，申请人可登录查看结果；待审核或未通过者不能预约、改设备或上传图片。
6. 用户使用注册邮箱与密码登录。内部用户名为 `hclab_` 加规范化邮箱 SHA-256 的前 40 位。

当前采用用户名密码认证，邮箱用作平台登录标识，**尚未验证邮箱所有权，也没有邮箱找回密码流程**。密码为 10–32 位，首位为英文字母或数字，至少包含大写字母、小写字母、数字、允许的特殊字符中的三类。密码由 CloudBase 管理，业务数据库不保存密码。

初始超级管理员须由环境所有者根据已核实的现有账号定向设置；生产迁移不包含真实姓名、邮箱或自动提权名单。注册接口永远不能申请 `super_admin`。本环境仅允许一个超级管理员，现有已准入成员保持原权限。

在 SQL 编辑器先核对身份，再以完整 ID、姓名、邮箱共同约束更新：

```sql
select id, name, email, role, membership_status
from public.profiles
where email = lower('已核实的邮箱');

update public.profiles
set role = 'super_admin', membership_status = 'approved'
where id = '上方核对的完整id'
  and name = '已核实的姓名'
  and email = lower('已核实的邮箱')
returning id, name, role, membership_status;
```

超级管理员重新登录后，进入 `#/admin?tab=registration` 核对注册申请；也可以从站内通知直接进入。通知通过现有 30 秒刷新及窗口重新聚焦同步，没有配置邮件通知。审核记录保存申请身份、考试分数、条例版本、审核人、时间与说明。

## 数据与权限

- 公共页面仅展示设备资料。未登录者不能看到成员、预约、通知或违规记录。
- 待审核/未通过账号只能读取自己的申请和通知，没有设备操作权限。
- 普通成员只能查看和操作自己的完整预约；通过审核的成员可在其他人的占用时段中看到姓名，但不开放用途、邮箱或完整预约记录。
- 管理员可维护设备、审批、查看记录、上传图片并记录违规。图片限 2 MB 的 JPG/PNG/WebP。
- 设备图片按 `image_urls` 顺序保存，`image_url` 始终等于第一张封面；旧单图自动迁移并保留。
- 归还须上传一张设备及当前放置位置照片，最大 10 MB，JPG/PNG/WebP。照片保存在私有 `return-photos` 桶，按预约 ID 分目录；只有本人使用中的预约可上传，本人和管理员可通过 10 分钟签名地址查看。客户端不能覆盖或删除归还照片，后端核验对象实际存在且属于本预约。历史归还保持原记录，无须补图。
- 所有设备、预约、准入修改由数据库事务再次校验；冲突申请不能同时成功。
- 续约需要单独申请与批准。归还必须登记，超时不会自动改成已归还。
- 平台准入限制不直接控制实验室实体门禁。

## GitHub 配置与发布状态

2026-09-14 经课题组确认公开。仓库已配置 `VITE_DATA_MODE=cloudbase`、上海环境 ID、地域和 Publishable Key 四项 Actions Variables。前端只使用公开 Key，不含管理员凭据。

推送 main 仍只测试和构建，`publish` 默认 false。发布更新时手动运行工作流并勾选 publish；没有部署成功的提交不会自动替换线上版本。

验证命令为 `npm test` 和 `npm run build`。数据库测试运行真实 PostgreSQL SQL，并模拟本环境的原生身份结构；真实环境联调另见实施记录。

2026-09-14：条例全文提取后升为 `2026-09-v3`。迁移 `20260914000003_rules_update.sql` 使新考试采用新版本；已有考试和凭证保持原有效期，新成员资料记录其实际考试版本。既有成员的准入记录保持不变，无须重新注册。

2026-09-14：迁移 `20260914000004_holiday_question.sql` 将小长假设备处理题的正确选项改为“关闭设备并断电”，同步移除解析中的连续运行例外。新抽题使用更新内容；已有试卷保留原快照，需重新开始考试才能看到新选项。

修改条例后须同步核对 `src/data/questions.ts` 中的选项和解析，并通过新增迁移更新云端 `private.questions`；修改条例正文不会自动更新题库。已应用的迁移和已生成的考试快照不应重写。

2026-09-14：迁移 `20260914000005_membership_approval.sql` 新增注册审核、独立超级管理员和待审核权限隔离。部署时先迁移数据库、再部署注册云函数，最后定向设置已核实的初始超级管理员；不修改任何现有密码。

2026-09-14：迁移 `20260914000006_equipment_hours.sql` 允许设备开放时间精确到分钟（例如 `00:00—23:59`），预约仍按整点/半点划分，仅展示开放范围内完整的半小时。开放范围至少包含一个完整时段，不支持通过单个申请跨日；原有设备和预约记录保留。

2026-09-15：迁移 `20260915000000_all_day_equipment.sql` 支持全天开放（`00:00—24:00`），预约可结束于开始日期的次日零点；开始日仍须在每周开放日内，预约仍按半小时划分并检查冲突与审批。新增设备默认全天、每周七天，现有设备需管理员在编辑窗口选择“全天开放（24 小时）”后保存，迁移不更改原有开放时间。

2026-09-15：迁移 `20260915000001_slot_booker_names.sql` 在已审核成员可读取的占用时段中增加预约人姓名，其他人的用途、邮箱和完整预约记录不因此开放。预约日历区分已占用与不开放，已结束的格显示不开放；使用中的格继续显示预约人。页面每 30 秒及重新获得焦点时更新本地时间状态。

2026-09-15：迁移 `20260915000002_multi_day_bookings.sql` 允许在一份申请中连续跨天预约，替代早期的单日限制。整个区间必须持续开放，不能跨过每周非开放日或夜间关闭时段；零点结束不占用下一天。预约仍以一条记录提交和审批，原子冲突检查、准入和续约权限不变。前端支持分别设置起止日期和时间，以及跨日历日期两次点击选范围；第三次点击重置范围。发布时先应用数据库迁移，再发布前端。
