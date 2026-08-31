# M14：视频资产管理增强 — 实施方案

> 依赖：M9 视频资源管理面板（VideoLibraryView）。路线图定位：梯队 B · 中期。

## 目标

M9 面板目前只有「筛选 + 单条/批量重试/取消/删除」，删除为硬删除（记录 + 文件一并销毁），标签/收藏/服务端搜索缺失，成品（mp4）也没有便捷的批量导出手段。本里程碑为视频资产补齐管理能力：

1. **标签/收藏**：任务可标记收藏、打标签，按收藏/标签筛选。
2. **关键词搜索**：搜索范围从 prompt/title 扩展到标签、模型，仍为前端内存过滤（数据量受 list 上限约束，不引入 FTS）。
3. **回收站**：删除改为软删除（保留记录与落盘文件），支持恢复、彻底删除、清空回收站。
4. **批量导出资产**：多选任务/序列，把已落盘的 mp4 复制到用户选择的目录。

## 范围（MVP）

* **做**：上述 4 项能力；标签为任务级 JSON 文本列（无独立标签表/关联表）；序列与任务统一软删。
* **不做**：
  * 不做标签的重命名/合并管理界面（改标签即重新打标）。
  * 回收站不做自动过期清理（仅手动「清空回收站」）。
  * 导出为复制（非移动），不做转码/重命名规则。
  * 不引入 FTS 全文索引。
* **语义约定**：
  * 删除（进回收站）：非终态任务先 cancel 再软删；文件保留至彻底删除。
  * 恢复：清除 deleted_at；恢复序列时一并恢复其全部子镜头。
  * 排队恢复（重启 pump）等所有查询排除已软删记录。
  * 文件名冲突时导出自动追加序号后缀。

## 变更清单

### 1. 共享类型（shared/types/video.ts）

* `VideoTask` 增加 `favorite?: boolean`、`tags?: string[]`、`deletedAt?: number | null`。
* `VideoSequence` 增加 `deletedAt?: number | null`。
* 新增 `VideoExportAssetsResult = { targetDir: string; exported: number; skipped: { id: string; reason: string }[] }`。

### 2. 数据访问

* `db/index.ts` `COLUMN_MIGRATIONS` 新增 4 列（幂等）：
  * `video_tasks.favorite INTEGER NOT NULL DEFAULT 0`
  * `video_tasks.tags TEXT`（JSON 数组文本）
  * `video_tasks.deleted_at INTEGER`（可空）
  * `video_sequences.deleted_at INTEGER`（可空）
* `db/repos/video-task.ts`：
  * `rowToTask` 映射新列；`updateVideoTask` 支持更新 favorite/tags/deleted_at。
  * `listVideoTasks` / `listQueuedVideoTasks` / `listInFlightVideoTasks` / `listVideoTasksBySequence` 增加 `deleted_at IS NULL` 过滤。
  * 新增 `listTrashedVideoTasks(limit)`（deleted_at 非空，倒序）。
  * 新增 `purgeVideoTask(id)`（沿用现硬删除）。
* `db/repos/video-sequence.ts`：`listVideoSequences` 排除已删；新增 `listTrashedVideoSequences`、`purgeVideoSequence`；`updateVideoSequence` 支持 deleted_at。

### 3. 服务（video-engine.ts）

* `deleteTask` 改为软删：非终态先 cancel → 从 queue/active 移除 → 置 deleted_at → reconcile 序列；**不再删文件**。
* `deleteSequence` 改为软删：序列 + 全部子镜头置 deleted_at（非终态先 cancel）；文件保留。
* 新增 `restoreTask(id)`、`restoreSequence(id)`（连带子镜头）、`purgeTask(id)`（硬删记录 + unlink 文件，即原 deleteTask 行为）、`purgeSequence(id)`、`emptyTrash()`（purge 全部已删任务与序列）。
* 新增 `exportAssets({ taskIds, sequenceIds })`：序列展开为其 succeeded 子镜头，逐条复制 `workspace/videos/{provider}-{taskId}.mp4` 到目标目录，冲突名追加 `-2`/`-3` 序号；返回 `VideoExportAssetsResult`（目标目录由 IPC 层 dialog 选择后传入）。

### 4. IPC（src/main/ipc/video.ts）

* 新增通道（沿用 createValidatedHandler 校验模式）：
  * `video:set-favorite`（id, favorite）
  * `video:set-tags`（id, tags: string[]）
  * `video:restore`（type: 'task' | 'sequence', id）
  * `video:purge`（type, id）
  * `video:empty-trash`
  * `video:export-assets`（taskIds, sequenceIds → showOpenDialog 选目录 → 引擎导出 → 返回 VideoExportAssetsResult；取消选择返回 cancelled 标记）
* `video:delete-task` / `video:delete-sequence` 语义变为进回收站，前端文案同步改为「移入回收站」。

### 5. Preload + 渲染层类型

* `preload/index.ts` video 命名空间新增：setFavorite / setTags / restore / purge / emptyTrash / exportAssets。
* `types/electron-api.ts` `VideoAPI` 同步扩展，新增 `VideoExportAssetsResult` 类型。

### 6. Store（stores/video.ts）

* State：`trashTasks / trashSequences / trashLoading`。
* Actions：`setFavorite`、`setTags`、`fetchTrash`、`restore`、`purge`、`emptyTrash`、`exportAssets`（复用 reportBatch 风格的结果提示）；删除类动作完成后同时刷新主列表与回收站。

### 7. UI（VideoLibraryView + VideoTaskCard）

* VideoTaskCard：收藏星标按钮、标签展示。
* VideoLibraryView：
  * 顶部视图切换：「资产库 / 回收站」分段控件。
  * 资产库工具条：收藏筛选开关、标签筛选 chips（聚合当前列表去重）、关键词搜索扩展匹配 tags/model。
  * 单条操作：打标 popover、收藏切换、移入回收站（文案替换删除）。
  * 批量操作条：新增「导出资产」「移入回收站」（替换原删除）。
  * 回收站视图：任务/序列列表 + 恢复 / 彻底删除单条操作，「清空回收站」按钮（NPopconfirm 确认）。

### 8. 测试与验证

* 新增 `db/repos/video-task.test.ts`：软删过滤、trash/restore/purge、favorite/tags 更新、迁移后新列存在。
* `video-engine.test.ts` 增补：deleteTask 软删保留文件、restore、purge（文件被删）、emptyTrash、序列软删连带子镜头、exportAssets 复制与冲突改名。
* `ipc/video.test.ts` 增补新通道注册与参数校验。
* `stores/video.test.ts` 增补新 actions。
* 门槛：`typecheck / lint / test / build` 全绿。

## 验收标准

1. 任务可收藏/打标签，收藏与标签筛选生效，重启后持久。
2. 关键词搜索可命中 prompt、序列标题、标签、模型。
3. 删除任务/序列进入回收站，文件保留；恢复后回到资产库且状态/文件完好。
4. 彻底删除/清空回收站后记录与文件均被清除。
5. 多选任务/序列可一键导出 mp4 到所选目录，文件名冲突自动处理。
6. 排队恢复、统计、队列面板等既有功能不受软删影响（已删任务不出现在任何在途/队列查询中）。
7. 主进程、IPC、Preload、Store、UI 类型贯通；typecheck / lint / test / build 全绿。
