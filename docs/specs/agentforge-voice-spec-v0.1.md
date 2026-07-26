# AgentForge 语音功能规格 v0.1

> 本文档定义 AgentForge 桌面端的语音交互功能规格，包含 TTS（文本转语音）和 STT（语音转文本）两大能力，支持"语音播报回复"和"实时语音对话"两种模式。
> 语音模型独立于对话大模型配置，用户可分别指定 TTS 和 STT 的 API 地址与模型。
> V1 版本完成基础语音能力（TTS 播报 + STT 输入 + 基础实时语音模式），V2 规划高级功能（唤醒词、本地离线等）。

---

## 1. 功能总览

### 1.1 核心能力

| 能力 | 说明 | 触发方式 | 版本 |
|------|------|----------|------|
| **TTS 语音播报** | 大模型回复文本转为语音播放 | 消息气泡播放按钮 / 自动播报 | V1 |
| **流式语音播放** | 边生成边播放，按句子切分排队 | 流式回复时自动启用 | V1 |
| **STT 语音输入** | 用户语音转为文字填入输入框 | 输入框麦克风按钮 | V1 |
| **实时语音对话** | 免打字，说完自动发送，回复自动播报 | 全局语音模式开关 | V1 |
| **全局播放控制** | 底部播放条，进度/音量/速度调节 | 播放语音时显示 | V1 |

### 1.2 设计原则

- **模型独立**：TTS 和 STT 各有独立的 API 配置，与对话 LLM 解耦
- **渐进式启用**：默认关闭，用户在设置中配置后启用
- **低延迟优先**：流式播放减少等待，首句延迟 < 3s
- **可中断**：播放和录音均可随时停止
- **键盘可达**：所有语音操作均有快捷键支持
- **优雅降级**：语音功能失败不影响文本对话

---

## 2. 语音模型配置

### 2.1 配置项

设置页新增 **"语音"** 标签页，分为 TTS 和 STT 两个区块。

#### TTS 配置

| 字段 | 类型 | 必填 | 说明 | 默认值 |
|------|------|------|------|--------|
| 启用 TTS | boolean | 是 | 是否启用语音播报 | `false` |
| 提供商 | enum | 是 | `openai` / `azure` / `custom` | `openai` |
| API 地址 | string | 是 | TTS API Base URL | `https://api.openai.com/v1` |
| API Key | string | 是 | 密钥，加密存储 | 空 |
| 模型 | string | 是 | TTS 模型名，如 `tts-1`、`tts-1-hd` | `tts-1` |
| 声音 | string | 是 | 音色：alloy / echo / fable / onyx / nova / shimmer | `alloy` |
| 语速 | number | 否 | 0.25 ~ 4.0 | `1.0` |
| 格式 | enum | 否 | `mp3` / `opus` / `aac` / `flac` / `wav` / `pcm` | `mp3` |
| 自动播报 | boolean | 否 | 收到回复时自动播放语音 | `false` |

#### STT 配置

| 字段 | 类型 | 必填 | 说明 | 默认值 |
|------|------|------|------|--------|
| 启用 STT | boolean | 是 | 是否启用语音输入 | `false` |
| 提供商 | enum | 是 | `openai` / `azure` / `custom` | `openai` |
| API 地址 | string | 是 | STT API Base URL | `https://api.openai.com/v1` |
| API Key | string | 是 | 密钥，加密存储 | 空 |
| 模型 | string | 是 | STT 模型名，如 `whisper-1` | `whisper-1` |
| 语言 | string | 否 | 语言代码，如 `zh`、`en`，空=自动检测 | 空 |
| 温度 | number | 否 | 0.0 ~ 1.0 | `0.0` |

#### 实时语音模式配置

| 字段 | 类型 | 必填 | 说明 | 默认值 |
|------|------|------|------|--------|
| VAD 静音阈值 | number | 否 | 静音多少秒判定说完（1.0 ~ 3.0） | `1.5` |
| 自动进入等待 | boolean | 否 | 播报完毕自动进入等待说话状态 | `true` |

### 2.2 存储

- 配置存放在 `settings` 表的 `voice` 字段中（JSON 格式）
- API Key 与现有 LLM Key 使用相同的加密方式
- 修改即时保存（与通用设置行为一致）

### 2.3 连接测试

配置页提供"测试"按钮：
- **TTS 测试**：合成 "AgentForge 语音测试，如果你听到这段声音，说明 TTS 配置正确。" 并播放
- **STT 测试**：录制 3 秒音频，识别后在弹窗中显示识别结果

---

## 3. TTS 语音播报

### 3.1 消息气泡播放按钮

每条助手消息气泡右上角增加一个播放按钮：

- **状态**：未播放 / 播放中 / 暂停 / 播放完毕
- **点击行为**：
  - 未播放 → 开始播放
  - 播放中 → 暂停
  - 暂停 → 继续播放
  - 播放完毕 → 重新播放
- **显示条件**：仅 TTS 已配置并启用时显示
- **快捷键**：聚焦消息时按空格切换播放/暂停

### 3.2 流式播放

流式回复时，按句子切分文本，逐句合成并排队播放：

- **两种流式概念**：
  1. **句子级流式**：文本边生成边切句，每完成一句就调用 TTS 合成，不等全文
  2. **音频级流式**：单句音频边下载边播放，不等完整音频文件
- **切分策略**：遇到 `。？！\n` 时切分一句，中英混合均支持
- **缓冲机制**：第一句合成完毕立即播放，后续句子入队，前一句播完自动播放下一句
- **中断处理**：用户手动停止时清空队列并停止当前播放
- **目标**：首句播放延迟 < 3s

### 3.3 自动播报

设置中开启"自动播报"后：
- 助手回复生成时自动开始播放
- 用户发送新消息时自动停止当前播放
- 同一会话中，新回复自动替换旧的播放队列

### 3.4 播放控制

全局底部播放条（播放时显示）：
- 显示当前播放消息摘要（前 30 字）
- 播放进度条（可拖动跳转）
- 暂停/继续按钮、停止按钮
- 音量滑块（0 ~ 100，默认 80）
- 播放速度选择（0.5x / 0.75x / 1.0x / 1.25x / 1.5x / 2.0x）
- 播放条可手动收起

---

## 4. STT 语音输入

### 4.1 输入框麦克风按钮

聊天输入框右侧增加麦克风按钮：

- **状态**：待机（灰色）/ 录音中（红色闪烁 + 波形动画）/ 识别中（loading）
- **点击行为**：
  - 待机 → 开始录音
  - 录音中 → 停止录音并开始识别
- **显示条件**：仅 STT 已配置并启用时显示，未配置时置灰，hover 提示"请先配置语音模型"
- **快捷键**：`Cmd/Ctrl + Space` 切换录音

### 4.2 录音交互

- 录音时输入框区域显示实时波形动画
- 显示录音时长（分:秒）
- 显示取消按钮，点击或按 Escape 取消录音
- 录音最长 5 分钟，超时自动停止并识别
- 录音音量实时反馈（用于波形动画）

### 4.3 识别结果

- 识别完成后文字自动填入输入框
- 填入后可继续编辑再发送
- 可一键清空重录
- 识别失败时显示错误 toast，保留输入框原有内容

---

## 5. 实时语音对话模式

### 5.1 模式开关

- 标题栏增加"语音模式"开关按钮（麦克风图标）
- 开启后进入免操作语音对话模式
- 快捷键：`Cmd/Ctrl + Shift + V` 切换

### 5.2 交互流程

```
等待说话 → 用户说话 → VAD 检测静音 → 自动识别 → 自动发送
    ↑                                            ↓
    └───── 自动播报 ← 回复生成 ← 回复生成 ←──────┘
```

### 5.3 VAD 语音活动检测

- 基于 Web Audio API 能量检测
- 静音超过设定阈值（默认 1.5s）判定为说完，自动停止录音并发送
- 阈值可在设置中调节（1.0s ~ 3.0s）

### 5.4 视觉反馈

- 语音模式开启时，底部显示常驻语音条
- 录音中显示红色脉动 + 波形动画
- 识别中显示"正在识别..."
- 播放中显示播放进度和控制按钮
- 等待说话时显示呼吸灯效果

---

## 6. 技术架构

### 6.1 模块划分

```
┌─────────────────────────────────────────────────────┐
│ Renderer (Vue + Web APIs)                            │
│  ├── components/Settings/VoiceConfig.vue  语音设置页  │
│  ├── components/ChatPanel/VoiceInputButton.vue       │
│  ├── components/MessageItem/VoicePlayButton.vue      │
│  ├── components/Voice/VoicePlayerBar.vue  播放条      │
│  ├── components/Voice/VoiceModeBar.vue   语音模式条   │
│  ├── components/Voice/VoiceModeToggle.vue 开关按钮   │
│  ├── stores/voice.ts           语音状态管理           │
│  ├── composables/use-voice.ts  语音业务逻辑           │
│  ├── utils/tts-player.ts       音频播放（Web Audio） │
│  └── utils/stt-recorder.ts     录音（MediaRecorder） │
├─────────────────────────────────────────────────────┤
│ Preload                                              │
│  └── voice namespace (tts/stt/config 相关 IPC)       │
├─────────────────────────────────────────────────────┤
│ Main Process                                         │
│  ├── services/tts-service.ts   TTS API 调用          │
│  ├── services/stt-service.ts   STT API 调用          │
│  └── ipc/voice.ts              IPC 处理器            │
└─────────────────────────────────────────────────────┘
```

### 6.2 数据流

**TTS 播放流程：**
```
Renderer 发起播放 → IPC → TTS Service 调用 API → 音频流返回
      ↑                                              ↓
  播放状态事件 ←──── 播放控制 ←── Web Audio 播放 ←── 音频数据
```

**STT 识别流程：**
```
Renderer 开始录音 → MediaRecorder 录制 → 录音数据
      ↑                                          ↓
  识别结果 ←── IPC ←── STT Service ←── 停止录音 + 上传
```

**为什么录音/播放在渲染进程？**
- `getUserMedia`、`MediaRecorder`、`Web Audio API` 都是浏览器原生 API，渲染进程直接可用
- 主进程调用 Node.js 录音库需要额外依赖且跨平台兼容性差
- 主进程专注于 API 调用和 IPC 转发，职责更清晰

### 6.3 技术选型

| 模块 | 方案 | 说明 |
|------|------|------|
| TTS API | OpenAI 兼容接口 | 支持 OpenAI / Azure / 自定义端点，POST /audio/speech |
| STT API | OpenAI Whisper 兼容 | 支持 whisper-1 / 自定义端点，POST /audio/transcriptions |
| 音频播放 | Web Audio API | 渲染进程播放，支持流式、速度调节、音量控制 |
| 音频录制 | MediaRecorder API | 渲染进程录制，webm/opus 格式，体积小质量高 |
| 句子级流式 | 文本切句 + 队列播放 | 按标点切句，逐句合成排队播放 |
| VAD | Web Audio API 能量检测 | 简单静音检测，满足基础实时语音需求 |
| 波形动画 | Canvas + 时域/频域数据 | 录音和播放时均显示实时波形 |

### 6.4 IPC 接口

#### 方法接口

```typescript
window.electron.voice = {
  // ─── TTS ───
  /** 合成语音，返回音频 ArrayBuffer */
  synthesize(text: string, options?: TtsOptions): Promise<ArrayBuffer>
  /** 测试 TTS 配置是否有效（合成一句测试音频） */
  testTts(config: VoiceConfig): Promise<void>

  // ─── STT ───
  /** 上传音频并转录，返回识别文本 */
  transcribe(audioBlob: ArrayBuffer, options?: SttOptions): Promise<string>
  /** 测试 STT 配置是否有效 */
  testStt(config: VoiceConfig): Promise<string>

  // ─── 配置 ───
  /** 获取当前语音配置 */
  getConfig(): Promise<VoiceConfig>
  /** 保存语音配置 */
  saveConfig(config: VoiceConfig): Promise<void>
}
```

#### 事件接口

渲染进程通过 `window.electron.voice` 暴露的方法主动调用，播放/录音状态由渲染进程自行管理（因为播放和录音都在渲染进程），无需主进程推送事件。

> 注：与规格初稿不同，最终确认播放和录音均在渲染进程完成，因此播放/录音状态由 renderer 的 voice store 管理，无需 IPC 事件。主进程仅负责 API 调用（TTS 合成 / STT 转录）。

---

## 7. 验收标准

### V1 - 基础语音功能

| 编号 | 验收项 | 标准 |
|------|--------|------|
| V1-01 | 语音配置 | 设置页有语音标签页，TTS 和 STT 可独立配置，保存后生效，支持测试连接 |
| V1-02 | TTS 播报 | 点击消息播放按钮可播放语音，可暂停/继续/停止 |
| V1-03 | 流式播放 | 流式回复时按句子切分逐句合成，首句播放延迟 < 3s |
| V1-04 | STT 输入 | 点击麦克风按钮录音，停止后识别文字自动填入输入框 |
| V1-05 | 播放控制 | 底部播放条显示进度，可调音量和播放速度 |
| V1-06 | 实时语音模式 | 一键进入语音模式，VAD 检测说完自动发送，回复自动播报 |
| V1-07 | 错误处理 | API 调用失败有明确错误提示，不影响文本对话功能 |
| V1-08 | 边界情况 | 无麦克风权限、网络失败、录音超时等边界场景均有合理处理 |

---

## 8. 边界情况处理

| 场景 | 处理方式 |
|------|----------|
| 无麦克风权限 | 首次点击录音时请求权限；被拒绝时显示弹窗，引导用户在系统设置中开启麦克风权限 |
| 网络请求失败 | 显示错误 toast，说明失败原因（网络错误 / API Key 无效 / 模型不存在等），自动回退到文本模式，不影响对话 |
| 音频格式不支持 | 自动降级为 mp3 格式重试；仍失败则提示用户更换格式 |
| 录音超时（>5min） | 自动停止录音，已录制部分正常识别，toast 提示"录音已达上限 5 分钟" |
| 多条消息同时播放 | 新播放请求自动停止当前播放并替换，始终只播最新一条 |
| 应用最小化 | 语音继续播放，播放状态正常更新；录音功能保持可用 |
| 配置不完整 | 语音按钮置灰，hover 显示 tooltip "请先在设置中配置语音模型" |
| 音频设备被占用 | 录音失败时提示"麦克风被其他应用占用"，建议关闭占用程序后重试 |
| 文本过长 | 超过 TTS 单条限制（通常 4096 字符）时自动分段合成，分段播放 |

---

## 9. 与现有功能的关系

- **对话系统**：语音是对话的输入输出增强，不改变对话核心逻辑
- **设置系统**：在 SettingsView 新增 "语音" 标签页
- **消息列表**：在 MessageItem（助手消息）增加播放按钮
- **聊天输入**：在 ChatInput 增加麦克风按钮
- **全局状态**：新增 voice Pinia store，管理播放/录音/语音模式状态
- **标题栏**：新增语音模式切换按钮

---

## 10. 实现状态（2026-07-26）

### 10.1 已完成模块

| 模块 | 对应任务 | 文件路径 | 说明 |
|------|----------|----------|------|
| 类型定义 | V1-00 | `src/shared/types.ts` | VoiceConfig / TtsConfig / SttConfig / VoiceModeConfig / TtsOptions / SttOptions / TtsPlayState / SttRecordState / VoiceModeState / TtsPlayProgress / SttRecordProgress |
| 数据库 | V1-01 | `src/main/db/schema.sql` | app_settings 新增 voice JSON 列，含默认值 |
| 语音设置页 | V1-01 | `src/renderer/src/components/Settings/VoiceConfig.vue` | TTS/STT/模式 三区块配置 + 测试按钮 |
| TTS 服务 | V1-02 | `src/main/services/tts-service.ts` | 基于 OpenAI SDK 的语音合成，支持多模型/音色/语速/格式 |
| STT 服务 | V1-05 | `src/main/services/stt-service.ts` | 基于 OpenAI Whisper 的语音识别，支持多语言/温度 |
| 语音 IPC | V1-02/V1-05 | `src/main/ipc/voice.ts` | 4 个 IPC channel：tts-synthesize / tts-test / stt-transcribe / stt-test |
| Preload | V1-02/V1-05 | `src/preload/index.ts` | voice 命名空间暴露到渲染进程 |
| 设置 Store | V1-01 | `src/renderer/src/stores/settings.ts` | updateVoice 方法支持深度合并 |
| 语音 Store | V1-03/V1-06/V1-07 | `src/renderer/src/stores/voice.ts` | TTS 播放 / STT 录音 / 流式播放 / 实时语音模式 |
| TTS 播放器 | V1-03 | `src/renderer/src/utils/tts-player.ts` | HTMLAudioElement 封装，支持队列/进度/音量/语速 |
| STT 录音器 | V1-05 | `src/renderer/src/utils/stt-recorder.ts` | MediaRecorder 封装，支持 VAD 音量检测/时长/波形 |
| 消息播放按钮 | V1-03 | `src/renderer/src/components/MessageItem/VoicePlayButton.vue` | 助手消息气泡中的播放/暂停按钮 |
| 语音输入按钮 | V1-06 | `src/renderer/src/components/ChatPanel/VoiceInputButton.vue` | 输入框麦克风按钮，录音+转写+发送 |
| 语音模式开关 | V1-07 | `src/renderer/src/components/ChatPanel/VoiceModeToggle.vue` | 实时语音模式开关，状态指示 |
| 全局播放控制 | V1-08 | `src/renderer/src/components/VoiceControlPanel.vue` | 固定底部播放条，进度/音量/语速/停止 |
| 流式播放 | V1-04 | `src/renderer/src/stores/chat.ts` + voice store | 按句子切分流式文本，边生成边合成边播放 |
| 实时语音模式 | V1-07 | `src/renderer/src/stores/voice.ts` | VAD 检测 + 免提交互 + 状态机（awaiting/listening/transcribing/speaking） |

### 10.2 错误码

| 错误码 | 说明 |
|--------|------|
| `VOICE_TTS_ERROR` | TTS 语音合成错误 |
| `VOICE_STT_ERROR` | STT 语音识别错误 |
| `VOICE_MIC_PERMISSION` | 麦克风权限不足 |

### 10.3 待优化项

- [ ] VAD 算法可替换为更精确的 WebRTC VAD 或 Silero VAD
- [ ] 流式播放的句子切分可优化（支持更复杂的标点规则）
- [ ] 语音模式下的打断功能（用户说话时打断 AI 播报）
- [ ] 唤醒词支持（"你好 AgentForge"）
- [ ] 本地离线 TTS/STT 支持
- [ ] 多音色切换与收藏

