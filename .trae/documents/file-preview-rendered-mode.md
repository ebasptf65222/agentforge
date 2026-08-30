# 文件预览增强:渲染视图切换 + preset-lite 常用格式支持

## Summary

为 FilePreviewPanel 增加「预览 / 源码」切换按钮:md/markdown 复用现有 MarkdownRenderer(marked + shiki + mermaid + DOMPurify)渲染,html/htm 用 `<webview>` 加载 agentfile:// URL 真实渲染,svg 用 `<img>` 显示。同时安装 `@file-viewer/preset-lite`,让图片(png/jpg/gif/webp/bmp)、音频、视频这些目前完全无法预览的格式直接走 FileViewer 渲染。可渲染文件默认显示「预览」效果。

## 调研结论:@file-viewer 格式矩阵

| 能力包 | 覆盖格式 | 结论 |
|---|---|---|
| `preset-office`(已装) | PDF/Word/Excel/PPT/OFD/RTF/OpenDocument | 保留 |
| `preset-lite`(新增) | 文本、Markdown、代码、图片、音频、视频 | **补齐图片/音视频预览缺口** |
| `preset-engineering` | CAD/3D/XMind/Geo/Typst/Archive | 不需要 |
| `preset-all` | 全部 | 不需要(体积大) |

vite-plugin 会自动发现已安装 preset,组件默认 `autoRenderers: true`。

## Current State

- `getPreviewMode()`([workspace.ts](file:///d:/桌面/ai/agentforge/src/renderer/src/stores/workspace.ts#L44-L61))只返回 `viewer | text | none`;图片返回 none(无法预览),md/html 走 text 只显示源码
- [FilePreviewPanel.vue](file:///d:/桌面/ai/agentforge/src/renderer/src/components/FilePreviewPanel.vue) 两种模式:viewer(FileViewer 组件)/ text(shiki 高亮),无渲染预览能力
- `previewFileUrl`(agentfile:// URL)仅在 viewer 模式下构建([workspace.ts](file:///d:/桌面/ai/agentforge/src/renderer/src/stores/workspace.ts#L268-L269))
- 已有可复用资产:`MarkdownRenderer.vue`(含 mermaid)、`LinkPreviewPanel.vue` 的 webview 用法、`agentfile://` 协议
- [workspace.test.ts](file:///d:/桌面/ai/agentforge/src/renderer/src/stores/workspace.test.ts) 中断言 `b.png → none`,需同步更新

## Proposed Changes

### 1. 安装依赖

```
pnpm add @file-viewer/preset-lite
```

### 2. [electron.vite.config.ts](file:///d:/桌面/ai/agentforge/electron.vite.config.ts#L55-L59)

`fileViewerRenderers({ preset: 'office', ... })` → 移除 `preset` 项(默认 `'auto'` 自动发现 office + lite 两个 preset),保留 `copyAssets: true, chunkStrategy: 'renderer'`。

### 3. [workspace.ts](file:///d:/桌面/ai/agentforge/src/renderer/src/stores/workspace.ts)

- **OFFICE_EXTENSIONS 扩充**(viewer 模式):新增图片 `png jpg jpeg gif webp bmp ico ico?`、音频 `mp3 wav ogg flac m4a aac`、视频 `mp4 webm mov mkv avi`。重命名为 `VIEWER_EXTENSIONS`(或保留原名加注释)
- **新增 `RENDERABLE_EXTENSIONS = new Set(['md', 'markdown', 'html', 'htm', 'svg'])`** 与导出函数 `isRenderablePreview(filename: string): boolean`
- **openPreview()**:当 `mode === 'text'` 且 `isRenderablePreview(node.name)` 时,同样构建 `previewFileUrl`(html webview / svg img 需要),并新增 `previewRenderable = ref(false)` 状态,打开时置位
- svg 保留在 TEXT_EXTENSIONS(源码用 shiki),渲染视图用 `<img :src="previewFileUrl">`,不走 FileViewer

### 4. [FilePreviewPanel.vue](file:///d:/桌面/ai/agentforge/src/renderer/src/components/FilePreviewPanel.vue) — 核心改动

**script 部分:**
- 新增本地状态 `viewMode = ref<'rendered' | 'source'>('rendered')`,watch `previewPath` 变化时重置为 `'rendered'`
- `canRender = computed(() => workspaceStore.previewRenderable)`(md/htm/html/svg)
- `effectiveView = computed(() => (canRender && viewMode === 'rendered') ? 'rendered' : 'source')`
- 复用 `MarkdownRenderer`(md 渲染)、webview ref(html 渲染,参考 LinkPreviewPanel 绑定事件处理失败重载)、`<img>`(svg 渲染)

**template header 部分:**
- actions 区域新增按钮组「预览 | 源码」(两个按钮,当前项高亮),仅 `canRender` 且非 viewer 模式时显示;复制按钮保留在源码视图下

**template body 部分(优先级:viewer > rendered > source):**
1. viewer 模式(office/图片/音视频):现状不变(FileViewer)
2. rendered 模式:
   - `md/markdown` → `<MarkdownRenderer :content="previewContent" />`
   - `html/htm` → `<webview :src="previewFileUrl" allowpopups="false">` + 加载失败重试 UI
   - `svg` → `<img :src="previewFileUrl">`,居中、棋盘格透明背景
3. source 模式:现状 shiki 高亮

**样式:** 新增按钮组、rendered 容器样式(md 预览容器限宽居中、webview 铺满、svg 棋盘格背景),遵循现有 `--af-*` CSS 变量。

### 5. [workspace.test.ts](file:///d:/桌面/ai/agentforge/src/renderer/src/stores/workspace.test.ts)

- `b.png → none` 改为 `viewer`;新增 gif/webp/mp3/mp4/webm → `viewer`
- 新增 `isRenderablePreview` 测试:`README.md/a.html/photo.svg → true`,`app.ts → false`

## Assumptions & Decisions

- **md 渲染复用 MarkdownRenderer 而非 FileViewer 的 markdown renderer**:样式与聊天一致,且支持 mermaid( preset-lite 的 markdown 渲染无 mermaid)
- **html 用 webview 而非 iframe**:主窗口 CSP(`script-src 'self' agentfile:`)会继承到 srcdoc/blob iframe 并拦截内联脚本;webview 是独立 guest 页面不受影响,且项目已有 webview 先例。webview 默认沙箱化、`allowpopups="false"`
- **图片/音视频走 preset-lite 而非手写 img/video 标签**:FileViewer 自带缩放/工具栏/主题,且后续扩展格式零成本
- md/html 默认显示「预览」;图片/音视频无源码概念,始终 viewer
- 不引入 preset-engineering / preset-all

## Verification

1. `pnpm install` 后 `pnpm dev`
2. 预览 README.md:默认渲染效果(含 mermaid 图表则验证渲染),点「源码」切回高亮
3. 预览一个含脚本/样式的 .html:默认 webview 渲染可交互;「源码」显示高亮代码
4. 预览 .svg:默认图像显示;「源码」显示 xml
5. 预览 .png / .gif:FileViewer 显示图片(此前无法预览)
6. 预览 .mp3 / .mp4:FileViewer 音视频播放
7. 回归:PDF/docx/xlsx/pptx 预览正常;txt/py/ts 等纯文本行为不变
8. `pnpm test`(workspace.test.ts)、`pnpm typecheck`、`pnpm lint` 通过
