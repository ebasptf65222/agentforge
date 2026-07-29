// P3-02: MCP 市场 - 预置服务器目录
// 提供常用 MCP Server 的预置配置，支持一键安装

import type { TransportType } from '@shared/types'

// ─── 类型定义 ──────────────────────────────────────────────────

/** 预置 MCP Server 目录条目 */
export interface McpCatalogEntry {
  /** 唯一标识（用于去重和安装追踪） */
  id: string
  /** 显示名称 */
  name: string
  /** 简短描述 */
  description: string
  /** 分类标签 */
  category: McpCategory
  /** 传输方式 */
  transport: TransportType
  /** stdio 模式的命令 */
  command?: string
  /** stdio 模式的参数 */
  args?: string[]
  /** http 模式的 URL */
  url?: string
  /** 环境变量（可能需要用户填写，如 API Key） */
  envKeys?: McpEnvKey[]
  /** 图标标识（用于 UI 展示） */
  icon: string
  /** 官方/来源链接 */
  homepage?: string
}

/** MCP 环境变量键（需要用户填写的敏感信息） */
export interface McpEnvKey {
  /** 环境变量名 */
  key: string
  /** 显示标签 */
  label: string
  /** 是否为必填 */
  required: boolean
  /** 是否为敏感字段（密码/API Key 等） */
  secret: boolean
  /** 占位提示 */
  placeholder?: string
}

/** 市场分类 */
export type McpCategory = 'filesystem' | 'search' | 'database' | 'devtools' | 'productivity' | 'communication'

// ─── 分类元数据 ────────────────────────────────────────────────

export const CATEGORY_LABELS: Record<McpCategory, string> = {
  filesystem: '文件系统',
  search: '搜索',
  database: '数据库',
  devtools: '开发工具',
  productivity: '生产力',
  communication: '通信',
}

export const CATEGORY_ORDER: McpCategory[] = [
  'filesystem',
  'search',
  'database',
  'devtools',
  'productivity',
  'communication',
]

// ─── 预置目录数据 ──────────────────────────────────────────────

export const MCP_CATALOG: McpCatalogEntry[] = [
  // ─── 文件系统 ───────────────────────────────────────────────
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: '提供本地文件系统的读写、搜索和管理能力',
    category: 'filesystem',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    icon: 'folder',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'GitHub 仓库管理：创建 issue、PR、搜索代码、管理分支',
    category: 'devtools',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    envKeys: [
      {
        key: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        label: 'GitHub Token',
        required: true,
        secret: true,
        placeholder: 'ghp_xxxxxxxxxxxx',
      },
    ],
    icon: 'github',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    description: 'GitLab 项目管理：issue、merge request、pipeline 管理',
    category: 'devtools',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-gitlab'],
    envKeys: [
      {
        key: 'GITLAB_PERSONAL_ACCESS_TOKEN',
        label: 'GitLab Token',
        required: true,
        secret: true,
        placeholder: 'glpat-xxxxxxxxxxxx',
      },
    ],
    icon: 'gitlab',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/gitlab',
  },

  // ─── 搜索 ───────────────────────────────────────────────────
  {
    id: 'brave-search',
    name: 'Brave Search',
    description: 'Brave 搜索引擎 API，支持网页搜索和本地搜索',
    category: 'search',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    envKeys: [
      {
        key: 'BRAVE_API_KEY',
        label: 'Brave API Key',
        required: true,
        secret: true,
        placeholder: 'BSAxxxxxxxxxxxxxxxxxx',
      },
    ],
    icon: 'search',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search',
  },
  {
    id: 'fetch',
    name: 'Fetch',
    description: '抓取网页内容并转为 Markdown，支持智能截取',
    category: 'search',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    icon: 'cloud-download',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
  },

  // ─── 数据库 ─────────────────────────────────────────────────
  {
    id: 'sqlite',
    name: 'SQLite',
    description: '查询和管理本地 SQLite 数据库',
    category: 'database',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite', '--db-path', '/tmp/data.db'],
    icon: 'database',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite',
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    description: '查询和管理 PostgreSQL 数据库',
    category: 'database',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    envKeys: [
      {
        key: 'POSTGRES_CONNECTION_STRING',
        label: '连接字符串',
        required: true,
        secret: true,
        placeholder: 'postgresql://user:pass@localhost:5432/db',
      },
    ],
    icon: 'database',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres',
  },

  // ─── 开发工具 ───────────────────────────────────────────────
  {
    id: 'memory',
    name: 'Memory',
    description: '基于知识图谱的持久记忆存储，跨会话记住实体关系',
    category: 'devtools',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    icon: 'brain',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
  },
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    description: '结构化思维工具，支持动态推理和思维链修正',
    category: 'devtools',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    icon: 'lightbulb',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
  },
  {
    id: 'puppeteer',
    name: 'Puppeteer',
    description: '浏览器自动化：导航页面、截图、点击、填表',
    category: 'devtools',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    icon: 'browser',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer',
  },

  // ─── 生产力 ─────────────────────────────────────────────────
  {
    id: 'google-drive',
    name: 'Google Drive',
    description: '搜索和读取 Google Drive 中的文件内容',
    category: 'productivity',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-google-drive'],
    envKeys: [
      {
        key: 'GOOGLE_DRIVE_OAUTH_CREDENTIALS',
        label: 'OAuth 凭据 JSON',
        required: true,
        secret: true,
        placeholder: '{"installed":{"client_id":...}}',
      },
    ],
    icon: 'cloud',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/google-drive',
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Slack 消息管理：列出频道、获取历史消息、发送消息',
    category: 'communication',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    envKeys: [
      {
        key: 'SLACK_BOT_TOKEN',
        label: 'Slack Bot Token',
        required: true,
        secret: true,
        placeholder: 'xoxb-xxxxxxxxxxx',
      },
    ],
    icon: 'chat',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack',
  },

  // ─── 通信 ───────────────────────────────────────────────────
  {
    id: 'time',
    name: 'Time',
    description: '获取当前时间和时区信息，支持时区转换',
    category: 'productivity',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-time'],
    icon: 'clock',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/time',
  },
  {
    id: 'everart',
    name: 'EverArt',
    description: '使用 AI 生成图片，支持多种模型和风格',
    category: 'productivity',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everart'],
    envKeys: [
      {
        key: 'EVERART_API_KEY',
        label: 'EverArt API Key',
        required: true,
        secret: true,
        placeholder: 'ea-xxxxxxxxxxxx',
      },
    ],
    icon: 'image',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/everart',
  },
]

// ─── 工具函数 ──────────────────────────────────────────────────

/**
 * 获取完整目录
 */
export function getCatalog(): McpCatalogEntry[] {
  return MCP_CATALOG
}

/**
 * 按 ID 获取目录条目
 */
export function getCatalogEntry(id: string): McpCatalogEntry | undefined {
  return MCP_CATALOG.find((e) => e.id === id)
}

/**
 * 按分类获取目录条目
 */
export function getCatalogByCategory(category: McpCategory): McpCatalogEntry[] {
  return MCP_CATALOG.filter((e) => e.category === category)
}

/**
 * 搜索目录条目
 */
export function searchCatalog(query: string): McpCatalogEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return MCP_CATALOG
  return MCP_CATALOG.filter(
    (e) =>
      e.name.toLowerCase().includes(q) ||
      e.description.toLowerCase().includes(q) ||
      e.id.toLowerCase().includes(q),
  )
}
