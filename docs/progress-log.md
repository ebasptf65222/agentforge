# AgentForge 进度日志

## 依赖版本升级 (2026-07-26)

**原因**: 用户要求所有技术版本使用最新

### 版本变更明细

| 包名 | 旧版本 | 新版本 | 备注 |
|------|--------|--------|------|
| typescript | ^5.8.0 | ~6.0.3 | TS 7.0 与 typescript-eslint 不兼容，锁定 6.x |
| electron | ^36.0.0 | ^43.2.0 | 跨 7 个大版本升级 |
| openai | ^4.0.0 | ^6.49.0 | SDK API 有破坏性变更 |
| better-sqlite3 | ^11.0.0 | ^13.0.1 | N-API 重写，预编译二进制跨 ABI 兼容 |
| pinia | ^2.3.0 | ^4.0.2 | ESM-only，需 @vue/devtools-api v8 |
| eslint | ^9.0.0 | ^10.8.0 | flat config 必需 |
| @eslint/js | ^9.0.0 | ^10.0.1 | |
| eslint-plugin-vue | ^9.32.0 | ^10.10.0 | |
| vue-eslint-parser | ^9.4.3 | ^10.4.1 | |
| vitest | ^3.0.0 | ^4.1.10 | 需要 Vite 6+ |
| vue-tsc | ^2.2.0 | ^3.3.8 | |
| @vueuse/core | ^12.0.0 | ^14.3.0 | |
| marked | ^15.0.0 | ^18.0.7 | ESM-only |
| shiki | ^1.0.0 | ^4.3.1 | |
| dompurify | ^3.2.0 | ^3.4.12 | |
| naive-ui | ^2.41.0 | ^2.44.1 | |
| prettier | ^3.5.0 | ^3.9.6 | |
| eslint-config-prettier | ^10.0.0 | ^10.1.8 | |
| @types/node | ^22.0.0 | ^26.1.1 | |
| unocss | ^66.7.0 | ^66.7.5 | |
| @vitejs/plugin-vue | ^6.0.8 | ^6.0.8 | 已是最新 |
| electron-vite | ^5.0.0 | ^5.0.0 | 已是最新 |
| vite | (隐式) | ^8.1.5 | 新增显式依赖 |

### 移除的依赖

| 包名 | 原因 |
|------|------|
| @electron/rebuild | better-sqlite3 v13 使用 N-API，预编译二进制无需 rebuild |

### 移除的脚本

| 脚本 | 原因 |
|------|------|
| postinstall: `electron-rebuild -f -w better-sqlite3` | 不再需要 |

### 关键技术决策

1. **TypeScript 6.0.3 而非 7.0.2**: `typescript-eslint@8.65.0` 的 peerDependency 要求 `typescript <6.1.0`，TS 7 暂不兼容。待 typescript-eslint 更新后可升级。
2. **Vite 8.1.5 显式安装**: electron-vite 将 Vite 作为 peer dependency，而 vitest 4 要求 Vite 6+，显式安装确保版本一致。
3. **better-sqlite3 N-API 验证**: 确认 v13 预编译二进制可直接加载，无需 electron-rebuild。
4. **Electron 42+ 下载行为变更**: electron npm 包不再在 postinstall 时下载二进制，改为首次运行时下载。

### 验证结果

- `pnpm build`: 通过 (Vite 8.1.5)
- `pnpm lint`: 通过 (ESLint 10.8.0)
- `pnpm format:check`: 通过
- better-sqlite3 加载测试: 通过

### 后续任务需注意的 API 变更

- **openai v6**: `.del()` → `.delete()`，streaming API 调整，path params 自动 URI 编码
- **Pinia v4**: `defineStore({ id, ... })` 已废弃，必须用 `defineStore('id', ...)`
- **marked v18**: ESM-only，自定义 renderer/walker 注意 token 结构变化
- **vitest v4**: `workspace` → `projects`，pool 选项重命名，coverage 配置变更
- **@vueuse/core v14**: `computedAsync` 默认 flush 变为 sync

---

## P1-02: 主进程窗口创建与生命周期 (2026-07-26)

**任务**: 实现主进程入口，创建 BrowserWindow，配置安全策略，注册应用生命周期事件，实现单实例锁和窗口状态持久化

### 修改文件列表

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/index.ts` | 重写 | 完整主进程入口：单实例锁、安全配置、CSP 注入、窗口状态持久化、DevTools、before-quit 清理 |
| `src/main/utils/window-state.ts` | 新增 | 窗口状态持久化模块（loadWindowState / saveWindowState / createDebouncedSaver） |
| `src/main/utils/window-state.test.ts` | 新增 | 单元测试（14 个测试用例） |
| `vitest.config.ts` | 新增 | vitest 配置文件 |
| `agentforge-dev-spec/agentforge-spec-v0.2.md` | 更新 | §3 目录结构新增 window-state.ts 和 vitest.config.ts |
| `agentforge-dev-spec/task-backlog-v0.2.md` | 更新 | P1-02 状态 → done |

### 验收标准核对

| # | 验收标准 | 状态 | 实现位置 |
|---|---------|------|---------|
| 1 | `nodeIntegration: false` | 通过 | `src/main/index.ts` webPreferences |
| 2 | `contextIsolation: true` | 通过 | `src/main/index.ts` webPreferences |
| 3 | `sandbox: true` | 通过 | `src/main/index.ts` webPreferences |
| 4 | `webSecurity: true` | 通过 | `src/main/index.ts` webPreferences |
| 5 | `allowRunningInsecureContent: false` | 通过 | `src/main/index.ts` webPreferences |
| 6 | CSP header 注入 | 通过 | `injectCsp()` 使用 `session.defaultSession.webRequest.onHeadersReceived` |
| 7 | `app.requestSingleInstanceLock()` 生效 | 通过 | 单实例锁 + `second-instance` 聚焦已有窗口 |
| 8 | `before-quit` 中关闭数据库连接 | 通过 | `before-quit` handler + `cleanupTasks` 注册表（P1-03 注册 db.close） |
| 9 | 窗口尺寸/位置持久化 | 通过 | JSON 文件持久化（防抖 500ms），P1-03 后迁移到 app_settings 表 |
| 10 | 开发环境打开 DevTools | 通过 | `!app.isPackaged` 时 `openDevTools()` |

### 关键技术决策

1. **窗口状态用 JSON 文件而非 SQLite**: P1-03（SQLite）尚未实现，验收标准 9 要求持久化到 app_settings，但 app_settings 表尚不存在。采用 JSON 文件（`userData/window-state.json`）作为临时方案，P1-03 完成后迁移到 SQLite app_settings 表。WindowBounds 接口与 Spec v0.2 §5 AppSettings.windowBounds 类型一致。
2. **CSP 仅生产环境注入**: 开发环境需要 Vite HMR（WebSocket + inline script），CSP 的 `script-src 'self'` 会阻断 HMR。因此 `app.isPackaged` 为 true 时才注入 CSP。
3. **资源清理注册表**: 导出 `registerCleanup()` 函数，P1-03 注册 `db.close()`、P1-08 注册 `AbortController.abort()`、P2 注册 MCP 子进程关闭。
4. **preload 路径修复**: P1-01 中 preload 路径为 `index.c.js`，实际构建输出为 `index.cjs`，已修正。
5. **navigateOnDragDrop: false**: 额外添加安全配置，防止拖拽文件时导航到 file:// URL。

### 验证步骤

```
pnpm build       → 通过 (Vite 8.1.5, 4 modules transformed)
pnpm lint        → 通过 (ESLint 10.8.0, 0 warnings)
pnpm format:check → 通过
pnpm test        → 14 tests passed
```

### 遗留问题

- 窗口状态持久化使用 JSON 文件，P1-03 完成后需迁移到 SQLite app_settings 表
- `before-quit` 清理注册表目前为空，P1-03/P1-08/P2 会逐步注册清理函数

### 是否需要更新文档

- 是：已更新 Spec v0.2 §3 目录结构（新增 `window-state.ts` 和 `vitest.config.ts`）

---

## P1-03: SQLite 数据库初始化与 Schema (2026-07-26)

**任务**: 使用 better-sqlite3 初始化数据库连接，配置 PRAGMA，创建 5 张 P1 表，实现 migration 机制

### 修改文件列表

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/db/schema.sql` | 新增 | 完整 P1 schema（5 表 + 2 索引） |
| `src/main/db/index.ts` | 新增 | 数据库初始化、单例、PRAGMA 配置、schema 执行、关闭、版本查询 |
| `src/main/db/index.test.ts` | 新增 | 18 个单元测试，覆盖全部 12 项验收标准 |
| `src/main/db/repos/model-config.ts` | 新增 | 占位，P1-06 实现 |
| `src/main/db/repos/conversation.ts` | 新增 | 占位，P1-09a 实现 |
| `src/main/db/repos/message.ts` | 新增 | 占位，P1-08/P1-09a 实现 |
| `src/main/db/repos/app-settings.ts` | 新增 | 占位，P1-09b 实现 |
| `src/main/index.ts` | 修改 | 导入并调用 initDatabase()，注册 closeDatabase() 清理 |
| `agentforge-dev-spec/task-backlog-v0.2.md` | 更新 | P1-03 状态 → done |

### 验收标准核对

| # | 验收标准 | 状态 | 测试用例 |
|---|---------|------|---------|
| 1 | `PRAGMA journal_mode=WAL` | 通过 | `should set journal_mode to WAL` |
| 2 | `PRAGMA foreign_keys=ON` | 通过 | `should enable foreign_keys` |
| 3 | `PRAGMA busy_timeout=5000` | 通过 | `should set busy_timeout to 5000` |
| 4 | schema_version 表存在且 version=1 | 通过 | `should create schema_version table with version=1` |
| 5 | conversations.model_id 外键引用 model_configs(id) | 通过 | `should have conversations.model_id referencing model_configs(id)` |
| 6 | messages.role 有 CHECK 约束 | 通过 | `should enforce CHECK constraint on messages.role` |
| 7 | model_configs.provider 有 CHECK 约束 | 通过 | `should enforce CHECK constraint on model_configs.provider` |
| 8 | model_configs 有 UNIQUE(provider, model_id) | 通过 | `should enforce UNIQUE(provider, model_id) on model_configs` |
| 9 | messages 表有 idx_messages_conv 索引 | 通过 | `should have idx_messages_conv index on messages` |
| 10 | conversations 表有 idx_conv_updated 索引 | 通过 | `should have idx_conv_updated index on conversations` |
| 11 | app_settings 有 INSERT OR IGNORE 初始化 | 通过 | 两个测试用例验证初始化和幂等性 |
| 12 | 外键 ON DELETE CASCADE 生效 | 通过 | `should cascade delete messages when conversation is deleted` |

### 关键技术决策

1. **Schema SQL 从文件读取**: 使用 `readFileSync(schema.sql)` 在运行时执行，而非字符串内嵌。便于版本管理和 schema 变更追踪。
2. **better-sqlite3 v13 N-API**: 确认 v13 预编译二进制可直接加载，无需 `electron-rebuild`。
3. **单例模式**: `initDatabase()` 返回单例，多次调用安全。`getDatabase()` 在未初始化时抛出明确错误。
4. **建表顺序**: model_configs → conversations → messages，确保外键引用的表先存在。
5. **迁移机制预留**: `getSchemaVersion()` + `schema_version` 表，P2/P3 新增表时可递增 version 并添加迁移脚本。

### 验证步骤

```
pnpm build  → 通过 (20 modules transformed)
pnpm lint   → 通过
pnpm test   → 32 tests passed (18 db + 14 window-state)
pnpm format:check → 通过
```

### 遗留问题

- 窗口状态持久化目前使用 JSON 文件，**尚未迁移到 app_settings 表的 window_bounds 列**。P1-09b（settings IPC handler）实现时一并迁移。
- Repo 文件仅占位，具体 CRUD 方法在 P1-06/P1-08/P1-09 中实现。

### 是否需要更新文档

- 不需要：Spec v0.2 §6 已完整定义所有表结构，实现完全符合规格。
