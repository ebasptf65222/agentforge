# UI 优化任务分解 v0.3

## 批次 1 — 高优先级（交互安全 + 空状态）

| 编号 | 任务 | 文件 | 预估工时 |
|------|------|------|---------|
| UI-01 | 聊天视图空状态引导（WelcomeScreen 组件） | `ChatView.vue`, 新建 `WelcomeScreen.vue` | 1h |
| UI-02 | 消息气泡操作按钮（复制/重试/编辑/删除） | `MessageItem.vue`, `chat.ts` store | 1.5h |
| UI-04 | 会话列表删除确认 | `ConversationList.vue` | 15min |
| UI-12 | 键盘快捷键体系完善 | `ChatView.vue`, `KbView.vue`, `SettingsView.vue` | 30min |

## 批次 2 — 中优先级（功能增强）

| 编号 | 任务 | 文件 | 预估工时 |
|------|------|------|---------|
| UI-03 | Skill 选择器可发现性（提示条 + tooltip） | `ChatInput.vue`, `skill.ts` store | 30min |
| UI-05 | 知识库导入弹窗简化（折叠高级参数） | `KbView.vue` | 30min |
| UI-08 | 语音面板语速标签和档位 | `VoiceControlPanel.vue` | 20min |
| UI-10 | ThinkingBlock 可复制 | `ThinkingBlock.vue` | 15min |
| UI-13 | 主题切换实时预览 | `GeneralSettings.vue` | 20min |

## 批次 3 — 低优先级（批量操作 + 搜索 + 预览增强）

| 编号 | 任务 | 文件 | 预估工时 |
|------|------|------|---------|
| UI-06 | 知识库批量操作（多选 + 批量删除/索引） | `KbView.vue`, `kb.ts` store | 1h |
| UI-07 | 设置搜索/快速跳转 | `SettingsView.vue` + 各 Settings 组件 | 1h |
| UI-09 | 文件面板扩展功能（右键菜单、代码高亮） | `FileTreePanel.vue`, `FileTreeNodeItem.vue`, `FilePreview.vue` | 1h |
| UI-11 | 审批卡片预览增强 | `ApprovalCard.vue`, `ExecutionPanel.vue` | 45min |

---

## 实施顺序

按批次顺序执行，每批次完成后编译验证。
