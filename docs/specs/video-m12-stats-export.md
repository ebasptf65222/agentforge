# M12：生成历史统计导出 — 实施方案

## 目标

基于 `video_tasks` 全量历史，按时间 / 厂商 / 模型 / 状态聚合生成统计（成功数、失败率、平均耗时、用量），并在视频库提供统计面板与一键导出 CSV 报表，用于数据复盘与成本/质量度量。

## 范围（MVP，不新增数据库表）

* 统计数据全部从既有 `video_tasks` 表实时聚合（行数量级小，JS 聚合即可，不引入 SQL 聚合与索引变更）。
* 序列父记录（video_sequences）不参与统计，仅统计镜头/单视频任务行，避免重复计数。
* 导出为标准 CSV（UTF-8 带 BOM，兼容 Excel 直接打开），分段呈现 summary / by_day / by_provider / by_model。

## 指标口径

| 指标 | 口径 |
| --- | --- |
| total | 时间范围内全部任务行数 |
| succeeded / failed / cancelled | 各终态任务行数 |
| active | queued + submitted + running（未到终态） |
| successRate | succeeded ÷（succeeded+failed+cancelled）× 100，无终态时为 0 |
| failureRate | failed ÷（succeeded+failed+cancelled）× 100，无终态时为 0 |
| avgElapsedSeconds | 成功任务 createdAt→updatedAt 的平均耗时（秒），无成功任务时为 null |
| videoSeconds | 成功任务 duration（秒）之和，即成功产出的视频总时长用量 |

## 变更清单

### 1. 共享类型（shared/types/video.ts）

* `VideoStatsBucket`：`{ key, total, succeeded, failed, cancelled, active, successRate, failureRate, avgElapsedSeconds, videoSeconds }`。
* `VideoStatsOverview`：汇总指标 + `since` 时间戳 + `byDay / byProvider / byModel` 三个分桶数组。
* `VideoStatsExportResult`：`{ canceled: true } | { canceled: false; path: string }`。

### 2. 数据访问（db/repos/video-task.ts）

* 新增 `listVideoTasksSince(sinceTs: number): VideoTask[]`：查询 `created_at >= sinceTs` 的全部任务行（不分页）。

### 3. 统计聚合服务（新文件 src/main/services/video-stats.ts）

* `aggregateVideoStats(sinceTs: number): VideoStatsOverview`：读取任务行后按 天（本地时区 YYYY-MM-DD）/ provider / model 分桶聚合，汇总指标同上。
* `buildStatsCsv(overview: VideoStatsOverview): string`：生成带 `section` 列的 CSV（summary / by_day / by_provider / by_model），字段：`section,key,total,succeeded,failed,cancelled,active,success_rate,failure_rate,avg_elapsed_s,video_seconds`。
* 新增 `video-stats.test.ts`：真实临时 DB 覆盖聚合口径（状态计数、成功率、平均耗时、用量、分桶归属、空数据）与 CSV 结构。

### 4. IPC（src/main/ipc/video.ts）

* `video:stats`：参数 `{ days?: number }`（缺省 30，钳制 1–365），返回 `VideoStatsOverview`。
* `video:export-stats`：参数 `{ days?: number }`；主进程弹 `dialog.showSaveDialog`（默认文件名 `video-stats-YYYYMMDD.csv`），取消则返回 `{ canceled: true }`，否则写入 CSV（UTF-8 BOM）并返回 `{ canceled: false, path }`。

### 5. Preload + 渲染层类型

* `src/preload/index.ts`：`video.stats(days?)`、`video.exportStats(days?)`。
* `src/renderer/src/types/electron-api.ts`：补 `VideoStatsBucket / VideoStatsOverview / VideoStatsExportResult` 与 API 方法声明。

### 6. Store（stores/video.ts）

* `fetchStats(days?)`：拉取统计并缓存到 state（`stats` / `statsLoading` / `statsDays`）。
* `exportStatsCsv(days?)`：调用导出 IPC，成功 toast 展示落盘路径，取消不打扰。

### 7. UI（VideoLibraryView）

* 头部新增「统计」按钮 → 统计模态：
  * 时间范围选择（近 7 / 30 / 90 天）。
  * 汇总指标卡（总数 / 成功 / 失败 / 取消 / 进行中 / 成功率 / 失败率 / 平均耗时 / 用量）。
  * 按厂商、按模型、按天三张明细表。
  * 「导出 CSV」按钮走保存对话框。

### 8. 测试与验证

* IPC 测试（video.test.ts）：新通道注册、days 校验、导出委托。
* Store 测试（video.test.ts）：fetchStats / exportStatsCsv 行为。
* 结束门槛：`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build` 全绿。

## 验收标准

1. 统计面板正确展示时间范围内的聚合指标与三张分桶明细，口径与本文档一致。
2. 导出 CSV 弹出系统保存对话框，落盘文件可被 Excel 直接打开且分段清晰。
3. 空数据（无任务）时统计全为 0，平均耗时显示为空，导出不报错。
4. 主进程、IPC、Preload、Store、UI 类型贯通，无隐式 any。
5. 全部单测通过、typecheck/lint/build 通过。
