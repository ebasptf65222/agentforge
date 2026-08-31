# M13：批量任务队列面板 — 实施方案

## 目标

为视频生成引入统一的本提交队列：所有任务提交先进队（queued），由引擎按并发上限向厂商出队提交；提供独立队列视图展示排队位置与在途并发，支持整批暂停/恢复与并发上限调节，解决大规模批产（M10/M11）不可控、易触发厂商限流的问题。

## 范围（MVP，不新增数据库表）

* 队列为引擎内存态（FIFO），任务持久化沿用 `video_tasks`（queued 状态已存在）。
* 并发上限语义：同时在途（submitted/running、已提交未终态）的任务数上限，缺省 2。
* 暂停 = 停止出队新任务；已提交厂商的任务继续轮询不受影响。
* M8 连续性衔接序列的镜头推进保持直提交路径（首镜头除外），避免破坏逐镜头尾帧衔接编排。
* 应用重启后，DB 中遗留的 queued 任务（非衔接镜头）自动回队恢复提交。

## 变更清单

### 1. 引擎队列化（src/main/services/video-engine.ts）

* 引擎状态新增：`queue: string[]`（FIFO 任务 id）、`paused: boolean`、`maxConcurrent: number`（缺省 2，1–10）。
* `submitSingle` 创建任务改为 queued 入队（`createVideoTask` 初始状态改为 queued），由 `pump()` 出队提交。
* `pump()`：非暂停且在途数 < maxConcurrent 时依次出队，读取任务与配置后走 `submitPersisted`；任务终态（成功/失败/取消）后再次触发 pump。
* `generate()` / `generateSequence()`（并行模式）/ `retry()` / `generateRows()` 全部经队列出队；`generate()` 语义保持「返回时已提交」（非暂停且无并发占用时）。
* 新增方法：
  * `pauseQueue()` / `resumeQueue()`：暂停/恢复出队，恢复时立即 pump。
  * `setQueueConcurrency(limit)`：调节并发上限（钳制 1–10），调小不影响已在途任务。
  * `getQueueSnapshot()`：返回 `{ paused, maxConcurrent, activeCount, items: [{ task, position }] }`。
* `cancel(id)` 对 queued 任务同时移出队列；`shutdown()` 清空队列与暂停标记。
* 重启恢复：首次入队/查询时把 DB 中 `status='queued' AND is_chained=0` 的任务按 createdAt 升序回队。

### 2. 共享类型（shared/types/video.ts）

* `VideoQueueItem`：`{ task: VideoTask; position: number }`。
* `VideoQueueSnapshot`：`{ paused, maxConcurrent, activeCount, items }`。

### 3. IPC（src/main/ipc/video.ts）

* `video:queue` → 快照。
* `video:queue-pause` / `video:queue-resume` → 快照。
* `video:queue-concurrency`（参数 `{ limit: number }`，1–10 校验）→ 快照。

### 4. Preload + 渲染层类型

* `video.queue() / queuePause() / queueResume() / queueConcurrency(limit)`。
* `electron-api.ts` 补 `VideoQueueItem / VideoQueueSnapshot` 与 API 方法。

### 5. Store（stores/video.ts）

* state：`queue: VideoQueueSnapshot | null`。
* `refreshQueue()` 拉取快照；`pauseQueue()/resumeQueue()/setQueueConcurrency(limit)` 动作后同步快照。
* `handleEvent` 收到任何事件时顺带刷新队列（任务终态会让出并发槽位）。

### 6. UI（VideoLibraryView）

* 顶部「生成队列」面板（折叠条 + 明细）：
  * 状态徽标（进行中 N / 排队 M / 暂停中）。
  * 暂停/恢复按钮、并发上限选择（1–5 显示，内部支持 1–10）。
  * 排队任务列表：位置序号、提示词、取消按钮（复用既有 cancel）。

### 7. 测试与验证

* 引擎测试（video-engine.test.ts）：入队出队、并发上限、暂停/恢复、暂停时任务保持 queued、取消排队任务出队、重启恢复回队。
* IPC 测试：新通道注册、limit 校验、委托快照。
* Store 测试：refreshQueue / pause / resume / concurrency。
* 结束门槛：`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build` 全绿。

## 验收标准

1. 批量/CSV/多镜头提交的任务按并发上限逐步提交，其余保持排队并可在队列面板看到位置。
2. 暂停后不再有新任务提交到厂商，恢复后继续按上限推进。
3. 调节并发上限立即生效（只影响新出队，不中断在途任务）。
4. 重启应用后遗留排队任务自动回队继续提交（衔接镜头除外）。
5. 主进程、IPC、Preload、Store、UI 类型贯通；全部单测、typecheck/lint/build 通过。
