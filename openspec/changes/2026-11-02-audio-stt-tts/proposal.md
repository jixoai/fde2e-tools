# change: audio-stt-tts（浏览器本地语音转文字 + 文字转语音）

> 选型依据：`openspec/changes/2026-11-02-audio-stt-tts/research.md`（STT/TTS/
> 基建三路调研 + 国内分发渠道调研，全部结论带一手来源，截至 2026-11-01/02）。

## Why

Owner 需求（2026-11-01）：在 fde2e-tools-v0 增加两个基础工具——**音频转文字
（STT）**与**文字转语音（TTS）**——利用 Web 生态（WebGPU/WASM），按用户电脑
配置把当前最优质的开源模型跑在浏览器里，**完全本地化、零云端**（红线：全静态
零后端）。两工具暂不涉及音频编辑。

选型调研核心结论（详见 research.md）：

1. **双引擎是唯一同时满足体验与许可的架构**：
   - `@huggingface/transformers` v4.3+（MIT，npm 直装）——STT 通用档：Whisper
     全系现成 ONNX、WebGPU 成熟（v4 runtime C++ 重写）、多语；中文档之外所有
     STT 场景走它。
   - `sherpa-onnx` WASM（Apache-2.0，2026-10-20 起 GPL-free；无官方浏览器
     npm，需仓内自建 emscripten 产物并 vendor）——STT 中文优先档（SenseVoice
     int8）+ TTS 全线（Kokoro v1.1-zh 等）；模型覆盖最广。
2. **许可红线第一**：kokoro-js 默认包（内嵌 espeak-ng GPL-3.0）、Piper 官方
   （已转 GPL-3.0+中文音色数据许可 Unknown）、Moonshine 中文包（NC）、
   F5/Spark/OuteTTS-0.2（NC）等一律禁入（清单见 research.md §许可红线）。TTS
   中文主力＝**Kokoro v1.1-zh（Apache-2.0，100 中文音色）经 sherpa-ionnx 的
   lexicon G2P 干净路线**。
3. **性能档位按设备能力分层**（能力探测下发，不做身份/UA 枚举）：WebGPU 可用
   → STT 上 `whisper-large-v3-turbo q4f16`（≈0.5GB）；仅 WASM → `whisper-base
   q4f16`（≈90MB）；iOS/移动端 → 单文件 q8 小模型（iOS 单模型内存 ≳0.75GB 会
   被系统杀，实证 transformers.js#1827）。
4. **分发与下载复用 center 的既有内核**：`fde2e-downloader-core`（npm
   `fde2e-downloader`，主仓单源 OIDC 发版）承载模型权重的多源并发分片下载
   （4MiB×6×cap3/断点续传/sha256 三态门/IDB 块仓），Owner 2026-11-02 指令：
   「把我们 center 的分片下载技术拿去用，有封装，用起来应该很快」——已核实
   `opts.sources` 可注入自定义源池、noRange 自动降级单请求，对非 GH 直链的
   模型文件同样成立（web.ts IIFE bundle 形态可 vendor 复用）。

## What Changes

### 新工具两站（registry 加两条 + apps/ 新建）

- `apps/audio-stt/`（`stt.tool.fde2e.com`）：音频文件/麦克风 → 本地转写文本。
  引擎分层：transformers.js（Whisper 全系，多语+时间戳）为默认；sherpa-onnx
  （SenseVoice-Small int8，中粤英日韩+情绪事件标签）为中文优先档；麦克风实时
  （v2）走 AudioWorklet PCM + Silero VAD 切句（MIT，0.64MB）。
  - WebMCP：`transcribe_audio`（结构化参数型：audioUrl 或页内 input + 语言/
    模型选项）与可枚举 `list_models`。
- `apps/audio-tts/`（`tts.tool.fde2e.com`）：文本 → 本地合成音频（wav/pcm
  下载）。引擎：sherpa-onnx + Kokoro v1.1-zh（100 中文音色、24kHz、中英混说，
  首选 int8 ≈157MB 包）；Kokoro v1.0（英文 54 音色）与 Pocket TTS（英文轻量
  克隆，MIT+CC-BY-4.0）为英文档备选；长文本按标点切句流式拼接（sherpa 句切
  5/20 词基准）+ AudioBuffer 时钟链 gapless 播放。
  - WebMCP：`create_speech`（文本/音色/语速 → 下载 wav）与 `list_voices`。

### 共享基建（packages/ 新建 + shared 扩展）

- `packages/audio-engine/`：本仓音频引擎装载层——双引擎装配（transformers.js
  npm 依赖 + sherpa-onnx wasm 产物 vendor）、设备能力探测（WebGPU 现实性/门
  与回落）、模型清单（manifest：id/name/文件字节数/sha256/源清单/许可标签）、
  Cache API 缓存层（transformers.js 默认路径统一走它）。
- 模型权重**不入仓**（.gitignore，禁 >50MB 文件进 git），由
  `deploy/models-fetch.sh` 按 manifest 钉版本拉取到 dist 外挂目录随一次部署
  上传（服务器 `/www/tools/models/`，编排者侧 vhost）。
- 下载内核复用：vendor `fde2e-downloader-core` web bundle（esbuild IIFE，
  `fde2e/packages/downloader-core/src/web.ts` 单源），自建 **模型源池**
  （CF 边缘 + 阿里云反代 + 服务器直连兜底，见分发路由）替代包内默认 GH 白名
  单源池；下载进度 UI 用 shadcn 官方组件收编形态。
- dev 端口：stt 5281 / tts 5282（沿用既有 5271-5280 顺延；仅回环，不进 frp
  段）。

### 分发路由（Owner 2026-11-02 指令：国内间接渠道；三层四源，实测定案）

- **自托管同源**（`stt/tts.tool.fde2e.com/models/`，OpenResty CORS＋
  Range＋sendfile）：**默认源与最终兜底**。权重经 `deploy/models-fetch.sh`
  按 manifest 钉版本从 ModelScope/GH Releases 拉取（不入仓）。
- **ModelScope 解析直链**：国内运行的**第一外源**——专项实测
  （2026-11-01）确认 `resolve` 链浏览器可达：CORS `*` ＋ Range 206 ＋
  境外出口实测 ~10MB/s（比 ghproxy 快两个数量级）；中文生态仓收录齐全
  （onnx-community/Kokoro-82M-v1.1-zh-ONNX、chatterbox-ONNX、
  whisper-base、iic/SenseVoiceSmall 均在）。
- **GH 官方 Releases**（sherpa-onnx `asr-models` 498 资产/`tts-models`
  646 资产，kokoro v1.1 int8 147MB 等）：**上游存档与运维 seed 位**——
  （注意 `asr-models` tag 已在 1000 资产触顶边缘）——单资产 <2GiB 可用，
  但 `.tar.bz2` 浏览器解包成本高、release 域无 CORS（fetch 不可用），
  不进运行时源池；ghproxy 族（ghproxy.net 可断点、ghfast.top 已拉黑
  k2-fsa 仓库、gh-proxy.com 大 Range 退化 200）只作**人肉下载备选**，
  禁入运行时。
- **npm/npmmirror**：只承载 <10MB 附件（@ricky0123/vad-web 内含
  silero_vad onnx 是合规先例；纯权重包触发 npm「不得当通用数据库」条款
  有下架风险）；npmmirror 走 tarball 地址（CORS+Range 实测过），`files/`
  白名单路径不经白名单库。
- **HF 官方直链**：海外用户可选项；国内不作默认源。hf-mirror 禁入生产。
- **下载协议**：全部经 downloader-core（多源并发＋断点续传＋sha256 门），
  manifest sources 带 cors/range/size/sha 能力标记；nginx 要点
  （sendfile/禁 gzip/Expose-Headers 206/max_ranges/limit_*）落
  research.md §5。

### 许可与合规

- 仓库主体（Apache-2.0）内**禁入**：espeak-ng 数据/wasm（GPL）、kokoro-js
  默认包、Piper 官方 piper1-gpl、piper-phonemize、Moonshine 中文/多语 NC 包、
  Matcha zh-baker（数据 NC）、F5-TTS/Spark-TTS/OuteTTS-0.2（NC 权重）、
  Canary-1b（NC）。白名单模型的外加许可义务按 NOTICE 逐条落（CC-BY-4.0 署
  名、OpenRAIL-M 如用 Supertonic 等）。
- sherpa-onnx 部署内核必须 ≥2026-10-20 版（espeak-ng 已移除）；部署物
  **禁带** `espeak-ng-data` 目录与 piper-phonemize 组件。
- SenseVoice/Paraformer 系（FunASR 生态）许可表述不一致
  （Apache-2.0/MIT/自定义 MODEL_LICENSE 三种并存）——**gate：上线前 NOTICE
  附双声明（模型卡声明 + 仓库 LICENSE 链接）**；若法务否决，中文档回落
  Dolphin base int8（Apache-2.0，80MB，40 语含中）。
- 每站页内 ai-guide 增「模型来源与许可」段（用户可见，与 NOTICE 单源）。

### 绿门扩展

- 既有：`pnpm -r check && pnpm -r build`；`pnpm webmcp:check`（两新站枚举
  + executeTool 往返）；`pnpm smoke:check`（参数契约冒烟）。
- 新增：
  - `interface-lint.mjs` 纳入两站 WebMCP 工具断言（items 选择器/schema
    additionalProperties=false/ok:false 带 error）。
  - **真推理冒烟（非模型出真值）**：headless Chromium 带 WebGPU flag +
    本地权重 seed，对 whisper-base 与 Kokoro v1.0/1.1-zh 各跑一次真实转录
    /合成往返产物断言（写 .wav → 解析头/字节级校验；写文本 → py 断言含关键
    词），不依赖网络拉权重。
  - **下载分片冒烟**：downloader-core + 自建源池走一次真实分片下载往返
    （断点续传模拟：中断→恢复→sha256 match）——200MB 级文件用截断假模型
    断言协议，不跑全量下载。
  - 黄页卡片 +6（两工具卡 +ai-guide 许可段可见断言），存量断言零缩水。

## Non-Goals

- 不做音频编辑（裁剪/混音/降噪——Owner 明示暂不涉及）。
- 不做音色克隆的增值闭环（Pocket TTS/Chatterbox 克隆能力仅注册为模型档位，
  不做克隆体验专页；Chatterbox 1.5GB 大模型档最后排、POC 后再定）。
- 麦克风实时转写（Zipformer 流式/Paraformer 流式）为 v2 排程（worktree 后续
  批次），本 change 先做文件转写与 TTS。
- 不新增 frp/frps 段端口、不引入任何服务端进程；模型分发只用既有 OpenResty
  静态托管与既有 GH 加速链（CF-edge/阿里云反代）。
- 不为模型权重新发 npm 包（npmmirror 同步不可控风险，且 CDN 大文件策略在
  external 接口处不被我们掌控）。

## 自己的风险与已知不确定（诚实声明）

- **sherpa-onnx 无官方浏览器 npm**：需仓内维护 emscripten 构建产物
  （wasm ≈10MB + js）；模型 preload `.data`（官方 199MB 形态）不适合我们——
  需研究 fetch→MEMFS 动态装载路径（CMake 有 FORCE_FILESYSTEM 允许，无官方文
  档，属 POC 项）。
- **浏览器 RTF 无公开基准**：桌面 sherpa RTF 表全为原生多线程；浏览器单线程要
  按 2-4× 折扣预估；POC 必须实测三设备（M 系 + 中低端 Win + 一台手机）。
- **WebGPU 泄漏 bug 未修**：transformers.js#1739（每 30s 分片泄漏 ≈650MB）；
  长音频必须分片 + 定期重建 pipeline。
- **iOS 独立风险面**：Safari 26 才有 WebGPU + AudioDecoder；单模型 ≳0.75GB
  内存被杀；模型下载用 Range 才可断点续传——iOS 直接降级 q8 小模型。
- **transformers.js 多线程要 COOP/COEP**：黄页是 iframe 嵌生产域架构，需
  配套 CORP 协同——实现批次时必须与黄页预览路径一起过一遍（fc worktree
  冒烟 + 生产域验收真机）。

## 落地与验收顺序（实现批次的次序，不由本 change 决定）

1. packages/audio-engine + 分发路由 + downloader 集成 + deploy/models-fetch
   （基建先行，无 UI 也可被 STT/TTS 复用）。
2. TTS 站（Kokoro v1.1-zh int8 单模型档最小闭环：输入文本 → 选音色 → 试听
   /下载 .wav；绿门真推理冒烟 + ai-guide）。
3. STT 站（whisper-base q8 WASM 兜底 + whisper-large-v3-turbo q4f16 WebGPU
   档 + SenseVoice 中文档；文件转写最小闭环）。
4. 黄页收编 + 状态行/进度 UI 全链 manifest 对表 + 真 E2E（录屏级走查，证据
   落 `.agents/reports/tools/<change>/`）。

## 依赖的既有 change/裁决

- project-bootstrap（全静态红线、CORS/COOP 纪律）。
- downloader-core-shared（downloader-core API 冻结面）。
- c-d-batch-interface（WebMCP 工具命名/错误形态/结构化 schema 规范）。
- ui-experience-gate（新站 UI 验收门）。

## 影响面

- 新增两 app + 一共享包 + registry 两卡；既有七 app 与三编辑站零改动。
- 服务器新增静态目录 `/www/tools/models/`（编排者侧 vhost + CORS 头）。
- 绿门脚本增 POC 冒烟文件（scripts/）。
