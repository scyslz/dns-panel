# dns-panel 证书功能整体规划

更新时间：2026-03-24
定位：先做通用证书申请能力，再补自动续期与自动部署。

---

## 1. 总目标

为 dns-panel 增加一套通用证书能力：

- 证书账户管理
- 证书申请订单管理
- DNS-01 自动写入/清理验证记录
- 自动续期
- 证书下载
- 自动推送/部署

参考来源：

- 彩虹聚合 DNS 的 `cert_account / cert_order / cert_deploy / cert_cname` 思路
- dns-panel 现有的 `DnsCredential + DnsService + ProviderRegistry + Scheduler` 架构
- Let’s Encrypt 2026-02-12 官方 challenge 文档

---

## 2. 设计原则

### 2.1 不直接照搬彩虹 DNS

彩虹 DNS 的方向是对的，但它是 PHP + 自有证书/部署体系。

dns-panel 当前是：

- Server: Node.js + Express + Prisma + SQLite
- Client: React + TypeScript
- 已有多 DNS 提供商统一门面

所以本项目要复用现有 DNS 能力，不要一开始就做大而全插件系统。

### 2.2 默认选 DNS-01，不选 HTTP-01 作为主路径

原因：

- dns-panel 本质是 DNS 管理面板，不是站点托管面板
- 需要支持泛域名时，HTTP-01 不可用，DNS-01 才可用
- 多域名、多提供商统一接入时，DNS-01 与现有架构最匹配

HTTP-01 可以作为后续可选能力，不作为 V1 主路径。

补充：

- HTTP-01 更适合“我控制目标站点入口”的场景
- dns-panel 当前控制的是 DNS，不控制所有目标站点的 80 端口入口
- 因此对本项目而言，HTTP-01 的适配面更窄

### 2.3 自动推送要做，但不要在 Phase 1 做“全插件化”

Phase 1 只做申请闭环。

自动推送建议拆层：

- Phase 2：先做通用 Hook/Webhook/SSH 推送
- Phase 3：再做云厂商/CDN/面板插件式部署

### 2.4 所有证书与账户密钥必须强制加密落库

以下字段不允许明文存储：

- ACME 账户私钥
- 证书私钥
- 证书正文
- fullchain
- 可能包含敏感信息的 EAB 数据

实现时必须直接复用：

- `server/src/utils/encryption.ts`

### 2.5 Phase 1 必须采用异步状态机，不允许同步阻塞式申请

证书申请涉及：

- 创建订单
- 自动写 TXT
- 等待 DNS 生效
- 通知 ACME 校验
- 下载证书

该流程可能持续数分钟，因此不得在单个 HTTP 请求中阻塞等待。

V1 必须采用：

- `CertificateOrder` 持久化状态
- 后台任务轮询推进
- 前端轮询查看状态

### 2.6 证书模块禁止重复造 DNS Provider 轮子

证书模块只允许复用现有：

- `server/src/providers/*`
- `server/src/providers/ProviderRegistry.ts`
- `server/src/services/dns/DnsService.ts`

仅在必要时扩展 Provider 能力，以支持 TXT 记录的自动添加、读取、删除。

### 2.7 开发环境默认使用 ACME Staging

为了避免触发正式环境频控，规划要求：

- 开发/联调默认使用 staging
- 生产环境显式切换到 production
- 配置层预留 `ACME_ENV=staging|production`

### 2.8 交互与前端架构决策

- 前端必须提供全局独立一级入口：`证书中心`
- 该入口不挂在单个 DNS 提供商页面下，也不埋入通用 `Settings`
- 路由路径固定为：`/certificates`
- 侧边栏位置放在：`仪表盘` 与 `DNS 提供商列表` 之间
- 面包屑统一显示为：`证书中心`
- Phase 1 采用单页面聚合方式，不先拆很多侧边栏子菜单
- Phase 1 页面至少包含两个区块/Tab：
  - `证书订单`
  - `ACME账户`
- `证书订单` Tab 负责：
  - 列表刷新
  - `创建并申请`
  - 查看状态与 challenge 信息
  - 必要时手动重试 / 继续验证
  - 已签发后下载证书
- `ACME账户` Tab 负责：
  - 账户 CRUD
  - 默认账户选择
- 自动化控制分层：
  - 订单级操作放在订单列表/详情内
  - 全局自动化策略放在证书中心内部
  - 部署目标/部署任务放在 Phase 2 的证书中心内部
- Phase 1 默认交互为：`创建并申请`
  - 提交请求仅负责创建订单并置为 `queued`
  - 后续由异步调度器推进
  - 不阻塞 HTTP 请求等待签发完成
  - 同时保留草稿与手动重试能力
- 该交互与彩虹 DNS 默认“先建单，后调度/手动执行”的前端体验不同，但后端仍保持异步状态机模式

---

## 3. 现有项目可复用能力

### 后端

- `server/src/routes/dnsRecords.ts`
- `server/src/services/dns/DnsService.ts`
- `server/src/providers/ProviderRegistry.ts`
- `server/src/jobs/domainExpiryScheduler.ts`
- `server/src/utils/encryption.ts`
- `server/src/services/logger.ts`

### 前端

- `client/src/App.tsx`
- `client/src/components/Layout/Sidebar.tsx`
- `client/src/services/*`
- `client/src/components/Dashboard/EsaRecordManagement.tsx`

现状判断：

- 自动写 DNS TXT 的基础已经有了
- 定时任务模式已经有了
- 证书状态展示的交互参考已经有了
- 缺的是通用证书模型、异步订单状态机、通用证书页面、通用自动部署层

---

## 4. 分期规划

## Phase 1：MVP —— 证书申请闭环

目标：先跑通“申请证书”主链路。

### 功能范围

- 证书账户管理
  - Let's Encrypt
  - ZeroSSL
  - Google ACME
  - Custom ACME
- 前端提供全局独立入口：`证书中心`
- Phase 1 使用单页面区块/Tab 形式承载证书能力
- 创建证书申请订单
- 默认提交动作：`创建并申请`
- 选择 DNS 凭证用于 DNS-01 自动验证
- 自动写入 `_acme-challenge` TXT
- 轮询 DNS 生效
- 完成签发
- 保存 `certificate/fullchain/privateKey`
- 前端查看状态
- 手动下载证书
- 保留草稿与手动重试
- 自动失败时回退为手动 DNS 校验模式
- 开发环境默认使用 ACME staging

### 数据模型

新增：

- `CertificateCredential`
- `CertificateOrder`

建议字段概念：

#### CertificateCredential
- `userId`
- `name`
- `provider`
- `email`
- `directoryUrl`
- `eabPayload`
- `accountKeyPem`
- `accountUrl`
- `isDefault`

#### CertificateOrder
- `userId`
- `certificateCredentialId`
- `dnsCredentialId`
- `primaryDomain`
- `domainsJson`
- `status`
- `challengeRecordsJson`
- `privateKeyPem`
- `certificatePem`
- `fullchainPem`
- `expiresAt`
- `autoRenew`
- `retryCount`
- `nextRetryAt`
- `lastError`

### 状态机

建议：

- `draft`
- `queued`
- `pending_dns`
- `manual_dns_required`
- `waiting_dns_propagation`
- `validating`
- `issued`
- `failed`

说明：

- `queued`：订单已创建，等待后台任务推进
- `manual_dns_required`：自动写 TXT 失败，但可回退为手动复制验证值

### 后端文件

新增：

- `server/src/routes/certificateCredentials.ts`
- `server/src/routes/certificates.ts`
- `server/src/services/cert/AcmeService.ts`
- `server/src/services/cert/CertificateOrderService.ts`
- `server/src/services/cert/CertificateDnsService.ts`
- `server/src/jobs/certificateOrderScheduler.ts`

修改：

- `server/prisma/schema.prisma`
- `server/src/index.ts`
- `server/src/types/index.ts`
- `server/src/config/index.ts`

### 前端文件

新增：

- `client/src/pages/Certificates.tsx`（证书中心单页，Phase 1 先承载“证书订单 / ACME账户”）
- `client/src/components/Certificates/CertificateTabs.tsx`
- `client/src/components/Certificates/AcmeAccountManagement.tsx`
- `client/src/components/Certificates/AcmeAccountDialog.tsx`
- `client/src/services/certificates.ts`
- `client/src/types/cert.ts`
- `client/src/components/Certificates/ApplyCertificateDialog.tsx`
- `client/src/components/Certificates/CertificateTable.tsx`
- `client/src/components/Certificates/CertificateOrderDetailDialog.tsx`

修改：

- `client/src/App.tsx`
- `client/src/components/Layout/Layout.tsx`
- `client/src/components/Layout/Sidebar.tsx`

### Phase 1 前端页面结构

- 页面路由：`/certificates`
- 页面形态：单页 + 顶部 Tabs
- Tabs：
  - `证书订单`
  - `ACME账户`
- `证书订单` 页内操作：
  - 刷新列表
  - 创建并申请
  - 查看状态
  - 查看 challenge / 手动 DNS 信息
  - 重试 / 继续验证
  - 下载证书
- `ACME账户` 页内操作：
  - 新增账户
  - 编辑账户
  - 删除账户
  - 设置默认账户
- 详情展示优先使用 Dialog / Drawer，不在 Phase 1 再拆二级路由

### Phase 1 验收标准

- 能为单域名申请证书
- 能为多 SAN 域名申请证书
- 能为泛域名申请证书
- 能自动写 TXT 并完成签发
- 自动写 TXT 失败时可回退到手动 DNS 模式
- 能在页面查看与下载证书
- 开发环境默认使用 staging 成功联调

---

## Phase 2：自动续期 + 自动推送基础层

目标：补足“可长期无人值守”。

### 功能范围

- 自动续期调度器
- 失败重试/退避
- 续期日志
- 自动推送基础层
- 接入 ACME ARI（Renewal Information）优化续期窗口
- 在证书中心内补齐自动化策略、部署目标、部署任务相关页面
- 延续 `/certificates` 单页结构，在同一页面扩展：
  - `自动化策略`
  - `部署目标`
  - `部署任务`

### 自动推送先做什么

先不要做几十种厂商插件。

先做三种通用推送方式：

1. **Webhook 推送**
   - 将新证书 POST 到外部服务
   - 适合 1Panel、自定义部署器、CI/CD 中转层

2. **SSH 推送**
   - 写入远程文件
   - 执行 reload 命令，如 `nginx -s reload`

3. **本地目录导出**
   - 将证书输出到挂载目录
   - 供其他服务读取

### 数据模型

新增：

- `CertificateDeployTarget`
- `CertificateDeployJob`

### 文件

新增：

- `server/src/jobs/certificateRenewalScheduler.ts`
- `server/src/services/cert/CertificateRenewService.ts`
- `server/src/services/cert/CertificateDeployService.ts`
- `server/src/routes/certificateDeploy.ts`

前端新增：

- `client/src/components/Certificates/DeployTargetDialog.tsx`
- `client/src/components/Certificates/DeployJobTable.tsx`

### Phase 2 验收标准

- 到期前自动续期
- 续期逻辑优先使用 ARI 推荐窗口
- 续期成功后可自动触发推送
- 至少支持 webhook / ssh / 本地导出 三种方式

---

## Phase 3：完整增强版

目标：向彩虹 DNS 的“完整证书中心”靠近，但不机械复制。

### 功能范围

- 云厂商免费 SSL 渠道接入
  - 腾讯云免费 SSL
  - 阿里云免费 SSL
  - UCloud 免费 SSL
- 插件化部署目标
  - CDN
  - WAF
  - 面板
  - 对象存储
  - 负载均衡
- CNAME Challenge Alias / 委派验证
- 更细粒度通知
- 证书到期告警
- 证书使用链路可视化

### 可选增强

- 接入 ACME ARI
- 支持 challenge alias 策略
- 支持多签发方回退
- 支持站点批量证书模板

---

## 5. DNS-01 与 HTTP-01 取舍结论

## 5.1 DNS-01

优点：

- 支持泛域名
- 不依赖 80 端口
- 适合多站点统一管理
- 与 dns-panel 现有 DNS 能力天然匹配

代价：

- 自动化时需要 DNS 写权限
- 需要处理传播延迟
- 需要更谨慎保护 DNS API 凭证

## 5.2 HTTP-01

优点：

- 不需要 DNS API 权限
- 如果站点本身在公网 80 端口可达，实现更直接

缺点：

- 不支持泛域名
- 必须控制目标域名的 HTTP 接入
- dns-panel 本身并不托管这些域名的站点入口，普适性差

## 5.3 项目结论

对于 dns-panel：

- **主方案：DNS-01**
- **后续可选：HTTP-01**
- **V1 不做 HTTP-01**

---

## 6. 权限要求结论

如果做 DNS-01 自动化：

- 需要当前 DNS 提供商 API Token/AK/SK 具备“读取记录 + 新增/修改/删除 TXT 记录”的权限
- 最好是最小权限，不要给全账户高危权限
- 若当前 token 只有只读权限，则只能做“手动指引”，不能自动验证
- 自动写入前必须优先复用现有权威 DNS 判断结果，避免对非权威域名误写

---

## 7. 自动推送结论

这项必须进规划，但不建议在 Phase 1 做重型插件体系。

推荐路线：

- Phase 1：证书申请成功 + 手动下载
- Phase 2：通用 webhook/ssh/local deploy
- Phase 3：云厂商/面板/CDN 插件化部署

这样可以先把核心价值交付，再逐步加自动化深度。

---

## 8. 推荐实施顺序

1. Prisma 模型
2. 配置层加入 `ACME_ENV` 与 staging/production 切换
3. 证书账户 API
4. ACME 服务封装
5. DNS-01 自动验证服务（强制复用现有 Provider 层）
6. 订单状态机 + `certificateOrderScheduler`
7. 证书订单 API
8. 前端证书页（先做轮询，不先做复杂实时通道）
9. 下载能力
10. 自动续期调度器 + ARI
11. 通用自动推送层
12. 插件化部署

---

## 9. 当前最终决策

- 先做规划存档
- 再做 Phase 1
- 默认 DNS-01
- HTTP-01 暂不进入 Phase 1
- 自动推送进入规划，但放在 Phase 2 起步
- 前端采用全局独立入口：`证书中心`
- Phase 1 默认交互为：`创建并申请`，创建后立即入队异步申请
