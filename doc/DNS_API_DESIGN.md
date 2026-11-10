# DNS 记录开放 API 设计方案

> **实施修订（按反馈调整）**
> 1. API Key 不再使用 scope：Key 与单个 User 完全绑定，拥有该账号全部权限。
> 2. API Key 数量不限制，并在「设置」页提供管理界面；新增 `/docs` API 参考页。
> 3. 记录接口新增 `options` 扩展字段，用于 Cloudflare 等厂商的专有参数（proxied/comment/tags）。
> 实际行为以 `API.md` 为准。

> 目标：在现有 DNS Panel 之上提供一套**面向程序调用**的 API，支持 DNS 记录的查询、创建、更新、删除（含批量与幂等），
> 同时不改动现有页面链路，保证 UI 完全兼容。

---

## 1. 背景与目标

现状：所有 DNS 记录操作都通过前端页面完成，后端接口 `/api/dns-records/*` 虽然已具备 CRUD 能力，但它是"为页面服务的内部接口"：

| 问题 | 说明 |
|------|------|
| 认证方式 | JWT access token，7 天有效，权限=整个账号，无法细粒度授权、无法单独吊销 |
| 寻址方式 | 必须传提供商侧的 `zoneId`（Cloudflare/DNSPod 各不相同），脚本需要先查 zoneId |
| 凭证选择 | `?credentialId=` 可选，缺省取默认凭证，多账号场景下语义不清 |
| 无批量 | 一次只能一条记录，批量导入需要循环调用，慢且容易触发厂商限流 |
| 无幂等 | 网络重试会产生重复记录（A 记录可以有重复值） |
| 无并发控制 | 无 `If-Match`/版本，后写覆盖先写 |
| 无文档 | 没有 OpenAPI，第三方无法自助接入 |

设计目标：

1. **Key 认证**：独立 API Key，可吊销、可限权、可限域名、可限 IP、可限速。
2. **域名优先寻址**：`/domains/example.com/records`，调用方不需要理解各厂商的 zoneId。
3. **一套语义覆盖 14 个提供商**：全部复用现有 `DnsService` + Provider 抽象，不新增厂商适配。
4. **可自动化**：批量、幂等、upsert、按 name+type 删除、TTL 默认值、能力校验。
5. **可审计**：所有写操作沿用 `Log` 表，标记来源为 API 与 Key 名称。
6. **不破坏现状**：`/api/dns-records/*` 保持不动，新 API 挂在 `/api/open/*`。

---

## 2. 现状代码评估

已有的可复用资产（无需重写）：

- `server/src/services/dns/DnsService.ts` — 统一门面：`getZones / getRecords / getRecord / createRecord / updateRecord / deleteRecord / getCapabilities`
- `server/src/providers/*` — 14 个提供商的适配实现，含能力声明 `ProviderCapabilities`（`recordTypes`、`supportsLine`、`supportsWeight`、`paging`、`requiresDomainId` 等）
- `server/src/routes/dnsRecords.ts` — 已有的参数解析、错误映射、日志写法，可直接抽成公共模块
- `server/src/middleware/rateLimit.ts` — express-rate-limit 现成封装
- `server/src/utils/response.ts` — 响应封装（新 API 建议用独立的 v1 封装，见 §6.2）

需要新增的：

- `ApiKey` 数据模型 + 签发/校验/吊销逻辑
- `authenticateApiKey` 中间件
- 域名 → zone 解析器（带缓存）
- 记录名校验/归一化、按 name+type 查找记录
- 批量执行器、幂等缓存
- `/api/open` 路由 + OpenAPI 文档

---

## 3. 总体架构

```
调用方 (curl / SDK / CI / 证书脚本)
        │  Authorization: Bearer dns_live_xxx
        ▼
┌─────────────────────────────────────────────┐
│ /api/open  (新增)                              │
│  authenticateApiKey → scope/域名/IP 校验      │
│  rateLimit(per key) → 参数校验 → 幂等检查      │
└──────────────────┬──────────────────────────┘
                   ▼
        DnsRecordApiService (新增服务层)
        ├─ ZoneResolver        域名 → zoneId（缓存 5min）
        ├─ RecordLocator       按 name+type+value 定位记录
        ├─ RecordValidator     类型/值/TTL/线路 校验
        ├─ BatchExecutor       批量 + 并发限制
        └─ IdempotencyStore    幂等键 → 响应快照
                   ▼
        dnsService (现有门面，不改)
                   ▼
        Provider 适配层（Cloudflare / DNSPod / 阿里云 / …）
```

**关键原则**：v1 路由里不做任何厂商特判；所有差异通过 `dnsService.getCapabilities(ctx)` 与 `DnsProviderError` 暴露。

---

## 4. 认证与授权

### 4.1 Key 格式

```
dns_live_<keyId(8)>_<secret(32)>
例：dns_live_7f3a9c21_9Kd2mQ...（仅创建时返回一次）
```

- `keyId` 明文存储、建唯一索引，用于**O(1) 查找**，避免全表比对哈希。
- `secret` 用 `sha256(secret + API_KEY_PEPPER)` 存库；数据库泄露也无法反推 Key。
- 只展示一次，之后仅显示 `dns_live_7f3a9c21_****`。
- 支持 `expiresAt` 过期、`revokedAt` 吊销（软删，保留审计）。
- 记录 `lastUsedAt` / `lastUsedIp`（异步更新，不要每条请求都写库）。

### 4.2 传输方式

优先 `Authorization: Bearer <key>`；兼容 `X-API-Key: <key>`（部分老工具只支持后者）。
**不接受**放在 query string（会进 access log / 浏览器历史）。

### 4.3 权限模型（scope）

| Scope | 含义 |
|-------|------|
| `dns:read` | 列域名、查记录、查线路、查能力 |
| `dns:write` | 创建/更新/删除/启停记录 |
| `zone:read` | 列域名（`dns:read` 已隐含，独立 scope 便于只读 DNS 发现） |
| `zone:write` | 添加/删除域名（默认不授予，高风险） |

写操作必须同时具备 `dns:write`。默认新建 Key 只给 `dns:read,dns:write`。

### 4.4 数据边界（最小权限）

- `credentialId`：Key 可绑定**唯一一个** DNS 凭证；未绑定则允许使用该用户名下任意凭证（通过请求参数或默认凭证指定）。生产建议绑定。
- `allowedDomains`：JSON 数组，支持通配 `*.example.com`、`example.com`。命中校验在 zone 解析**之后**、真正调用厂商**之前**，避免越权探测。
- `allowedIps`：JSON 数组，支持 CIDR（`10.0.0.0/8`）与单 IP；为空表示不限制。取 `getClientIp(req)`，需考虑反代 `X-Forwarded-For` 配置。
- 所有查询都以 `userId = key.userId` 为过滤条件，复用现有 `prisma.dnsCredential.findFirst({ where: { id, userId } })` 的隔离逻辑。

### 4.5 中间件伪代码

```ts
// server/src/middleware/apiKey.ts
export async function authenticateApiKey(req: ApiRequest, res, next) {
  const raw = extractKey(req);                       // Bearer / X-API-Key
  if (!raw) return apiError(res, 401, 'MISSING_API_KEY', '缺少 API Key');

  const parsed = parseKey(raw);                      // { keyId, secret }
  if (!parsed) return apiError(res, 401, 'INVALID_API_KEY', 'API Key 格式不正确');

  const record = await prisma.apiKey.findUnique({ where: { keyId: parsed.keyId } });
  if (!record || record.revokedAt) return apiError(res, 401, 'INVALID_API_KEY', 'API Key 无效或已吊销');
  if (record.expiresAt && record.expiresAt < new Date()) return apiError(res, 401, 'KEY_EXPIRED', 'API Key 已过期');
  if (!safeEqual(hash(parsed.secret), record.keyHash)) return apiError(res, 401, 'INVALID_API_KEY', 'API Key 无效');

  if (record.allowedIps && !ipAllowed(getClientIp(req), record.allowedIps))
    return apiError(res, 403, 'IP_NOT_ALLOWED', '来源 IP 不在白名单');

  req.apiKey = { id: record.id, name: record.name, userId: record.userId,
                 scopes: splitScopes(record.scopes), credentialId: record.credentialId,
                 allowedDomains: parseJson(record.allowedDomains) };
  req.user = await loadUserLite(record.userId);       // 复用现有日志/凭证逻辑
  touchLastUsed(record.id, getClientIp(req));         // 节流写入（如 60s 一次）
  next();
}

export const requireScope = (scope: string) => (req, res, next) =>
  req.apiKey.scopes.includes(scope) ? next() : apiError(res, 403, 'SCOPE_DENIED', `缺少权限: ${scope}`);
```

---

## 5. 数据模型

追加到 `server/prisma/schema.prisma`（项目用 `prisma db push`，无需迁移文件）：

```prisma
model ApiKey {
  id               Int       @id @default(autoincrement())
  userId           Int
  user             User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  name             String
  keyId            String    @unique          // 明文前缀，用于查找
  keyHash          String                      // sha256(secret + pepper)
  scopes           String    @default("dns:read,dns:write")
  credentialId     Int?                        // 绑定单个 DNS 凭证（可选）
  allowedDomains   String?                     // JSON: ["example.com","*.foo.com"]
  allowedIps       String?                     // JSON: ["1.2.3.4","10.0.0.0/8"]
  rateLimitPerMin  Int       @default(60)
  expiresAt        DateTime?
  revokedAt        DateTime?
  lastUsedAt       DateTime?
  lastUsedIp       String?
  createdAt        DateTime  @default(now())

  @@index([userId])
  @@map("api_keys")
}
```

`User` 增加反向关系：`apiKeys ApiKey[]`。

幂等记录复用现有 `Cache` 表即可（`key = idem:<userId>:<keyId>:<Idempotency-Key>`，`expiresAt = now + 24h`），无需新表；若担心与 DNS 缓存互相影响，可加前缀区分（现有 Cache 表已按 `key` 唯一）。

> 注意：`Log` 表不加字段也能审计——写日志时把 `ipAddress` 保留，`errorMessage/newValue` 中带上 `source: "api"`, `apiKey: "<name>"`。若希望可查询，建议给 `Log` 增加 `source String @default("ui")` 与 `apiKeyId Int?`，成本很低。

---

## 6. API 规范

### 6.1 版本与路由挂载

```ts
// server/src/index.ts
app.use('/api/open', apiV1Routes);          // 新增
app.use('/api/dns-records', dnsRecordRoutes);  // 保持不变（UI 使用）
```

`/api/open` 内部结构：

```
server/src/routes/api/open/index.ts       // 挂载 + 统一错误处理
server/src/routes/api/open/domains.ts
server/src/routes/api/open/records.ts
server/src/routes/api/open/meta.ts        // /me、/capabilities
```

### 6.2 统一响应与错误码

成功：

```json
{ "ok": true, "data": { ... }, "requestId": "req_8f2c1a" }
```

失败：

```json
{
  "ok": false,
  "error": {
    "code": "RECORD_NOT_FOUND",
    "message": "记录不存在: www.example.com A",
    "details": { "domain": "example.com", "name": "www", "type": "A" }
  },
  "requestId": "req_8f2c1a"
}
```

HTTP 状态与错误码映射：

| HTTP | code | 场景 |
|------|------|------|
| 400 | `INVALID_ARGUMENT` | 参数缺失/格式错误 |
| 400 | `UNSUPPORTED_RECORD_TYPE` | 厂商不支持该类型（details 带 `supported`） |
| 401 | `MISSING_API_KEY` / `INVALID_API_KEY` / `KEY_EXPIRED` | 认证失败 |
| 403 | `SCOPE_DENIED` / `DOMAIN_NOT_ALLOWED` / `IP_NOT_ALLOWED` | 越权 |
| 404 | `ZONE_NOT_FOUND` / `RECORD_NOT_FOUND` | 资源不存在 |
| 409 | `AMBIGUOUS_RECORD` / `RECORD_CONFLICT` / `IDEMPOTENCY_CONFLICT` | 需要消歧/冲突 |
| 422 | `PROVIDER_REJECTED` | 厂商业务拒绝（详情透传 code/message） |
| 429 | `RATE_LIMITED` | 限流，带 `Retry-After` |
| 502 | `PROVIDER_UNAVAILABLE` | 厂商不可达/超时（`retriable: true`） |

`requestId` 由中间件生成（`crypto.randomUUID()` 截断），写入响应头 `X-Request-Id` 与日志，便于排障。

### 6.3 端点清单

| 方法 | 路径 | 说明 | Scope |
|------|------|------|-------|
| GET | `/api/open/me` | Key 信息、scopes、绑定的凭证 | — |
| GET | `/api/open/domains` | 域名列表（`?keyword=&page=&pageSize=`） | `dns:read` |
| GET | `/api/open/domains/:domain` | 单个域名信息（含权威状态、名称服务器） | `dns:read` |
| GET | `/api/open/domains/:domain/records` | 记录列表（`?type=&name=&value=&page=`） | `dns:read` |
| GET | `/api/open/domains/:domain/records/:recordId` | 记录详情 | `dns:read` |
| POST | `/api/open/domains/:domain/records` | 创建记录 | `dns:write` |
| PATCH | `/api/open/domains/:domain/records/:recordId` | 局部更新（只改传入字段） | `dns:write` |
| PUT | `/api/open/domains/:domain/records/:recordId` | 全量更新 | `dns:write` |
| PATCH | `/api/open/domains/:domain/records/:recordId/status` | 启停 `{ "enabled": false }` | `dns:write` |
| DELETE | `/api/open/domains/:domain/records/:recordId` | 按 ID 删除 | `dns:write` |
| DELETE | `/api/open/domains/:domain/records?name=&type=&value=` | 按内容删除（幂等友好） | `dns:write` |
| POST | `/api/open/domains/:domain/records:upsert` | 存在则更新、不存在则创建 | `dns:write` |
| POST | `/api/open/domains/:domain/records:batch` | 批量操作 | `dns:write` |
| GET | `/api/open/domains/:domain/lines` | 线路列表（支持线路的厂商） | `dns:read` |
| GET | `/api/open/domains/:domain/capabilities` | 能力：类型、TTL 下限、是否支持线路/权重/代理 | `dns:read` |

> 说明：`:batch` / `:upsert` 用 Google AIP 风格的自定义方法后缀，避免与 `/:recordId` 冲突（Express 里把自定义方法路由**放在** `/:recordId` 之前注册即可，稳妥起见也可用 `/records/batch` 并在 `:recordId` 前声明）。

### 6.4 请求/响应示例

**创建（TTL 缺省，返回标准化记录）**

```http
POST /api/open/domains/example.com/records
Authorization: Bearer dns_live_7f3a9c21_xxxxxxxx
Content-Type: application/json
Idempotency-Key: 5f1c2a9e-...

{
  "name": "www",          // 支持 "@"、"www" 或完整域名 "www.example.com"
  "type": "A",
  "value": "1.2.3.4",
  "ttl": 600,             // 可选，缺省取厂商最小 TTL 或 600
  "line": "default",      // 可选，仅 supportsLine 的厂商
  "proxied": true,        // 可选，仅 Cloudflare 等
  "remark": "created by ci"
}
```

```json
{
  "ok": true,
  "data": {
    "record": {
      "id": "123456789",
      "domain": "example.com",
      "name": "www",
      "fqdn": "www.example.com",
      "type": "A",
      "value": "1.2.3.4",
      "ttl": 600,
      "line": "default",
      "status": "1",
      "proxied": true,
      "updatedAt": "2026-11-10T12:00:00.000Z"
    }
  },
  "requestId": "req_8f2c1a"
}
```

**局部更新**

```http
PATCH /api/open/domains/example.com/records/123456789
{ "value": "5.6.7.8" }
```
只传 `value` 时，其余字段（name/type/ttl/line）沿用旧记录——这需要在服务层先 `getRecord` 合并，而不是把 `undefined` 丢给厂商（部分厂商会把未传字段重置为默认值，这是现有 `PUT` 的隐患，v1 的 PATCH 必须显式合并）。

**按内容删除**

```http
DELETE /api/open/domains/example.com/records?name=www&type=A&value=1.2.3.4
```
- 未找到 → `204 No Content`（幂等：重复删除不报错）
- 多条匹配且未传 `value` → `409 AMBIGUOUS_RECORD`，`details.candidates` 返回候选列表
- 传 `value` 且仍多条 → 删除全部匹配（并在 `data.deleted` 返回条数），或要求 `?all=true` 才批量删；**建议默认只允许唯一匹配**，`all=true` 显式开启

**Upsert**

```http
POST /api/open/domains/example.com/records:upsert
{ "name": "www", "type": "A", "value": "1.2.3.4", "ttl": 600, "match": { "value": "1.2.3.3" } }
```
- 匹配键默认 `(name, type, line)`；A/AAAA/TXT 可能有多条，因此允许 `match.value` 缩小范围。
- 结果 `data.action` ∈ `created | updated | unchanged`。
- 0 条 → 创建；1 条 → 差异则更新，无差异返回 `unchanged`（不调厂商写接口）；>1 条且无 `match` → `409 AMBIGUOUS_RECORD`。

**批量**

```http
POST /api/open/domains/example.com/records:batch
{
  "atomic": false,
  "operations": [
    { "op": "create", "name": "a", "type": "A", "value": "1.1.1.1" },
    { "op": "update", "id": "123", "value": "2.2.2.2" },
    { "op": "upsert", "name": "@", "type": "TXT", "value": "v=spf1 -all" },
    { "op": "delete", "id": "456" }
  ]
}
```

```json
{
  "ok": true,
  "data": {
    "results": [
      { "index": 0, "ok": true,  "action": "created", "record": { "id": "789", "name": "a", "type": "A" } },
      { "index": 1, "ok": false, "error": { "code": "RECORD_NOT_FOUND", "message": "..." } }
    ],
    "summary": { "total": 4, "succeeded": 3, "failed": 1 }
  }
}
```
- 单条失败不影响其余（`atomic: false`，默认）。
- `atomic: true` 为"先全量校验再执行"（preflight + 顺序执行），失败不保证厂商侧已生效部分回滚——**文档必须写明这不是事务**，避免误导。首版可先不实现 `atomic`，直接返回 400 `NOT_IMPLEMENTED`。
- 批量内部并发：同一 zone 内**串行**（多数厂商对同域名有 QPS 限制且并发写易触发风控），跨 zone 最多 3 并发。单次批量上限 100 条操作。

### 6.5 幂等

- 请求头 `Idempotency-Key`（UUID，客户端生成），仅对 POST/PATCH/PUT/DELETE 生效。
- 处理流程：`SETNX` 风格占位（状态 `in_progress`）→ 执行 → 存响应快照（24h）。
  - 命中 `completed` → 直接回放原响应，加 `Idempotent-Replay: true`
  - 命中 `in_progress` → `409 IDEMPOTENCY_IN_PROGRESS`（客户端应重试）
  - 相同 Key 但请求体不同 → `409 IDEMPOTENCY_CONFLICT`
- Key 的作用域：`userId + apiKeyId + Idempotency-Key`，防止跨租户撞键。

---

## 7. 关键算法

### 7.1 域名 → zone 解析（ZoneResolver）

调用方传 `example.com` 或 `www.example.com`，需要映射到厂商的 `zoneId`：

1. 归一化：小写、去末尾点、去协议/路径、IDN → punycode（`url.domainToASCII`）。
2. 取该凭证下的 zone 列表：`dnsService.getZones(ctx, 1, 100, keyword)` 分页拉全量（上限 1000），缓存 5 分钟，key = `zones:${provider}:${credentialKey}`。缓存复用现有 `DnsService` 的 NodeCache 更省事，或在 resolver 内单独维护。
3. 匹配策略：
   - 精确匹配 zone.name → 直接命中；
   - 否则按 `.` 后缀从长到短找最长匹配（`a.b.example.com` → `example.com`），命中后剩余部分作为记录名；
   - 都没有 → `404 ZONE_NOT_FOUND`，`details.suggestions` 返回包含该串的候选（最多 5 条）。
4. 命中后做 `allowedDomains` 校验（对 zone.name 匹配，不对子域名匹配，防止 `*.example.com` 越权到别的 zone）。
5. 返回 `{ zone: { id, name }, recordName: 'a.b' }`。

> 为什么不让用户传 zoneId：zoneId 是厂商内部 ID，跨厂商不通用、不可读、易变；域名优先是自动化场景的正确抽象。同时**保留** `?zoneId=` 可选覆盖，供高级用户跳过解析。

### 7.2 记录名归一化

- `@` / 空串 → 根记录（部分厂商用 `@`，部分用空串，由 Provider 层处理，已经在现有实现里做了）
- 以 `.` 结尾或等于 FQDN 且以 `.zoneName` 结尾 → 截断为相对名（`www.example.com` → `www`）
- 含 `*` 的泛解析保留
- 长度/字符校验：label ≤ 63，总长 ≤ 253；不允许空格、下划线例外（`_acme-challenge`、`_dmarc` 必须允许，很多厂商允许下划线）

### 7.3 记录定位（RecordLocator）

`getRecords` 的 `subDomain` 过滤在部分厂商是"模糊/前缀"语义，不可靠，因此：

```
findRecords(ctx, zoneId, { name, type, value? }):
  page = 1
  loop:
    result = dnsService.getRecords(ctx, zoneId, { page, pageSize: 500, type })
    精确过滤 name === targetName （以及 value 可选精确匹配）
    命中足够 / 已到末页 / 已翻 10 页 → 返回
```
- `type` 传给厂商做服务端过滤（大多数支持），减少数据量。
- 结果按 `name/type/value` 精确比对，不信任厂商的模糊搜索。
- 记录数量极多的域名（>5000 条）走 `paging: 'client'` 的厂商会较慢——加 5 分钟缓存并在文档标注。

### 7.4 值校验（RecordValidator）

在调用厂商前做本地校验，把错误提前到 400，减少无效 API 调用：

| 类型 | 规则 |
|------|------|
| A | IPv4，禁止私网？——**不禁止**（内网 DNS 是合法场景），仅校验格式 |
| AAAA | IPv6 格式 |
| CNAME | 主机名格式，不能与 A/AAAA 同名共存（冲突检测可选，交给厂商） |
| MX | `priority` 必填（0–65535），value 为主机名 |
| TXT | ≤ 2048 字符（部分厂商限制），过长拆分提示 |
| SRV | 需要 `priority` + `weight`，value 形如 `host:port` 或由独立字段拼接（按现有 Provider 约定） |
| CAA | value 形如 `0 issue "letsencrypt.org"` |
| TTL | ≥ 厂商 `minTtl`（通过 `getMinTtl` 获取），≤ 604800；缺省 600 |
| line | 仅 `supportsLine` 时允许，否则传了返回 400（避免静默忽略） |
| proxied | 仅 Cloudflare 等支持；其他厂商传了返回 400 |

类型必须属于 `capabilities.recordTypes`，否则 `400 UNSUPPORTED_RECORD_TYPE` + `details.supported`。

---

## 8. 限流与并发

- **每 Key 限流**：`express-rate-limit` + `keyGenerator: req => \`key:${req.apiKey.id}\``，读 300/min、写 60/min（Key 表 `rateLimitPerMin` 可覆盖写限额）。超限返回 `429` + `Retry-After`。
- **全局兜底**：保留现有 `dnsLimiter` 作为第二层（按 IP），防止单一 Key 打满厂商配额。
- **厂商配额**：批量同 zone 串行；单请求最多 100 操作；对 `retriable: true` 的 `DnsProviderError` 由 Provider 层已有重试处理（`BaseProvider.withRetry`），路由层不重复重试。
- **超时**：批量请求整体 30s 超时（`AbortController` 或 `Promise.race`），超时返回 504 `BATCH_TIMEOUT`，并建议客户端用幂等键重试。

---

## 9. 审计与可观测

- 写操作日志复用 `LoggerService.createLog`，约定：
  - `action`: `CREATE | UPDATE | DELETE`
  - `resourceType`: `DNS`
  - `ipAddress`: 真实来源 IP
  - `newValue`: JSON，包含 `source: "api"`, `apiKeyId`, `apiKeyName`, `requestId`, 以及记录快照
- 建议给 `Log` 加 `source`（`ui|api|cert|system`）与 `apiKeyId` 字段，前端日志页可筛选"API 来源"。
- 关键指标（可选，Prometheus 或简单计数日志）：请求量、错误率、按 provider 的失败分布、P99 延迟、限流触发次数。
- 失败日志必须记录厂商返回的原始 code（`DnsProviderError.details.code`），否则排障只能猜。

---

## 10. 代码改造清单

```
server/prisma/schema.prisma                     + ApiKey, User.apiKeys, Log.source/apiKeyId
server/src/config/index.ts                      + apiKey.pepper, apiKey.defaultRateLimit
server/src/middleware/apiKey.ts                 新增
server/src/middleware/requestId.ts              新增（或并入 apiKey 中间件）
server/src/utils/apiResponse.ts                 新增（v1 响应/错误封装）
server/src/services/dns/context.ts              新增（从 routes/dnsRecords.ts 抽出 getServiceContext + handleProviderError）
server/src/services/dns/ZoneResolver.ts         新增
server/src/services/dns/RecordLocator.ts        新增
server/src/services/dns/RecordValidator.ts      新增
server/src/services/dns/IdempotencyStore.ts     新增
server/src/services/dns/DnsRecordApiService.ts  新增（编排：解析→校验→调用→日志→响应映射）
server/src/services/apiKey/ApiKeyService.ts     新增（签发/列表/吊销/校验）
server/src/routes/api/open/index.ts               新增
server/src/routes/api/open/domains.ts             新增
server/src/routes/api/open/records.ts             新增
server/src/routes/api/open/meta.ts                新增
server/src/routes/apiKeys.ts                    新增（管理端，JWT 保护）
server/src/index.ts                             + app.use('/api/open', ...)
docs/openapi.yaml                               新增
client/src/services/apiKeys.ts                  新增（Phase 4）
client/src/pages/.../ApiKeys.tsx                新增（Phase 4，可选）
```

对现有代码的唯一侵入：把 `getServiceContext` / `handleProviderError` / `parseDomains` 从 `routes/dnsRecords.ts` 移到 `services/dns/context.ts` 并 import，行为不变（纯重构，便于回归）。

---

## 11. 实施阶段

| 阶段 | 内容 | 预估 | 可交付 |
|------|------|------|--------|
| P0 | 抽出公共 context、加 `ApiKey` 模型与 `authenticateApiKey`、`/me`、`/domains` 只读 | 0.5 天 | 能用 Key 读到域名 |
| P1 | 记录 CRUD（域名寻址）+ ZoneResolver + RecordLocator + 校验 + 日志 | 1.5 天 | 核心需求达成 |
| P2 | upsert、按内容删除、批量、幂等、能力端点 | 1 天 | 可放心用于 CI/证书脚本 |
| P3 | OpenAPI + curl 示例 + README 章节 + 错误码文档 | 0.5 天 | 可交付第三方 |
| P4 | 管理界面（Key 列表/创建/吊销/用量）、日志页来源筛选 | 1 天 | 产品完整性 |

**最小可用路径**：P0 + P1（约 2 天）即可满足"通过 API 增删改 DNS"。

---

## 12. 测试计划

1. **单元**：ZoneResolver（精确/后缀/无匹配/通配白名单/CNAME 归一化）、RecordValidator（各类型边界）、`parseKey`/`hash`、幂等状态机。
2. **集成**：用 PowerDNS（本地 docker）或 mock Provider 做端到端 CRUD，覆盖 400/401/403/404/409/422/429。
3. **兼容回归**：现有 `/api/dns-records/*` 全量接口跑一遍（抽公共函数后必须验证）。
4. **真实厂商冒烟**：Cloudflare / DNSPod 各准备一个测试子域，跑 create → upsert(unchanged) → patch → delete 幂等。
5. **限流/并发**：并发 50 个写请求，验证 429 与不产生重复记录（配合幂等键）。

---

## 13. 安全清单

- [ ] Key 仅存哈希，日志/异常中做脱敏（正则 `dns_(live|test)_[A-Za-z0-9_]+` 替换）
- [ ] 强制 HTTPS（反代层），文档强调不要在前端 JS 中暴露 Key
- [ ] scope + 域名白名单 + IP 白名单 + 凭证绑定 四层收敛
- [ ] 写操作全部落审计日志，含 requestId
- [ ] 吊销立即生效（不要缓存 Key 校验结果，或缓存 ≤ 30s 并支持主动失效）
- [ ] 批量接口上限、请求体大小限制（`express.json({ limit: '256kb' })`）
- [ ] 错误信息不泄露凭证/内网地址；`NODE_ENV=production` 不返回堆栈（现有 `errorResponse` 已如此）
- [ ] 防 SSRF：不允许通过 API 修改 Webhook 类配置（本设计不涉及）

---

## 14. 待确认的决策点

1. **认证方式**：独立 API Key（推荐）还是复用 JWT / 发长效 Personal Access Token？
2. **寻址**：域名优先（推荐）还是保持 `zoneId`？是否同时提供 `?zoneId=` 覆盖？
3. **范围**：是否本期就做批量 + 幂等，还是先只做单条 CRUD？
4. **管理界面**：Key 的创建/吊销是否要做页面，还是先用脚本/数据库？
5. **域名写权限**：是否开放 `zone:write`（通过 API 添加/删除域名）？建议首版不开放。

---

## 15. EdgeOne 适配方案

EdgeOne 与其余 14 个提供商**模型不同**，不能直接套用 `/api/open/domains/:domain/records`。现有代码已经明确把它排除在 DNS Provider 之外：

```ts
// server/src/providers/ProviderRegistry.ts
/**
 * 仅用于「复用 DnsCredential 存储」的非 DNS 服务商能力声明。
 * 不注册到 providerMap：这类凭证不参与 DNS 记录操作，也不需要 checkAuth()。
 */
const EDGEONE_CAPABILITIES: ProviderCapabilities = {
  provider: ProviderType.EDGEONE,
  recordTypes: [],        // ← 关键：没有任何 DNS 记录类型
  ...
};
```

因此 `dnsService.getProvider()` 遇到 `provider='edgeone'` 会直接失败。

### 15.1 为什么不能复用通用端点

| 概念 | 普通提供商 | EdgeOne |
|------|-----------|---------|
| 一级对象 | Zone / 域名（一个账号 N 个域名） | 站点 Site（**1 站点 = 1 域名**，且分 `full`(NS) / `dnsPodAccess`(DNSPod 托管) 两种接入方式） |
| 二级对象 | DNS 记录（name/type/value） | **加速域名**（domainName + CNAME + 回源配置 + 证书 + 启停），不是 DNS 记录 |
| DNS 记录在哪 | 厂商自己 | `full` 站点才在 EdgeOne（`DescribeDnsRecords`）；`dnsPodAccess` 站点官方返回**空**，记录实际在 DNSPod |
| 删除语义 | 直接删 | 加速域名**必须先停用**（`offline`/`init`）才能删，否则 409 |
| 证书 | 与 DNS 无关 | 免费证书单向申请，不可在面板关闭 |

结论：**EdgeOne 单独开一个命名空间 `/api/open/edgeone/*`**，共享同一套 API Key 认证、限流、幂等、审计，但不经过 `DnsService`，直接调用已有的 `services/tencentEdgeOne.ts`。

### 15.2 凭证怎么配

凭证与页面完全共用 `dns_credentials` 表（`provider='edgeone'`），**不需要新增表**。

```http
POST /api/dns-credentials            # 现有接口，JWT 认证
{
  "name": "EdgeOne 主账号",
  "provider": "edgeone",
  "secrets": {
    "secretId": "AKIDxxxxxxxx",
    "secretKey": "xxxxxxxx",
    "token": ""                       // 仅 STS 临时密钥需要
  },
  "accountId": null,
  "isDefault": true
}
```

要点：

- `secrets` 里字段名必须是 **`secretId` / `secretKey`**（大小写敏感，`resolveEdgeOneCredential` 按此读取）；临时密钥用 `token` 或 `sessionToken`。
- 国际站：设环境变量 `TEO_API_HOST=teo.intl.tencentcloudapi.com`（默认 `teo.tencentcloudapi.com`）。
- 必须配 `ENCRYPTION_KEY`（32 字符），否则 `decrypt` 失败。
- **CNAME 自动同步的前提**：同一用户下还要有一把 `provider='dnspod'` 且 **`secretId` 相同**、并且托管了该域名的凭证。这是"自动发现"机制（`resolveDnspodLink`），不是配置项；找不到就只返回 `dnspodLink.available=false`，不会报错。
- 站点创建接口只支持 `full`（`createNsZone` 写死 `Type: 'full'`）；`dnsPodAccess` 站点请在腾讯云控制台建，API 里只读。

### 15.3 API Key 怎么配

```json
{
  "name": "edgeone-ci",
  "scopes": ["edgeone:read", "edgeone:write"],
  "credentialId": 12,                     // 绑定上面那把 edgeone 凭证
  "allowedDomains": ["example.com"],      // 精确匹配站点域名，不做后缀通配
  "rateLimitPerMin": 30
}
```

- scope 拆成 `edgeone:read` / `edgeone:write`，与 `dns:*` 分离：只给 EdgeOne 权限的 Key 不能去动 DNSPod 记录。
- 如果需要同一个 Key 同时管 EdgeOne 和它背后的 DNSPod，则加绑 `dns:write` + 另一把 dnspod 凭证（当前设计一个 Key 绑一个 credential，多凭证场景建议发两个 Key）。
- `allowedDomains` 校验对象是 **站点域名**（`zone.zoneName`），不是加速域名（`www.example.com`）。加速域名天然属于该站点，无需再列。

### 15.4 端点

| 方法 | 路径 | 说明 | Scope |
|------|------|------|-------|
| GET | `/api/open/edgeone/sites` | 站点列表（含 `dnspodLink` 标记） | read |
| GET | `/api/open/edgeone/sites/:site` | 站点详情（`:site` 可用域名或 zoneId） | read |
| POST | `/api/open/edgeone/sites` | 创建 NS 站点 `{domain, area, planId?}`，`area ∈ mainland/overseas/global` | write |
| DELETE | `/api/open/edgeone/sites/:site` | 删除站点（**危险**，建议首版不开放） | write |
| POST | `/api/open/edgeone/sites/:site/verify` | 查询归属权 / NS 切换状态 | read |
| GET | `/api/open/edgeone/sites/:site/domains` | 加速域名列表 | read |
| POST | `/api/open/edgeone/sites/:site/domains` | 新增加速域名（自动写 CNAME 到 DNSPod） | write |
| GET | `/api/open/edgeone/sites/:site/domains/:name` | 单个加速域名详情 | read |
| PATCH | `/api/open/edgeone/sites/:site/domains/:name` | 改回源配置（origin / protocol / ports / hostHeader） | write |
| POST | `/api/open/edgeone/sites/:site/domains/:name:upsert` | 不存在则建、存在则改回源 | write |
| PATCH | `/api/open/edgeone/sites/:site/domains/:name/status` | `{ "status": "online" \| "offline" }` | write |
| DELETE | `/api/open/edgeone/sites/:site/domains/:name?force=true` | 删除；`force=true` 自动先停用再删 | write |
| POST | `/api/open/edgeone/sites/:site/domains/:name/certificate` | 申请免费证书 | write |
| GET | `/api/open/edgeone/sites/:site/domains/:name/certificate` | 查询证书状态 | read |
| POST | `/api/open/edgeone/sites/:site/sync` | 全量对齐 CNAME 到 DNSPod | write |
| GET/POST/PUT/DELETE | `/api/open/edgeone/sites/:site/records[/:id]` | **仅 `full` 站点**可用的 EdgeOne 解析记录；`dnsPodAccess` 返回 `400 ZONE_NOT_RECORD_CAPABLE` | read/write |

### 15.5 关键差异的处理

1. **站点寻址**：`:site` 允许域名（推荐）或 `zoneId`。域名匹配用 `describeZones({ keyword })` 后**精确比对**（EdgeOne 的 keyword 是模糊匹配，必须二次过滤），找不到 → `404 SITE_NOT_FOUND`。**不要**做后缀回退——一个站点就是一个域名，`www.example.com` 不是站点。

2. **加速域名寻址**：`:name` 接受 `www`、`@`、`www.example.com`，统一用现有的 `toTeoRecordFqdn(name, site.domain)` 转 FQDN；返回时用 `toRelativeRecordName` 转回相对名。

3. **创建不是幂等的**：EdgeOne 的 `CreateAccelerationDomain` 重复调用会报错（域名已存在）。因此：
   - `POST` 前先 `describeAccelerationDomains(keyword)` 精确查重，已存在 → `409 DOMAIN_ALREADY_EXISTS`，`details.existing` 带出现有配置；
   - 自动化场景用 `:upsert`，内部逻辑：查不到 → create；查到 → `modifyAccelerationDomain` 只更新传入字段，返回 `action: "created" | "updated" | "unchanged"`。

4. **删除必须先停用**：`force=true` 时执行 `offline → 轮询直到 offline（最多 60s，2s 间隔）→ delete`；不加 `force` 且状态非 `offline/init` → `409 DOMAIN_IN_USE`，`details.status` 给当前状态和提示。轮询超时 → `409 OFFLINE_TIMEOUT`（EdgeOne 停用是异步的，通常几十秒）。

5. **CNAME 同步必须回显**：所有写操作响应都带 `dnspodSync`：

```json
{
  "ok": true,
  "data": {
    "domainName": "www.example.com",
    "cname": "www.example.com.eo.dnse1.com",
    "dnspodSync": {
      "attempted": true,
      "action": "created",              // created | updated | unchanged | skipped | failed
      "credentialId": 3,
      "domain": "example.com",
      "error": null
    },
    "certificate": null
  }
}
```
   调用方据此判断"EdgeOne 建好了但 DNS 没生效"。**绝不能吞掉** `dnspodSync.error` 只返回成功。

6. **免费证书是单向的**：`POST .../certificate` 只负责申请/复用，没有"关闭"。重复申请由 `enableFreeCertificate` 内部幂等（`CheckFreeCertificateVerification` 先查），API 可以直接透传 `already_issued | applying | enabled | disabled`。

7. **`dnsPodAccess` 站点**：`GET .../records` 会返回空数组而不是报错（与页面一致），但 `POST .../records` 应直接 `400 ZONE_NOT_RECORD_CAPABLE`，`details.hint` 指向"该站点的解析记录在 DNSPod，请用 `/api/open/domains/.../records`"。

8. **通用端点遇到 edgeone 凭证**：`/api/open/domains` 列表直接过滤掉；显式传 `credentialId` 指向 edgeone 时返回

```json
{ "ok": false, "error": { "code": "PROVIDER_NOT_RECORD_CAPABLE",
  "message": "EdgeOne 凭证不支持 DNS 记录接口",
  "details": { "recordTypes": [], "alternatives": ["/api/open/edgeone/sites"] } } }
```

### 15.6 curl 示例

```bash
# 1) 列站点
curl -s https://panel.example.com/api/open/edgeone/sites \
  -H "Authorization: Bearer dns_live_7f3a9c21_xxx"

# 2) 新增加速域名（自动写 CNAME 到 DNSPod + 申请免费证书）
curl -s -X POST https://panel.example.com/api/open/edgeone/sites/example.com/domains \
  -H "Authorization: Bearer dns_live_7f3a9c21_xxx" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "name": "www",
    "origin": "1.2.3.4",
    "originProtocol": "HTTPS",
    "httpsOriginPort": 443,
    "hostHeaderMode": "origin",
    "applyFreeCert": true
  }'

# 3) 改回源（只改传入字段）
curl -s -X PATCH https://panel.example.com/api/open/edgeone/sites/example.com/domains/www \
  -H "Authorization: Bearer dns_live_7f3a9c21_xxx" \
  -d '{ "origin": "5.6.7.8", "originProtocol": "FOLLOW" }'

# 4) 删除（自动先停用）
curl -s -X DELETE "https://panel.example.com/api/open/edgeone/sites/example.com/domains/www?force=true" \
  -H "Authorization: Bearer dns_live_7f3a9c21_xxx"
```

### 15.7 实现落点

```
server/src/routes/api/open/edgeone.ts        新增（薄路由，复用 tencentEdgeOne 服务函数）
server/src/services/edgeone/EdgeOneApiService.ts  新增（站点解析、查重、force 删除轮询、响应映射）
server/src/services/dns/context.ts         复用这里抽出的凭证解析思路（edgeone 单独一份 resolve）
```

- 路由层**不要**再复制 `resolveEdgeOneCredential`：把它从 `routes/tencentEdgeOne.ts` 抽到 `services/edgeone/credential.ts`，页面路由与 v1 共用。
- `TeoError` 映射到 §6.2 的错误码：`AuthFailure.*` → 401/403，`ResourceNotFound.*` → 404，`OperationDenied.*` / 状态冲突 → 409，`RequestLimitExceeded` → 429，其余 → 422 `PROVIDER_REJECTED`（透传 `Code`）。
- EdgeOne 的限流比 DNSPod 严，批量同步 `POST .../sync` 应限制并发 1（现有页面实现就是 for 循环串行），并放在后台任务里返回 `202 + taskId` 更稳；首版可同步执行但设 30s 超时。

### 15.8 一句话总结

> EdgeOne 不是"又一个 DNS 服务商"，而是"CDN 加速域名管理 + 自动把 CNAME 写进 DNSPod"。
> 配置上复用 `provider='edgeone'` 的凭证；API 上单开 `/api/open/edgeone/*`；
> 通用 DNS 记录端点必须明确拒绝 edgeone 凭证并给出替代路径。
