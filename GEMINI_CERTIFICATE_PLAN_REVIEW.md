# 证书功能开发计划评估报告 (GEMINI_CERTIFICATE_PLAN_REVIEW)

基于当前 `dns-panel` 代码库（Node.js/React 架构）以及参考的 PHP `dnsmgr_ref` 仓库，对 `CERTIFICATE_PLAN.md` 进行了深入评估。

## 1. 阶段划分的合理性
**评估：基本合理，但存在依赖倒置风险。**
通常计划会按照“数据库 -> 核心逻辑 -> API -> 前端”进行划分。但在当前 Node.js 架构中，SSL 证书申请（ACME DNS-01 验证）强依赖于现有的 DNS 解析记录操作。阶段划分中必须明确：**先完成 ACME 核心模块与现有 `src/providers/ProviderRegistry.ts` 的深度整合，再进行其他云厂商证书 API（如阿里云、腾讯云等非 ACME 证书）的对接。** 前端界面的开发不应过早启动，应在后端 ACME 状态机完全走通后再进行。

## 2. 模糊或缺失的重要约束
*   **ACME 账户与密钥的安全存储：** 计划中未明确说明生成的证书私钥（Private Key）和 ACME 账户密钥将如何保存。考虑到现有系统中有 `server/src/utils/encryption.ts`，这些敏感数据必须在落库前强制进行 AES 加密，绝对不能明文存入数据库或无保护的文件系统中。
*   **速率限制（Rate Limits）应对策略：** Let's Encrypt 等机构有严格的频控限制。计划中未明确说明如何利用 Staging 环境进行开发测试，以及在生产环境中发生 DNS 验证失败时的重试退避（Backoff）策略。
*   **长时任务的执行与超时：** 证书申请通常需要等待 DNS 传播，这个过程可能长达数分钟。现有的 Express 请求模型不适合阻塞等待，计划中缺乏对异步任务状态追踪的具体定义。

## 3. 文件/模块新增建议 (保留、重命名、合并、推迟)
*   **正确 (Correct)：** 新增 `server/src/services/cert/acme.ts` 处理 ACME v2 协议；新增 `server/src/jobs/certRenewScheduler.ts` 定时续期任务。
*   **合并 (Merge)：** **切勿重复造轮子。** 参考项目中存在大量独立的 DNS 客户端代码（如 `app/lib/dns/`），在重构为 Node.js 时，严禁为证书申请重新编写 DNS API 客户端。必须完全复用已有的 `server/src/providers/` 目录下的各厂商逻辑，通过扩展现有基类实现 TXT 记录的添加与删除。
*   **重命名 (Rename)：** 将原先可能松散的脚本统一归入现有的任务调度体系，例如命名为 `server/src/jobs/certTaskRunner.ts`，对齐现有的 `domainExpiryScheduler.ts`。
*   **推迟 (Defer)：** 参考项目 `app/lib/deploy/` 中包含数十种部署面板（宝塔、k8s等）。强烈建议第一阶段推迟这些复杂部署模块，首发版本仅实现基础的：本地文件、Webhook 回调及主流云服务（如阿里云 CDN）部署。

## 4. 实施前的 5 个具体改进建议
1.  **引入状态机与任务队列：** 现有架构缺乏对长时任务的支持。必须在 `prisma/schema.prisma` 中引入 `CertOrder` 队列表，配合定时任务实现状态机（Pending/Processing/Valid/Failed）轮询，而非在 HTTP 请求中阻塞等待。
2.  **强制集成开发环境的 Staging 模式：** 在配置 (`server/config/index.ts`) 中增加强制环境变量 `ACME_ENV=staging` 选项，避免开发期间触发 Let's Encrypt 频控导致服务器 IP 被封禁。
3.  **前后端交互采用异步通知 (SSE/轮询)：** 在前端 `client/src/pages/Settings.tsx` 或新增的证书页面中，明确要求设计基于 SSE 或定时轮询的日志视图，由于验证 DNS 需等待，UI 必须具备实时状态反馈能力。
4.  **复用 Provider 鉴权机制：** 在对接云厂商 SSL 服务或执行 DNS 验证时，直接复用 `server/src/providers/` 的凭据及加密逻辑（`server/src/utils/encryption.ts`），不为证书模块单独另起一套密钥管理体系。
5.  **规范化事件与异常通知：** 在证书即将过期、续签成功或遇到不可恢复的错误时，提前规划统一的事件通知入口（复用并扩展 `server/src/services/email.ts`），确保无人值守下续签体系的健壮性。

## 总结
该迁移计划的核心指导思想应当是 **复用现有 Provider 生态** 与 **建立可靠的异步状态机**，避免简单照搬 PHP 版本的同步阻塞逻辑。请在实施前修正上述约束。
