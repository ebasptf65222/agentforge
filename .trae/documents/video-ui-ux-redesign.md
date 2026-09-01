# 视频界面 UI/UX 结构级重构计划（专业视频工具风）

> 范围：全部视频界面（视频库、任务卡/序列卡、工作台 4 面板、全部模态、设置页 VideoConfig、聊天内视频卡）
> 方向：结构级重构 + 专业视频工具风（即梦/Runway：大封面网格、悬浮播放、深色沉浸、克制的状态色）
> 约束：仅改渲染层（src/renderer），**不改 store 逻辑、IPC、主进程、共享类型**（`video.test.ts` 745 行测试与 1795 passed 基线不动）；沿用现有 indigo 品牌色与 `--af-*` token 体系。

## 1. 现状问题（基于源码核查）

| # | 问题 | 位置 |
|---|------|------|
| P1 | 视频库是 860px 单列文本列表，无封面网格视图；浏览效率低，与"视频资产"内容形态错配 | [VideoLibraryView.vue](file:///d:/桌面/ai/agentforge/src/renderer/src/views/VideoLibraryView.vue) `.video-library` |
| P2 | 成功卡内嵌完整 `<video preload=metadata>`，长列表性能差；无海报帧、无悬浮播放 | [VideoTaskCard.vue](file:///d:/桌面/ai/agentforge/src/renderer/src/components/video/VideoTaskCard.vue) |
| P3 | 头部堆 8+ 按钮（3 视图切换 + 统计/批量造片/参考图/选择/刷新），round/circle 混杂 | VideoLibraryView header |
| P4 | 视图切换（资产库/回收站/工作台）与工作台 4 子页签都用 round 按钮模拟 tabs | VideoLibraryView |
| P5 | 统计模态自绘 8 列 grid 表格，`:nth-child(even)` 斑马纹把表头算错位；9 张等权指标卡无层级 | VideoLibraryView stats modal |
| P6 | `--af-text-muted`(#64748b) 用于 11px 小字，暗色底上对比度 <4.5:1 | tokens.ts + 各组件 |
| P7 | 布尔控件三种写法（文字按钮 / NSelect 伪装 / NSwitch）；危险操作防护标准不一（删模板有 Popconfirm、清路由日志无） | 4 个工作台面板 + VideoConfig |
| P8 | 统计/计费/CSV 全部两态（NSpin/NEmpty），无骨架屏；计费日期桶逐行平铺、空桶布局跳动 | VideoBillingPanel 等 |
| P9 | 列表操作按钮长驻（重试/标签/删除每卡常显），视觉噪音；tiny 图标按钮仅靠 tooltip 可发现性差 | VideoLibraryView `__actions`、SchedulePanel |
| P10 | VideoConfig：保存无 dirty 反馈、API Key 已存状态不可见、清日志无确认 | [VideoConfig.vue](file:///d:/桌面/ai/agentforge/src/renderer/src/components/Settings/VideoConfig.vue) |

## 2. 实施步骤

### Step 0 · 设计上下文（impeccable 前置）
- 新建 `PRODUCT.md`（register: product；用户/目的/品牌个性/反参照/设计原则，简洁一页）。
- 新建 `DESIGN.md`：记录现有 token 体系（indigo、slate 中性色、8px 间距、6/8/12px 圆角）+ 本次新增的视频域规范（封面网格、状态色、悬浮层级）。

### Step 1 · Token 扩展与对比度修正 — [tokens.ts](file:///d:/桌面/ai/agentforge/src/renderer/src/theme/tokens.ts)
- 提亮 `--af-text-muted`：dark `#64748b` → `#8494ad`（on #1e293b ≥4.5:1）；light 同步校准。
- 新增视频域变量（两套主题同名）：`--af-video-cover-radius: 12px`、`--af-video-card-hover-shadow`、`--af-scrim`（封面底部渐变遮罩色）、`--af-state-running/success/error/warning` 语义别名。
- `naive themeOverrides` 补 `Tabs`、`Dropdown`、`Segment` 关键色，保证新控件与主题一致。

### Step 2 · VideoLibraryView 结构级重构（最大工作量）
**2.1 导航 tabs 化**
- 视图切换（资产库/回收站/工作台）→ `NTabs type="segment"`（配合统计/工具图标按钮）。
- 工作台 4 子页签（定时批量/后处理/模板/计费）→ `NTabs`，替换 4 个 round 按钮。

**2.2 工具栏收敛**
- Header 右侧只留：`新建 ▾`（NDropdown：参考图生成 / CSV 批量造片）、统计（icon）、多选（icon toggle）、刷新（icon）。
- 统一 `quaternary circle` icon 按钮规格，去掉 tooltip 里的 "(M11)(M16)" 里程碑编号文案。

**2.3 封面网格视图（核心新能力，Runway 风）**
- 新增视图切换（网格/列表，local ref，默认网格），仅作用于"单视频"分组；**多镜头序列始终全宽行卡**（过程性内容，展开查看镜头）。
- 网格：`repeat(auto-fill, minmax(240px, 1fr))`，卡片 16:9 封面（按 `task.aspect` 动态 `aspect-ratio`）。
- 封面实现：成功任务 `agentfile://` URL 直接喂 `<video preload="metadata" muted>` 渲染首帧；**IntersectionObserver（VueUse `useIntersectionObserver`）惰性挂载**，进入视口才加载；hover 时 `play()` 静音预览、`mouseleave` 暂停复位。
- 网格卡信息架构：封面底 40% 渐变 scrim 上叠 2 行 prompt + meta（模型·时长·比例）；左上状态角标（非成功态显示小圆点+文字）；右上收藏星 hover 显影；点击封面 → 既有 `handleOpenVideo` 预览面板。
- 多选模式：网格卡左上角 checkbox 显影，行为复用现有 selection store。
- 列表视图保留，但优化为现有行卡样式修整版。

**2.4 反馈与状态**
- 加载态：`NSkeleton` 封面占位网格（6 张骨架卡）替代 NSpin 包全列表。
- 队列面板、批量操作条保留，样式统一到新 tabs 层级下。
- 空状态保留现有引导结构，微调文案与图标。

### Step 3 · VideoTaskCard 双形态重构
- 加 `variant` prop：`'grid'`（Step 2 网格封面卡，新组件形态）| `'list'`（现列表卡优化版）| `'chat'`（聊天内紧凑版，仅修样式不动结构）。
- `'list'` 形态：成功态显示 160×90 缩略图（同惰性封面方案）+ 右侧信息列，替代全宽内嵌播放器；点击缩略图走预览面板，行内不再直接嵌 `<video controls>`。
- 操作收敛：常驻按钮（停止/重试/收藏）保留最多 2 个 + `NDropdown`「更多」（标签/导出/删除）；删除统一走 Popconfirm。
- 修 P6：11px muted 文本全部换新 muted 色；错误块、进度条样式统一。

### Step 4 · SequenceCard 优化
- 展开区镜头行：prompt 由单行省略改为 2 行 clamp；成功镜头加 96×54 缩略图（惰性）；衔接徽标、状态、进度排版对齐。
- 卡头信息层级：状态 Tag → 弱化为圆点+文字，突出序列标题与 N/M 进度。

### Step 5 · 工作台 4 面板统一改造
- **SchedulePanel**：启停改 `NSwitch`；批量 prompt 输入加实时行数徽标；卡片操作改「编辑 + 更多(NDropdown)」，关键动作保留文字按钮。
- **PostprocessPanel**：操作类型 `NRadioGroup` → `NTabs type="segment"`；重命名分支就地表单化（与其他 op 一致）；执行记录操作完成后自动刷新一次。
- **TemplateLibrary**：连续性 `NSelect` → `NSwitch`；加关键词搜索框（前端过滤）；「一键生成」改显性文字按钮 + 二次确认；镜头列表高度统一（min-height 替代卡内滚动）。
- **BillingPanel**：三个手写重复块抽为单组件 `BillingBucketTable`（同文件内子组件即可）；空桶渲染占位行防跳动；按日期桶超过 10 行折叠为「展开其余 N 行」。

### Step 6 · 统计模态重构
- 指标卡 9 张等权 → 分两组：顶部 3 张核心（总数/成功率/平均耗时，大号）+ 其余 6 张紧凑次要行。
- 自绘 8 列表格 → `NDataTable`（修复斑马纹错位问题，获得排序/悬浮态）；三张分桶表共用列定义。

### Step 7 · CSV / 参考图模态打磨
- CSV：步骤标签改数字徽标 + 标题层级；预览行加斑马底色；跳过明细可折叠。
- 参考图：三档参考图改横排缩略图选择区（选中显示图片预览缩略图，而非文件名文本）；参数行换 `NFormItem` 布局对齐。

### Step 8 · VideoConfig 设置页修正（小修）
- 清空路由日志加 `NPopconfirm`。
- API Key 输入框旁显示「已保存 ✓ / 未配置」状态徽标（读现有 configured 状态）。
- 保存成功后 toast 反馈（现有 showToast 即可）。

### Step 9 · 全局细节
- 所有新增动效（封面 hover、卡片显影）带 `@media (prefers-reduced-motion: reduce)` 降级为直接切换。
- 交互元素 `:focus-visible` 统一 `box-shadow: 0 0 0 2px var(--af-brand-dim)`（沿用 SequenceCard 既有写法）。
- 聊天内 [VideoMessage.vue](file:///d:/桌面/ai/agentforge/src/renderer/src/components/video/VideoMessage.vue) 缺失占位卡补「重新检查」刷新按钮，样式对齐实线卡。

## 3. 关键决策与假设

- **封面帧方案**：不引入 ffmpeg 抽帧/主进程改动，直接用本地文件 URL 的 `<video preload="metadata">` 首帧 + IntersectionObserver 惰性加载（Electron 本地 IO 足够快，符合"不改主进程"约束）。
- **网格只做单视频，序列保持行卡**：序列是过程性聚合内容，全宽展开阅读效率更高；避免网格内嵌展开态的复杂度。
- **不改 store/IPC**：所有筛选、排序、选择逻辑已在 store/视图层完备，本次纯呈现层。
- **不做虚拟滚动/分页**：当前规模（个人工具）收益低、风险高；列为未来候选。
- 默认视图 = 网格；用户偏好存 localStorage（不进 settings 表，避免动主进程）。

## 4. 验证

1. `pnpm typecheck` / `pnpm lint` / `pnpm test`（预期仍 1795 passed）/ `pnpm build` 全绿。
2. 手动走查清单（electron dev）：
   - 网格/列表切换、多选批量操作、回收站恢复、队列暂停/恢复在各视图下正常。
   - 封面惰性加载：长列表滚动无卡顿、hover 静音播放、离开视口后暂停。
   - 深色/浅色主题、compact(<900px)/medium(≤1280px) 断点下网格降为 1–2 列不溢出。
   - 全部模态（CSV/统计/参考图/标签/路由日志）打开-提交-关闭流转正常。
3. 对比度抽查：muted 文本、状态角标、scrim 上白字 ≥4.5:1。
