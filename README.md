# 🌐 DNS Panel

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker)](https://hub.docker.com/r/scyslz/dns-panel)

> 现代化的多 DNS 服务商统一管理面板：多用户、多凭证隔离，统一管理域名与 DNS 解析记录，支持通用证书中心、Cloudflare Tunnels 管理，并提供操作日志审计。

---

## 📑 目录

- [功能概览](#-功能概览)
- [Cloudflare Tunnels](#-cloudflare-tunnels)
- [支持的服务商](#-支持的服务商)
- [技术栈](#-技术栈)
- [相关文档](#-相关文档)
- [Docker Hub 镜像](#-docker-hub-镜像部署)
- [首次使用](#-首次使用)
- [本地开发](#-本地开发)
- [环境变量](#️-环境变量)
- [常见问题](#-常见问题)
- [版本更新](#-版本更新)

---

## 📋 版本更新

| 版本 | 日期 | 更新内容 |
|------|------|----------|
| v1.7.2 | 2026-11-11 | 🔐 重构账号体系：角色/管理员、公开注册默认关闭、注册审核、设置页多用户与注册策略开关、用户管理（移动端卡片 + MoreVert 菜单 + 重置密码）、JWT 即时失效 |
| v1.7.1 | 2026-11-09 | ✨ 支持 NS EdgeOne（1 站点 = 1 域名），加速域名增删改自动同步 CNAME 到腾讯云 DNSPod；🔑 新增 Open API（API Key 认证、DNS 记录 CRUD/批量/幂等、EdgeOne 接口） |
| v1.7.0 | 2026-03-31 | 🔐 新增证书中心（ACME/订单/自动续期/部署矩阵/通知）+ 域名到期手动设置 |
| v1.6.0 | 2026-03-24 | ✨ 新增 ESA 自动 DNS 配置、全提供商权威 DNS 识别、非权威域名显示开关 |
| v1.5.0 | 2026-03-02 | 🆕 新增 Cloudflare Tunnels 管理：隧道创建/删除、详情面板、cloudflared 安装指引、三类路由管理（Public Hostnames / CIDR / 主机名路由） |
| v1.4.1 | 2026-02-18 | ✨ 抽屉支持 DNS 服务商拖拽排序 + 前端体验优化 |
| v1.4.0 | 2026-02-18 | ✨ 新增阿里云 ESA 站点管理与免费证书 |
| v1.3.0 | 2026-01-30 | ✨ 多服务商添加/删除域名功能 |
| v1.2.0 | 2026-01-30 | ✨ 新增 Cloudflare 添加域名功能 |
| v1.1.0 | 2026-01-29 | ✨ 新增火山引擎、京东云、DNSLA 支持 |
| v1.0.0 | 2026-01-15 | 🎉 首次发布 |

<details>
<summary><b>查看完整更新日志</b></summary>

### v1.7.2 (2026-11-11)
- 🔐 **账号与权限体系**
  - 新增 `admin` / `user` 角色，公开注册默认关闭；旧库升级自动提升首个管理员
  - JWT 每次请求查库校验：禁用账号、改密、重置密码、角色变更、审核状态变更均让旧 token 立即失效
  - 「用户管理」支持创建、角色调整、启停、审核、重置密码、删除；移动端卡片列表 + PC/移动端共用 `MoreVert` 菜单
  - 「设置 → 账号与注册」提供三个持久化开关：启用多用户、允许公开注册、注册需要审核（默认关/开/开），保存后立即生效
  - 关闭多用户时隐藏菜单并禁止用户增删；开启审核时新注册账号需管理员通过后才可登录

### v1.7.1 (2026-11-09)
- ✨ 支持 NS EdgeOne：1 站点 = 1 域名，加速域名增删改自动同步 CNAME 到腾讯云 DNSPod
- 🔑 **新增 Open API（`/api/open`）**
  - API Key 认证（`Authorization: Bearer` / `X-API-Key`），支持域名、IP/CIDR、凭证与限流绑定
  - DNS 记录查询、创建、更新、删除、启停、upsert、批量与幂等
  - EdgeOne 站点 / 加速域名 / 证书 / CNAME 同步接口
  - 统一响应信封与错误码，设置页 API Key 管理与 `/docs` 参考页

### v1.7.0 (2026-03-31)
- 🔐 **新增通用证书中心（Certificate Center）**
  - 证书订单：草稿/申请、DNS-01 自动写入/清理、状态机 + 重试、打包下载（ZIP）
  - ACME 账户：Let's Encrypt / ZeroSSL / Google / Custom（支持 EAB）
  - 自动续期：后台调度器轮询续期、失败重试、续期后自动触发部署
  - 部署矩阵：部署目标/部署任务（支持 Webhook / Dokploy / 1Panel / Nginx Proxy Manager 等），可手动执行部署
  - 厂商证书：腾讯云/阿里云/UCloud SSL 订单统一管理（含 DNS 验证与下载）
  - CNAME 代理：证书 CNAME Alias 管理与校验
  - 通知：证书/部署/厂商渠道通知策略 + 多通道配置（邮件/Webhook/Telegram/钉钉/飞书/企微等）
- ✨ **域名到期时间支持手动设置**：自动查询失败时可编辑补充；自动成功时也可覆盖并支持清除恢复自动

### v1.6.0 (2026-03-24)
- ✨ **增强阿里云 ESA 自动 DNS**
  - ESA 站点创建后，如为 CNAME 接入且项目内命中可托管 `_esaauth.<domain>` 的权威域名，可直接自动创建验证 TXT
  - ESA 业务记录创建后，如项目内命中可托管该记录名的权威域名，可直接自动创建业务 CNAME
  - 当命中多个可用主域名时，弹窗要求用户确认目标账户 / 域名后再继续
  - TXT 自动创建完成后会自动触发 ESA `VerifySite`
- ✨ **新增权威 DNS 识别框架**
  - 域名列表与详情统一输出 `authorityStatus / authorityReason / authorityMeta`
  - 自动识别 `authoritative / pending / non_authoritative / unknown`
  - 已接入 Cloudflare、阿里云、DNSPod、华为云、PowerDNS、火山引擎、京东云、Spaceship、NameSilo 等提供商的权威识别
  - 对百度云、西部数码、DNSLA 等元数据不足的提供商保持保守判定，避免误判为可自动接入
- ✨ **新增非权威域名显示开关**
  - 设置页新增「显示非权威域名」开关，默认关闭
  - 仅控制域名列表是否显示 `non_authoritative`
  - `pending / unknown` 仍然显示，便于排查待接入或待识别域名
- 🔒 **自动流程更严格**
  - 自动 DNS / ESA 自动接入仅使用 `authoritative` 域名
  - `unknown / pending / non_authoritative` 不参与自动接入，统一回退手动配置
- 🐛 **修复自动 DNS 重复记录识别**
  - 统一将不同服务商返回的相对主机名 / FQDN 规范化后再判断
  - 已存在同名同类型记录时优先更新，避免误判为重复创建

### v1.5.0 (2026-03-02)
- 🆕 **新增 Cloudflare Tunnels 管理**
  - 隧道列表：创建 / 删除 Tunnel，查看连接状态，支持搜索过滤
  - 删除 Tunnel 时可选同时清理指向该 Tunnel 的 DNS CNAME 记录
- ✨ **隧道详情面板**（展开即可查看）
  - Active Replicas 表格：Replica ID / Origin IP / Edge Locations / Version / Architecture / Uptime
  - Routes 概览：从 Tunnel Config 解析 ingress 公开路由列表
  - Status / Uptime 统计卡片
- ✨ **未连接安装指引**（Tunnel 状态为 inactive/down 时自动展示）
  - 支持 5 个平台切换：Windows / macOS / Debian / Red Hat / Docker
  - 自动生成安装命令和 `cloudflared tunnel run --token <TOKEN>` 连接命令
  - Token 默认遮罩显示，复制时保留完整值
- ✨ **路由管理弹窗（三类 Tab）**
  - 已发布应用程序路由（Public Hostnames）：增删改 ingress 规则，自动同步 DNS CNAME，失败时自动回滚 Tunnel 配置
  - CIDR 路由：创建 / 查询 / 删除私网 CIDR 路由（IPv4/IPv6），含前端格式校验
  - 主机名路由：创建 / 查询 / 删除私网主机名路由，含通配符支持
- 🔧 **后端 Tunnel API**
  - 新增 12+ 个 REST 端点：Tunnel CRUD、Config、Token、Public Hostnames、CIDR 路由、主机名路由
  - 私网路由聚合查询使用 `Promise.allSettled`，部分失败仍可返回
  - 删除路由前增加归属校验，防止跨 Tunnel 误删

### v1.4.1 (2026-02-18)
- ✨ 左侧抽屉：DNS 服务商支持拖拽排序（长按拖动，顺序自动保存）
- 💄 前端体验优化
  - 「DNS 账户管理」新增/编辑对话框样式统一，移动端不再全屏
  - 优化表单自动填充干扰（别名/Token 更不易被误识别为账号密码）
  - 优化抽屉交互：移除移动端点击蓝色遮罩、退出登录菜单居中、修复腾讯云重复显示

### v1.4.0 (2026-02-18)
- ✨ 新增阿里云 ESA（边缘安全加速）站点管理
  - 账号级「DNS 域名」与「ESA 站点管理」一键切换
  - 支持多 Region 拉取站点/实例（cn-hangzhou / ap-southeast-1）
  - 新增站点创建：接入方式（CNAME/NS）、覆盖范围、套餐实例（含配额展示）
- ✨ 新增 ESA DNS 记录管理
  - 记录增删改查、CNAME 配置指引与状态检测
  - HTTPS 证书状态展示 + 一键申请/续签免费证书（Let's Encrypt；基础版/更高支持 DigiCert）
  - 提供托管 DCV / DCV 验证信息复制，支持外部 DNS 场景
- 🐛 修复若干前端交互问题（站点下拉白屏、编辑凭证回填 label 重叠等）
- 🔧 新增后端 ESA API 路由与签名适配（增强错误信息、兼容 POST/GET）

### v1.3.0 (2026-01-30)
- ✨ 新增多服务商添加/删除域名功能
  - 支持：Cloudflare、阿里云、腾讯云（DNSPod）、华为云、百度云、火山引擎、京东云、DNSLA、PowerDNS
- 🔧 统一域名管理接口，支持批量添加、自动去重

### v1.2.0 (2026-01-30)
- ✨ 新增 Cloudflare 添加域名功能（批量添加、自动去重）
- ✨ 添加结果展示 NS 服务器信息，支持一键复制
- 🔒 删除域名增加二次确认（需输入域名）
- 💄 优化添加域名对话框 UI

### v1.1.0 (2026-01-29)
- ✨ 新增火山引擎 DNS 支持
- ✨ 新增京东云 DNS 支持
- ✨ 新增 DNSLA 支持
- 🐛 修复 Cloudflare 自定义主机名显示问题

### v1.0.0 (2026-01-15)
- 🎉 首次发布
- 支持 Cloudflare、阿里云、DNSPod、华为云、百度云、西部数码、NameSilo、PowerDNS、Spaceship

</details>

---

## ✨ 功能概览

| 功能 | 说明 |
|------|------|
| 🌐 多服务商支持 | 统一管理多个 DNS 服务商的域名和解析记录 |
| ⚡ ESA 自动 DNS | 自动创建 ESA 验证 TXT / 业务 CNAME；多候选时支持人工确认目标主域名 |
| ☁️ NS EdgeOne | 加速域名管理（1 站点 = 1 域名）、复用现有凭证体系、CNAME 自动同步到 DNSPod |
| 🧭 权威 DNS 识别 | 统一识别域名是否为当前托管方权威 DNS，区分 authoritative / pending / non_authoritative / unknown |
| 🧾 解析记录管理 | 增删改查；支持权重/线路/启停/备注等 |
| 🔐 通用证书中心 | ACME 账户管理、证书订单管理、DNS-01 自动验证、自动续期、Webhook / Dokploy / 1Panel / NPM 等部署目标、证书下载 |
| ☁️ Cloudflare 增强 | 自定义主机名、证书状态、Fallback Origin |
| 🚇 Cloudflare Tunnels | 隧道管理、路由配置（公网主机名 / CIDR / 主机名路由） |
| 🛡️ 阿里云 ESA | 边缘安全加速站点管理、DNS 记录、免费证书申请/续签 |
| 🔑 多用户隔离 | JWT 登录、账户与凭证隔离 |
| 🔒 安全存储 | DNS 凭证加密存储（AES-256） |
| 💾 数据持久化 | SQLite 数据库，挂载 Volume 即可备份迁移 |

### 🚇 Cloudflare Tunnels

通过面板即可完成 Cloudflare Tunnel 的全生命周期管理，无需手动操作 `cloudflared` 配置文件。

| 能力 | 说明 |
|------|------|
| 隧道管理 | 创建 / 删除 Tunnel，查看连接状态与副本（Replica）信息 |
| 详情面板 | 展开查看 Active Replicas、Routes、Uptime 等运行指标 |
| 安装指引 | 未连接 Tunnel 自动展示 cloudflared 安装 / 启动命令（Windows / macOS / Debian / Red Hat / Docker） |
| Token 安全 | Token 默认遮罩显示，复制时保留完整值 |
| 已发布应用程序路由 | 管理 Public Hostnames（ingress），自动同步创建 / 更新 DNS CNAME 记录，失败时自动回滚 |
| CIDR 路由 | 创建 / 查询 / 删除私网 CIDR 路由，支持归属校验防止跨 Tunnel 误删 |
| 主机名路由 | 创建 / 查询 / 删除私网主机名路由 |
| DNS 清理 | 删除 Tunnel 时可选同时清理指向该 Tunnel 的 DNS CNAME 记录 |

> ⚠️ Tunnels 功能需要 Cloudflare API Token 具备 **Account: Cloudflare Tunnel（编辑）** 和 **Zone: DNS（编辑）** 权限。

---

## 🏢 支持的服务商

| 国内服务商 | 国际服务商 |
|-----------|-----------|
| 阿里云 | Cloudflare |
| DNSPod（腾讯云） | NameSilo |
| UCloud | PowerDNS |
| 华为云 | Spaceship |
| 百度云 | |
| 西部数码 | |
| 火山引擎 | |
| 京东云 | |
| DNSLA | |

---

## 🧱 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React + TypeScript + Vite + MUI + TanStack Query |
| 后端 | Node.js 18 + Express + TypeScript + Prisma |
| 数据库 | SQLite（默认） |

---

## 📚 相关文档

- [快速启动指南](doc/快速启动指南.md)：面向新用户的快速部署与使用说明
- [Open API 参考](doc/OPEN_API.md)：`/api/open` 的认证、端点、错误码与示例
- [EdgeOne 接入](doc/EDGEONE.md)：站点、加速域名与 DNSPod 自动同步
- [证书中心规划](doc/CERTIFICATE_PLAN.md)：证书中心整体规划
- [证书规划评估](doc/GEMINI_CERTIFICATE_PLAN_REVIEW.md)：Gemini 规划评估记录
- [UI/UX 标准](doc/UIUX-STANDARDS.md)：界面与交互规范

---

## 🏷️ 发版（Tag 自动发布）

项目只保留一个发布工作流 `release-on-tag.yml`。推送 `v*` Tag（例如 `v1.7.1`）或手动触发并填写 Tag 后，会自动：

- 构建并推送多架构 Docker 镜像到 Docker Hub：
  - `scyslz/dns-panel:1.7.1`
  - `scyslz/dns-panel:1.7`
  - `scyslz/dns-panel:latest`（预发布 Tag 不带 `latest`）
- 构建轻量发布包：`dns-panel-<version>-bundle.tar.gz`（服务端 dist + 前端静态资源 + prisma，约 1 MB）
- 生成 `SHA256SUMS`，创建 GitHub Release 并自动生成 Release Notes

> 离线 Docker 镜像包不再产出，直接 `docker pull scyslz/dns-panel:<version>` 即可；有离线需求时可在本地 `docker save`。

使用方法：

```bash
# 1) 先提交本次改动（包括 README 的版本更新）
git add -A
git commit -m "chore(release): v1.7.1"

# 2) 打 Tag 并推送（触发 Release on Tag 工作流）
git tag -a v1.7.1 -m "v1.7.1"
git push origin main  # 仓库如使用 master 分支请改为 master
git push origin v1.7.1
```

发布前请在 GitHub 仓库 Secrets 中配置：

- `DOCKER_USERNAME`
- `DOCKER_PASSWORD`

### 前置条件

- Linux 服务器（Ubuntu / Debian 等）
- 已安装 Git、Docker 与 Docker Compose v2
- 开放端口 `3000`（或通过反代访问）

### 1️⃣ 克隆仓库

```bash
git clone https://github.com/Frankieli123/dns-panel.git
cd dns-panel
```

### 2️⃣ 配置环境变量

在仓库根目录创建 `.env` 文件：

```env
# 必填：生产环境必须设置强随机值
JWT_SECRET=your-random-jwt-secret-min-32-chars-here
ENCRYPTION_KEY=your-32-character-encryption-key!!

# 可选：跨域访问时设置
# CORS_ORIGIN=https://panel.example.com
```

**生成安全密钥：**

```bash
openssl rand -base64 48  # JWT_SECRET（建议 32+ 字符）
openssl rand -hex 16     # ENCRYPTION_KEY（必须 32 字符）
```

### 3️⃣ 启动服务

```bash
# 首次启动（从源码构建）
docker compose up -d --build

# 查看状态
docker compose ps

# 查看日志
docker compose logs -f
```

### 4️⃣ 访问面板

| 地址 | 说明 |
|------|------|
| `http://<IP>:3000` | Web 界面 |
| `http://<IP>:3000/health` | 健康检查 |

### 5️⃣ 更新版本

```bash
git pull
docker compose down
docker compose up -d --build
```

### 6️⃣ 数据备份

数据库文件位于 `./data/database.db`：

```bash
cp ./data/database.db ./data/database.db.backup
```

### 7️⃣ 生产建议

**反向代理（推荐）：**

1. 修改端口映射为 `127.0.0.1:3000:3000`
2. 使用 Nginx/Caddy 终止 TLS，对外开放 80/443

---

## 📦 Docker Hub 镜像部署

不想从源码构建？直接使用预构建镜像：

```bash
docker run -d \
  --name dns-panel \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e JWT_SECRET=your-secret-here \
  -e ENCRYPTION_KEY=your-32-character-encryption-key!! \
  -e DATABASE_URL=file:/app/data/database.db \
  -v $(pwd)/data:/app/data \
  --restart unless-stopped \
  scyslz/dns-panel:latest
```

> 镜像由 GitHub Actions 自动构建（amd64 + arm64），包含 `latest`、主版本与具体版本标签。

---

## 👤 首次使用

1. **初始化管理员** - 打开 `http://<IP>:3000`，用环境变量或默认策略完成首个管理员账号；后续账号由管理员在「用户管理」中创建
2. **添加凭证** - 进入「设置」→「DNS 账户/凭证」，添加服务商 API 凭证
3. **账号策略** - 进入「设置」→「账号与注册」，可开关多用户、公开注册、注册审核（保存到数据库，立即生效）
4. **开始管理 DNS** - 回到仪表盘，选择服务商与账户，管理域名和记录
5. **申请证书** - 进入左侧「证书中心」，创建 ACME 账户并发起证书申请
6. **自动续期 / 推送** - 在证书订单开启自动续期，在「部署目标 / 部署任务」中配置 Webhook、Dokploy、1Panel、Nginx Proxy Manager 等推送

> 🔐 **账号与权限**：默认「多用户开启、公开注册关闭、注册需审核」。三个开关都在「设置 → 账号与注册」里维护，保存后立即生效；关闭多用户会隐藏用户管理菜单并禁用用户增删。开启公开注册后，开启审核时新账号为「待审核」，管理员在「用户管理」通过后才能登录；空库首个账号自动成为管理员。`admin` 可创建/禁用/删除账号、审核、重置密码、调整角色；`user` 只能管理自己的数据。旧版本升级后会自动把最早创建的账号提升为管理员（可用 `BOOTSTRAP_ADMIN_USERNAME` 指定）。禁用账号、改密、重置密码、角色变更都会让该账号已签发的 JWT 立即失效。
>
> ⚠️ Cloudflare 自定义主机名功能需要 Token 具备 `区域.SSL 和证书（编辑）` 权限；Tunnels 功能需要 `Account: Cloudflare Tunnel（编辑）` + `Zone: DNS（编辑）` 权限。
>
> ⚠️ 通用证书中心默认使用 `DNS-01`；新建证书默认开启自动续期。开发/联调建议保持 `ACME_ENV=staging`。
>
> ⚠️ 如需升级旧版 NPM 实验目标类型，可执行：`cd server && npm run cert:deploy:migrate:npm-type`

---

## 🛠️ 本地开发

**前置要求：** Node.js 18+

### 端口说明

| 服务 | 端口 | 说明 |
|------|------|------|
| 前端 | 5173 | Vite 开发服务器 |
| 后端 | 4001 | Express API（可在 `server/.env` 修改） |

> 修改后端端口后，需同步更新 `client/vite.config.ts` 的 proxy target

### 启动命令

**后端：**

```bash
cd server
npm install
npx prisma generate
npx prisma migrate dev
npm run dev
```

**前端（新终端）：**

```bash
cd client
npm install
npm run dev
```

---

## ⚙️ 环境变量

### 必填（生产环境）

| 变量 | 说明 |
|------|------|
| `JWT_SECRET` | JWT 签名密钥（建议 32+ 字符） |
| `ENCRYPTION_KEY` | 加密密钥（**必须 32 字符**） |

### 可选

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CORS_ORIGIN` | - | 允许的前端来源 |
| `JWT_EXPIRES_IN` | `7d` | JWT 过期时间 |
| `LOG_RETENTION_DAYS` | `90` | 日志保留天数 |
| `ALLOW_PUBLIC_REGISTRATION` | `false` | 公开注册初始值，**仅首次创建设置记录时生效**；之后在设置页修改 |
| `MULTI_USER_ENABLED` | `true` | 多用户初始值，**仅首次创建设置记录时生效**；之后在设置页修改 |
| `BOOTSTRAP_ADMIN_USERNAME` | 空 | 旧库升级且无管理员时，指定提升为管理员的用户名；留空则提升最早创建的账号 |
| `DATABASE_URL` | - | SQLite 连接串 |
| `ACME_ENV` | `production`（当 `NODE_ENV=production` 且未显式设置 ACME_ENV 时），否则 `staging` | ACME 环境：`staging` / `production` |
| `CERTIFICATE_SCHEDULER_INTERVAL_MS` | `15000` | 证书订单调度器轮询间隔 |
| `CERTIFICATE_RENEWAL_SCHEDULER_INTERVAL_MS` | `21600000` | 自动续期调度器轮询间隔（默认 6 小时） |
| `ACME_PROPAGATION_DELAY_MS` | `30000` | 自动写入 TXT 后的首次传播等待时间 |
| `VENDOR_CERTIFICATE_SCHEDULER_INTERVAL_MS` | `30000` | 厂商证书订单调度器轮询间隔 |
| `CERTIFICATE_DEPLOY_SCHEDULER_INTERVAL_MS` | `30000` | 证书部署调度器轮询间隔 |
| `SMTP_HOST` | - | SMTP 主机（未在设置中配置 SMTP 时必填） |
| `SMTP_PORT` | `587` | SMTP 端口 |
| `SMTP_SECURE` | `false` | 是否使用 SMTPS（465） |
| `SMTP_USER` | - | SMTP 用户名（可选） |
| `SMTP_PASS` | - | SMTP 密码（可选） |
| `SMTP_FROM` | - | 发件人（如 `DNS Panel <no-reply@example.com>`） |

> 邮件通知：也可以在「设置」里配置 SMTP；未配置时会使用环境变量 `SMTP_*`。

---

## ❓ 常见问题

<details>
<summary><b>容器启动后无法访问？</b></summary>

```bash
docker compose ps          # 检查容器状态
docker compose logs -f     # 查看日志
curl http://localhost:3000/health  # 测试健康检查
```

</details>

<details>
<summary><b>忘记或修改了 ENCRYPTION_KEY？</b></summary>

更改 `ENCRYPTION_KEY` 后，历史加密的 DNS 凭证将**无法解密**。只能保持原值，或让用户重新录入凭证。

</details>

---

## 🗂️ 项目结构

```text
.
├── client/                           # 前端（React + Vite）
│   └── src/
│       ├── pages/Certificates.tsx    #   证书中心页
│       ├── components/Certificates/  #   证书中心组件
│       ├── services/certificates.ts  #   证书 API 调用
│       ├── pages/Tunnels.tsx         #   Tunnels 列表页
│       ├── components/Tunnels/       #   Tunnels 组件
│       │   ├── TunnelDetailsPanel.tsx #     详情面板（副本/路由/安装指引）
│       │   └── TunnelPublicHostnamesDialog.tsx  # 路由管理弹窗（三类路由）
│       └── services/tunnels.ts       #   Tunnels API 调用
├── server/                           # 后端（Express + Prisma）
│   └── src/
│       ├── routes/certificates.ts    #   证书订单 API
│       ├── routes/certificateCredentials.ts # ACME 账户 API
│       ├── routes/certificateDeploy.ts #   证书部署（目标/任务）API
│       ├── routes/vendorCertificates.ts #   厂商证书订单 API
│       ├── routes/certificateAliases.ts #   CNAME Alias API
│       ├── services/cert/            #   ACME / DNS-01 / 订单服务
│       ├── jobs/certificateOrderScheduler.ts # 证书调度器
│       ├── jobs/certificateRenewalScheduler.ts # 自动续期调度器
│       ├── jobs/vendorCertificateScheduler.ts # 厂商证书调度器
│       ├── jobs/certificateDeployScheduler.ts # 部署调度器
│       ├── routes/tunnels.ts         #   Tunnels REST API（~1000 行）
│       └── services/cloudflare.ts    #   Cloudflare API 封装
├── docker-compose.yml                # Docker Compose 配置
├── Dockerfile                        # 多阶段构建（前后端一体）
├── .env.example                      # 环境变量示例
├── doc/                              # 项目文档
│   ├── 快速启动指南.md               # 快速部署指南
│   ├── OPEN_API.md                   # Open API 参考
│   ├── EDGEONE.md                    # EdgeOne 接入说明
│   ├── CERTIFICATE_PLAN.md           # 证书中心规划
│   ├── GEMINI_CERTIFICATE_PLAN_REVIEW.md # 规划评估
│   └── UIUX-STANDARDS.md             # UI/UX 规范
```

---

## 📄 许可证

[MIT License](LICENSE)
