# AgentForge - AI 开发代理指南

## 当前状态

| 字段 | 内容 |
|------|------|
| 当前阶段 | P4 - 本地知识库 |
| 当前任务 | P4 已完成 |
| 上次完成任务 | P4-04: KB 搜索工具集成到 Agent |
| 测试总数 | 857 passed (38 files) |
| Git 远程 | Gitee (私有仓库) |

## 必读文档

1. `docs/progress-log.md` - 进度日志
2. `AGENT.md` - 本文件（当前状态与任务索引）

## 任务状态

### P1 - 基础对话闭环 (done)

- P1-00: done - 项目脚手架
- P1-01: done - 前端框架搭建
- P1-02: done - 主进程窗口创建与生命周期
- P1-03: done - SQLite 数据库初始化与 Schema
- P1-04 ~ P1-09: done - IPC handlers、UI 组件、对话闭环

### P2 - Agent 引擎 + MCP 工具 (done)

- P2-01: done - Agent ReAct 执行引擎 (executor.ts)
- P2-02: done - 工具注册与内置工具 (file-read/write, web-search/scrape, directory-list)
- P2-03: done - 审批机制 (approval.ts)
- P2-04: done - MCP 客户端 (client.ts, transport.ts, manager.ts)
- P2-05: done - Agent IPC handler 集成
- P2-06: done - Agent UI 组件 (ExecutionPanel, ThinkingBlock, ApprovalCard)
- P2-07: done - 集成测试 (27 tests)

### P3 - Skills 系统 (done)

- P3-01: done - Skills 数据库表 + CRUD 仓库层 (45 tests)
- P3-02: done - Skills IPC + Preload 扩展 (34 tests)
- P3-03: done - Skill 意图匹配引擎 (32 tests)
- P3-04: done - Skill 执行集成 (32 tests)
- P3-05: done - 内置 Skills 种子数据 (20 tests)

### P4 - 本地知识库 (done)

- P4-01: done - 知识库数据表设计与仓库层
- P4-02: done - 文档导入与分块
- P4-03: done - 向量嵌入与语义搜索
- P4-04: done - KB 搜索工具集成到 Agent

## 版本升级注意事项 (2026-07-26)

- TypeScript 6.0.3 (TS 7 与 typescript-eslint 不兼容，暂不升级)
- Electron 43.2.0 (首运行时下载二进制)
- openai v6 (`.del()` → `.delete()`，streaming API 变更)
- better-sqlite3 v13 (N-API，无需 electron-rebuild)
- Pinia v4 (ESM-only，`defineStore('id', ...)` 格式)
- ESLint 10 + eslint-plugin-vue 10
- Vite 8.1.5 (显式安装)
- vitest 4 (pool 选项重命名，coverage 配置变更)
- 详见 `docs/progress-log.md`

## Git 提交规范

- 提交描述使用中文
- 格式: `feat(任务ID): 简短描述` 或 `fix(任务ID): 简短描述`
- 每完成一个任务后提交并推送到 Gitee
- 同时更新 `docs/progress-log.md` 进度日志
