import { useState } from 'react';
import { alpha } from '@mui/material/styles';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  Divider,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Typography,
} from '@mui/material';

const codeSx = {
  bgcolor: '#0f172a',
  color: '#e2e8f0',
  p: 1.5,
  borderRadius: 1.5,
  overflowX: 'auto' as const,
  fontSize: 12.5,
  lineHeight: 1.7,
  fontFamily:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  m: 0,
};

function Code({ children }: { children: string }) {
  return (
    <Box component="pre" sx={codeSx}>
      {children}
    </Box>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <Typography variant="subtitle1" fontWeight={700} sx={{ mt: 1 }}>
      {children}
    </Typography>
  );
}

function EndpointTable({ rows }: { rows: Array<[string, string, string]> }) {
  return (
    <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5 }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ whiteSpace: 'nowrap', width: 64 }}>方法</TableCell>
            <TableCell sx={{ whiteSpace: 'nowrap' }}>路径</TableCell>
            <TableCell>说明</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map(([method, path, desc]) => (
            <TableRow key={`${method}-${path}`}>
              <TableCell>
                <Chip
                  size="small"
                  label={method}
                  color={method === 'GET' ? 'default' : method === 'DELETE' ? 'error' : 'primary'}
                  variant="outlined"
                />
              </TableCell>
              <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, whiteSpace: 'nowrap' }}>{path}</TableCell>
              <TableCell sx={{ fontSize: 13 }}>{desc}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

const dnsEndpoints: Array<[string, string, string]> = [
  ['GET', '/domains', '域名列表'],
  ['GET', '/domains/:domain', '域名详情'],
  ['GET', '/domains/:domain/capabilities', '支持的类型 / 最小 TTL'],
  ['GET', '/domains/:domain/lines', '线路列表'],
  ['GET', '/domains/:domain/records', '记录列表（name / type / value）'],
  ['GET', '/domains/:domain/records/:recordId', '记录详情'],
  ['POST', '/domains/:domain/records', '创建记录'],
  ['PATCH', '/domains/:domain/records/:recordId', '局部更新'],
  ['PUT', '/domains/:domain/records/:recordId', '全量更新'],
  ['PATCH', '/domains/:domain/records/:recordId/status', '启用 / 停用'],
  ['DELETE', '/domains/:domain/records/:recordId', '按 ID 删除'],
  ['DELETE', '/domains/:domain/records?name=&type=&value=', '按内容删除'],
  ['POST', '/domains/:domain/records/upsert', '存在则更新，否则创建'],
  ['POST', '/domains/:domain/records/batch', '批量（最多 100 条）'],
];

const edgeOneEndpoints: Array<[string, string, string]> = [
  ['GET', '/edgeone/sites', '站点列表'],
  ['POST', '/edgeone/sites', '创建 NS 站点'],
  ['GET', '/edgeone/sites/:site', '站点详情'],
  ['DELETE', '/edgeone/sites/:site', '删除站点'],
  ['GET', '/edgeone/sites/:site/domains', '加速域名列表'],
  ['POST', '/edgeone/sites/:site/domains', '新增加速域名（自动写 CNAME）'],
  ['POST', '/edgeone/sites/:site/domains/upsert', '不存在则建，存在则改回源'],
  ['PATCH', '/edgeone/sites/:site/domains/:name', '修改回源配置'],
  ['PATCH', '/edgeone/sites/:site/domains/:name/status', '启用 / 停用'],
  ['DELETE', '/edgeone/sites/:site/domains/:name?force=true', '删除（自动先停用）'],
  ['GET/POST', '/edgeone/sites/:site/domains/:name/certificate', '免费证书查询 / 申请'],
  ['POST', '/edgeone/sites/:site/sync', '全量对齐 CNAME 到 DNSPod'],
  ['GET/POST/PUT/DELETE', '/edgeone/sites/:site/records', '仅 NS(full) 站点的解析记录'],
];

const errors: Array<[string, string]> = [
  ['400 INVALID_ARGUMENT', '参数缺失或格式错误'],
  ['400 UNSUPPORTED_RECORD_TYPE', '厂商不支持该记录类型'],
  ['400 PROVIDER_NOT_RECORD_CAPABLE', '凭证不是 DNS 解析类（如 EdgeOne）'],
  ['401 INVALID_API_KEY / KEY_EXPIRED', 'Key 无效、吊销或过期'],
  ['403 DOMAIN_NOT_ALLOWED / IP_NOT_ALLOWED', '超出白名单'],
  ['404 ZONE_NOT_FOUND / RECORD_NOT_FOUND', '域名或记录不存在'],
  ['409 AMBIGUOUS_RECORD / DOMAIN_IN_USE', '需要消歧或状态冲突'],
  ['422 PROVIDER_REJECTED', '厂商拒绝，details.providerCode 含原始错误码'],
  ['429 RATE_LIMITED', '超出 Key 配额，带 Retry-After'],
  ['502 PROVIDER_UNAVAILABLE', '厂商超时或不可达'],
];

export default function ApiDocs() {
  const [tab, setTab] = useState(0);

  return (
    <Box>
      <Stack spacing={0.5} sx={{ mb: 2 }}>
        <Typography variant="h5" fontWeight={600}>
          API 参考
        </Typography>
        <Typography variant="body2" color="text.secondary">
          基础路径 <code>/api/open</code>，API Key 在 设置 → API Key 创建。
        </Typography>
      </Stack>

      <Card sx={{ boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: 'none' }}>
        <Tabs
          value={tab}
          onChange={(_, value) => setTab(value)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            borderBottom: '1px solid',
            borderColor: 'divider',
            px: 1,
            pt: 1,
            '& .MuiTabs-indicator': { display: 'none' },
            '& .MuiTab-root': {
              minHeight: 48,
              mr: 1,
              mb: 1,
              borderRadius: '12px',
              fontWeight: 600,
              textTransform: 'none',
              color: 'text.secondary',
              '&.Mui-selected': {
                bgcolor: (theme) => alpha(theme.palette.primary.main, 0.1),
                color: 'primary.main',
                fontWeight: 700,
              },
            },
          }}
        >
          <Tab label="快速开始" />
          <Tab label="DNS 记录" />
          <Tab label="EdgeOne" />
          <Tab label="错误与限制" />
        </Tabs>

        <CardContent>
          {tab === 0 ? (
            <Stack spacing={2}>
              <SectionTitle>认证</SectionTitle>
              <Typography variant="body2">
                所有请求带 API Key。Key 与账号绑定，拥有该账号的全部 DNS 权限。
              </Typography>
              <Code>{`Authorization: Bearer dns_live_xxxxxxxx_xxxxxxxx
# 也支持
X-API-Key: dns_live_xxxxxxxx_xxxxxxxx`}</Code>

              <SectionTitle>验证连接</SectionTitle>
              <Code>{`curl -s https://your-panel/api/open/me \\
  -H "Authorization: Bearer $DNS_API_KEY"`}</Code>

              <SectionTitle>响应格式</SectionTitle>
              <Code>{`// 成功
{ "ok": true, "data": { }, "requestId": "req_8f2c1a" }

// 失败
{
  "ok": false,
  "error": { "code": "RECORD_NOT_FOUND", "message": "记录不存在", "retriable": false },
  "requestId": "req_8f2c1a"
}`}</Code>

              <SectionTitle>凭证选择</SectionTitle>
              <Typography variant="body2">
                所有 DNS / EdgeOne 接口都可带 <code>?credentialId=</code>。不传时使用 Key 绑定的凭证，
                未绑定则使用账号默认凭证。
              </Typography>

              <Alert severity="info">
                写请求建议带 <code>Idempotency-Key</code>，网络重试不会重复创建记录。
              </Alert>
            </Stack>
          ) : null}

          {tab === 1 ? (
            <Stack spacing={2}>
              <SectionTitle>域名优先寻址</SectionTitle>
              <Typography variant="body2">
                传 <code>example.com</code> 或 <code>www.example.com</code> 均可，服务端自动解析到厂商 zone。
              </Typography>

              <EndpointTable rows={dnsEndpoints} />
              <Typography variant="caption" color="text.secondary">
                以下路径均省略前缀 <code>/api/open</code>。
              </Typography>

              <Divider />
              <SectionTitle>创建记录</SectionTitle>
              <Code>{`curl -X POST https://your-panel/api/open/domains/example.com/records \\
  -H "Authorization: Bearer $DNS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -d '{
    "name": "www",
    "type": "A",
    "value": "1.2.3.4",
    "ttl": 600,
    "remark": "created by ci"
  }'`}</Code>

              <SectionTitle>局部更新</SectionTitle>
              <Code>{`curl -X PATCH https://your-panel/api/open/domains/example.com/records/123456 \\
  -H "Authorization: Bearer $DNS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"value": "5.6.7.8"}'`}</Code>

              <SectionTitle>Upsert</SectionTitle>
              <Code>{`curl -X POST https://your-panel/api/open/domains/example.com/records/upsert \\
  -H "Authorization: Bearer $DNS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "www", "type": "A", "value": "1.2.3.4", "ttl": 600}'
# action: created | updated | unchanged`}</Code>

              <SectionTitle>批量</SectionTitle>
              <Code>{`{
  "operations": [
    { "op": "create", "name": "a", "type": "A", "value": "1.1.1.1" },
    { "op": "update", "id": "123", "value": "2.2.2.2" },
    { "op": "upsert", "name": "@", "type": "TXT", "value": "v=spf1 -all" },
    { "op": "delete", "name": "old", "type": "A", "value": "9.9.9.9" }
  ]
}`}</Code>

              <SectionTitle>扩展字段 options</SectionTitle>
              <Typography variant="body2">
                厂商专有参数放在 <code>options</code>，原样透传。支持字符串 / 数字 / 布尔 / 标量数组，≤ 32 键、≤ 4KB。
              </Typography>
              <Code>{`{
  "name": "www",
  "type": "A",
  "value": "1.2.3.4",
  "options": {
    "proxied": true,
    "comment": "created by ci"
  }
}`}</Code>
              <Typography variant="caption" color="text.secondary">
                已接入 Cloudflare：<code>proxied</code>、<code>comment</code>；其余厂商会忽略不认识的键。
              </Typography>
            </Stack>
          ) : null}

          {tab === 2 ? (
            <Stack spacing={2}>
              <SectionTitle>说明</SectionTitle>
              <Typography variant="body2">
                EdgeOne 一个站点对应一个域名，二级对象是「加速域名」而不是 DNS 记录。
                写操作会在响应里返回 <code>dnspodSync</code>。
              </Typography>

              <EndpointTable rows={edgeOneEndpoints} />

              <Divider />
              <SectionTitle>新增加速域名</SectionTitle>
              <Code>{`curl -X POST https://your-panel/api/open/edgeone/sites/example.com/domains \\
  -H "Authorization: Bearer $EDGEONE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "www",
    "origin": "1.2.3.4",
    "originProtocol": "HTTPS",
    "httpsOriginPort": 443,
    "hostHeaderMode": "origin",
    "applyFreeCert": true
  }'`}</Code>

              <SectionTitle>注意</SectionTitle>
              <Stack component="ul" spacing={0.5} sx={{ pl: 2.5, m: 0 }}>
                <Typography component="li" variant="body2">
                  创建不幂等，重复创建返回 <code>409 DOMAIN_ALREADY_EXISTS</code>；自动化请用 <code>domains/upsert</code>。
                </Typography>
                <Typography component="li" variant="body2">
                  删除前需停用；<code>force=true</code> 会自动停用并轮询最多 60 秒。
                </Typography>
                <Typography component="li" variant="body2">
                  <code>dnsPodAccess</code> 站点的解析记录在 DNSPod，EdgeOne 记录接口返回 400。
                </Typography>
                <Typography component="li" variant="body2">
                  CNAME 同步需要同 SecretId 的 DNSPod 凭证托管该域名，找不到时 <code>dnspodLink.available=false</code>。
                </Typography>
              </Stack>
            </Stack>
          ) : null}

          {tab === 3 ? (
            <Stack spacing={2}>
              <SectionTitle>错误码</SectionTitle>
              <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>HTTP / code</TableCell>
                      <TableCell>说明</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {errors.map(([code, desc]) => (
                      <TableRow key={code}>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, whiteSpace: 'nowrap' }}>{code}</TableCell>
                        <TableCell sx={{ fontSize: 13 }}>{desc}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>

              <SectionTitle>限流</SectionTitle>
              <Typography variant="body2">
                按 Key 每分钟计数，默认 60 次，可在创建时调整。响应头包含
                <code> X-RateLimit-Limit</code> 与 <code>X-RateLimit-Remaining</code>；超限返回 429 + <code>Retry-After</code>。
              </Typography>

              <SectionTitle>幂等</SectionTitle>
              <Typography variant="body2">
                锁跟随业务处理：请求占位后，成功或失败都会<strong>立即释放</strong>；
                只有进程崩溃才会残留，由 <code>IDEMPOTENCY_LOCK_SECONDS</code>（默认 120 秒）租约自动接管。
                处理中重复请求返回 409。
              </Typography>
              <Typography variant="body2">
                成功后保留结果用于回放：显式 <code>Idempotency-Key</code> 默认 24 小时，
                自动 Key（POST）默认 5 分钟，可用 <code>IDEMPOTENCY_RESULT_TTL_SECONDS</code> /
                <code>IDEMPOTENCY_AUTO_RESULT_TTL_SECONDS</code> 调整；设为 0 则处理完立即删除。
              </Typography>
              <Typography variant="body2">
                不带 <code>Idempotency-Key</code> 时，POST 会自动按 method + path + body 生成 SHA-256 键
                （<code>Idempotent-Auto: true</code>）。PATCH / DELETE 不自动缓存。
                如需创建两条完全相同的记录，请传入唯一的 <code>Idempotency-Key</code>。
              </Typography>
            </Stack>
          ) : null}
        </CardContent>
      </Card>
    </Box>
  );
}
