# AgentForge - AI 开发代理指南

## 当前状态

| 字段 | 内容 |
|------|------|
| 当前阶段 | P1 - 基础对话闭环 |
| 当前任务 | P1-04 (pending) |
| 上次完成任务 | P1-03: SQLite 数据库初始化与 Schema |

## 必读文档

1. `agentforge-dev-spec/agentforge-spec-v0.2.md` - 开发规格说明书
2. `agentforge-dev-spec/task-backlog-v0.2.md` - 任务 Backlog
3. `agentforge-dev-spec/ai-iteration-rules-v0.2.md` - AI 自主迭代规则
4. `docs/progress-log.md` - 进度日志

## 任务状态

- P1-00: done
- P1-01: done
- P1-02: done
- P1-03: done
- P1-04: pending

## P1-02 完成备注

- 窗口状态持久化使用 JSON 文件（`userData/window-state.json`），P1-03 完成后迁移到 SQLite app_settings 表
- `registerCleanup()` 函数已导出，供 P1-03 注册 `db.close()`、P1-08 注册 `AbortController.abort()`
- CSP 仅生产环境注入（`app.isPackaged`），开发环境跳过以支持 Vite HMR
- preload 路径已修正为 `../preload/index.cjs`

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
