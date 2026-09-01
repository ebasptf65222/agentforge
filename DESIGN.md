# Design

> 视觉系统唯一事实源：`src/renderer/src/theme/tokens.ts`（`--af-*` CSS 变量 + naive-ui themeOverrides）。本文件记录规范与用法约定。

## Theme

深色优先（slate 底 `#0f172a` / surface `#1e293b`），浅色为镜像。`html.dark` 切换，变量注入 `:root`。

## Color

| 角色 | 值（dark / light） | 用途 |
| --- | --- | --- |
| Brand | `#818cf8` / `#6366f1` (indigo) | 主操作、选中态、焦点环；≤10% 面积 |
| Success | `#10b981` | 完成态 |
| Warning | `#f59e0b` | 进行中/暂停 |
| Error | `#ef4444` | 失败/危险操作 |
| Text muted | `#8494ad` / `#64748b` | 辅助小字（≥4.5:1） |

语义状态色别名：`--af-state-running`（warning）、`--af-state-success`、`--af-state-error`。状态一律"圆点/细 Tag + 文字"，禁止大面积色块。

## Typography

系统字体栈（`-apple-system, 'Segoe UI', Roboto…`），单一字族。字号阶梯 11/12/14/15/18/22px（`--af-font-*`）。数字用 `font-variant-numeric: tabular-nums`。等宽场景 `ui-monospace, Menlo, Consolas`。

## Layout & Spacing

间距 4–32px 八档（`--af-space-*`）。内容列 `max-width: 860px` 居中；视频封面网格用 `repeat(auto-fill, minmax(240px, 1fr))` 全宽（不受 860px 限制时单独声明）。断点：compact <900px、medium ≤1280px、wide。

## Components

- 圆角：6/8/12px（`--af-radius-sm/-/lg`），卡片 10–12px，封面图 12px。
- 布尔控件一律 `NSwitch`；页签一律 `NTabs`（视图级用 `type="segment"`）；危险操作一律 `NPopconfirm`。
- 加载态：`NSkeleton`（列表/网格用形状占位），仅按钮级用 spinner。
- 图标：`@vicons/material`，14–18px。
- 交互元素 `:focus-visible` → `box-shadow: 0 0 0 2px var(--af-brand-dim)`。

## Video Domain（封面网格范式）

- 封面：`<video preload="metadata" muted>` 渲染首帧，`useIntersectionObserver` 惰性挂载；hover 静音播放、离开复位；`prefers-reduced-motion` 下禁用自动播放。
- 网格卡：封面 `aspect-ratio` 按 `task.aspect` 动态（16:9→16/9）；底部 40% scrim（`--af-scrim` 渐变）叠 prompt(2 行 clamp) + meta；左上状态角标、右上收藏 hover 显影。
- 多镜头序列：始终全宽行卡，展开查看镜头（镜头行缩略图 96×54）。
- 悬浮层级（语义 z 序）：dropdown → sticky → modal-backdrop → modal → toast → tooltip。

## Motion

`--af-dur-fast/base/slow`（120/200/320ms），缓动 `--af-ease-out`。动效只传达状态（hover 显影、展开、进度），无装饰性循环动画。
