# CloudBase 接入实施记录

目标：将现有注册、满分考试、设备管理、预约审批和通知接入上海 CloudBase PostgreSQL。GitHub Pages 保持取消发布；不将示例设备导入正式库。

## 已核实的环境差异

- 真实 `auth.users.id` 是 bigint；JWT 身份对应 `auth.users.sub`，平台用户主键使用 text。
- 公开 Key 的 `auth.uid()` 是字符串 `anon`。所有身份判断必须同时核验 JWT 的 authenticated 角色和平台资料。
- 环境启用了用户名密码登录，未启用邮箱验证码。浏览器 signup 不支持仅用户名密码；由云函数在验证考试凭证后调用官方 createUser，密码由 CloudBase 管理。

## 实施任务与接口

1. 独立 CloudBase SQL 迁移及真实身份模型测试。沿用现有业务 RPC 名称、参数和返回值；所有考试必须 100 分。资料仅允许后台注册流程创建，固定普通用户。增加 private.claim_registration(p_data jsonb) 与 private.finish_registration(p_token uuid)：前者核验满分、邮箱、条例版本、期限，为该凭证固定随机 uid 和由邮箱 SHA-256 派生的 username，绑定姓名学号项目；后者确认原生账号 sub/username/project 对应，创建平台资料并消费凭证。同一凭证同一资料可以恢复中断操作，不能创建第二个身份或变更资料；不保存密码。
2. 注册云函数 hclab-register：校验输入，调用后台 SQL claim，官方 createUser(type=externalUser)，后台 SQL finish；如果原生账号已创建，仅允许确认同一预分配 UID，绝不修改已有密码。账号内部 username 为 hclab_ 加规范化邮箱 SHA-256 的前 40 位；用户仍用邮箱登录。云函数使用平台短期服务凭据，客户端只用 Publishable Key。
3. 前端 CloudBase DataService：官方 SDK 认证、PostgreSQL RPC、图片存储；云函数注册成功后用用户名密码登录。增加配置校验，CloudBase 密码 10–32 位且至少三种字符类别。现有页面与 Supabase/演示模式保持兼容。
4. 本地测试、真实云端迁移和函数部署；验证匿名越权、90/100 分、重复注册、普通用户权限、跨用户预约冲突、管理员审批及通知。首次真实管理员由用户指定账户后提升。

## 进度

- 基线：53d54c8；20 个测试通过。实现分支 codex/cloudbase-integration。
- 2026-09-14：CLI 授权成功，已读取真实数据库结构和认证设置。

- 已应用 20260914000000_platform.sql 和 20260914000001_username_length.sql、20260914000002_rpc_results.sql；注册云函数部署完成。
- 原生用户名创建与登录的长度上限不同，派生用户名已统一为 46 字符。
- 函数匿名调用通过 DescribeSecurityRule / ModifySecurityRule 单独开放注册函数；其余原规则保留。
- 真实 API 已验证 90 分拒绝、100 分注册、伪造管理员忽略、原生登录成功；两用户并发预约仅一份成功，跨用户记录隔离、审批与通知正常。
- 本机已切换 CloudBase 模式；GitHub Pages 仍取消发布。首个真实管理员须由用户指定并核对账户。
- SDK 3.9.3 会将 UUID 标量 RPC 结果误作裸 JSON 解析；新增两个返回 `{id}` 的写操作包装 RPC，避免成功写入却提示失败。补充真实 SDK 请求适配回归。
- 真实环境借用、续约申请与批准、归还、取消和图片存储权限通过；测试图片已删除。
- 最终验证：80 项 Vitest（含真实 SDK 返回格式回归、PostgreSQL 权限/并发规则和会话清理）及 7 项注册云函数测试通过；CloudBase 模式构建通过。
- 浏览器验收：真实注册表单 → 随机 10 题 → 100 分 → 注册成功；预约提交、管理员设备编辑保存和审批均在界面及云端记录验证成功。
- 清理完成：本轮 5 个临时原生账号及平台资料、1 台虚拟设备、对应预约/考试和测试图片已删除，精确 ID 查询残留均为 0；没有导入演示资产。
- Pages 公网复查返回 404；发布工作流默认关闭。
