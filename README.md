# AgentForge

> 本地优先的个人 AI Agent 桌面工作站

AgentForge 是一款基于 Electron 的桌面 AI Agent 应用，集成了流式对话、ReAct 执行引擎、工具调用、MCP 协议、Skills 意图匹配和本地知识库，所有数据存储在本地 SQLite 数据库中，无需云端依赖。

## 功能特性

### AI 对话

- 流式响应（SSE），实时输出思考过程与回复
- 支持 OpenAI / DeepSeek 模型提供商，可扩展自定义接入点
- 多会话管理，会话历史持久化到本地数据库
- Markdown 渲染，代码高亮（Shiki），XSS 防护（DOMPurify）

### Agent 引擎

- ReAct（Thought-Action-Observation）执行循环
- 工具风险分级：`low`（自动执行）/ `medium`（需确认）/ `high`（必须审批）
- 审批超时机制（默认 60s），支持 `suggest` / `auto-edit` / `full-auto` 三种模式
- Token 计数与上下文长度管理，超限自动截断历史消息
- 执行轨迹可视化（ThinkingBlock + ExecutionPanel）

### 工具系统

| 内置工具 | 功能 | 风险等级 |
|---------|------|---------|
| `file-read` | 读取本地文件 | low |
| `file-write` | 写入本地文件 | medium |
| `directory-list` | 列出目录内容 | low |
| `web-search` | 网络搜索 | low |
| `web-scrape` | 网页内容抓取 | low |
| `kb-search` | 知识库语义搜索 | low |

### MCP 集成

- 支持 Model Context Protocol（JSON-RPC 2.0 over stdio）
- 动态工具发现（`tools/list`）与调用（`tools/call`）
- MCP 服务配置持久化到数据库，支持启用/禁用

### Skills 系统

- LLM 意图匹配引擎，自动识别用户意图并触发对应 Skill
- 变量替换（`{{variable}}`），支持必填/可选/默认值
- 工具过滤：仅允许 Skill 配置的工具集
- 内置 Skills：研究报告生成（`research-report`）、文档摘要（`summarize-docs`）

### 本地知识库

- 文档导入：PDF、DOCX、XLSX、Markdown、TXT、CSV
- 分块策略：固定大小 / 按段落，可配置分块大小与重叠
- 向量嵌入与语义搜索（余弦相似度）
- 索引进度追踪，支持重新导入与重新索引
- 知识库搜索工具集成到 Agent 执行流程

### 安全与隐私

- `contextIsolation: true` + `sandbox: true` + `nodeIntegration: false`
- CSP 头注入（生产环境）
- API Key 加密存储（AES-256-GCM）
- 单实例锁，防止多开
- 所有数据本地存储，不上传云端

## 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 运行时 | Electron | ^43.2.0 |
| 前端框架 | Vue 3 | ^3.5.0 |
| 状态管理 | Pinia | ^4.0.2 |
| 样式 | UnoCSS + Naive UI | ^66.7 / ^2.44 |
| 语言 | TypeScript | ~6.0.3 |
| 数据库 | better-sqlite3 (WAL) | ^13.0.1 |
| 构建工具 | electron-vite + Vite | ^5.0 / ^8.1.5 |
| 测试 | Vitest | ^4.1.10 |
| 代码规范 | ESLint + Prettier | ^10.8 / ^3.9.6 |
| 打包 | electron-builder | ^26.15.3 |

### 文档解析依赖

| 格式 | 库 | 说明 |
|------|-----|------|
| PDF | unpdf | 异步解析，无原生依赖 |
| DOCX | mammoth | 提取纯文本 |
| XLSX | exceljs | 工作表遍历 |
| Markdown / TXT / CSV | 原生 | UTF-8 直接读取 |

## 项目结构

```
agentforge/
├── src/
│   ├── main/                    # 主进程
│   │   ├── agent/               # ReAct 执行引擎
│   │   │   ├── executor.ts     # 执行循环
│   │   │   ├── parser.ts        # LLM 响应解析
│   │   │   ├── prompt-builder.ts
│   │   │   ├── approval.ts      # 审批机制
│   │   │   └── tokenizer.ts     # Token 计数
│   │   ├── db/                  # 数据库层
│   │   │   ├── schema.sql       # 建表脚本
│   │   │   ├── migrations/     # 迁移脚本
│   │   │   └── repos/           # CRUD 仓库
│   │   ├── ipc/                 # IPC handlers
│   │   ├── knowledge-base/      # 知识库
│   │   │   ├── parser.ts        # 文档解析
│   │   │   ├── chunking.ts      # 文本分块
│   │   │   ├── embedding.ts     # 向量嵌入
│   │   │   ├── search.ts        # 语义搜索
│   │   │   └── importer.ts      # 导入流程
│   │   ├── mcp/                 # MCP 客户端
│   │   ├── models/              # 模型适配器
│   │   ├── skills/              # Skills 引擎
│   │   ├── tools/               # 工具系统
│   │   └── utils/               # 工具函数
│   ├── preload/                 # Preload 桥接层
│   ├── renderer/                # 渲染进程 (Vue 3)
│   │   └── src/
│   │       ├── components/      # UI 组件
│   │       ├── composables/     # 组合式函数
│   │       ├── stores/          # Pinia 状态
│   │       ├── views/           # 页面视图
│   │       └── utils/           # 工具函数
│   └── shared/                  # 共享类型定义
├── docs/
│   └── progress-log.md          # 开发进度日志
├── electron.vite.config.ts      # 构建配置
└── package.json
```

## 快速开始

### 环境要求

- Node.js >= 20.0.0
- pnpm >= 10.0.0

### 安装

```bash
# 克隆仓库
git clone https://gitee.com/chang-zhi-qiang/agentforge.git
cd agentforge

# 安装依赖
pnpm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 填入 API Key
```

### 开发

```bash
# 启动开发服务器（热更新）
pnpm dev
```

### 构建

```bash
# 类型检查
pnpm typecheck

# 类型检查 + 构建
pnpm build
```

### 测试

```bash
# 运行全部测试
pnpm test

# 监听模式
pnpm test:watch
```

### 代码规范

```bash
# 检查
pnpm lint
pnpm format:check

# 自动修复
pnpm lint:fix
pnpm format
```

## 打包发布

```bash
# 打包当前平台
pnpm pack

# 指定平台
pnpm pack:linux    # Linux AppImage + deb
pnpm pack:mac      # macOS DMG (x64 + arm64)
pnpm pack:win      # Windows NSIS 安装包

# 仅解包不打包（快速验证）
pnpm pack:dir
```

打包产物输出到 `dist/` 目录。

### 支持的平台

| 平台 | 目标格式 | 架构 |
|------|---------|------|
| Linux | AppImage, deb | x64 |
| macOS | DMG | x64, arm64 |
| Windows | NSIS 安装包 | x64 |

## 数据库 Schema

数据库采用 SQLite（WAL 模式），包含以下表：

| 表名 | 说明 |
|------|------|
| `model_configs` | 模型配置（provider/model_id/api_key 等） |
| `conversations` | 会话记录 |
| `messages` | 消息记录（user/assistant/system/tool） |
| `app_settings` | 应用设置（主题、审批模式、快捷键等） |
| `mcp_servers` | MCP 服务配置 |
| `skills` | Skills 定义 |
| `kb_documents` | 知识库文档元数据 |
| `kb_chunks` | 知识库文档分块与嵌入 |

版本迁移通过 `schema_version` 表管理。

## 配置说明

### 环境变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `OPENAI_API_KEY` | OpenAI API 密钥 | `sk-...` |
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 | `sk-...` |
| `LOG_LEVEL` | 日志级别 | `info` |

API Key 也可在应用设置界面中配置，会加密存储到数据库。

### 应用设置

| 设置项 | 说明 | 默认值 |
|--------|------|--------|
| 主题 | dark / light / system | dark |
| 审批模式 | suggest / auto-edit / full-auto | suggest |
| 最大执行步数 | Agent 循环上限 | 20 |
| 审批超时 | 等待审批时间 |600000ms |
| 默认模型 | 首选模型 ID | - |

## 开发指南

### Git 提交规范

- 提交描述使用中文
- 格式：`feat(任务ID): 简短描述` 或 `fix(任务ID): 简短描述`
- 每完成一个任务后提交并推送

### 新增工具

1. 在 `src/main/tools/` 下创建工具文件
2. 实现 `ToolDefinition` 和执行函数
3. 在 `registry-init.ts` 中注册
4. 编写单元测试

### 新增模型适配器

1. 在 `src/main/models/` 下创建适配器文件
2. 实现统一接口（`chat` / `streamChat`）
3. 在 `router.ts` 中注册
4. 在 `shared/types.ts` 的 `ModelProvider` 中添加类型

## 许可证

私有项目，保留所有权利。
