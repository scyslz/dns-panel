# 腾讯云 EdgeOne 站点接入 + DNSPod 自动同步（加速域名）

## 设计

- **入口在左侧 DNS 服务商列表**：「EdgeOne」和其它 DNS 服务商并列，点击后复用仪表盘的卡片、账户 Tab、搜索、表格与分页样式；不再有独立 `/edgeone` 页面。
- **EdgeOne 面板只管 EdgeOne 的「加速域名」**：新增 / 删除加速域名时，EdgeOne 会分配一个 CNAME；真实 DNS 记录始终在 DNSPod。
- **一个站点对应一个域名**，站点可以是 `full`（NS 接入）或 `dnsPodAccess`（DNSPod 托管接入）等类型；
  `dnsPodAccess` 站点调用 `DescribeDnsRecords` 官方就返回空，所以这里不显示 DNS 记录，只显示加速域名。
- **UI 已并入 DNS 服务商列表**：点侧边栏「EdgeOne」账户后，在 Dashboard 的多账号 Tab 里显示 `EdgeOnePanel`，
  与其他提供商一致；`/edgeone` 独立路由重定向回首页。凭证统一在「设置 → DNS 账户管理」维护，页面不再单独提供凭证按钮。
- 站点状态按接入类型解释：`dnsPodAccess` 的 `Status=pending` 显示「DNSPod 托管接入 · 已启用」，
  只有 `full`（NS）站点的 `pending` 才提示「待切换 NS」；`Area=global` 显示「全球（含中国大陆）」。
- **不需要指定 DNSPod 凭证**：EdgeOne 与 DNSPod 通常是同一把腾讯云 SecretId/SecretKey。
  后端自动在当前用户的 `dns_credentials` 里找 `secretId` 相同、且托管了该域名的 DNSPod 凭证，
  站点/域名列表会给每个加速域名打上「DNSPod 已关联 / 值不同 / 未关联」标记。
- **零新增表、零 schema 变更**：凭证复用 `/api/dns-credentials`（`provider='edgeone'`），
  站点与同步目标都不落库，和阿里云 ESA 模块一样无状态。

## 凭证配置

到「设置 → DNS 账户管理」添加账户，提供商选 **EdgeOne**，填 `SecretId` / `SecretKey`（可选临时 Token）。
只要同账号下还有一把**相同 SecretId** 的腾讯云 DNSPod 凭证，CNAME 就会自动同步到它托管的域名。

## 加速域名表单（新建 / 编辑共用）

新建和编辑使用**完全相同的字段与顺序**，不支持修改的字段在编辑时置灰：

| 字段 | 对应 EdgeOne API | 新建 | 编辑 |
|------|------------------|------|------|
| DNS 值 | `DomainName` | 可填 `www` / `@` / 完整域名 | 置灰，创建后不可修改 |
| CNAME | `Cname` | 占位显示「创建后由 EdgeOne 自动分配」 | 置灰，展示 EdgeOne 分配值 |
| 回源 IP / 域名 | `OriginInfo.Origin` | 可编辑 | 可编辑 |
| 回源协议 | `OriginProtocol` | 协议跟随 / HTTP / HTTPS | 可编辑 |
| HTTP 回源端口 | `HttpOriginPort` | 占位 80，留空即用 80；选 HTTPS 时不显示 | 同左 |
| HTTPS 回源端口 | `HttpsOriginPort` | 占位 443，留空即用 443；选 HTTP 时不显示 | 同左 |
| 回源 Host | `OriginInfo.HostHeader` | 选项见下表 | 可编辑 |
| 申请免费 SSL 证书 | 见下文 | 可勾选（复选框，一次性动作） | 置灰；证书在列表「免费证书」列申请 |

回源 Host 选项保持简短、无字母编号、无括号：

| 值 | 显示 | EdgeOne 参数 |
|----|------|--------------|
| `default` | 加速域名 | 不传 `HostHeader` |
| `request` | 请求 Host | `$host` |
| `origin` | 回源地址 | 回源 IP / 域名 |
| `custom` | 自定义 | 用户填写值 |

创建成功后自动把 EdgeOne 分配的 **CNAME** upsert 到 DNSPod（同名同类型优先更新、值相同跳过）。
编辑回源配置不会改变 CNAME，因此不会触发 DNSPod 写入。

**删除流程**：EdgeOne 不允许直接删除正在使用的加速域名，必须先停用。
列表每行的操作区提供「编辑 / 停用·启用 / 删除」三个按钮；`online`、`process` 等状态的删除按钮会置灰，
后端也会用 `409` 强制拦截。停用后（`offline` 或 `init`）才可删除，删除时自动移除 DNSPod 里值匹配的 CNAME。

站点行的同步按钮会做「全量对齐」：遍历所有加速域名把 CNAME 补齐/更新到 DNSPod。

免费证书是**单向操作**（只能申请，不能在面板里关闭），因此列表用状态 Chip 表示，而不是开关：
`去申请`（可点击）→ `申请中` → `已开启`；未检测到状态时显示 `未检测`。

## 页面显示

- 账户 Tab、搜索框、按钮组、卡片、表格沿用 DNS 域名列表样式；站点表**不分页**（与 DNS 记录表一致，一次展示全部）
- 点站点行（或移动端卡片）时，加速域名**紧跟在该站点下方展开**，而不是统一堆到列表最底部
- 站点表本身不横向滚动，加速域名表在自己的容器里滚动，两者滚动互不影响
- 站点表按容器宽度自适应（`tableLayout: fixed`），**不出现横向滚动条**；加速域名表内容较多，自带横向滚动条并固定操作列
- 回源列按协议只展示生效端口：`HTTP` 显示 80 端口、`HTTPS` 显示 443/自定义 HTTPS 端口、协议跟随才同时显示两个端口
- 操作结果用右下角浮层提示，不往列表上方插入 Alert；删除 / 停用只刷新当前域名列表，不再整页闪一下
- 站点列：展开按钮 / 域名 + `DNSPod` 标签 / Zone ID + 接入方式 / 状态 + 区域 / 操作
- 加速域名列：DNS 值 + `TLS` 标签 / 状态 / CNAME + `DNSPod` 标签 / 回源 / 操作
  - 颜色区分：状态用语义色（绿=生效、琥珀=部署中），`DNSPod` 用 info 蓝，`TLS` 用 secondary 蓝
  - DNSPod 关联不再单独占列，只在域名旁显示一个紧凑的绿色 `DNSPod` 标签（悬浮显示凭证与域名），未关联则不显示
- 展开站点 → 加速域名表格：DNS 值 + TLS、状态、CNAME + DNSPod 同步状态、回源信息
  - `已关联`：DNSPod 里 CNAME 值一致
  - `值不同`：同名 CNAME 存在但目标不同
  - `未关联`：DNSPod 里没有该 CNAME
  - `未检测`：没找到同一把密钥托管的 DNSPod 域名

## API

`/api/tencent-edgeone`（均需登录）：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/credentials/:id/verify` | 复用 `dns_credentials` 凭证的连通性校验 |
| GET | `/plans` | 套餐 |
| GET / POST / DELETE | `/sites[/:zoneId]` | 站点列表 / 创建 NS 站点 / 删除 |
| POST | `/sites/:zoneId/verify` | 归属权 / NS 切换状态 |
| GET / POST | `/sites/:zoneId/domains` | 加速域名列表 / 新增（自动同步 CNAME + 可选免费证书） |
| PUT | `/sites/:zoneId/domains/:domainName` | 编辑回源 IP/域名、回源协议、HTTP/HTTPS 端口、回源 Host |
| PUT | `/sites/:zoneId/domains/:domainName/status` | 停用（`offline`）/ 启用（`online`） |
| DELETE | `/sites/:zoneId/domains/:domainName` | 删除并自动移除 CNAME；**仅 `offline` / `init` 状态可删** |
| POST | `/sites/:zoneId/domains/:domainName/certificate` | 为已有加速域名开启/查询免费证书（自动适配接入模式） |
| GET | `/sites/:zoneId/domains/:domainName/certificate` | 查询免费证书签发状态 |
| POST | `/sites/:zoneId/sync` | 全量对齐 CNAME 到 DNSPod |
| GET / POST / PUT / DELETE | `/sites/:zoneId/records[/:recordId]` | 兼容保留：仅 NS(`full`) 站点可用的 EdgeOne DNS 记录接口；`dnsPodAccess` 站点不要用 |

使用的腾讯云 EdgeOne 接口（`2022-09-01`，TC3-HMAC-SHA256）：
`DescribeZones`、`CreateZone`、`DeleteZone`、`DescribePlans`、`VerifyOwnership`、
`DescribeAccelerationDomains`、`CreateAccelerationDomain`、`ModifyAccelerationDomain`、`ModifyAccelerationDomainStatuses`、`DeleteAccelerationDomains`、
`ModifyHostsCertificate`、`CheckFreeCertificateVerification`、`ApplyFreeCertificate`、
`DescribeDnsRecords`、`CreateDnsRecord`、`ModifyDnsRecords`、`DeleteDnsRecords`。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ENCRYPTION_KEY` | — | 必须 32 字符，用于加密所有凭证 |
| `TEO_API_HOST` | `teo.tencentcloudapi.com` | 国际站可设 `teo.intl.tencentcloudapi.com` |

## 注意

- NS 接入后公网权威解析在 EdgeOne；`dnsPodAccess` 站点权威解析仍在 DNSPod。
  写 DNSPod 是为了让 CNAME 指向 EdgeOne，两种模式下都是必要的。
- **免费证书按接入模式自动分流**（避免 `OperationDenied.CurrentZoneOnlySupportAutoVerification`）：
  1. 先调 `CheckFreeCertificateVerification`，域名已有免费证书时直接复用（`already_issued`），不重复申请；
  2. `full`（NS）与 `dnsPodAccess`（DNSPod 托管接入）→ 调 `ModifyHostsCertificate(Mode='eofreecert')` 由 EdgeOne **自动验证**申请并部署；
  3. 其他接入模式 → 调 `ApplyFreeCertificate(dns_challenge)`，把返回的验证 TXT 自动写入 DNSPod。
  - 每个加速域名行的证书按钮可对已有域名单独发起/查询；创建域名时勾选则自动执行。
  - 自动验证模式由 EdgeOne 完成验证，无需写 TXT；证书签发结果可用 `CheckFreeCertificateVerification` 查询。
- 如果 EdgeOne 与 DNSPod 用的是**不同密钥**，页面会显示「未检测」，此时不会自动同步；
  请用同一把 SecretId/SecretKey 添加两个凭证。
