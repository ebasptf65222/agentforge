# M11：CSV 批量造片 — 实施方案

## 目标

支持从本地 CSV 批量导入提示词参数生成视频，复用 M10 的受限并发控制与批量错误汇总，实现内容批量生产。每个 CSV 行视为一个单视频任务，成功提交后与单个 `generate` 任务一致，自动进入视频库并通过事件推送进度。

## 范围（MVP，不新增数据库表）

* 每行 = 一个单视频任务（不引入多镜头序列、不新增 batch job 父实体）。

* 批量任务的生命周期通过既有 `video:event` 推送与视频库聚合呈现。

* 并发上限复用 `BATCH_RETRY_CONCURRENCY`（2）。

## CSV 格式约定

| 列名           | 必填 | 说明                              |
| ------------ | -- | ------------------------------- |
| `prompt`     | ✅  | 提示词，非空                          |
| `duration`   | ❌  | 秒数，缺省用引擎默认 5                    |
| `resolution` | ❌  | `480P/720P/1080P`，缺省 720P       |
| `aspect`     | ❌  | `16:9/9:16/4:3/3:4/1:1`，缺省 16:9 |

* 编码：UTF-8（兼容 BOM，自动剥离）。

* 空行忽略；表头若缺 `prompt` 列则整体报错。

* 非法单元格（缺 prompt / 非法枚举 / 非法数值）记入 `skipped`，不阻断其他行。

## 变更清单

### 1. CSV 解析与校验（主进程）

* 新增 `src/main/services/csv-batch.ts`：

  * `parseCsvRows(content: string): CsvParseResult` 小体量、确定性的 CSV 解析器（兼容引号/逗号/内嵌换行），剥离 BOM。

  * 表头映射到 `CreateVideoTaskParams`，非法行聚合到 `skipped`。

  * 返回 `{ rows, skipped, headerMissingPrompt }`。

* 新增 `csv-batch.test.ts`：编码、引号转义、内嵌换行、非法枚举/数值、缺 prompt 列、空行等用例。

### 2. 引擎批量生成（主进程）

* `VideoEngine.generateRows(rows: CreateVideoTaskParams[], concurrency?): Promise<VideoBatchResult<VideoTask>>`

  * 复用 `runWithConcurrency`；逐行走 `submitSingle` 的提交路径，成功 upsert 并确保轮询定时器启动。

  * 个别行失败不阻断其余行，明细写入 `failed`。

### 3. IPC + Preload + 类型（边界）

* IPC 新增两通道：

  * `video:parse-csv`（参数文件路径或文本内容），返回解析预览。

  * `video:batch-generate`（参数：行数组 + 可选并发），返回批量结果。

* 复用 `validateStringArray` / `createValidatedHandler` 做入参加固。

* `src/preload/index.ts` 与 `src/renderer/src/types/electron-api.ts` 扩展 `parseCsv`、`batchGenerate`。

### 4. Store 动作（渲染进程）

* `stores/video.ts` 新增 `parseCsv`、`batchGenerate(rows)`：成功后逐条 upsert、清空相关选择并 toast 汇总（复用 `reportBatch` 模式）。

### 5. UI（VideoLibraryView）

* 工具栏新增「批量造片」按钮 → 模态：

  * 选择本地 CSV（native 文件对话框）。

  * 解析并预览行表（行数 / 跳过 / 错误统计）。

  * 确认后运行，关闭模态；新任务经事件自动出现在视频库。

### 6. 测试与验证

* 覆盖：CSV 解析、引擎批量生成、IPC 校验、store 动作。

* 结束门槛：`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build` 全绿。

## 验收标准

1. 选择合法 CSV 后能预览行数与校验结果，非法行被跳过且有明确提示。
2. 批量生成以受限并发提交，成功任务进入视频库并实时更新进度。
3. 部分失败时给出「成功 X / 失败 Y」汇总，失败明细可定位。
4. 主进程、IPC、Preload、Store、UI 类型贯通，无隐式 any。
5. 全部单测通过、typecheck/lint/build 通过。

