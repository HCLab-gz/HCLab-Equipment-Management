# GitHub Pages + Supabase 部署说明

GitHub Pages 托管 HTML/CSS/JavaScript，无法自身保存跨用户预约或安全验证账号。Supabase 承载 Auth、PostgreSQL 与图片 Storage。浏览器只放公开密钥，所有敏感写入由受控数据库函数执行。

## 1. 初始化数据服务

在自己控制的 Supabase 账号中新建一个**专用于此平台的项目**。在 SQL Editor 依次执行：

1. `supabase/migrations/001_platform.sql`：表、RLS、审批/预约/违规 RPC、注册考试校验触发器。
2. `supabase/migrations/002_questions.sql`：30 道题与正确答案，放在不公开的 `private` schema。
3. `supabase/migrations/003_storage.sql`：设备图片桶，最大 2 MB，仅管理员能上传。
4. `supabase/migrations/004_exam_full_marks.sql`：更新为 100 分满分才合格、条例版本 v2，作废旧版本未消费的考试凭证。

这些是首次安装迁移，001 和 003 不能反复整份执行。现有项目升级应新增迁移文件，不应重置生产数据库。

已执行 001—003 的项目只需补充执行 004；现有用户、设备和预约保留，未完成注册的旧版考试需重新抽题。全新项目也必须执行 004，才能启用满分准入规则。

在 Authentication 配置 Email 登录，启用邮箱验证，密码最短长度设为 10。设置 Site URL：

```text
https://hclab-gz.github.io/HCLab-Equipment-Management/
```

将同一地址加入 Redirect URLs。本地测试可另加 `http://127.0.0.1:5173/`。不要向前端提供 service_role 或 secret key。

`auth.users` 的 before-insert 触发器强制检查服务端考试合格凭证，after-insert 触发器强制创建普通用户档案。不要关闭这些触发器；如果注册显示 “Database error saving new user”，检查 SQL 是否完整执行、考试凭证是否过期以及用户字段是否完整。

## 2. 启用正式配置

复制 `.env.example` 为 `.env.local`（已加入 gitignore）：

```dotenv
VITE_DATA_MODE=supabase
VITE_SUPABASE_URL=https://你的项目.supabase.co
VITE_SUPABASE_ANON_KEY=你的publishable或legacy_anon公开密钥
```

重新启动开发服务。缺少正式配置时直接报错，不会悄悄退回演示模式。正式构建会删除演示模块和前端答案表。`npm run build` 先检查密钥类型，拒绝 service_role / secret key。

## 3. 设置首个管理员

先在正式平台完成阅读条例、考试和普通用户注册，并完成邮箱验证。然后由 Supabase 项目所有者在 SQL Editor 执行以下语句，把邮箱替换成**已注册且核实的管理员邮箱**：

```sql
update public.profiles
set role = 'admin'
where email = '管理员的注册邮箱';
```

确认只更新了预期的一行。刷新网站，使用“管理员登录”进入后台。后续管理员同样通过数据库受控设置；不能在公开注册请求的 metadata 中自行声明管理员。

管理员可先新增真实设备、上传图片、设置工作日/开放时间和具体归还位置。停用设备保留预约记录。设备开放规则调整后，待审批申请会按最新规则重新核验；已批准的旧时段仍视为原批准承诺，维护或停用状态会阻止开始使用。受影响预约需要管理员联系申请人取消并重约。

## 4. 创建仓库并部署

当前要求为**暂不公开网站，源码仓库仍公开**。[源码仓库](https://github.com/HCLab-gz/HCLab-Equipment-Management) 已存在，日常推送 `main` 只会测试和构建，不会上传或发布 Pages 产物，无需重复初始化。

取消既有发布：使用仓库管理员账号 HCLab-gz 打开 Settings → Pages，在站点地址旁的菜单中选择 **Unpublish site**。这会移除当前网站部署，保留源代码和仓库设置。仅修改工作流不会自动移除已有网站，必须完成此操作。参见 [GitHub 取消发布说明](https://docs.github.com/en/pages/getting-started-with-github-pages/unpublishing-a-github-pages-site)。

未来重新上线时，站点地址仍为 `https://hclab-gz.github.io/HCLab-Equipment-Management/`。

以下命令仅供在全新仓库首次部署时参考；当前仓库请跳过：

```bash
git init -b main
git add .
git commit -m "feat: build HCLab equipment management platform"
gh repo create HCLab-gz/HCLab-Equipment-Management --public --source=. --remote=origin --push
gh api --method POST repos/HCLab-gz/HCLab-Equipment-Management/pages -f build_type=workflow
```

如果仓库已存在，不要再次创建或覆盖；添加正确 remote 后正常提交和推送。仓库公开源码用于 GitHub Pages，不包含任何真实学生记录、密码或服务端密钥。GitHub 账号计划如允许私有仓库 Pages，也可自行改为私有。

GitHub 仓库 → Settings → Secrets and variables → Actions → **Variables** 中设置：

| 变量                     | 值                          |
| ------------------------ | --------------------------- |
| `VITE_DATA_MODE`         | `supabase`                  |
| `VITE_SUPABASE_URL`      | 项目 URL                    |
| `VITE_SUPABASE_ANON_KEY` | publishable / anon 公开密钥 |

未来确认需要公开后，GitHub → Settings → Pages → Source 选择 **GitHub Actions**。进入 Actions，手动运行 “Test and build (manual Pages publish)” 并明确勾选 **publish**。流程依次测试、构建并发布；只有全部通过才部署。普通推送及未勾选 publish 的手动运行均不会发布网站。

没有设置变量时部署的是带醒目标识的演示版，供界面评审使用。不要把演示版当作多人预约系统。

采用 HashRouter 和相对静态资源路径，支持项目子目录，例如 `/#/equipment` 和 `/#/admin`，刷新详情页不会产生 Pages 404。

## 5. 上线验收

- 使用两个独立浏览器分别登录两个普通用户，验证相同设备相同时段只能成功提交一次。
- 用管理员批准申请，普通用户能看到通知；直接调用设备或审批 RPC 的普通用户必须被拒绝。
- 注册未考试账号应失败；合格凭证不能被另一个邮箱或重复注册使用。
- 真实 SMTP 邮箱验证成功；在 Storage 上传一张设备图片并确认匿名可读、普通用户不能上传。
- 在批准时间前/结束时间后不能开始使用；上一位未归还不能被下一位直接接用。
- 管理员核实并录入违规，确认第二次起平台准入限制生效，并人工同步实体门禁。
- 在实验室实际网络测试 GitHub Pages 和 Supabase 的访问稳定性。

## 6. 条例、题库与数据维护

条例内容：`src/data/rules.ts`。演示题库：`src/data/questions.ts`。修改后可运行 `node scripts/generate-question-migration.mjs` 生成题库 SQL；对于已上线数据库，复制生成内容作为**新的增量迁移**执行，并审查变更。

条例版本在前端和数据库注册校验中均为 `2026-09-v2`，正式发布新版本时需同步更新。当前不强制现有用户重新考试，若未来需要应通过独立迁移实现。

生产数据应使用 Supabase 备份机制。违规记录只追加，若经复核撤销或更正，由项目负责人在数据库维护并记录复核依据；页面目前不提供随意删除或清空处罚的入口。

参考：[GitHub Pages 文档](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)、[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)。
