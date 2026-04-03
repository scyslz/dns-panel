# DNS Panel — UI/UX 设计标准文档

## 1. 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | React 18 + TypeScript |
| 构建 | Vite 6 |
| UI 库 | Material-UI (MUI) v6 |
| 样式方案 | Emotion CSS-in-JS（通过 MUI `sx` prop） |
| 状态管理 | React Query v5 + React Context |
| 表单 | React Hook Form v7 |
| 路由 | React Router v6 |
| 日期 | Day.js + `@mui/x-date-pickers` |
| 国际化 | MUI `zhCN` locale |

---

## 2. 色彩体系

### 2.1 主色板

| 语义 | 变量名 | 色值 | 用途 |
|------|--------|------|------|
| Primary | `#0F172A` (Slate 900) | 深蓝灰 | 侧边栏背景、主强调、渐变按钮起始色 |
| Primary Light | `#334155` | — | 渐变按钮终止色、用户头像背景 |
| Secondary | `#3B82F6` (Blue 500) | 亮蓝 | 高亮操作、选中态、侧边栏选中项 |
| Success | `#10B981` | 翡翠绿 | 已启用/成功状态 |
| Warning | `#F59E0B` | 琥珀色 | 待验证/警告状态 |
| Error | `#EF4444` | 红色 | 错误/删除操作 |

### 2.2 中性色

| 语义 | 色值 | 用途 |
|------|------|------|
| 背景 | `#F1F5F9` (Slate 100) | 页面背景、表格数据行分隔 |
| 纸面 | `#FFFFFF` | 卡片/对话框/内容区域背景 |
| 文本主色 | `#1E293B` (Slate 800) | 正文标题 |
| 文本次色 | `#64748B` (Slate 500) | 辅助文字、表头文字 |
| 表头背景 | `#F8FAFC` | 表格 `<thead>` 背景 |
| 边框/分隔 | `#E2E8F0` / `#F1F5F9` | 表头边框 / 行间分隔 |

### 2.3 状态色彩映射

通过 `alpha()` 函数生成 10% 透明度底色 + 对应暗色文字：

```
bgcolor: alpha(palette[color].main, 0.1)
color:   palette[color].dark
```

适用于：状态 Chip、选中 Tab 背景、侧边栏选中项。

### 2.4 供应商品牌色

每个 DNS 供应商都有专属品牌色（如 Cloudflare `#f38020`、阿里云 `#ff6a00`），用于：
- 侧边栏选中项的 `alpha(color, 0.12)` 背景 + `alpha(color, 0.3)` 边框
- 供应商图标容器的 `alpha(color, 0.15)` 背景
- 账户 Chip 的 `alpha(color, 0.08)` 背景

---

## 3. 排版规范

### 3.1 字体

```
font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif
```

### 3.2 字重层级

| 层级 | 字重 | 场景 |
|------|------|------|
| h1-h2 | 700 (Bold) | 大标题 |
| h3-h6 | 600 (Semi-Bold) | 段落标题、卡片标题 |
| subtitle1 | 600 | Section 标题 |
| body1 域名 | 600 | 表格中域名 |
| Tab 选中 | 700 | Tab 选中态 |
| Tab 未选中 | 600 | Tab 默认态 |
| 按钮 | 500 (Medium) | 所有按钮 |
| Chip | 500-600 | 状态标签 |
| body2 | 400 (Regular) | 常规正文 |
| caption | 400 | 时间戳、辅助信息 |

### 3.3 按钮文字

- `textTransform: 'none'` — 取消 MUI 默认大写
- 使用中文标签，简洁直达（如"添加域名"、"同步列表"、"保存"、"取消"）

---

## 4. 圆角体系

| 组件 | 圆角 |
|------|------|
| 全局默认 (`shape.borderRadius`) | `12px` |
| Paper (`MuiPaper.rounded`) | `16px` |
| 按钮 | `8px` |
| 输入框 | `8px` |
| Chip | `6px` |
| 侧边栏导航项 | `12px` |
| 供应商图标容器 | `8px` |
| 账户计数徽章 | `10px` |
| Tab | `12px`（主级） / `10px`（次级） |

---

## 5. 阴影体系

采用 Tailwind 风格阴影：

| 级别 | 值 | 用途 |
|------|-----|------|
| shadow-sm | `0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)` | Paper elevation1、AppBar |
| shadow-md | `0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)` | Card 默认、按钮 hover |
| 自定义柔和 | `0 4px 20px rgba(0,0,0,0.05)` | 主内容卡片 |
| Sticky 列 | `-4px 0 8px -4px rgba(0,0,0,0.15)` | 表格固定操作列阴影 |

按钮默认无阴影 (`boxShadow: 'none'`)，hover 时提升为 shadow-md。

---

## 6. 布局结构

### 6.1 整体布局

```
┌──────────────────────────────────────────────┐
│ AppBar (毛玻璃效果 rgba(255,255,255,0.8) + blur(12px)) │
├────────────┬─────────────────────────────────┤
│            │                                 │
│  Sidebar   │       Main Content              │
│  260px     │       maxWidth: 1600px          │
│  固定深色    │       mx: auto                  │
│  #1E293B   │       背景: #F1F5F9              │
│            │                                 │
├────────────┴─────────────────────────────────┤
```

- **桌面端**：固定宽度 Sidebar + 内容区
- **移动端**：Sidebar 变为 Drawer 抽屉，通过 AppBar 汉堡按钮触发

### 6.2 侧边栏结构

```
├── Logo/品牌 (Avatar + 标题)
├── Divider
├── 仪表盘入口 (ListItemButton)
├── 证书中心入口 (ListItemButton)
├── 供应商列表 (可拖拽排序, scrollable)
│   ├── Cloudflare [2]
│   ├── 阿里云 [1]
│   └── ...
└── 用户区域
    ├── 头像 + 用户名
    ├── 操作日志 (IconButton)
    └── 系统设置 (IconButton)
```

### 6.3 面包屑

- 位于 AppBar 内
- `BreadcrumbContext` 动态设置 label
- 带 Home 图标的可点击导航

---

## 7. 组件模式

### 7.1 按钮 (Button)

**三种变体使用规则**：

| 变体 | 用途 | 示例 |
|------|------|------|
| `contained` (主要) | 主操作 / 创建 | "添加域名"、"保存"、"删除" |
| `outlined` (次要) | 辅助操作 | "同步列表"、"取消"、"ESA 站点管理"、"Tunnels" |
| `text` | 内联轻量操作 | 极少使用 |

**主按钮样式**：
- 渐变背景：`linear-gradient(135deg, #0F172A 0%, #334155 100%)`
- 禁用态：`bgcolor: #CBD5E1, color: #94A3B8`

**操作按钮标准搭配**：
- 带 `startIcon` 的文字按钮用于工具栏：`<Button startIcon={<AddIcon />}>添加域名</Button>`
- `IconButton` 用于行内/紧凑操作（编辑、删除、展开、更多菜单）

**对话框底部按钮**：
- 左："取消" (`color="inherit"`)
- 右："保存/确认" (`variant="contained"`)
- 危险操作右侧："删除" (`color="error" variant="contained"`)
- 加载态文字替换："保存中..." / "删除中..."

### 7.2 IconButton

- 大量使用 `size="small"` 的 `IconButton`
- 常用图标：`Edit`, `Delete`, `Refresh`, `Add`, `MoreVert`, `OpenInNew`, `KeyboardArrowDown/Up`
- 表格操作列使用 `fontSize="inherit"` 控制图标大小

### 7.3 表格 (Table)

**表头**：
- 背景：`#F8FAFC`
- 文字：`#64748B`, `fontWeight: 600`
- 边框：`1px solid #E2E8F0`

**表体**：
- 行间分隔：`1px solid #F1F5F9`
- 单元格内边距：`16px 24px`（通用）/ `px: 1.75, py: 1.5`（紧凑型，证书表格）
- 行 hover：`transition: background-color 0.2s`
- 末行无底边框

**固定操作列**：
- `position: sticky; right: 0`
- 溢出时显示左侧投影 `-4px 0 8px -4px rgba(0,0,0,0.15)`

**可展开行**：
- 点击行展开/收起，配合 `Collapse` + `unmountOnExit`
- 展开箭头使用 `KeyboardArrowDown/Up` 图标

**分页**：
- 使用 `TablePagination`，中文标签 "每页显示"
- 每页行数持久化到 `localStorage`

### 7.4 卡片 (Card)

- 阴影：`0 4px 20px rgba(0,0,0,0.05)` 或 shadow-md
- `overflow: 'visible'`（全局主题）或 `'hidden'`（特定场景）
- 主内容卡片通常无边框 (`border: 'none'`)
- 证书中心卡片有 `1px solid divider` 边框

### 7.5 对话框 (Dialog)

**标准结构**：
```jsx
<Dialog maxWidth="xs|sm" fullWidth>
  <DialogTitle>标题</DialogTitle>
  <DialogContent>
    <Stack spacing={2} sx={{ mt: 1 }}>
      {/* 表单内容 */}
    </Stack>
  </DialogContent>
  <DialogActions>
    <Button color="inherit">取消</Button>
    <Button variant="contained">确认</Button>
  </DialogActions>
</Dialog>
```

**证书模块对话框** 使用统一的间距常量：
```ts
DialogTitle:   { px: 3, pt: 2.5, pb: 1 }
DialogContent: { px: 3, pt: '12px !important', pb: 2 }
DialogActions: { px: 3, pb: 2.5, pt: 1 }
```

**危险操作确认**：
- 显示 `<Alert severity="warning">` 警告信息
- 需要用户输入名称确认（如域名/站点名）
- 确认按钮使用 `color="error" variant="contained"`

### 7.6 Chip / 状态标签

**语义状态 Chip**：
- 背景：`alpha(palette[color].main, 0.1)`
- 文字：`palette[color].dark`
- `fontWeight: 600`, `border: 'none'`
- 可选图标：`<ActiveIcon>`, `<PendingIcon>`, `<ErrorIcon>`

**元数据 Chip**：
- `variant="outlined"`
- `height: 22-24px`, `fontSize: '0.72-0.75rem'`
- `borderRadius: 1`（约 4px）

**供应商/账户 Chip**：
- 带供应商图标的 Chip
- `alpha(brandColor, 0.08)` 背景
- `fontSize: '0.75rem'`, `height: 24`

### 7.7 Tab 导航

**主级 Tab**（证书中心顶部）：
- 隐藏默认指示器 `indicator: { display: 'none' }`
- 选中态：`alpha(primary, 0.1)` 背景 + `primary.main` 文字 + `fontWeight: 700`
- `borderRadius: '12px'`
- `minHeight: 48-56px`
- `mr: 1` 间距

**次级 Tab**（子模块内部）：
- 同样隐藏指示器
- `borderRadius: '10px'`
- `minHeight: 40px`
- 底部有 `1px solid divider` 分隔线

### 7.8 搜索框

- `width: { xs: '100%', sm: 300 }`
- `size="small"` + `variant="outlined"` (主题默认)
- `startAdornment`: `<SearchIcon color="action" />`
- 白色背景 `bgcolor: 'background.paper'`

### 7.9 空状态

```jsx
<Box sx={{ border: '1px dashed divider', borderRadius: 2, px: 2.5, py: 3, bgcolor: 'background.default' }}>
  <Typography variant="body2" fontWeight={600}>标题</Typography>
  <Typography variant="body2" color="text.secondary">描述</Typography>
  {action}
</Box>
```

或居中图标式：
```jsx
<Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 8, color: 'text.secondary' }}>
  <DnsIcon sx={{ fontSize: 48, mb: 2, opacity: 0.3 }} />
  <Typography>提示文字</Typography>
</Box>
```

### 7.10 Alert / 反馈

- `<Alert severity="error|warning|info">` 用于内联反馈
- `borderRadius: 2`（约 8px）
- 可带 `onClose` 关闭按钮
- `<CircularProgress>` 居中显示用于加载态

### 7.11 Settings Section

可复用的设置区块封装：
```jsx
<SettingsSection title="标题" description="描述" action={<Button>操作</Button>}>
  {children}
</SettingsSection>
```
- `Stack spacing={2}` 布局
- 标题：`variant="subtitle1" fontWeight={600}`
- 描述：`variant="body2" color="text.secondary"`

---

## 8. 交互模式

### 8.1 过渡动画

- 全局过渡：`transition: 'all 0.2s'` / `0.2s ease`
- 表格行 hover 背景过渡
- 侧边栏项 hover 平移：`transform: translateX(4px)`
- 展开箭头旋转：`transform: rotate(180deg)`, `transition: 'transform 0.2s'`

### 8.2 工具栏布局

```jsx
<Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}
  justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }}>
  <SearchField />
  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
    <Button>辅助操作</Button>
    <Button variant="contained">主操作</Button>
    <Button variant="outlined">同步/刷新</Button>
  </Stack>
</Stack>
```

### 8.3 右键/更多菜单

- `<IconButton><MoreVertIcon /></IconButton>` 触发
- `<Menu>` 弹出，`anchorOrigin: bottom-right`, `transformOrigin: top-right`
- `<MenuItem>` 带前置图标 + 文字标签

### 8.4 确认删除流程

1. 显示 `<Dialog>` + 警告 Alert
2. 用户输入目标名称确认
3. 按钮禁用直到输入匹配
4. 提交时显示"删除中..."

---

## 9. 响应式策略

| 断点 | 宽度 | 行为 |
|------|------|------|
| xs | 0px+ | 单列堆叠, Card 列表替代 Table, Sidebar 变 Drawer |
| sm | 600px+ | 工具栏横排, 搜索框固定 300px |
| md+ | 960px+ | 完整桌面布局 |

- `useMediaQuery(theme.breakpoints.down('sm'))` 判断移动端
- 移动端：卡片列表视图 (`renderMobileView`)
- 桌面端：表格视图 (`renderDesktopView`)
- 对话框表单：`direction={{ xs: 'column', sm: 'row' }}`

---

## 10. 滚动条

全局自定义滚动条（body + 侧边栏列表）：

```css
scrollbar-width: thin;
::-webkit-scrollbar       { width: 8px; height: 8px; }
::-webkit-scrollbar-track  { background: transparent; }
::-webkit-scrollbar-thumb  { background: #cbd5e1; border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
```

侧边栏列表使用更窄的 4px 滚动条 + 半透明白色。

---

## 11. 图标使用规范

全部使用 `@mui/icons-material`，**不使用**自定义 SVG 或第三方图标库。

### 常用图标映射

| 场景 | 图标 |
|------|------|
| 添加 | `Add` |
| 编辑 | `Edit` |
| 删除 | `Delete` |
| 刷新 | `Refresh` |
| 搜索 | `Search` |
| 查看详情 | `VisibilityOutlined` |
| 外部链接 | `OpenInNew` |
| 更多操作 | `MoreVert` |
| 展开/收起 | `KeyboardArrowDown` / `KeyboardArrowUp` |
| 保存 | `Save` |
| 下载 | `Download` |
| 重试 | `Autorenew` |
| 复制 | `ContentCopy` |
| 设置 | `Settings` |
| 日志 | `History` |
| 证书 | `WorkspacePremium` |
| 仪表盘 | `Dashboard` |
| 退出 | `Logout` |
| 安全/2FA | `Security` |
| 域名 | `Dns` / `Language` |
| 标签 | `LocalOfferOutlined` |
| 时间 | `AccessTime` / `Event` |
| 成功 | `CheckCircle` |
| 待处理 | `Pending` |
| 错误 | `ErrorOutline` / `Error` |
| 暂停/恢复 | `PauseCircleOutline` / `PlayCircleOutline` |

---

## 12. 间距与尺寸约定

| 属性 | 常用值 (MUI spacing, 1 = 8px) |
|------|-----|
| 页面内边距 (CardContent) | `p: 3` (24px) / 移动端 `p: 0-2` |
| Stack 间距 | `spacing: 1-2` |
| 搜索框宽度 | `300px` (sm+) |
| 侧边栏宽度 | `260px` |
| 主内容最大宽度 | `1600px` |
| 图标按钮尺寸 | `size="small"` |
| 表单输入 | `size="small"` (主题默认) |
| 紧凑输入 (行内编辑) | `height: 32px`, `fontSize: 0.875rem` |
| Chip 高度 | `22-24px` |
| 供应商图标容器 | `32×32px` |

---

## 13. 数据加载状态

| 状态 | 展示 |
|------|------|
| 加载中 | `<CircularProgress>` 居中，`py: 8` |
| 骨架屏 | 侧边栏使用 `<Skeleton variant="rectangular" height={48}>` |
| 错误 | `<Alert severity="error">` 内联提示 |
| 空数据 | 居中图标 + 文字提示，或虚线边框空状态组件 |
| 刷新中 | 按钮文字变为"刷新中..."，按钮禁用 |
| 提交中 | 按钮文字变为"保存中..."/"删除中..."，按钮禁用 |

---

## 14. 各页面 UI 模式一览

| 页面 | 主体结构 | 交互特点 |
|------|----------|----------|
| Dashboard | Card > Tabs + 工具栏 + Table/CardList | 可展开行、分页、搜索过滤、MoreVert 菜单 |
| DomainDetail | 面包屑 + QuickAddForm + DNSRecordTable | 行内编辑、固定操作列 |
| Certificates | Card > 6-Tab + 各 Section | 搜索 + Table + 对话框CRUD |
| CustomHostnames | 搜索 + Card/List 视图 + 对话框 | 双视图切换 |
| Tunnels | 详情面板 + 公共域名管理 | 嵌套展开 |
| Settings | 多 Card 垂直堆叠 | 表单 + 独立保存按钮 |
| Logs | 过滤器 + Table + 分页 | 筛选 + 分页表格 |
| Login/Register | 居中 Card 表单 | 密码可见性切换、验证 |
