# AgentForge 本地文件工作区 - 任务拆解 v0.1

> 本文档基于 [agentforge-workspace-spec-v0.1.md](./agentforge-workspace-spec-v0.1.md) 拆解开发任务。
> 采用小步快跑策略，每个任务完成后提交到 Gitee。

### 复杂度图例

| 等级 | 说明 | 预估时间 |
|------|------|----------|
| S | 简单，纯配置或类型定义 | 2-3h |
| M | 中等，需编写逻辑或组件 | 4-5h |
| L | 复杂，涉及多个文件联动 | 6-8h |
| XL | 高复杂度，跨层架构改动 | 8h+ |

### 第一个可运行闭环路径

```
WS-01 → WS-02 → WS-03 → WS-04 → WS-05
```

（WS-06 为独立集成验收阶段，不在可运行闭环内）

---

## V1 - 基础工作区功能

### WS-01: 工作区配置基础设施

| 字段 | 内容 |
|------|------|
| **任务 ID** | WS-01 |
| **状态** | done |
| **标题** | 工作区配置类型定义 + 数据库迁移 + 设置读写 |
| **目标** | 定义 WorkspaceConfig / FileTreeNode / WorkspaceDirectoryEntry 类型，在 app_settings 添加 workspace 列，实现配置的读写和路径去重截断逻辑 |
| **依赖任务** | 无 |
| **涉及文件** | `src/shared/types.ts`(修改) `src/main/db/schema.sql`(修改) `src/main/db/index.ts`(修改) `src/main/db/repos/app-settings.ts`(修改) `src/main/db/repos/app-settings.test.ts`(修改) |
| **输入** | 规格文档 §2, §3.2, §5.4 |
| **输出** | WorkspaceConfig + FileTreeNode + WorkspaceDirectoryEntry 类型 + app_settings.workspace 列 + 条件迁移 + recentPaths 去重截断逻辑 |
| **验收标准** | 1) WorkspaceConfig 接口定义完整（path, recentPaths, autoRestore, excludePatterns）; 2) FileTreeNode 接口定义（id, name, relativePath, isDirectory, size, modifiedAt, children）; 3) WorkspaceDirectoryEntry 接口定义（name, isDirectory, size, modifiedAt）; 4) AppSettings 新增 workspace 字段; 5) app_settings 表有 workspace 列（条件迁移对老数据库生效）; 6) getSettings/updateSettings 可读写 workspace 配置; 7) updateSettings 处理 workspace.path 更新时自动维护 recentPaths（去重、截断到 10 条）; 8) 现有测试通过 |
| **不要做的事情** | 不实现前端 UI；不实现 IPC 通道；不修改 preload |
| **预估复杂度** | S（2-3h） |

---

### WS-02: 路径安全模块

| 字段 | 内容 |
|------|------|
| **任务 ID** | WS-02 |
| **状态** | done |
| **标题** | 实现工作区路径安全校验模块 |
| **目标** | 创建 path-guard 模块，确保所有文件操作路径都在工作区内 |
| **依赖任务** | WS-01 |
| **涉及文件** | `src/main/tools/path-guard.ts`(新) `src/main/tools/path-guard.test.ts`(新) |
| **输入** | 规格文档 §4.2 |
| **输出** | isPathInWorkspace + resolveWorkspacePath 函数 + 单元测试 |
| **验收标准** | 1) isPathInWorkspace 正确识别工作区内路径; 2) 拒绝 `..` 逃逸路径; 3) 拒绝符号链接逃逸（realpath 校验）; 4) 空路径和 null 路径返回 false; 5) 路径大小写不敏感（跨平台）; 6) realpath 解析失败时返回 false; 7) 测试覆盖率 ≥ 90% |
| **不要做的事情** | 不实现 IPC；不实现 Agent 工具；不修改现有工具 |
| **预估复杂度** | M（4-5h） |

---

### WS-03: 工作区 IPC + Agent 工具

| 字段 | 内容 |
|------|------|
| **任务 ID** | WS-03 |
| **状态** | pending |
| **标题** | 实现工作区文件操作 IPC handlers + ws_* Agent 工具 |
| **目标** | 创建 workspace 文件操作 IPC 通道（ws:read/write/list/mkdir/delete/rename/tree）和 7 个 ws_* 内置工具，注册到 ToolRegistry |
| **依赖任务** | WS-01, WS-02 |
| **涉及文件** | `src/main/ipc/workspace.ts`(新) `src/main/ipc/index.ts`(修改) `src/main/tools/ws-tools.ts`(新) `src/main/tools/registry-init.ts`(修改) `src/main/utils/error.ts`(修改) `src/preload/index.ts`(修改) `src/renderer/src/types/electron-api.ts`(修改) |
| **输入** | 规格文档 §4, §5.4, §9 |
| **输出** | workspace 文件操作 IPC handlers + ws_read/write/list/mkdir/delete/rename/file_tree 工具 + preload workspace API + 4 个新错误码 |
| **验收标准** | 1) 7 个 ws_* 工具注册到 ToolRegistry; 2) 所有工具使用相对路径 + path-guard 校验; 3) 未设置工作区时返回 WORKSPACE_NOT_SET; 4) ws_read 限制 1MB，超限返回 FILE_TOO_LARGE; 5) ws_write 自动创建父目录; 6) ws_list 默认列出根目录; 7) ws_mkdir 支持递归创建; 8) ws_delete 拒绝非空目录（返回 DIRECTORY_NOT_EMPTY）; 9) ws_rename 目标路径校验; 10) ws_file_tree 最大深度 5，排除规则生效; 11) WORKSPACE_NOT_SET / WORKSPACE_PATH_INVALID / WORKSPACE_PATH_ESCAPE / DIRECTORY_NOT_EMPTY 已添加到 error.ts; 12) ipc/index.ts 调用 registerWorkspaceHandlers; 13) preload 暴露 workspace 命名空间; 14) electron-api.ts 类型声明完整; 15) IPC 注册使用幂等模式（含 removeHandler）; 16) 现有测试通过 |
| **不要做的事情** | 不实现前端 UI；不实现文件树组件；不新增 ws:get-config/ws:set-path（配置走 settings:update） |
| **预估复杂度** | L（6-8h） |

---

### WS-04: 工作区设置页面

| 字段 | 内容 |
|------|------|
| **任务 ID** | WS-04 |
| **状态** | pending |
| **标题** | 设置页新增「工作区」Tab + WorkspaceConfig 组件 |
| **目标** | 在设置页添加工作区配置 Tab，支持选择目录、查看最近工作区、切换、编辑排除模式 |
| **依赖任务** | WS-01 |
| **涉及文件** | `src/renderer/src/components/Settings/WorkspaceConfig.vue`(新) `src/renderer/src/views/SettingsView.vue`(修改) `src/renderer/src/stores/settings.ts`(修改) |
| **输入** | 规格文档 §2.3 |
| **输出** | WorkspaceConfig.vue 组件 + SettingsView 新增 'workspace' Tab（SettingsTab 类型更新）+ settings store 支持 workspace 更新 |
| **验收标准** | 1) SettingsTab 类型新增 'workspace'; 2) 设置页有「工作区」Tab; 3) 显示当前工作区路径; 4) 「选择目录」按钮调用 file:select-dir 后通过 settings:update 保存; 5) 最近工作区下拉列表正确显示并去重; 6) 可从下拉列表切换工作区; 7) 排除模式可编辑（excludePatterns）; 8) autoRestore 开关可切换; 9) 应用重启后 autoRestore=true 时自动恢复 workspace.path |
| **不要做的事情** | 不实现文件树；不实现文件预览 |
| **预估复杂度** | M（4-5h） |

---

### WS-05: 文件树面板 + 文件预览

| 字段 | 内容 |
|------|------|
| **任务 ID** | WS-05 |
| **状态** | pending |
| **标题** | 侧边栏文件树面板 + 文件预览组件 |
| **目标** | 在聊天界面侧边栏添加文件树面板，支持浏览工作区文件和预览文本文件 |
| **依赖任务** | WS-03, WS-04 |
| **涉及文件** | `src/renderer/src/components/Sidebar/FileTreePanel.vue`(新) `src/renderer/src/components/Sidebar/FilePreview.vue`(新) `src/renderer/src/stores/workspace.ts`(新) `src/renderer/src/stores/ui.ts`(修改) `src/renderer/src/views/ChatView.vue`(修改) |
| **输入** | 规格文档 §3 |
| **输出** | FileTreePanel.vue + FilePreview.vue + workspace store + ChatView 集成 |
| **验收标准** | 1) 侧边栏显示文件树面板; 2) 文件树正确展开/折叠; 3) 排除规则生效（node_modules 等不显示）; 4) 点击文件名预览文本内容; 5) 非文本文件显示提示; 6) 文件超过 1MB 显示提示; 7) 未设置工作区时显示引导按钮跳转设置页; 8) workspace store 管理文件树状态; 9) 文件树懒加载子目录 |
| **不要做的事情** | 不实现文件上传；不实现文件拖拽；不实现文件变更监听 |
| **预估复杂度** | L（6-8h） |

---

### WS-06: 集成验收 + 端到端测试

| 字段 | 内容 |
|------|------|
| **任务 ID** | WS-06 |
| **状态** | pending |
| **标题** | 端到端集成测试 + 路径安全渗透测试 |
| **目标** | 验证所有 ws_* 工具的端到端流程，包括路径安全渗透测试 |
| **依赖任务** | WS-01 ~ WS-05 |
| **涉及文件** | `src/main/tools/ws-tools.test.ts`(新) `src/main/ipc/workspace.test.ts`(新) |
| **输入** | 规格文档 §6 验收标准 |
| **输出** | 工具单元测试 + IPC 集成测试 + 路径安全测试 |
| **验收标准** | 1) 所有 ws_* 工具有单元测试; 2) 路径逃逸测试覆盖 `..` / 符号链接 / 绝对路径; 3) 未设置工作区的边界测试; 4) 文件大小限制测试; 5) 非空目录删除拒绝测试; 6) 全部测试通过 |
| **不要做的事情** | 不实现新功能 |
| **预估复杂度** | M（1.5h） |

---

## V2 - 高级功能（规划中，本版本不实现）

| 任务 ID | 标题 | 预估复杂度 |
|---------|------|-----------|
| V2-01 | 文件变更监听（chokidar） | L |
| V2-02 | 文件模板系统（PPT / Word / Excel 生成） | XL |
| V2-03 | 文件拖拽上传 | M |
| V2-04 | 文件搜索（模糊匹配） | M |
| V2-05 | 多工作区标签页管理 | L |
| V2-06 | 从工作区导入文档到知识库 | M |

---

### 状态字段说明

- `pending` — 未开始
- `in-progress` — 进行中
- `done` — 已完成
- `blocked` — 被阻塞

### 任务状态追踪

| 任务 | 状态 | 完成时间 | 备注 |
|------|------|----------|------|
| WS-01 | done | 2026-07-26 | 工作区配置类型 + DB 迁移 + recentPaths 去重截断 + settings IPC voice/workspace 透传修复 |
| WS-02 | done | 2026-07-26 | path-guard 模块 + 4 个工作区错误码 + 28 个单元测试 |
| WS-03 | pending | — | — |
| WS-04 | pending | — | — |
| WS-05 | pending | — | — |
| WS-06 | pending | — | — |
