# M16：参考图风格化生成 — 实施方案

> 依赖：M8 连续性（首尾帧链路）。路线图定位：梯队 B · 中期。
> 定位：把「图生视频」从受限的内部链路（M8 仅连续性自动衔接）扩展到「用户主动上传参考图」，并让参考图信息随任务可见、可重试。

## 目标

当前图生视频仅由 M8 连续性链路自动注入（镜头 i 尾帧 → 镜头 i+1 首帧），工具层虽接受 `images` 但：参考图不持久化、任务卡不展示、重试退化为纯文生。M16 补齐：

1. **参考图语义扩展**：`VideoImageRole` 增加 `style`（风格参考图，不锁定首帧画面，仅锚定风格）与既有 `first_frame / last_frame` 并存。
2. **参考图持久化**：任务记录参考图列表（路径 + 角色），写库、读回、列表展示。
3. **参考图重试**：失败/取消任务重试时带上原参考图，不再退化为纯文生。
4. **参考图生成面板**：视频库新增「参考图生成」模态，用户选 1–2 张本地图（首帧 / 首帧+尾帧 / 风格）提交单视频。
5. **适配器校验**：Seedance 支持全部三种角色；Kling（TokenHub）明确拒绝参考图并给出可读错误（维持现状）。

## 范围（MVP）

* **做**：role 扩展；参考图持久化（video_tasks 新列 + repo 读写）；重试带图；生成面板 UI（选图 + 角色 + 参数）；Seedance adapter 对 style 角色内联上传；工具层 images 透传持久化。
* **不做**：不做厂商侧风格模型/风格融合参数调优；不改 Kling 参考图支持；不做参考图尺寸/比例检查的严格正则校验。

## 变更清单

### 1. 共享类型（shared/types/video.ts）

```typescript
/** 图生视频图片角色：首帧 / 尾帧 / 风格参考 */
export type VideoImageRole = 'first_frame' | 'last_frame' | 'style'

/** 图生视频的参考图片（本地文件，由适配器 base64 内联上传） */
export interface VideoImageRef {
  path: string
  role: VideoImageRole
}

// VideoTask 新增（持久化列 image_refs，JSON 数组）：
imageRefs: VideoImageRef[]
```

### 2. 数据访问（db/index.ts + repos/video-task.ts）

* 新增条件迁移：`ALTER TABLE video_tasks ADD COLUMN image_refs TEXT`（缺省 `[]`）。
* `video-task.ts`：`VideoTaskRow` 增加 `image_refs`；`createVideoTask` 接受 `imageRefs` 并 JSON 序列化；`rowToTask` 反序列化（非法/空回退 `[]`）；新增 `updateVideoTask` 支持 `imageRefs` 字段（用于重试写入）。

### 3. 引擎（video-engine.ts）

* `enqueueSingle`：把 `imageRefs` 一并写入 `createVideoTask`，使参考图随任务持久化（而不仅是内存队列携带）。
* `retry(id)`：读取原任务 `task.imageRefs` 传入新的 `enqueueSingle`，实现带图重试。

### 4. 工具层（tools/video-generate.ts）

* `resolveImageRefs` 沿用；`execute` 返回 metadata 增加 `imageRefs` 的角色列表，便于对话展示「含风格参考图」。

### 5. Preload + IPC + 渲染层类型

* `types/electron-api.ts`：新增 `VideoImageRole` 导出（复用 @shared 类型，无需新通道）。
* （无新 IPC 通道——生成复用现有 `video:generate`。）

### 6. Store + UI

* `VideoTaskCard.vue`：展示参考图角色徽标（首帧 / 尾帧 / 风格参考）。
* `VideoLibraryView.vue`：工具栏新增「参考图生成」按钮，打开模态：选择本地图（多选 ≤2）→ 选择每种图的角色 → 填提示词/时长/分辨率/比例 → 提交单视频。

### 7. 适配器

* `seedance.ts`：`readImageDataUri` 与 content 构造已支持 `role`；补充 `style` 角色文案（`role: 'style'` 仍作为 image_url content 内联，ARK 端兼容）。
* `kling.ts`：维持参考图拒绝逻辑。

### 8. 测试

* `video-task.test.ts`：image_refs 列读写、JSON 序列化/反序列化、缺省空数组。
* `video-engine.test.ts`：generate 持久化 imageRefs；重试带图。
* `seedance.test.ts`：style 角色内联提交。
* store / 工具层补充透传断言。

门槛：`typecheck / lint / test / build` 全绿。

## 验收标准

1. 用户可在视频库「参考图生成」模态选择 1–2 张本地图并指定角色生成视频。
2. 参考图（路径+角色）随任务持久化，任务列表读回完整。
3. 失败/取消任务重试时复用原参考图，不退化文生。
4. Seedance 支持首帧 / 首尾帧 / 风格三种角色；Kling 拒绝并报可读错误。
5. 任务卡展示参考图角色，对话返回含参考图信息。
6. typecheck / lint / test / build 全绿，既有功能不受影响。