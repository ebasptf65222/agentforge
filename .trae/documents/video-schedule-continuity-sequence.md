# 定时调度支持连续性序列（长视频）计划

> 目标：补齐"定时调度 + 首尾帧衔接序列"的组合缺口。一次 cron/手动触发跑完一个连续性多镜头序列（镜头 i 尾帧自动作为镜头 i+1 首帧），串成较长的完整视频；"每隔几分钟出一个"由序列内部串行推进天然满足。
> 用户已确认：①工作方式 = 一次触发跑完整序列（复用 M8 衔接机制）；②镜头来源 = 表单内嵌分段 + 绑定序列模板，两种都要。

## 1. 现状分析（已核查源码）

| 事实 | 位置 |
|---|---|
| 调度执行入口只调 `generateRows(validRows, concurrency)`（独立单视频批量） | [video-schedule-service.ts#L130-215](file:///d:/桌面/ai/agentforge/src/main/services/video-schedule-service.ts#L130-L215) |
| `VideoBatchConfig { rows, concurrency }`，整包 JSON 存 `video_schedules.batch_config` 列（扩展字段无需迁移表） | [video.ts#L348-353](file:///d:/桌面/ai/agentforge/src/shared/types/video.ts#L348-L353)、[video-schedule.ts repo](file:///d:/桌面/ai/agentforge/src/main/db/repos/video-schedule.ts) |
| `generateSequence({ shots, continuity: true })` 已完整实现衔接编排：镜头 queued 占位（shotIndex>0 记 isChained）、仅提交锚点镜头即返回，后续镜头由完成回调 `advanceContinuity` 截尾帧推进 | [video-engine.ts#L326-452](file:///d:/桌面/ai/agentforge/src/main/services/video-engine.ts#L326-L452) |
| `generateFromTemplate(id)` 已支持 sequence 模板 + continuity 一键生成 | [video-template.ts#L78-114](file:///d:/桌面/ai/agentforge/src/main/services/video-template.ts#L78-L114) |
| 调度表单仅有"每行一个 prompt"单视频模式；卡片 meta 显示行数/并发 | [VideoSchedulePanel.vue](file:///d:/桌面/ai/agentforge/src/renderer/src/components/video/VideoSchedulePanel.vue) |
| renderer store 已有 `templates` / `fetchTemplates` / `templatesLoading` | [stores/video.ts#L87-89, L872](file:///d:/桌面/ai/agentforge/src/renderer/src/stores/video.ts) |
| 调度服务无既有测试文件（engine/router/stats 有）；`createVideoScheduleRun` / `finishVideoScheduleRun` 记录执行历史 | services 目录清单 |

关键时序事实：连续性序列是**异步推进**的——`generateSequence` 返回时只有锚点镜头已提交，其余镜头后台逐个推进。因此调度执行函数 for-await 多个序列不会长时间阻塞 cron 重排，`executeSchedule` 的 run 记录口径是"已提交"。

## 2. 改动清单

### 2.1 shared/types/video.ts — 类型扩展

- 新增接口：

```ts
/** 调度批量中的序列行：到点触发一个连续性衔接序列（长视频） */
export interface VideoBatchSequenceRow {
  /** 序列标题（缺省取首镜头 prompt 截断） */
  title?: string
  /** 镜头 prompt 列表（表单按空行分段产生），至少 2 段 */
  shots: string[]
  /** 每镜时长（秒），缺省 5 */
  duration?: number
  /** 分辨率，缺省 720P */
  resolution?: VideoResolution
  /** 画面比例，缺省 16:9 */
  aspect?: VideoAspect
}
```

- `VideoBatchConfig` 增加两个可选字段（与 `rows` 至少一者非空）：
  - `sequences?: VideoBatchSequenceRow[]`
  - `templateIds?: string[]` — 绑定的分镜模板 id（到点逐个 `generateFromTemplate`）

### 2.2 main/services/video-schedule-service.ts — 执行与校验

**normalizeCreateParams（L344-380）放宽校验：**
- 原"`rows` 为空即报错"改为：`rows` / `sequences` / `templateIds` **至少一者非空**，否则 `VALIDATION_ERROR`
- `sequences` 校验：每行 `shots.length >= 2` 且每段 prompt trim 非空（与 `generateSequence` 的 ≥2 镜头约束一致）
- 返回的 `batch` 透传 `sequences` / `templateIds`（repo 端 `JSON.stringify(params.batch)` 自动持久化，无需改 repo）

**executeSchedule（L130-215）扩展执行编排：**
1. 现有 `validRows` → `generateRows(validRows, concurrency)` 不变
2. 追加：`for (const row of batch.sequences ?? [])` 逐个（串行）调用
   `getVideoEngine().generateSequence({ title, shots: row.shots.map(p => ({ prompt: p, duration: row.duration })), resolution: row.resolution, aspect: row.aspect, continuity: true })`
3. 追加：`for (const id of batch.templateIds ?? [])` 逐个调用 `generateFromTemplate(id)`（import 自 `./video-template`）；sequence 模板走衔接序列，shot 模板产出单视频（宽容处理，计入产物）
4. 统计口径：`taskCount = generateRows 成功数 + Σ 序列镜头数（shots.length，generateSequence 返回 tasks.length）+ Σ 模板产物数`；`failedCount` = 抛错的行数（序列/模板调用抛 AppError 时计 1 个失败并继续下一行，最后按 failedCount>0 定 run status='error'）
5. summary 文案：`提交 N 个任务、M 个序列（共 K 镜头）、T 个模板产物`（各段为 0 时省略）；空 batch 报错分支同步更新为"无任何任务来源"

### 2.3 renderer VideoSchedulePanel.vue — 表单与展示

**表单（新建/编辑模态）：**
- `form` 增加：`batchKind: 'tasks' | 'sequence'`（NRadioGroup 两项：单视频批量 / 连续性序列）、序列模式下来源 `sourceKind: 'text' | 'template'`（NRadioGroup：粘贴分段 / 绑定模板）
- 序列字段：`seqTitle`、`seqShotsText`（textarea，**空行分段**）、`seqDuration`（NInputNumber 默认 5，min 1 max 引擎上限沿用）、`seqResolution`（480P/720P/1080P，默认 720P）、`seqAspect`（16:9 等五项，默认 16:9）、`selectedTemplateIds: string[]`
- 镜头分段解析：`seqShotsText.split(/\n\s*\n/)` map trim filter 非空；label 徽标实时显示镜头数（沿用现有 promptRowCount 徽标样式），<2 时提示"至少 2 个镜头"
- 模板选择：NSelect multiple，options = `videoStore.templates.filter(t => t.type === 'sequence')`（label 用模板名 + 镜头数）；`onMounted` 里补 `void videoStore.fetchTemplates()`（现有 onMounted 已 fetchSchedules）
- `saveSchedule`：batchKind='tasks' 走现有 `rows` 组装；'sequence' + text 来源组装 `{ sequences: [{ title, shots, duration, resolution, aspect }] }`；'sequence' + template 来源组装 `{ templateIds: selectedTemplateIds }`；校验失败 toast
- `openEdit` 回填：`batch.sequences?.length` → sequence/text 模式回填字段；`batch.templateIds?.length` → sequence/template 模式；两者皆空 → tasks 模式（旧数据兼容）
- `resetForm` 同步重置新增字段

**卡片列表 meta：**
- batchKind 判定：有 `sequences` 显示 `NTag`"连续性序列 · K 镜头"；有 `templateIds` 显示"模板 × T"；否则现有"N 行任务"

### 2.4 测试 — 新增 src/main/services/video-schedule-service.test.ts

- `normalizeCreateParams`（经 `createScheduleTask` 间接测）：rows/sequences/templateIds 全空报错；sequence 行 shots<2 报错；合法组合通过
- `executeSchedule` 序列分支：`vi.mock('./video-engine')` 单例，断言 `generateSequence` 以 `continuity: true` + 正确 shots 调用；summary/lastRunCount 口径正确；序列抛错时 run status='error' 且继续执行后续行
- 数据库依赖沿用 repo 层既有测试的内存库模式（参照 `video-sequence.test.ts` 的做法）

## 3. 假设与决策

- **一次触发 = 一个完整序列**（用户确认）；一个调度只配一个内嵌序列或若干模板，多序列需求建多个调度。不做 rows+sequences 混配表单，降低复杂度。
- **异步推进不阻塞**：`generateSequence` 提交锚点即返回，调度 run 记录"已提交 N 镜头"；镜头级成败由视频库序列卡实时呈现（事件推送已有）。
- **旧数据兼容**：`batch.sequences/templateIds` 均为 undefined 时行为与现状完全一致。
- **并发上限仅作用于单视频批量**；连续性序列天然串行，不适用并发参数。
- **不动**：store 逻辑（create/update 参数类型自动随 shared 类型扩展）、IPC、数据库表结构、`generateSequence`/`generateFromTemplate` 本体。

## 4. 验证

1. `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build` 全绿。
2. 手动走查（electron dev）：
   - 新建调度 → 连续性序列 → 粘贴一大段话（空行分 3+ 段）→ 立即执行 → 视频库出现连续性序列，SequenceCard 镜头带"⇣ 衔接"徽标、逐个推进（每镜约几分钟）。
   - cron 预设"每分钟（测试）"验证定时触发序列。
   - 绑定 sequence 模板的调度 → 立即执行 → 按模板生成衔接序列。
   - 旧的单视频批量调度编辑回填与执行不回归；执行历史 summary 文案正确。
