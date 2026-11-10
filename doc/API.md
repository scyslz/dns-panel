# DNS Panel 开放 API

面向程序调用的 DNS 管理接口。与页面接口（`/api/*` + JWT）完全分离，使用 API Key 认证。

- 基础路径：`/api/open`
- 认证：`Authorization: Bearer dns_live_...`（也支持 `X-API-Key`）
- 响应：统一 JSON 信封，带 `requestId`
- 文档对应设计：`DNS_API_DESIGN.md`

---

## 1. 快速开始

### 1.1 签发 API Key

**方式 A：命令行（最快）**

```bash
cd server

# 生成 Key（拥有账号全部 DNS 权限）
npx tsx src/scripts/create-api-key.ts --user <用户名> --name ci

# 绑定单个凭证 + 限制域名 + 限制来源 IP
npx tsx src/scripts/create-api-key.ts --user <用户名> --name deploy \
  --credential 2 \
  --domains example.com --ips 10.0.0.0/8 --rate 120
```

Key 只显示一次，格式为 `dns_live_<keyId>_<secret>`。

**方式 B：管理接口（登录态 JWT）**

```http
POST /api/api-keys
{
  "name": "ci",
  "credentialId": 2,
  "allowedDomains": ["example.com", "*.internal.example.com"],
  "allowedIps": ["10.0.0.0/8"],
  "rateLimitPerMin": 60,
  "expiresAt": "2027-01-01T00:00:00Z"
}
```

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/api-keys` | 列表（不返回明文） |
| POST | `/api/api-keys` | 创建（明文只返回一次） |
| DELETE | `/api/api-keys/:id` | 吊销（立即生效） |

也可以直接到 **设置 → API Key** 管理：生成、查看使用情况、吊销。界面右上角「文档」或左侧边栏的 API 文档图标可打开 `/docs` 参考页。

### 1.2 验证

```bash
curl -s -H "Authorization: Bearer dns_live_xxx" https://panel.example.com/api/open/me
```

### 1.3 权限模型

**API Key 与账号完全绑定，拥有该 User 的全部权限**，不再细分 scope。

- 同一个 Key 可以操作该账号下所有 DNS 凭证与 EdgeOne
- 需要缩小范围时用 `credentialId` 绑定单个凭证，或 `allowedDomains` / `allowedIps` 白名单
- Key 泄露等于账号 DNS 权限泄露，请按用途分开生成并在不使用时吊销

---

## 2. 通用约定

### 2.1 成功 / 失败

```json
{ "ok": true, "data": { }, "requestId": "req_8f2c1a" }
```

```json
{
  "ok": false,
  "error": {
    "code": "RECORD_NOT_FOUND",
    "message": "记录不存在: www A",
    "details": { "name": "www", "type": "A" },
    "retriable": false
  },
  "requestId": "req_8f2c1a"
}
```

### 2.2 错误码

| HTTP | code | 说明 |
|------|------|------|
| 400 | `INVALID_ARGUMENT` | 参数缺失/格式错误 |
| 400 | `UNSUPPORTED_RECORD_TYPE` | 厂商不支持该记录类型（`details.supported`） |
| 400 | `PROVIDER_NOT_RECORD_CAPABLE` | 凭证是 EdgeOne 等非解析类（`details.alternatives`） |
| 400 | `ZONE_NOT_RECORD_CAPABLE` | EdgeOne 站点不是 NS 接入，记录不在 EdgeOne |
| 401 | `MISSING_API_KEY` / `INVALID_API_KEY` / `KEY_EXPIRED` | 认证失败 |
| 403 | `DOMAIN_NOT_ALLOWED` / `IP_NOT_ALLOWED` | 越权 |
| 404 | `ZONE_NOT_FOUND` / `SITE_NOT_FOUND` / `RECORD_NOT_FOUND` / `DOMAIN_NOT_FOUND` | 资源不存在 |
| 409 | `AMBIGUOUS_RECORD` / `DOMAIN_ALREADY_EXISTS` / `DOMAIN_IN_USE` / `OFFLINE_TIMEOUT` / `IDEMPOTENCY_CONFLICT` | 需要消歧或状态冲突 |
| 422 | `PROVIDER_REJECTED` | 厂商业务拒绝（`details.providerCode`） |
| 429 | `RATE_LIMITED` | 触发 Key 配额，带 `Retry-After` |
| 502 | `PROVIDER_UNAVAILABLE` | 厂商超时/不可达（`retriable: true`） |

### 2.3 幂等

实现分「锁」和「结果回放」两层，锁不按固定 TTL 持有：

**锁（跟随业务处理）**

- 请求进入时占位，业务成功或失败后**立即释放**
- 同一 Key 的请求仍在处理：`409 IDEMPOTENCY_IN_PROGRESS`
- 失败会删除占位，可用同一个 Key 立即重试
- 只有进程崩溃才会留下锁，由租约兜底：默认 **120 秒**后可被下一次请求原子接管（`IDEMPOTENCY_LOCK_SECONDS`）

**结果回放（按配置保留）**

- 显式 `Idempotency-Key`：成功后保留 **24 小时**（`IDEMPOTENCY_RESULT_TTL_SECONDS`）
- 自动 Key（POST 未带请求头）：保留 **5 分钟**（`IDEMPOTENCY_AUTO_RESULT_TTL_SECONDS`）
- 上述值设为 `0`：业务处理完立即删除，只防并发重复，不做事后回放
- 回放时响应头带 `Idempotent-Replay: true`；自动模式带 `Idempotent-Auto: true`
- 相同 Key + 不同请求体：`409 IDEMPOTENCY_CONFLICT`

**自动 Key**

未带 `Idempotency-Key` 时，**POST 请求会自动生成幂等键**：

- 依据 `method + path（含 query）+ body` 计算 SHA-256
- 只对 POST 生效；PATCH/PUT/DELETE 本身幂等，不做自动缓存（否则会掩盖真实状态，例如第二次删除本应返回 `deleted: 0`）
- 如果确实要创建两条完全相同的记录，传一个每次唯一的 `Idempotency-Key` 即可绕过自动合并

### 2.4 限流

按 Key 滑动窗口计数，默认 **60 次/分钟**，可用 `rateLimitPerMin` 调整。
响应头：`X-RateLimit-Limit`、`X-RateLimit-Remaining`；超限 `429` + `Retry-After`。

### 2.5 凭证选择

所有 DNS/EdgeOne 接口都支持 `?credentialId=<id>`：

- 不传：使用 Key 绑定的凭证；未绑定则用该用户的默认凭证
- Key 绑定凭证后，传其他凭证会 `403 SCOPE_DENIED`（凭证边界校验，与 scope 无关）
- EdgeOne 凭证必须显式传给 `/api/open/edgeone/*`

---

## 3. DNS 记录

域名优先寻址：传 `example.com` 或 `www.example.com` 都可以，服务端解析到对应 zone，调用方无需知道厂商的 `zoneId`。

### 3.1 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/open/domains` | 域名列表（`keyword/page/pageSize`） |
| GET | `/api/open/domains/:domain` | 域名详情 |
| GET | `/api/open/domains/:domain/capabilities` | 支持的类型、最小 TTL、线路/权重能力 |
| GET | `/api/open/domains/:domain/lines` | 线路列表 |
| GET | `/api/open/domains/:domain/records` | 记录列表（`name/type/value/page/pageSize`） |
| GET | `/api/open/domains/:domain/records/:recordId` | 记录详情 |
| POST | `/api/open/domains/:domain/records` | 创建 |
| PATCH | `/api/open/domains/:domain/records/:recordId` | 局部更新（只改传入字段） |
| PUT | `/api/open/domains/:domain/records/:recordId` | 全量更新（需 name/type/value） |
| PATCH | `/api/open/domains/:domain/records/:recordId/status` | `{"enabled": false}` |
| DELETE | `/api/open/domains/:domain/records/:recordId` | 按 ID 删除 |
| DELETE | `/api/open/domains/:domain/records?name=&type=&value=&all=` | 按内容删除 |
| POST | `/api/open/domains/:domain/records/upsert` | 存在则更新，不存在则创建 |
| POST | `/api/open/domains/:domain/records/batch` | 批量（最多 100 条） |

> 注意：upsert/batch 使用 `/records/upsert`、`/records/batch` 子路径（不是 `:upsert` 后缀），路由上已放在 `/:recordId` 之前。

### 3.2 创建 / 更新

```bash
curl -X POST https://panel.example.com/api/open/domains/example.com/records \
  -H "Authorization: Bearer $DNS_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "name": "www",
    "type": "A",
    "value": "1.2.3.4",
    "ttl": 600,
    "remark": "created by ci"
  }'
```

```bash
# 只改值，其余字段（name/type/ttl/line/remark）自动保留
curl -X PATCH https://panel.example.com/api/open/domains/example.com/records/123456 \
  -H "Authorization: Bearer $DNS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"value": "5.6.7.8"}'
```

创建成功返回 `201`，记录结构：

```json
{
  "id": "123456",
  "domain": "example.com",
  "name": "www",
  "fqdn": "www.example.com",
  "type": "A",
  "value": "1.2.3.4",
  "ttl": 600,
  "line": "default",
  "status": "1",
  "remark": "",
  "updatedAt": "2026-11-10 01:34:00"
}
```

### 3.3 Upsert

```bash
curl -X POST https://panel.example.com/api/open/domains/example.com/records/upsert \
  -H "Authorization: Bearer $DNS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "www", "type": "A", "value": "1.2.3.4", "ttl": 600}'
```

- 默认匹配键：`name + type + line`
- A/AAAA/TXT 可能有多条，用 `"match": {"value": "1.2.3.3"}` 消歧
- 返回 `action`: `created` / `updated` / `unchanged`（无变化不调用厂商写接口）
- 匹配到多条且未消歧：`409 AMBIGUOUS_RECORD` + `details.candidates`

### 3.4 按内容删除

```bash
# 唯一匹配时删除；未找到返回 deleted: 0（幂等）
curl -X DELETE "https://panel.example.com/api/open/domains/example.com/records?name=www&type=A&value=1.2.3.4" \
  -H "Authorization: Bearer $DNS_KEY"

# 同名同类型多条时必须显式 all=true
curl -X DELETE ".../records?name=www&type=A&all=true" -H "Authorization: Bearer $DNS_KEY"
```

### 3.5 批量

```bash
curl -X POST https://panel.example.com/api/open/domains/example.com/records/batch \
  -H "Authorization: Bearer $DNS_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "operations": [
      {"op": "create", "name": "a", "type": "A", "value": "1.1.1.1"},
      {"op": "update", "id": "123", "value": "2.2.2.2"},
      {"op": "upsert", "name": "@", "type": "TXT", "value": "v=spf1 -all"},
      {"op": "delete", "name": "old", "type": "A", "value": "9.9.9.9"}
    ]
  }'
```

- 逐条执行，单条失败不影响其余；返回每条 `ok/action/error`
- 同一域名内**串行**，避免触发厂商并发写风控
- `atomic: true` 当前返回 400（厂商侧无事务，不做假承诺）

### 3.6 校验规则（本地提前拦截）

| 类型 | 规则 |
|------|------|
| A / AAAA | `net.isIP` 校验 |
| CNAME | 不能是 IP，必须是合法主机名 |
| MX | 必须提供 `priority` |
| TXT | ≤ 2048 字符 |
| CAA | `<flags> issue|issuewild|iodef "<ca>"` |
| TTL | 1–604800，且不低于厂商最小 TTL（DNSPod 为 600） |
| line / weight | 厂商不支持时直接 400，不静默忽略 |
| proxied | 仅 Cloudflare 支持 |

### 3.7 厂商扩展字段 `options`

除通用字段外，创建/更新/upsert/batch 都支持 `options` 对象，原样透传给 Provider：

```json
{
  "name": "www",
  "type": "A",
  "value": "1.2.3.4",
  "proxied": true,
  "options": {
    "comment": "created by ci"
  }
}
```

规则：

- 只允许字符串 / 数字 / 布尔 / 标量数组，最多 32 个键，总大小 ≤ 4KB
- 禁止 `__proto__` / `constructor` / `prototype`
- 未识别的键由 Provider 忽略；不会报错，便于跨厂商复用同一份脚本

已接入的扩展键：

| Provider | options | 说明 |
|----------|---------|------|
| Cloudflare | `proxied` | 等价于顶层 `proxied`，`options` 优先 |
| Cloudflare | `comment` | 记录备注，等价于顶层 `remark` |
| Cloudflare | `tags` | 预留（当前 SDK 未透传） |

> 顶层 `proxied` / `remark` 仍然可用；两者同时存在时 `options` 优先。

---

## 4. EdgeOne

EdgeOne 不是 DNS 记录提供商：一个站点 = 一个域名，二级对象是「加速域名」。所有写操作会在响应里回显 `dnspodSync`。

### 4.1 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/open/edgeone/sites` | 站点列表（含 `dnspodLink`） |
| POST | `/api/open/edgeone/sites` | 创建 NS 站点 `{domain, area}` |
| GET | `/api/open/edgeone/sites/:site` | 站点详情 |
| DELETE | `/api/open/edgeone/sites/:site` | 删除站点 |
| POST | `/api/open/edgeone/sites/:site/verify` | 归属权/NS 状态 |
| GET | `/api/open/edgeone/sites/:site/domains` | 加速域名列表 |
| POST | `/api/open/edgeone/sites/:site/domains` | 新增加速域名（自动写 CNAME） |
| POST | `/api/open/edgeone/sites/:site/domains/upsert` | 不存在则建、存在则改回源 |
| GET | `/api/open/edgeone/sites/:site/domains/:name` | 单个加速域名 |
| PATCH | `/api/open/edgeone/sites/:site/domains/:name` | 改回源配置 |
| PATCH | `/api/open/edgeone/sites/:site/domains/:name/status` | `{"status":"online"\|"offline"}` |
| DELETE | `/api/open/edgeone/sites/:site/domains/:name?force=true` | 删除（force 自动先停用） |
| GET | `/api/open/edgeone/sites/:site/domains/:name/certificate` | 证书状态 |
| POST | `/api/open/edgeone/sites/:site/domains/:name/certificate` | 申请免费证书 |
| POST | `/api/open/edgeone/sites/:site/sync` | 全量对齐 CNAME 到 DNSPod |
| GET/POST/PUT/DELETE | `/api/open/edgeone/sites/:site/records[/:recordId]` | 仅 `full`(NS) 站点 |

`:site` 可用域名（推荐）或 zoneId，只做精确匹配。

### 4.2 示例

```bash
# 列表
curl -s "https://panel.example.com/api/open/edgeone/sites" \
  -H "Authorization: Bearer $EDGEONE_KEY"

# 新增加速域名（自动写 CNAME + 可选免费证书）
curl -X POST "https://panel.example.com/api/open/edgeone/sites/example.com/domains" \
  -H "Authorization: Bearer $EDGEONE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "www",
    "origin": "1.2.3.4",
    "originProtocol": "HTTPS",
    "httpsOriginPort": 443,
    "hostHeaderMode": "origin",
    "applyFreeCert": true
  }'
```

响应：

```json
{
  "ok": true,
  "data": {
    "domain": "www.example.com",
    "cname": "www.example.com.eo.dnse1.com",
    "dnspodSync": {
      "attempted": true,
      "action": "created",
      "recordId": "2434972316",
      "error": null,
      "link": { "available": true, "credentialId": 2, "domain": "example.com" }
    },
    "certificate": null
  }
}
```

### 4.3 行为差异

- 创建加速域名不幂等：重复创建 `409 DOMAIN_ALREADY_EXISTS`，自动化请用 `domains/upsert`
- 删除前必须停用：不传 `force` 且状态不是 `offline/init` → `409 DOMAIN_IN_USE`；`force=true` 会停用并轮询最多 60 秒
- `dnsPodAccess` 站点的解析记录在 DNSPod：`/edgeone/.../records` 返回 `400 ZONE_NOT_RECORD_CAPABLE`
- 免费证书是单向操作：只能申请/查询，没有关闭接口
- CNAME 同步依赖「同一 SecretId 的 DNSPod 凭证托管该域名」，找不到时 `dnspodLink.available=false`，写操作仍成功但 `dnspodSync.error` 会说明原因

---

## 5. 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `API_KEY_PEPPER` | 复用 `JWT_SECRET` | Key 哈希 pepper；设置后不要更改，否则所有 Key 失效 |
| `TEO_API_HOST` | `teo.tencentcloudapi.com` | EdgeOne 国际站改为 `teo.intl.tencentcloudapi.com` |
| `DATABASE_URL` | `file:./database.db` | SQLite |
| `IDEMPOTENCY_LOCK_SECONDS` | `120` | 崩溃后锁租约，不是业务锁时长 |
| `IDEMPOTENCY_RESULT_TTL_SECONDS` | `86400` | 显式 Key 的结果回放时长；0 = 不保留 |
| `IDEMPOTENCY_AUTO_RESULT_TTL_SECONDS` | `300` | 自动 Key 的结果回放时长；0 = 不保留 |

新增表 `api_keys`（`prisma db push` 自动创建），不改动任何现有业务表。

---

## 6. 当前实现范围

已实现：

- API Key 签发/吊销/列表（数量不限制）、域名白名单、IP/CIDR 白名单、凭证绑定、每 Key 限流
- 设置页 API Key 管理卡片（生成 / 复制一次 / 吊销 / 使用情况）+ `/docs` API 参考页
- 记录 `options` 扩展字段（Cloudflare proxied/comment 已接入）
- DNS 域名列表/详情/能力/线路
- 记录 CRUD、PATCH 合并、按内容删除、upsert、批量、幂等、审计日志
- EdgeOne 站点/加速域名/证书/CNAME 同步/NS 站点记录
- 命令行签发脚本、本文档

未实现（有意留到下一期）：

- 通过 API 添加/删除域名（`zone:write` 已预留）
- `atomic` 批量
- OpenAPI YAML（端点已固定，可后续从本文档生成）
