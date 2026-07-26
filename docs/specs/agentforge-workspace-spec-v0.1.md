# AgentForge 本地文件工作区功能规格说明书 v0.1

> 本文档定义 AgentForge 的「本地文件工作区」功能。
> 用户可选择一个本地目录作为工作区，Agent 可在工作区内安全地读写、创建、管理文件，
> 为未来实现「生成 PPT / 导出报告 / 管理项目文件」等高级能力奠定基础。
> V1 聚焦工作区选择 + 文件树浏览 + 基础文件操作工具；
> V2 规划文件模板系统（PPT / Word / Excel 模板生成）。

---

## 1. 功能总览

### 1.1 核心能力

| 能力 | 说明 | 触发方式 | 版本 |
|------|------|----------|------|
| 工作区选择 | 用户选择一个本地目录作为 Agent 的文件操作根目录 | 设置页 / 侧边栏入口 | V1 |
| 工作区持久化 | 记住上次选择的工作区路径，下次启动自动恢复 | 自动 | V1 |
| 最近工作区列表 | 记录最近使用的工作区路径（最多 10 个），支持快速切换 | 设置页下拉 | V1 |
| 文件树浏览 | 在 UI 中以树形结构展示工作区内的文件和目录 | 侧边栏文件面板 | V1 |
| 文件读取 | Agent 读取工作区内文件内容（文本类） | Agent 工具 / UI 预览 | V1 |
| 文件写入 | Agent 在工作区内创建或覆盖文件 | Agent 工具 | V1 |
| 目录创建 | Agent 在工作区内创建目录（含递归） | Agent 工具 | V1 |
| 文件列表 | Agent 列出工作区内指定目录的条目 | Agent 工具 | V1 |
| 文件删除 | Agent 删除工作区内的文件或空目录 | Agent 工具（需审批） | V1 |
| 文件重命名 | Agent 重命名工作区内的文件或目录 | Agent 工具（需审批） | V1 |
| 文件模板生成 | 基于模板生成 PPT / Word / Excel 等文件 | Agent 工具 | V2 |

### 1.2 设计原则

- **沙箱安全**：所有文件操作严格限制在工作区根目录内，禁止通过 `..` 或符号链接逃逸
- **最小权限**：删除、重命名等破坏性操作标记为 `medium` 风险，需审批
- **路径透明**：Agent 工具接收相对路径（相对于工作区根），由后端拼接为绝对路径
- **前端轻量**：文件树仅做展示和导航，文件读写全部走 Agent 工具或 IPC，不直接操作文件系统
- **与现有工具兼容**：不替换现有 `file_read` / `file_write` / `directory_list`，而是新增工作区感知版本

---

## 2. 工作区配置

### 2.1 配置项

#### 工作区设置（存储在 app_settings 的 workspace JSON 列中）

| 字段 | 类型 | 必填 | 说明 | 默认值 |
|------|------|------|------|--------|
| `path` | `string \| null` | 否 | 当前工作区绝对路径 | `null` |
| `recentPaths` | `string[]` | 否 | 最近使用的工作区路径列表（最多 10 个） | `[]` |
| `autoRestore` | `boolean` | 否 | 启动时是否自动恢复上次工作区 | `true` |
| `excludePatterns` | `string[]` | 否 | 文件树排除的 glob 模式 | `["node_modules", ".git", "dist", ".DS_Store"]` |

### 2.2 存储

- 工作区配置以 JSON 字符串存储在 `app_settings` 表的 `workspace` 列中
- 与 `voice` 列的存储方式一致（条件迁移添加列）
- `AppSettings` 类型新增 `workspace: WorkspaceConfig` 字段

### 2.3 工作区选择交互

1. 用户通过设置页「工作区」Tab 或侧边栏文件面板入口点击「选择目录」
2. 渲染进程先调用现有 `file:select-dir` IPC 弹出原生目录选择对话框，获取路径
3. 再调用 `settings:update` 将路径写入 `workspace.path`（与 voice 配置管理模式一致）
4. 设置更新时后端自动执行：
   - 验证目录存在且可访问
   - 将路径加入 `recentPaths`（去重、截断到 10 条）
   - 返回更新后的完整 AppSettings
5. 渲染进程收到更新后触发文件树加载
6. 用户可从 `recentPaths` 下拉列表快速切换（同样走 `settings:update`）

**设计决策**：workspace 配置通过现有 `settings:get` / `settings:update` 管理，与 voice 配置保持一致，不新增独立的 ws:get-config / ws:set-path 通道。仅文件读写操作走独立的 `ws:*` IPC 通道。

---

## 3. 文件树浏览

### 3.1 文件树面板

- 位于侧边栏，可折叠/展开
- 展示工作区根目录下的文件和目录，支持递归展开
- 每个节点显示：图标（文件/文件夹）、名称、大小（文件）
- 排除 `excludePatterns` 匹配的条目
- 支持点击文件名预览文本文件内容（仅 UI 展示，不触发 Agent）

### 3.2 文件树数据结构

```typescript
/** 文件树节点 */
interface FileTreeNode {
  /** 节点 ID（相对路径） */
  id: string
  /** 显示名称 */
  name: string
  /** 相对于工作区根的路径 */
  relativePath: string
  /** 是否目录 */
  isDirectory: boolean
  /** 文件大小（字节，目录为 0） */
  size: number
  /** 修改时间 */
  modifiedAt: number
  /** 子节点（仅目录有，懒加载时为 null） */
  children: FileTreeNode[] | null
}
```

### 3.3 文件预览

- 支持预览文本类文件：`.txt`、`.md`、`.json`、`.js`、`.ts`、`.vue`、`.css`、`.html`、`.csv`、`.yaml`、`.xml`
- 非文本文件（图片、PDF、二进制）仅显示文件信息，不预览内容
- 预览限制：最大 1MB

---

## 4. Agent 文件操作工具

### 4.1 工具总览

| 工具名 | 风险等级 | 说明 | 版本 |
|--------|----------|------|------|
| `ws_read` | low | 读取工作区内文件内容 | V1 |
| `ws_write` | medium | 写入/创建工作区内文件 | V1 |
| `ws_list` | low | 列出工作区内指定目录的条目 | V1 |
| `ws_mkdir` | low | 在工作区内创建目录 | V1 |
| `ws_delete` | medium | 删除工作区内文件或空目录 | V1 |
| `ws_rename` | medium | 重命名工作区内文件或目录 | V1 |
| `ws_file_tree` | low | 获取工作区文件树结构 | V1 |
| `ws_template_generate` | medium | 基于模板生成文件（PPT/Word/Excel） | V2 |

### 4.2 路径处理

所有工具的 `path` 参数均为**相对路径**（相对于工作区根目录）。

后端处理流程：
1. 检查工作区是否已设置（`workspace.path` 不为 null）
2. 拼接绝对路径：`resolve(workspacePath, relativePath)`
3. 安全校验：确保拼接后的绝对路径仍在工作区根目录内（防止 `..` 逃逸）
4. 执行文件操作

```typescript
/** 路径安全校验：确保 resolvedPath 在 workspacePath 内 */
function isPathInWorkspace(workspacePath: string, resolvedPath: string): boolean {
  const normalizedWorkspace = resolve(workspacePath)
  const normalizedResolved = resolve(resolvedPath)
  return normalizedResolved === normalizedWorkspace || normalizedResolved.startsWith(normalizedWorkspace + sep)
}
```

### 4.3 ws_read 工具

| 字段 | 内容 |
|------|------|
| **工具名** | `ws_read` |
| **风险等级** | low |
| **描述** | 读取工作区内指定文件的内容（UTF-8 文本） |
| **输入** | `{ path: string }`（相对路径，必填） |
| **输出** | 文件内容字符串 |
| **限制** | 最大 1MB；仅 UTF-8 文本 |

### 4.4 ws_write 工具

| 字段 | 内容 |
|------|------|
| **工具名** | `ws_write` |
| **风险等级** | medium |
| **描述** | 在工作区内创建或覆盖文件，自动创建父目录 |
| **输入** | `{ path: string, content: string }`（均为必填） |
| **输出** | 成功消息 + 写入字节数 |
| **限制** | 路径必须在工作区内 |

### 4.5 ws_list 工具

| 字段 | 内容 |
|------|------|
| **工具名** | `ws_list` |
| **风险等级** | low |
| **描述** | 列出工作区内指定目录的文件和子目录 |
| **输入** | `{ path?: string }`（相对路径，默认为根目录 `.`） |
| **输出** | 目录条目列表 `{ name, isDirectory, size, modifiedAt }[]` |

### 4.6 ws_mkdir 工具

| 字段 | 内容 |
|------|------|
| **工具名** | `ws_mkdir` |
| **风险等级** | low |
| **描述** | 在工作区内创建目录（支持递归创建） |
| **输入** | `{ path: string }`（相对路径，必填） |
| **输出** | 成功消息 |

### 4.7 ws_delete 工具

| 字段 | 内容 |
|------|------|
| **工具名** | `ws_delete` |
| **风险等级** | medium |
| **描述** | 删除工作区内的文件或空目录 |
| **输入** | `{ path: string }`（相对路径，必填） |
| **输出** | 成功消息 |
| **注意** | 不递归删除非空目录（安全限制）；删除非空目录返回错误 |

### 4.8 ws_rename 工具

| 字段 | 内容|
|------|------|
| **工具名** | `ws_rename` |
| **风险等级** | medium |
| **描述** | 重命名或移动工作区内的文件/目录 |
| **输入** | `{ from: string, to: string }`（均为相对路径，必填） |
| **输出** | 成功消息 |
| **注意** | 目标路径也必须在工作区内 |

### 4.9 ws_file_tree 工具

| 字段 | 内容 |
|------|------|
| **工具名** | `ws_file_tree` |
| **风险等级** | low |
| **描述** | 获取工作区文件树结构（递归，排除 node_modules 等） |
| **输入** | `{ path?: string, maxDepth?: number }`（默认根目录，最大深度 5） |
| **输出** | FileTreeNode JSON |

---

## 5. 技术架构

### 5.1 模块划分

```
┌─────────────────────────────────────────────────────────┐
│                    Renderer Process                      │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ WorkspacePanel│  │ FileTreeView  │  │ FilePreview   │  │
│  │ (侧边栏面板)  │  │ (文件树组件)  │  │ (文件预览)    │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘  │
│         │                 │                  │           │
│         └─────────┬───────┴──────────┬───────┘           │
│                   │  workspace store  │                   │
│                   └────────┬─────────┘                   │
├────────────────────────────┼─────────────────────────────┤
│                    Preload │                              │
│            workspace API   │   file.selectDir            │
├────────────────────────────┼─────────────────────────────┤
│                   Main Process                           │
│  ┌─────────────────────────┴──────────────────────────┐  │
│  │              workspace IPC handlers                 │  │
│  │  (配置走 settings:get / settings:update)            │  │
│  │  ws:read     ws:write      ws:list                 │  │
│  │  ws:mkdir    ws:delete     ws:rename  ws:tree      │  │
│  └─────────────────────────┬──────────────────────────┘  │
│                           │                              │
│  ┌────────────────────────┴──────────────────────────┐   │
│  │              ws tools (Agent)                     │   │
│  │  ws_read  ws_write  ws_list  ws_mkdir             │   │
│  │  ws_delete  ws_rename  ws_file_tree               │   │
│  └───────────────────────────────────────────────────┘   │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐   │
│  │  path-guard  │  │  db/repos    │  │  tools/       │   │
│  │  (路径安全)  │  │  app-settings │  │  registry     │   │
│  └─────────────┘  └──────────────┘  └───────────────┘   │
└──────────────────────────────────────────────────────────┘
```

### 5.2 数据流

```
用户选择目录
    │
    ▼
file:select-dir IPC ──► 返回路径
    │
    ▼
settings:update IPC ──► 写入 app_settings.workspace.path
    │                        │
    │                        ▼
    │                 加入 recentPaths（去重、截断）
    │
    ▼
workspace store ──► 更新 UI 状态
    │
    ▼
ws:tree IPC ──► 返回 FileTreeNode[]
    │
    ▼
FileTreeView 渲染文件树
```

### 5.3 技术选型

| 层 | 技术 | 说明 |
|------|------|------|
| 文件系统 | Node.js `fs/promises` | 异步文件操作 |
| 路径安全 | `path.resolve` + 前缀检查 | 防止目录穿越 |
| IPC | Electron `ipcMain.handle` | 与现有模式一致 |
| 文件树 | 递归 `readdir` + `stat` | 懒加载 + 深度限制 |
| 存储 | `app_settings.workspace` JSON 列 | 与 voice 配置同模式 |
| 前端组件 | naive-ui `NTree` | 文件树展示 |
| 文件预览 | naive-ui `NCode` / `NText` | 代码高亮预览 |

### 5.4 IPC 接口

workspace 配置不新增独立 IPC 通道，复用现有 `settings:get` / `settings:update`（与 voice 配置一致）。

仅文件操作相关 IPC 走独立 `ws:*` 通道：

```typescript
/** Workspace 文件操作 IPC 通道 */
interface WorkspaceAPI {
  /** 读取工作区内文件 */
  read(path: string): Promise<string>
  /** 写入工作区内文件 */
  write(path: string, content: string): Promise<void>
  /** 列出工作区内目录条目 */
  list(path?: string): Promise<WorkspaceDirectoryEntry[]>
  /** 创建目录 */
  mkdir(path: string): Promise<void>
  /** 删除文件或空目录 */
  delete(path: string): Promise<void>
  /** 重命名/移动 */
  rename(from: string, to: string): Promise<void>
  /** 获取文件树 */
  tree(path?: string, maxDepth?: number): Promise<FileTreeNode>
}
```

**工作区目录条目类型**：

```typescript
/** 工作区目录条目（比现有 DirectoryEntry 多 modifiedAt 字段） */
interface WorkspaceDirectoryEntry {
  name: string
  isDirectory: boolean
  size: number
  modifiedAt: number
}
```

---

## 6. 验收标准

### V1 验收

| 编号 | 验收项 | 标准 |
|------|--------|------|
| V1-01 | 工作区选择 | 用户可在设置页选择目录，选择后路径持久化存储 |
| V1-02 | 工作区恢复 | 应用重启后自动恢复上次工作区路径 |
| V1-03 | 最近工作区 | 最近工作区列表正确显示，可切换，最多 10 条 |
| V1-04 | 文件树展示 | 文件树正确显示工作区内容，排除规则生效 |
| V1-05 | 文件预览 | 可预览文本文件内容，非文本文件显示提示 |
| V1-06 | ws_read 工具 | Agent 可读取工作区内文件，路径逃逸被拒绝 |
| V1-07 | ws_write 工具 | Agent 可创建/覆盖文件，自动创建父目录 |
| V1-08 | ws_list 工具 | Agent 可列出工作区目录条目 |
| V1-09 | ws_mkdir 工具 | Agent 可创建目录，支持递归创建 |
| V1-10 | ws_delete 工具 | Agent 可删除文件或空目录，非空目录被拒绝 |
| V1-11 | ws_rename 工具 | Agent 可重命名文件/目录，目标路径在工作区内 |
| V1-12 | 路径安全 | 所有工具的 `..` 路径逃逸尝试被拒绝并返回错误 |
| V1-13 | 无工作区提示 | 未设置工作区时，工具返回友好提示引导用户先设置 |

---

## 7. 边界情况处理

| 场景 | 处理方式 |
|------|----------|
| 未设置工作区时调用工具 | 返回错误：`WORKSPACE_NOT_SET`，提示用户先选择工作区 |
| 工作区目录被外部删除 | 文件操作返回 `WORKSPACE_PATH_INVALID`，UI 提示工作区不可用 |
| 工作区内文件不存在 | 返回 `FILE_NOT_FOUND` |
| 路径包含 `..` | 拼接后校验不在工作区内，返回 `WORKSPACE_PATH_ESCAPE` |
| 符号链接逃逸 | `realpath` 解析后校验不在工作区内，返回 `WORKSPACE_PATH_ESCAPE`；realpath 失败返回 `FILE_ACCESS_ERROR` |
| 删除非空目录 | 返回错误：`DIRECTORY_NOT_EMPTY` |
| 文件超过 1MB 读取限制 | 返回 `FILE_TOO_LARGE` 错误 |
| 写入已存在文件 | 直接覆盖（无确认，由 Agent 审批模式控制） |
| 文件名含特殊字符 | 使用 `path.basename` 和 `path.join` 安全拼接 |
| 并发写入同一文件 | 依赖文件系统语义（后写覆盖先写） |
| 权限不足（EACCES/EPERM） | 返回 `FILE_ACCESS_ERROR` |

---

## 8. 与现有功能的关系

- **与现有功能集成**：工作区配置通过 `settings:update` 管理（与 voice 一致），文件操作走独立 `ws:*` IPC 和 Agent 工具
- **与现有 file_read / file_write / directory_list 工具并存**：现有工具使用绝对路径、无工作区约束，保留不动；后续可考虑将现有工具迁移到 path-guard 复用安全校验逻辑
- **与 Agent 执行路径集成**：ws_* 工具注册到 ToolRegistry，Agent 在执行时可自动调用
- **与设置系统集成**：工作区配置存储在 `app_settings.workspace`，通过设置页管理
- **与知识库集成**：未来可从工作区导入文档到知识库
- **与文件模板系统（V2）集成**：ws_template_generate 工具基于工作区路径生成 PPT / Word 等文件

---

## 9. 错误码

| 错误码 | 说明 |
|--------|------|
| `WORKSPACE_NOT_SET` | 未设置工作区路径 |
| `WORKSPACE_PATH_INVALID` | 工作区路径不存在或不可访问 |
| `WORKSPACE_PATH_ESCAPE` | 路径逃逸，尝试访问工作区外的文件 |
| `DIRECTORY_NOT_EMPTY` | 尝试删除非空目录 |
| `FILE_NOT_FOUND` | 文件或目录不存在（复用现有错误码） |
| `FILE_ACCESS_ERROR` | 文件访问被拒绝（复用现有错误码） |
| `FILE_TOO_LARGE` | 文件超过大小限制（复用现有错误码） |

---

## 10. 实现状态

### 10.1 已完成模块

（开发中，待实现）

### 10.2 待优化项

- [ ] 文件变更监听（chokidar / fs.watch）实时更新文件树
- [ ] 文件拖拽上传到工作区
- [ ] 文件搜索（按名称模糊搜索工作区内文件）
- [ ] 多工作区切换（标签页式管理）
- [ ] V2: 文件模板系统（PPT / Word / Excel 模板生成）
