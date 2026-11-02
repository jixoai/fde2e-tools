# audio-stt-tts 选型调研（记录于 2026-11-01/02）

> 本文是 change 的选型依据存档：三路并行网络调研（STT / TTS / 托管基建）
> ＋ Owner 追加的「国内模型获取渠道」调研（§5）。全部关键结论带一手来源；
> 「桌面 RTF」均官方文档口径，**浏览器实测基准目前基本空白，实现批次 POC
> 必须回填**（tasks 6.2）。

## 0. 结论图

```
                    浏览器本地语音工具（零云端）
                    ┌───────────────┬───────────────┐
                    │ STT 转写      │ TTS 合成      │
                    └──────┬────────┴──────┬────────┘
              双引擎（一次基建养两个工具）
        ┌───────────────┴───────┐ ┌─────┴─────────────┐
        │ transformers.js v4.3+ │ │ sherpa-onnx WASM  │
        │  MIT, npm 直装        │ │  Apache-2.0*      │
        │  WebGPU 成熟(C++)     │ │  GPL-free(≥2026-  │
        │  Whisper 全系现成ONNX │ │   10-20), 无官方   │
        ├───────────────────────┤ │  浏览器npm→仓内自建│
        │ whisper-tiny/base    │ ├───────────────────┤
        │  .en q4f16 55/90MB   │ │ TTS: Kokoro       │
        │ whisper-large-v3-    │ │  v1.1-zh int8     │
        │  turbo q4f16 ≈0.5GB  │ │  ≈157MB 100音色   │
        │  (WebGPU 档)         │ │ STT中文: SenseVoice│
        │ Moonshine-Base(英流式)│ │  int8 228MB       │
        ├───────────────────────┤ │ Zipformer流式(v2) │
        │ Silero VAD 0.64MB    │ └───────────────────┘
        └───────────────────────┘
分发：fde2e-downloader-core 多源分片下载（复用 center 内核）
     自托管同源主源 + CF-edge/阿里云反代（GH releases 资产）+ 服务器直连
```

## 1. STT 引擎对比（2026-10 版本口径）

| 引擎 | 版本 | WebGPU | 模型覆盖 | 许可 | 关键问题 |
|---|---|---|---|---|---|
| @huggingface/transformers | 4.3.2（10-27） | ✔（v4 C++ 重写，Safari 26 起） | Whisper 全系/Moonshine/Parakeet(CTC)/Voxtral | MIT | 无内置幻觉抑制（须应用层补）；GPU 泄漏 #1739 未修；多线程须 COOP/COEP |
| sherpa-onnx WASM | 2.0.1（10-26） | ✘（issue #3665 open） | 覆盖最广：Whisper/SenseVoice/Paraformer±流式/Zipformer 流式/Qwen3-ASR/FireRedASR2/Dolphin/Omnilingual/Nemotron 流式… | Apache-2.0 | **npm 包只有 Node 版**；浏览器须自建 emscripten 产物；单线程 SIMD（2026-08 起 pthread 禁用） |
| whisper.cpp WASM | 1.9.5 | ✘ | 仅 Whisper（≤small、Greedy、≤120s） | MIT | 上限写死在 README，无 WebGPU，无采用必要 |
| ort-web 直连 | 1.31.1 | ✔(experimental) | 任意 ONNX（全要自写：mel/tokenizer/解码/时间戳） | MIT | 工程量最大，ROI 低于 transformers.js |
| Web Speech API | — | — | 浏览器引擎 | 非开源 | **默认云端识别**（MDN 原文），不算本地开源，仅作对照 |

平台事实：多线程默认福利不存在（crossOriginIsolated=require COOP/COEP，
否则静默单线程）；iOS 单模型内存 ≳0.75GB 被 WebContent 2GB 硬限杀
（#1827）。

## 2. STT 模型分档

| 档 | 模型 | 体积（量化） | 语言 | 流式 | 许可 | 备注 |
|---|---|---|---|---|---|---|
| 英轻 | whisper tiny.en/base.en | 55/90MB q4f16 | 英 | 否 | MIT | transformers.js 现成 timestamped |
| 英流式 | Moonshine Base | 81–135MB | 英 | 真·流式 | MIT | ⚠️其非流式非英文包（含 Mandarin）为 NC，禁用 |
| **中文优先** | **SenseVoice-Small int8** | 228MB | 中/粤/英/日/韩＋情绪+事件 | VAD 伪流式 | ⚠️见 §4 | 仅 sherpa；RTF 0.109（桌面 1 线程） |
| 小而净 | Dolphin base int8 | 80.7MB | 40 语含中 | 否 | Apache-2.0 | 许可最干净小模型；中文质量 POC 实测 |
| 中英流式 | Zipformer bilingual 流式 | ≈190MB int8 | 中+英 | 真·流式 | Apache-2.0 | 麦克风实时 v2 主力 |
| 多语高质量 | whisper large-v3-turbo | ≈505MB q4f16 | 99 语 | 否 | MIT | 浏览器内多语质量天花板（WebGPU 档） |
| 多语+方言 | Qwen3-ASR 0.6B int8 | 937MB | 30 语+19 中文方言 | 伪流式 | Apache-2.0 | 仅 sherpa；方言独门 |
| 超多语 | Omnilingual 300M | 292MB int8 | 1600+ 语 | 否 | Apache-2.0 | 长尾语种 |
| 不推荐 | large-v3 fp16（3.1GB OOM 高危）/ Voxtral-Mini 3B（9.4GB）/ Canary-1b（NC） | — | — | — | — | — |

## 3. TTS 引擎与模型分档

| 档 | 方案 | 体积 | 中文 | 速度口径 | 许可 |
|---|---|---|---|---|---|
| 英轻 | Pocket TTS 100M | ≈146MB | 无 | ≈6× CPU 实时、首包 200ms… (官方博客 2026-01) | 代码 MIT / 权重 CC-BY-4.0 |
| 英高保真/克隆 | Chatterbox（Transformers.js v4 官方 demo） | ≈1.5GB | 多语模型未移植 | RTF 1.30（M1 Max WebGPU） | MIT |
| **中文主力** | **sherpa Kokoro v1.1-zh int8**（+fp16 230MB） | ≈157MB | 100 音色（zf_001…zm_100，专业数据集 LongMao；非 v1.0 的 zf_xiaobei D 级家族）24kHz 中英混说 | RPi4 原生 RTF 3.19–7.64；**中文浏览器无公开基准** | Apache-2.0 全链 |
| 中英混说备选 | MeloTTS（sherpa） | 163MB | 单音色 44.1kHz | RPi4 RTF 2.52–6.73 | MIT |
| 中文上限（待移植） | VoxCPM 0.5B | ≈0.8–1.2GB | 零样本克隆 · test-ZH WER 0.93/SIM 77.2（自报） | 无浏览器基准 | Apache-2.0 |
| 不推荐 | kokoro-js 默认包（espeak GPL+中文不支持）/ Piper 官方（GPL；huayan 数据 Unknown）/ Matcha zh-baker（NC）/ vits-zh-hf（许可未声明） | — | — | — | — |

长文本工程：sherpa 内部句切（5/20 词合并规范）已有实现；播放端
AudioBufferSourceNode.start(when) 音频时钟链（禁 setTimeout/禁混钟）；句间
pad 30–80ms 可调；decodeAudioData 会重采样且不处理 encoder-delay——TTS
中间态**禁有损格式**，合成产物直接拿 PCM 构造 AudioBuffer / WAV。

## 4. 模型许可撞线的事实判定（三裁定）

1. **espeak-ng-data 打进 Apache 产物＝整体按 GPL-3.0 分发**（ASF FAQ 单向
   兼容；GNU FAQ 同可执行文件/打包 WASM 组合语汇）。sherpa-onnx 自己也
   如此裁定：issue #3731 立 → PR #4055（2026-10-20）移除 espeak-ng/
   piper-phonemize 并宣布核心 GPL-free。**本 change 引擎钉 ≥ 该版**，
   部署禁带 espeak-ng-data。
2. **FunASR 系许可表述不一致**（ModelScope 元数据 Apache-2.0 / FunASR 仓库
   自定义 MODEL_LICENSE v1.1 / SenseVoice 仓库 MIT）：采用「NOTICE 双声明
   ＋法务否决回落 Dolphin」策略。
3. **浏览器可行与否**是独立于许可的第二轴：3B/8B 级（Voxtral/Step-Audio）/
   1.5B+BigVGAN（IndexTTS2）判不可行；0.5–0.8B 区间（VoxCPM/CosyVoice2/
   Qwen3-ASR）理论可行、无官方浏览器产物的标「待移植」。

## 5. 国内模型获取渠道（专项实测定案，2026-11-01/02）

### 5.1 渠道实测表（全为直接 HTTP 实测或官方文档；速度系境外出口口径，非国内节点）

| 渠道 | 覆盖 | 速度/能力证据 | 大小/政策限制 | 判定 |
|---|---|---|---|---|
| **ModelScope `resolve`** | onnx-community/Kokoro-82M-v1.1-zh-ONNX（119 文件，model_quantized 127MB+104 voices）、chatterbox-ONNX（q4 353MB/全量 2.08GB）、whisper-base（43 文件）、iic/SenseVoiceSmall（6553 万下载）；未收录 k2-fsa/sherpa 系 | `resolve` 302→cdn-lfs-cn-1；**ACAO `*`＋206**；253MB/25s≈10MB/s | 单文件 353MB 实测可 Range；`auth_key` 链 TTL 未定测（38 分钟后仍有效） | **国内第一外源** |
| **GitHub Releases** | sherpa 官方自打包：asr-models 498 资产、tts-models 646 资产；SenseVoice int8 163MB、kokoro-int8-multi-lang-v1_1 147MB、whisper-large-v3 1068MB | 直连仅 ~10KB/s（本环境）；无 CORS（浏览器 fetch 拦），只能 a[download]/服务端 302 | 单资产 <2GiB、单 release ≤1000 资产（asr-models-qnn-binary 已 1000 触顶） | **上游存档/运维 seed 位**；`.tar.bz2` 浏览器解包成本高 |
| **ghproxy 族** | 任意 release/blob | ghproxy.net：206 可断点（实测 1.3GB 尾段）；gh-proxy.com：大 Range 退化 200 全量（不可续传）；**ghfast.top 对 k2-fsa 全部 403 拉黑**；部分域名已死（TLS 失败）或劫持（302 广告域） | 未公布，公益无 SLA | **禁入运行时源池**（无 CORS＋拉黑＋漂移）；只作人肉下载备选 |
| **npm/npmmirror** | `@ricky0123/vad-web` 包内 silero_vad onnx 2.3MB（合规先例）；sherpa-onnx npm 15.2MB 仅 wasm | npmmirror tarball 5.2MB 1.5s（3.6MB/s）**支持 Range＋CORS**；`files/` 白名单（6249 包）不在 vad/sherpa 且不支持 Range | npm 可接受内容第 4 条：**不得把 registry 当通用数据库**（纯权重包有下架风险）；实测 115MB tarball 可发布同步 | 只承载 <10MB 功能包附带件；走 tarball 地址 |
| **jsDelivr/raw** | 仅仓库内文件 | jsDelivr 2.3MB 0.67MB/s | GH 仓库文件 >100MiB 拒收、jsDelivr >20MB 不支持；npm 包 >150MB 403 | 小词典/voices 兜底 |
| **自托管 OpenResty** | 全量 | 0.8 元/GB | 防滥用自建 | **默认源与最终兜底** |
| hf-mirror.com | HF 全量 | 损坏分片前科（基建调研） | — | 禁入生产 |

### 5.2 路由定案（写进 spec）

- 运行时源池（downloader-core `sources`）：①自托管同源 ②ModelScope
  解析直链 ③HF 官方直链（海外可选）。GH releases 与 ghproxy 不进运行时。
- manifest sources 带能力标记（cors/range/size/sha256/primary-fallback），
  同文件 ≥2 可用源（他人镜像有删除风险，自托管兜底是底线）。
- 自托管 nginx 要点：Range 内置＋`sendfile on; tcp_nopush on;`（模型路径
  禁 gzip）；反代上游 `proxy_force_ranges on; proxy_max_temp_file_size 0;`
  （大文件缓存用 slice 模块，OpenResty 编译需实测）；`add_header ACAO *;
  add_header AC-Expose-Headers "Content-Range, Content-Length,
  Accept-Ranges" always;`；防滥用四件：`max_ranges`/`limit_conn`/
  `limit_rate_after 10m; limit_rate 2m;`/防盗链（重要文件可选
  secure_link 签名）。

### 5.3 调研摩擦（诚实声明）

- 本环境无国内探针，全部速度为境外出口实测（ModelScope 10MB/s、npmmirror
  3.6MB/s、ghproxy ~40KB/s），不能直接代表厦门电信/联通用户——POC 批次须
  用国内真机复测。
- ghfast.top 拉黑是黑名单还是临时风控无法判定（对其它仓库正常）；ghproxy
  生态漂移快，本报告只写当日实测。
- npm tarball 官方没有公布数字上限（"500MB"说法无一手来源），只有
  115.4MB 发布成功的经验证据。
- ModelScope 条款页是 SPA 抓不到正文；auth_key TTL 无法准确测定——生产
  使用应在运行时解析 resolve 链而非缓存长时效直链。
- Gitee AI/OpenCSG/OpenI 只确认收录形态（OpenCSG API 对 whisper-base 404、
  OpenI 401），未深挖，一句话记录不进路由。

## 6. 悬而未决（POC 必答，回填本节）

1. **sherpa WASM fetch→MEMFS 动态装载——✅ 已证可行（2026-11-02，本机 M 系）**。
   实操：上游 `build-wasm-simd-tts.sh` 的 CMakeLists 两处补丁（①去
   `--preload-file` ②`EXPORTED_RUNTIME_METHODS` 增 `FS`）后，emcc 6.0.13 构建
   出无 `.data` 形态（wasm 13.7MB + js 74KB）；运行时 `FS.writeFile` 写 8 件
   kokoro 模型（115MB，0.2-0.6s）→ `createOfflineTts` 正常创建（103 音色、
   24kHz）→ 中文合成成功。RTF 实测（M 系 WASM 单线程 int8）：2.91 / 3.02
   （两句平均 ≈3.0）；产物与构建脚本已入库（apps/audio-tts/src/vendor/sherpa/
   ＋scripts/build-sherpa-wasm.sh ＋poc-memfs-load.cjs）。preload .data 方案
   （120MB 整包预载）废弃。注意：emcc 6 非 MODULARIZE 形态在 Node import()
   下静默 abort——测试须 vm 沙箱（`__dirname`/`module` stub）或浏览器 worker
   （`importScripts` 共享词法，`self.Module` 正常生效）。
2. 浏览器侧 RTF 实测（三设备：M 系桌面 / 中低端 Win / 一台手机）——STT
   whisper-base/turbo + SenseVoice；TTS Kokoro v1.1-zh int8。
3. **transformers.js v4 WebGPU vs WASM——✅ 已实测（2026-11-02，本机 M 系
   headless Chromium + whisper-base q8）**：3 轮推理延迟 WebGPU 2982/2899/2921/
   2858ms ≈ WASM 2909/2945/2913/2932ms——**whisper-base q8 小模型上两者无实质
   差异**（模型太小，GPU 调度开销吃掉并行收益）；首载 WebGPU 1.1-3.7s vs WASM
   0.5-0.6s（WebGPU pipeline 初始化更贵）。**结论**：q8 小档以 WASM 兜底为主
   体验即可；WebGPU 档的价值在 large-v3-turbo q4f16 大模型（待后续实测回填）。
   转录质量双向验证：中文样例（zh.wav）输出「开放时间早上9点…」两路一致
   （WebGPU 出繁体——tokenizer 繁简差异，工程上无需处理，用户可见输出属正常）。
   **工程要点（部署形态关键）**：transformers.js 的 `localModelPath` 只认非 http
   路径（http URL + `local_files_only` 直接 throw，见 y$/qr 源码）——自托管
   同源部署＝把 `env.remoteHost` 指向同源 base（`{model}/resolve/{revision}/`
   模板不变，服务器 mirror 同构 HF 路径形态）。POC 脚本
   scripts/poc-transformers-webgpu.cjs 入库可复跑。
4. SenseVoice/Zipformer 中文质量与@中文音色听感盲评（Owner 参评）。
5. Kanji/misaki 路线不采信原则：无一手证据的第三方 fork（@uzen 中文
   golden 21 gap、3 stars）不进依赖，只作技术参考。

## 7. 主要来源（节选；完整清单见三路调研子代理原始报告）

- transformers.js releases/issues：#894（WebGPU vs WASM）、#1739（GPU
  泄漏）、#1827（iOS 杀进程）；npm 4.3.2 依赖 ort-web 1.31.0-dev。
- sherpa-onnx：npm 2.0.1（Node-only）/v2.0.1 releases、wasm 构建
  （build-wasm-simd-asr.sh、FORCE_FILESYSTEM）、RTF 汇总页、issue #3665
  （webgpu open）、#3731+PR #4055（espeak 移除）。
- 模型卡/量化包：onnx-community whisper 系、Kokoro-82M v1.0/v1.1-zh
  （Apache-2.0；VOICES.md D 级音色表）、SenseVoiceSmall、Dolphin、
  Qwen3-ASR、FireRedASR2、Moonshine（LICENSE 的 NC 穷举名单）、Parakeet
  （NVIDIA 博文 CC-BY-4.0 口径）。
- 许可裁定：ASF License FAQ（Apache⇄GPLv3 单向兼容）、GNU GPL FAQ
  （组合/聚合）、espeak-ng README（GPL-3.0-or-later）、piper1-gpl
  （GPL-3.0 embeds espeak-ng）。
- TTS 浏览器实证：briantung.me 2026-08 实测（Kokoro WebGPU RTF 0.105 /
  q8 WASM 2.0）、resemble-ai/transformersjs-chatterbox-demo（1.5GB）、
  kyutai pocket-tts（200ms 首包）、supertonic（99M/OpenRAIL-M）。
- 分发基建：GreatFire huggingface.co（100% 失败）、hf-mirror issues
  （66/60/68/64）、Cloudflare R2 定价与 China Network（ICP 必须）、
  阿里云 ECS 价格页（0.8 元/GB）、MDN（Cache API/Storage quota/silero）。
- 本仓实施面：packages/downloader-core/src/{engine,web,sources,types}.ts
  （DownloadOptions.sources / noRange 降级 / WebDownload.autoLand）、
  site/scripts/build-downloader-core.mjs（IIFE 单源构建+漂移门）、
  fde2e-center-v0/openspec/specs/download-transport/spec.md（语义基线）。

## 8. 产品对标（Owner 方法论裁决 2026-11-02：先找真实世界产品再动手）

两路并查（STT/TTS 各一份产品盘点，结论摘要于此；完整矩阵与逐项 Sources
见会话子代理原始报告）。

### 8.1 STT 产品结论

- **whisper-web（3344★）命中度 ~47%，不 fork**：SRT/VTT 导出 0（issue #11
  挂两年）、段级播放同步 0、词级时间戳 0（issue #43 open）、栈落后两代
  （React18/Vite4/transformers v2.7 私有 `_decode_asr`）、默认分支无
  LICENSE、实质停更两年。可偷的只有 ~300 行（双声道降混/worker 消息协议
  概念/下载进度 UI）。
- **抄写参照（许可干净）**：
  - **Subtitler（BSD-3，活跃）**——词级时间戳、段编辑（LCS+时间插值：改
    文字不掉时间轴）、当前段高亮/自动滚动/聚焦跳段、SRT/VTT、PWA、视频
    烧字幕。注意其 subtitleExport 的 VTT_SLUG 模块级累加 bug 抄逻辑时修。
  - **Verbatim（MIT，2026-10 新）**——导出面板天花板（TXT/带时 TXT/SRT/
    VTT/MD/JSON/CSV/zip/复制）+ 词/段双高亮 + click-to-seek；`export.rs`
    的 SRT/VTT 边界处理（≥0.2s、空段、`-->` 转义、end null 回退）直接
    翻成 TS。
  - parakeet.js（MIT）adapter 接口形态。
- **禁抄码只看交互**：Whishper（AGPL-3.0，自托管后端；翻译/CPS 警告/拆分
  插入段交互好）、vtt-editor-pro（CC BY-NC-4.0；波形拖段/吸附/split-merge
  UX 参照）。
- **工程决策**：导出自写 ≤120 行 formatter 不引库；段同步＝原生 audio +
  RAF + 二分 + DOM class（禁 60fps React state）；TranscriptDoc canonical
  单源（spec 已入）。

### 8.2 TTS 产品结论

- **Kokoro 全系无情绪/语气标签**（已核实 v1.0 config vocab 114 tokens、
  v1.1-zh 178 tokens、misaki en/zh 源码——无 LINK_REGEX 类 tag 面）；风格
  本质是 voice pack 的 256 维 style vector。**`[laugh]`/<laugh> 记忆来自
  ChatTTS/Orpheus/Supertonic，不是 Kokoro**。supports 面按此如实声明，
  界面禁假控件（spec「假控件禁令」Scenario 的出处）。
- **kokoro-web（3344★ Cos？无：是 Xenova 官方 demo，Apache-2.0）是两小时
  单日 demo，不 fork**：硬编码 v1.0-ONNX、无引擎抽象、无取消、无历史、
  逐句 `<audio>` ended 链（gapless 坑）。可抄 ~300 行：App 布局 +
  AudioChunk 交互 + SpeedControl 形态 + worker 消息协议（加
  requestId/cancel 后用）。
- **抄写参照**：
  - **sherpa 官方 wasm demo（Apache-2.0）**——`ttsInstanceInfo` +
    `updateUiForModelType()` 的「能力驱动显隐」先例；engine 的
    `GenerationConfig` 还暴露 phoneme/tokens 直插（v1.1-zh 的「发音修正」
    高级面）。
  - **pocket-tts-js（MIT）StreamingPlayer**——prime 0.4s/lead 0.05s/
    nextStartTime 串接/underrun 计数，无缝调度抄这个。
  - **Inknarrate（GPL-3.0，禁抄码只抄思路）**——CAPS/META/SPECS 三层能力
    对象、句级 takes（每句≤6 个 take＋per-sentence override）、hash 缓存
    键、稳定 segment ID、Transport lookahead=2。
  - Inflect zh-en（Apache-2.0）——models.json 驱动模型选择 + `/compare/`
    同句多版本并排试听；VocoLoco——generation library（replay/reuse/
    delete/download）。
- **sherpa 增量回调关键坑**：官方 wasm worker 丢弃了 samples（只传
  progress 数字）——我们必须在 callback 里 `slice()` 复制 Float32 再
  transferable postMessage；返回 0 即取消。

### 8.3 支持 → UI 的设计模式（落 spec 的 supports Requirement）

四投影单源：UI 显隐（有则亮无则藏；禁 Supertonic 式「引擎支持 UI 不
暴露」反例）、WebMCP schema（enum/min/max/default 从 supports 派生 +
只读 `get_capabilities`；WebMCP 标准无 capabilities 字段，须自加）、
URL 参数（不支持的人话报错）、运行时 reconcile（sherpa 实测 numSpeakers/
lang ≠ 声明即 degraded）。

> 溯源：本节两份原始盘点报告（STT 盘点含 whisper-web 深度解剖 2,286 行
> 逐文件审计；TTS 盘点含 kokoro-web 67KB 全量解剖 + supports schema
> 提案）由 2026-11-02 会话子代理产出，段落摘录为授权摘要，完整 Sources
> 以子代理报告为准（whisper-web/Subtitler/Verbatim/kokoro-web/sherpa
> wasm demo/pocket-tts-js/Inknarrate/Inflect/VocoLoco 等 60+ URL）。
