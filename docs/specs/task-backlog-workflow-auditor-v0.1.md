# AgentForge Workflow Auditor Task Backlog v0.1

> 基于 `agentforge-workflow-auditor-spec-v0.1.md` 规格文档拆解。
> Phase 1 聚焦基础评估框架，不含历史趋势和循环改进。

### 复杂度图例

| 标记 | 含义 | 预估工时（含单元测试） |
|------|------|----------------------|
| S | Small | 2-3h |
| M | Medium | 4-5h |
| L | Large | 6-8h |
| XL | Extra Large | 8h（上限） |

### 执行路径

```
WA-01 → WA-02 → WA-03 → WA-04 → WA-05 → WA-06 → WA-07 → WA-08
```

---

## Phase 1: 基础评估框架

### WA-01: 审计类型定义

| 字段 | 内容 |
|------|------|
| **任务 ID** | WA-01 |
| **状态** | completed |
| **标题** | 审计类型定义（AuditDimension, EvidenceState, AuditFinding, AuditReport 等） |
| **目标** | 在 `src/shared/types.ts` 中新增审计相关类型，并在 `src/renderer/src/types/electron-api.ts` 中扩展 |
| **依赖任务** | 无 |
| **涉及文件** | `src/shared/types.ts`, `src/renderer/src/types/electron-api.ts` |
| **输入** | Spec v0.1 §4 类型定义 |
| **输出** | 类型可被主进程和渲染进程导入使用 |
| **验收标准** | 1) 定义 AuditDimension, EvidenceState, AuditSeverity 类型; 2) 定义 AuditFinding, DimensionScore, DimensionCheck, AuditReport 接口; 3) 在 electron-api.ts 中新增 AuditAPI 接口; 4) TypeScript 编译无错误 |
| **不要做的事情** | 不实现评估逻辑；不创建 IPC handler |
| **预估复杂度** | S（2h） |

---

### WA-02: 证据收集器

| 字段 | 内容 |
|------|------|
| **任务 ID** | WA-02 |
| **状态** | completed |
| **标题** | 证据收集器（Session / Project / Delivery 三通道） |
| **目标** | 从 TAO Trajectory、ToolRegistry、ApprovalManager 中提取评估证据 |
| **依赖任务** | WA-01 |
| **涉及文件** | `src/main/audit/collectors.ts`, `src/main/audit/collectors.test.ts` |
| **输入** | ExecutionResult.trajectories, ToolRegistry.list(), ApprovalMode |
| **输出** | SessionEvidence, ProjectHarnessEvidence, DeliveryEvidence 结构 |
| **验收标准** | 1) collectSessionEvidence 从 trajectory 提取工具调用、思考链、错误信息; 2) collectProjectHarnessEvidence 从 ToolRegistry 提取工具数量、来源、风险等级分布; 3) collectDeliveryEvidence 从 trajectory 中提取审批记录; 4) 单元测试覆盖空 trajectory、正常 trajectory、全错误 trajectory; 5) 导出纯函数，无副作用 |
| **不要做的事情** | 不实现评估逻辑；不修改 ToolRegistry 或 ApprovalManager |
| **预估复杂度** | M（4h） |

---

### WA-03: 五维度评估器

| 字段 | 内容 |
|------|------|
| **任务 ID** | WA-03 |
| **状态** | completed |
| **标题** | 五维度评估器（Task Understanding / Controlled Execution / Change Validation / Reliable Delivery / Learning Capture） |
| **目标** | 实现五个维度的评估逻辑，每个维度输出 DimensionScore + AuditFinding[] |
| **依赖任务** | WA-02 |
| **涉及文件** | `src/main/audit/evaluators.ts`, `src/main/audit/evaluators.test.ts` |
| **输入** | SessionEvidence, ProjectHarnessEvidence, DeliveryEvidence |
| **输出** | DimensionScore[] + AuditFinding[] |
| **验收标准** | 1) 每个维度至少 2 个检查项; 2) 证据状态按规则映射到评分上限（Missing=50, Present=70, Exercised=100）; 3) 维度评分取最低检查项分值; 4) Finding 包含 evidence, impact, repair 字段; 5) 单元测试覆盖各维度的 Missing/Present/Exercised 三种场景; 6) Finding 的 severity 合理（Missing→high, Present→medium, Exercised→无 finding） |
| **不要做的事情** | 不调用 LLM；不做历史趋势对比 |
| **预估复杂度** | L（7h） |

---

### WA-04: 审计引擎与报告生成

| 字段 | 内容 |
|------|------|
| **任务 ID** | WA-04 |
| **状态** | completed |
| **标题** | 审计引擎（协调收集+评估+报告生成） |
| **目标** | 实现 AuditEngine 类，编排证据收集→维度评估→报告生成的完整流程 |
| **依赖任务** | WA-03 |
| **涉及文件** | `src/main/audit/engine.ts`, `src/main/audit/engine.test.ts` |
| **输入** | AuditInput（ExecutionResult + tools + approvalMode） |
| **输出** | AuditReport |
| **验收标准** | 1) AuditEngine.evaluate() 返回完整 AuditReport; 2) 报告包含 5 个 DimensionScore 和 0-N 个 Finding; 3) overallScore = 五维度加权平均; 4) supportTrack 按规则选择（<50→bootstrap, 50-70→operationalize, >70→optimize, 无证据→undetermined）; 5) summary 为人类可读的中文摘要; 6) 单元测试覆盖空执行、正常执行、全错误执行 |
| **不要做的事情** | 不持久化报告（Phase 2）；不做历史对比 |
| **预估复杂度** | M（4h） |

---

### WA-05: IPC 集成

| 字段 | 内容 |
|------|------|
| **任务 ID** | WA-05 |
| **状态** | completed |
| **标题** | IPC 处理器注册（audit:run + audit:report 事件） |
| **目标** | 新增 audit 域 IPC handler，注册到 registerIpcHandlers |
| **依赖任务** | WA-04 |
| **涉及文件** | `src/main/ipc/audit.ts`, `src/main/ipc/index.ts` |
| **输入** | AuditEngine |
| **输出** | `audit:run` handler 可被渲染进程调用 |
| **验收标准** | 1) audit:run 接受 conversationId + executionResult 参数; 2) 从全局 ToolRegistry 和 AppSettings 获取证据; 3) 调用 AuditEngine.evaluate() 生成报告; 4) 通过 audit:report 事件推送报告到渲染进程; 5) 在 registerIpcHandlers() 中注册; 6) 幂等注册 |
| **不要做的事情** | 不在 Agent 执行完成时自动触发审计（由用户主动触发） |
| **预估复杂度** | S（3h） |

---

### WA-06: Preload 扩展

| 字段 | 内容 |
|------|------|
| **任务 ID** | WA-06 |
| **状态** | completed |
| **标题** | Preload 层暴露 audit API |
| **目标** | 在 preload 中新增 audit 命名空间 |
| **依赖任务** | WA-05 |
| **涉及文件** | `src/preload/index.ts` |
| **输入** | WA-05 的 IPC channel |
| **输出** | `window.electron.audit` 可用 |
| **验收标准** | 1) audit.run(params) 调用 audit:run IPC; 2) audit.onReport(callback) 监听 audit:report 事件; 3) 在 contextBridge.exposeInMainWorld 中注册 |
| **不要做的事情** | 不暴露内部评估函数 |
| **预估复杂度** | S（1h） |

---

### WA-07: 前端审计报告面板

| 字段 | 内容 |
|------|------|
| **任务 ID** | WA-07 |
| **状态** | completed |
| **标题** | AuditReportPanel.vue 组件（雷达图 + 发现列表 + 维度详情） |
| **目标** | 实现审计报告的前端展示组件 |
| **依赖任务** | WA-06 |
| **涉及文件** | `src/renderer/src/components/Agent/AuditReportPanel.vue`, `src/renderer/src/stores/agent.ts` |
| **输入** | AuditReport 数据 |
| **输出** | 可视化的审计报告 |
| **验收标准** | 1) 雷达图展示五维度评分; 2) 发现列表按 severity 排序（high→medium→low）; 3) 每个发现显示 title, description, evidence, impact, repair; 4) 点击维度可展开检查项详情; 5) 总评分 + supportTrack 标签显示; 6) 响应式布局（窄屏可滚动） |
| **不要做的事情** | 不实现历史趋势图（Phase 2）；不实现修复执行 |
| **预估复杂度** | L（6h） |

---

### WA-08: 集成测试与验证

| 字段 | 内容 |
|------|------|
| **任务 ID** | WA-08 |
| **状态** | completed |
| **标题** | 集成测试与端到端验证 |
| **目标** | 验证完整审计流程：执行→触发审计→展示报告 |
| **依赖任务** | WA-07 |
| **涉及文件** | `src/main/audit/integration.test.ts` |
| **输入** | 完整的审计模块 |
| **输出** | 所有测试通过 |
| **验收标准** | 1) 集成测试覆盖：正常执行→审计→报告结构正确; 2) 空执行（0步）→审计→报告仍可生成; 3) 全错误执行→审计→findings 包含 high severity; 4) TypeScript 编译无错误; 5) ESLint 通过 |
| **不要做的事情** | 不做性能基准测试 |
| **预估复杂度** | M（3h） |
