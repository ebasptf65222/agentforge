# AgentForge 语音功能 Backlog v0.1

> 本 Backlog 基于 `agentforge-voice-spec-v0.1.md` 规格文档拆解，面向 AI 自主开发。
> 语音功能独立于主对话系统，采用增量式开发，V1 版本完成基础语音能力（TTS 播报 + STT 输入 + 实时语音模式 + 播放控制）。

### 复杂度图例

| 标记 | 含义 | 预估工时（含测试） |
|------|------|-------------------|
| S | Small | 2-3h |
| M | Medium | 4-5h |
| L | Large | 6-8h |
| XL | Extra Large | 8h（上限） |

### 第一个可运行闭环路径

```
V1-00 → V1-01 → V1-02 → V1-03 → V1-05 → V1-06
```
> 完成以上任务后，可实现"语音输入 → 对话 → 语音播报"的基础语音交互闭环。

---

## V1 - 基础语音功能

### V1-00: 类型定义与常量

| 字段 | 内容 |
|------|------|
| **任务 ID** | V1-00 |
| **状态** | pending |
| **标题** | 语音相关类型定义与常量 |
| **目标** | 定义 TTS/STT 配置、播放状态、录音状态等 TypeScript 类型 |
| **依赖任务** | 无 |
| **涉及文件** | `src/shared/types/voice.ts`(新), `src/renderer/src/types/electron-api.ts`(新增 voice 接口) |
| **输入** | 规格文档 §2, §6.4 |
| **输出** | 完整的语音相关类型定义文件 |
| **验收标准** | 1) 定义 `TtsConfig` / `SttConfig` / `VoiceConfig` 接口（含所有字段及默认值）; 2) 定义 `TtsPlayState` 枚举（idle/playing/paused/finished/error）; 3) 定义 `SttRecordState` 枚举（idle/recording/transcribing/error）; 4) 定义 `TtsOptions` / `SttOptions` 接口; 5) 定义 `VoiceModeState` 类型（off/awaiting/listening/transcribing/speaking）; 6) 所有类型均有 JSDoc 注释 |
| **不要做的事情** | 不实现任何业务逻辑；不创建 Vue 组件；不修改 IPC |
| **预估复杂度** | S（2h） |

---

### V1-01: 语音模型配置页面

| 字段 | 内容 |
|------|------|
| **任务 ID** | V1-01 |
| **状态** | pending |
| **标题** | 设置页语音标签页（TTS + STT 配置 + 测试） |
| **目标** | 在 SettingsView 新增 Voice 标签页，包含 TTS、STT、实时语音模式三个配置区块，支持保存和测试连接 |
| **依赖任务** | V1-00 |
| **涉及文件** | `src/renderer/src/components/Settings/VoiceConfig.vue`(新), `src/renderer/src/views/SettingsView.vue`(新增 tab), `src/renderer/src/stores/settings.ts`(新增 voice 字段及读写方法), `src/main/ipc/voice.ts`(新, 配置相关 IPC), `src/preload/index.ts`(新增 voice namespace 配置方法) |
| **输入** | 规格文档 §2 |
| **输出** | 设置页可访问语音配置，填写后保存并持久化 |
| **验收标准** | 1) 设置页增加"语音"标签，排在 Skills 之后、通用之前; 2) TTS 区块含：启用开关、提供商下拉、API 地址、API Key（密码框+可见切换）、模型、声音下拉、语速滑块、格式下拉、自动播报开关; 3) STT 区块含：启用开关、提供商下拉、API 地址、API Key、模型、语言、温度滑块; 4) 实时语音模式区块含：VAD 静音阈值滑块（1.0~3.0s）、自动进入等待开关; 5) TTS 区块有"测试"按钮，点击调用 testTts 并播放测试音频; 6) STT 区块有"测试"按钮，点击录制 3 秒后识别并弹窗显示结果; 7) 所有配置变更即时保存到 settings store 并持久化到数据库; 8) API Key 以密码框显示，有显示/隐藏切换按钮 |
| **不要做的事情** | 不实现实际的 TTS/STT API 调用（那是 V1-02/V1-05 的事）；测试按钮先返回 mock 成功；不涉及数据库 schema 迁移（使用 settings JSON 字段） |
| **预估复杂度** | M（4h） |

---

### V1-02: TTS 合成服务

| 字段 | 内容 |
|------|------|
| **任务 ID** | V1-02 |
| **状态** | pending |
| **标题** | 主进程 TTS 合成服务 + IPC + preload |
| **目标** | 实现 TTS API 调用（文本 → 音频），通过 IPC 暴露给渲染进程 |
| **依赖任务** | V1-00 |
| **涉及文件** | `src/main/services/tts-service.ts`(新), `src/main/ipc/voice.ts`(新增 TTS handlers), `src/preload/index.ts`(新增 TTS 方法) |
| **输入** | 规格文档 §6.2, §6.4 |
| **输出** | 渲染进程可通过 `window.electron.voice.synthesize(text)` 获取音频 ArrayBuffer |
| **验收标准** | 1) `tts-service.ts` 封装 OpenAI 兼容 TTS API 调用（POST /audio/speech，请求体 {model, input, voice, response_format, speed}）; 2) 支持不同提供商（openai/azure/custom）的 base URL 适配; 3) 支持从 settings 中读取当前 TTS 配置; 4) IPC 通道：`voice:tts-synthesize`（text + options → ArrayBuffer）, `voice:tts-test`（用指定配置合成测试音频）; 5) preload 暴露 `voice.synthesize()` 和 `voice.testTts()` 方法; 6) API 调用失败时抛出明确错误（网络错误 / 401 / 404 / 模型不存在等）; 7) 支持流式获取音频（边下载边返回 chunk，v0.1 先返回完整 ArrayBuffer 即可） |
| **不要做的事情** | 不实现音频播放（那是渲染进程的事）；不实现多消息队列；不实现全局播放条 UI |
| **预估复杂度** | M（4h） |

---

### V1-03: 消息气泡语音播放按钮

| 字段 | 内容 |
|------|------|
| **任务 ID** | V1-03 |
| **状态** | pending |
| **标题** | 助手消息气泡播放按钮 + 播放管理 + voice store |
| **目标** | 每条助手消息右上角增加播放按钮，支持播放/暂停/继续/停止，使用 Web Audio API 播放 |
| **依赖任务** | V1-02 |
| **涉及文件** | `src/renderer/src/components/MessageItem/VoicePlayButton.vue`(新), `src/renderer/src/components/MessageItem/MessageItem.vue`(集成), `src/renderer/src/stores/voice.ts`(新, 播放状态管理), `src/renderer/src/utils/tts-player.ts`(新, Web Audio 播放封装), `src/renderer/src/composables/use-voice.ts`(新) |
| **输入** | 规格文档 §3.1 |
| **输出** | 点击助手消息的播放按钮可播放该消息的语音 |
| **验收标准** | 1) 助手消息气泡右上角显示播放按钮（仅 TTS 已配置并启用时显示，未配置时不显示）; 2) 按钮四态：未播放（三角图标）/ 播放中（双竖线暂停图标）/ 暂停（三角图标）/ 错误（警告图标+tooltip）; 3) 点击切换播放/暂停，右键或长按显示停止选项; 4) `tts-player.ts` 封装 Web Audio API，支持 play/pause/resume/stop/seek，支持音量和速度调节; 5) `voice.ts` store 管理当前播放状态（当前消息 ID、播放状态、进度、音量、速度）; 6) 新消息开始播放时自动停止上一条（始终只播最新一条）; 7) 播放时消息气泡有微妙高亮边框（2px 品牌色透明边）; 8) 播放完毕按钮恢复未播放状态; 9) 用户消息不显示播放按钮; 10) 支持播放进度回调，精确到秒 |
| **不要做的事情** | 不实现流式逐句播放（V1-04）；不实现全局播放条（V1-08）；不实现文本高亮同步 |
| **预估复杂度** | M（5h） |

---

### V1-04: 流式语音播放

| 字段 | 内容 |
|------|------|
| **任务 ID** | V1-04 |
| **状态** | pending |
| **标题** | 流式回复逐句合成并播放 |
| **目标** | 流式回复过程中按句子切分文本，逐句调用 TTS 合成并排队播放，减少首字延迟 |
| **依赖任务** | V1-03 |
| **涉及文件** | `src/renderer/src/utils/tts-player.ts`(新增队列播放), `src/renderer/src/composables/use-voice.ts`(流式逻辑 + 切句), `src/renderer/src/stores/voice.ts`(流式状态) |
| **输入** | 规格文档 §3.2 |
| **输出** | 流式回复时首句播放延迟 < 3s |
| **验收标准** | 1) 句子切分：遇到 `。？！\n` 时切为一句，支持中英混合，支持省略号、引号等复杂情况; 2) 流式文本累计中，每完成一句立即调用 TTS 合成; 3) 合成完成的音频入队，前一句播完自动播放下一句; 4) 用户手动停止时清空队列并停止当前播放; 5) 全文生成完毕后，剩余句子继续按序播放; 6) 自动播报开关开启时才自动流式播放（关闭时仅显示播放按钮等待用户点击）; 7) 流式播放时消息气泡显示"播放中"状态; 8) 长文本（>4096 字符）自动分段合成，分段间无明显间隙 |
| **不要做的事情** | 不实现文本与播放进度同步高亮；不实现播放进度条 |
| **预估复杂度** | M（5h） |

---

### V1-05: STT 识别服务

| 字段 | 内容 |
|------|------|
| **任务 ID** | V1-05 |
| **状态** | pending |
| **标题** | STT 转录服务（主进程）+ 录音工具（渲染进程） |
| **目标** | 实现 MediaRecorder 录音 + Whisper 兼容 API 语音识别 + IPC 接口 |
| **依赖任务** | V1-00 |
| **涉及文件** | `src/renderer/src/utils/stt-recorder.ts`(新, MediaRecorder 封装), `src/main/services/stt-service.ts`(新, STT API 调用), `src/main/ipc/voice.ts`(新增 STT handlers), `src/preload/index.ts`(新增 STT 方法) |
| **输入** | 规格文档 §4, §6.2 |
| **输出** | 渲染进程可录音并获取识别文本 |
| **验收标准** | 1) `stt-recorder.ts` 封装 MediaRecorder，支持 start/stop/cancel，webm/opus 格式，输出 ArrayBuffer; 2) 录音时提供音量回调（用于波形动画），基于 AnalyserNode 计算音量; 3) `stt-service.ts` 调用 OpenAI 兼容 STT API（POST /audio/transcriptions，form-data: file + model + language + temperature）; 4) 支持不同提供商（openai/azure/custom）的 base URL 适配; 5) IPC 通道：`voice:stt-transcribe`（audioBuffer + options → text）, `voice:stt-test`（测试配置）; 6) preload 暴露 `voice.transcribe()` 和 `voice.testStt()` 方法; 7) 录音最长 5 分钟，超时自动停止; 8) 麦克风权限请求处理：首次请求，被拒绝时抛出明确错误; 9) API 调用失败时抛出明确错误 |
| **不要做的事情** | 不实现实时流式识别；不实现 VAD 语音活动检测（V1-07）；不实现录音 UI 组件（V1-06） |
| **预估复杂度** | M（5h） |

---

### V1-06: 语音输入按钮

| 字段 | 内容 |
|------|------|
| **任务 ID** | V1-06 |
| **状态** | pending |
| **标题** | 聊天输入框麦克风按钮 + 录音交互 |
| **目标** | 聊天输入框增加麦克风按钮，点击开始录音，再次点击停止并识别，文字填入输入框 |
| **依赖任务** | V1-05 |
| **涉及文件** | `src/renderer/src/components/ChatPanel/VoiceInputButton.vue`(新), `src/renderer/src/components/ChatPanel/ChatInput.vue`(集成), `src/renderer/src/stores/voice.ts`(录音状态) |
| **输入** | 规格文档 §4.1, §4.2, §4.3 |
| **输出** | 用户可通过语音输入消息文字 |
| **验收标准** | 1) 输入框右侧增加麦克风按钮（STT 未配置时置灰，hover 显示 tooltip "请先在设置中配置语音模型"）; 2) 按钮三态：待机（灰色麦克风图标）/ 录音中（红色图标 + 脉动动画）/ 识别中（loading 旋转图标）; 3) 点击待机 → 开始录音，输入框上方显示波形动画条 + 录音时长（分:秒） + 取消按钮; 4) 点击录音中 → 停止录音，显示识别中状态，识别完成文字填入输入框; 5) 录音中按 Escape → 取消录音，不识别; 6) 点击取消按钮 → 取消录音; 7) 识别失败显示错误 toast，保留输入框原有内容; 8) 快捷键 Cmd/Ctrl + Space 切换录音; 9) 录音超过 5 分钟自动停止并识别，toast 提示"已达录音上限 5 分钟"; 10) 无麦克风权限时，点击显示权限引导弹窗 |
| **不要做的事情** | 不实现长按录音模式；不实现 VAD 自动停止（V1-07）；不实现唤醒词 |
| **预估复杂度** | M（4h） |

---

### V1-07: 实时语音对话模式

| 字段 | 内容 |
|------|------|
| **任务 ID** | V1-07 |
| **状态** | pending |
| **标题** | 实时语音对话模式（VAD + 自动播报 + 语音条） |
| **目标** | 增加语音模式开关，开启后 VAD 检测说完自动发送，回复自动播报，形成免操作语音对话 |
| **依赖任务** | V1-04, V1-06 |
| **涉及文件** | `src/renderer/src/components/Voice/VoiceModeToggle.vue`(新, 标题栏开关), `src/renderer/src/components/Voice/VoiceModeBar.vue`(新, 底部语音条), `src/renderer/src/components/common/TitleBar.vue`(集成开关), `src/renderer/src/App.vue`(集成语音条), `src/renderer/src/composables/use-voice.ts`(VAD 逻辑 + 语音模式状态机), `src/renderer/src/stores/voice.ts`(语音模式状态) |
| **输入** | 规格文档 §5 |
| **输出** | 一键进入语音对话模式，说完自动发送，回复自动播报 |
| **验收标准** | 1) 标题栏增加语音模式开关按钮（麦克风图标），点击切换 on/off; 2) 开启后底部显示常驻语音条，显示当前状态（等待说话/录音中/识别中/播报中）; 3) VAD 检测：基于 Web Audio API AnalyserNode 能量检测，静音超过设定阈值（默认 1.5s）自动停止并发送; 4) VAD 阈值从 settings 读取，设置中修改即时生效; 5) 回复生成时自动播报（走 V1-04 流式播放）; 6) 播报完毕后，如果"自动进入等待"开启，自动进入等待说话状态并开启 VAD 监听; 7) 语音条显示：波形动画（录音/播放时）、状态文字、停止按钮; 8) 快捷键 Cmd/Ctrl + Shift + V 切换语音模式; 9) 语音模式下输入框仍可手动打字，打字时自动暂停 VAD 监听; 10) 关闭语音模式时停止所有录音和播放，恢复普通模式 |
| **不要做的事情** | 不实现唤醒词；不实现多人对话区分；不实现声纹识别 |
| **预估复杂度** | L（7h） |

---

### V1-08: 全局播放控制面板

| 字段 | 内容 |
|------|------|
| **任务 ID** | V1-08 |
| **状态** | pending |
| **标题** | 底部语音播放控制条 |
| **目标** | 应用底部增加可收起的播放条，显示当前播放内容、进度、音量、速度控制 |
| **依赖任务** | V1-03 |
| **涉及文件** | `src/renderer/src/components/Voice/VoicePlayerBar.vue`(新), `src/renderer/src/App.vue`(集成), `src/renderer/src/stores/voice.ts`(播放进度/音量/速度持久化) |
| **输入** | 规格文档 §3.4 |
| **输出** | 播放语音时底部显示控制条，可调节音量和速度 |
| **验收标准** | 1) 播放语音时底部出现播放条，不播放时自动隐藏（可手动固定）; 2) 显示当前播放消息摘要（前 30 字，超出省略号）; 3) 播放进度条：显示当前进度，可拖动跳转; 4) 控制按钮：上一条/暂停-继续/下一条/停止（v0.1 先做暂停/继续/停止，上一条/下一条可置灰）; 5) 音量滑块（0 ~ 100，默认 80），调节即时生效，设置持久化; 6) 播放速度选择（0.5x / 0.75x / 1.0x / 1.25x / 1.5x / 2.0x），默认 1.0x，设置持久化; 7) 点击消息播放按钮时，播放条同步更新状态; 8) 播放条可手动收起（最小化为一个小图标按钮）; 9) 快捷键：空格播放/暂停、↑/↓ 调节音量、←/→ 快进快退 5 秒 |
| **不要做的事情** | 不实现上一条/下一条切换（没有播放列表）；不实现播放历史记录 |
| **预估复杂度** | M（5h） |

---

## V2 - 高级语音功能（规划中，本版本不实现）

| 任务 | 标题 | 说明 |
|------|------|------|
| V2-01 | 唤醒词支持 | "嘿，Agent" 唤醒，无需手动点击 |
| V2-02 | 播放进度文本高亮 | 语音播放时同步高亮当前播放的文字位置 |
| V2-03 | 多音色切换 | 不同角色用不同声音，支持自定义音色 |
| V2-04 | SSML 支持 | 支持语音合成标记语言，控制停顿、重音、语调 |
| V2-05 | 语音翻译模式 | 实时语音翻译，说中文出英文语音 |
| V2-06 | 本地离线 TTS/STT | 使用本地模型（如 Coqui TTS / whisper.cpp）离线运行 |
| V2-07 | Silero VAD | 升级 VAD 为 Silero 模型，提高检测准确率 |

---

### 状态字段说明

- `pending` — 待开始
- `in-progress` — 进行中
- `done` — 已完成
- `blocked` — 阻塞中（需等前置任务）

---

### 任务状态追踪

| 任务 | 状态 | 完成时间 | 备注 |
|------|------|----------|------|
| V1-00 | done | 2026-07-26 | 类型定义完成（TTS/STT/语音模式/进度） |
| V1-01 | done | 2026-07-26 | 语音配置页面完成（TTS/STT/模式 三区块 + 设置持久化） |
| V1-02 | done | 2026-07-26 | TTS 合成服务完成（主进程 + IPC + preload） |
| V1-03 | done | 2026-07-26 | 消息播放按钮完成（VoicePlayButton 组件 + voice store + MessageItem 集成） |
| V1-04 | done | 2026-07-26 | 流式播放完成（voice store 流式 TTS + chat store 集成 + TtsPlayer 队列播放） |
| V1-05 | done | 2026-07-26 | STT 识别服务完成（主进程 + 渲染端录音工具） |
| V1-06 | done | 2026-07-26 | 语音输入按钮完成（VoiceInputButton 组件 + voice store STT 方法 + ChatInput 集成） |
| V1-07 | done | 2026-07-26 | 实时语音模式完成（VAD 语音检测 + 免提交互 + VoiceModeToggle 组件） |
| V1-08 | done | 2026-07-26 | 播放控制条完成（VoiceControlPanel 全局播放条 + 进度/音量/语速控制） |
