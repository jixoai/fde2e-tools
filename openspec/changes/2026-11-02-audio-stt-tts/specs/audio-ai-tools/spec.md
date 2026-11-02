# 本地语音工具分发与引擎装载规格增量（ADDED）

> 归属 capability：`audio-ai-tools`（新建）。不修改既有 static-tools-hosting
> 语义；「未来动态代理类功能必须带认证立项」红线不受影响——模型分发是纯静态
> 文件 + 既有 GH 加速链，不新增服务端。

## ADDED Requirements

### Requirement: 浏览器本地推理（零云端红线）

stt/tts 两站的一切语音能力 SHALL 在用户浏览器内完成（WebGPU/WASM），不将
音频/文本上传任何服务端；引擎与权重经静态 CDN/自建源分发。页内 SHALL 明示
「本工具本地运行，音频不离开你的设备」。

#### Scenario: 断网仍可用（已缓存模型）

- **WHEN** 用户已缓存某模型权重后断网使用
- **THEN** 转写/合成功能不因网络不可用而失败（禁强制在线探测）

#### Scenario: 权重不入仓

- **WHEN** 审计本仓 git 历史与工作树
- **THEN** 无 >50MB 模型文件入库；权重只存在于 `deploy/models-fetch.sh`
  按 manifest 钉版本拉取的 gitignore 目录与部署物中

### Requirement: 模型 manifest 单源与 sha 门

每模型 SHALL 在 manifest 中登记：`{modelId, engine, files:[{path,bytes,
sha256}], sources, licenseTag, notice, minDeviceTier}`。线上下载 SHALL 一律
携带 `expectedSha256`（缺 sha 即上线被 lint 拒绝）；三面对表
（manifest ↔ 下载器门 ↔ 页内 ai-guide 展示体积/许可）。

#### Scenario: sha 不符 fail-closed

- **WHEN** 下载完成校验得出 mismatch
- **THEN** 不落权重入缓存（沿用 downloader-core 三态门语义），任务呈现
  failed 并可重试

#### Scenario: 页面展示与 manifest 一致

- **WHEN** 绿门运行
- **THEN** 页内引用的模型体积/许可标签与 manifest 逐条相等（脚本断言）

### Requirement: 多源并发下载（复用 fde2e-downloader-core）

模型权重下载 SHALL 复用 `fde2e-downloader-core` web 轨道（vendor IIFE，
单源 semantic 基线：4MiB×6×cap3/断点续传/长尾迁移/sha256 三态），源池为
**模型源池**（替换包内默认 GH 白名单语义）：自托管同源（默认源与最终
兜底）、ModelScope 解析直链、HF 官方直链（海外可选）。ghproxy 族 SHALL
只作人肉下载/运维 seed 备选，禁入运行时源池（其无 CORS——浏览器 fetch
可用性为零；且 `ghfast.top` 对 k2-fsa 拉黑、公益服务无 SLA）。npm/
npmmirror 通道 SHALL 只承载 <10MB「功能性 JS 包附带」附件（VAD/voices/
词典），禁为权重新发 npm 包或纯权重包（npm 条款「不得当通用数据库」）。
下载 UI SHALL 提供分片级进度与暂停/恢复；断点续传与缓存被清后的重下
提示 SHALL 落实。

#### Scenario: 多源并发与择源

- **WHEN** 源池 ≥2 源可达下载 ≥20MB 模型文件
- **THEN** 同时出现 ≥2 源活跃分片；慢源被 EMA 惩罚、快源承接长尾迁移
  （downloader-core 既有语义，不重写调度）

#### Scenario: 断点续传

- **WHEN** 下载进行到 ~50% 中止（网络断/页面关）后回来点继续
- **THEN** 已收分块计入进度、仅补缺块；产物 sha256 校验 match

### Requirement: 模型分发路由（国内可达优先）

分发路由 SHALL 按「国内默认序」编排，仓库只落 manifest 与 seed 脚本，
seed 动作归编排者侧执行：权重先经 ModelScope 解析直链/GH Releases 钉
版本拉取进自托管（`deploy/models-fetch.sh`），运行时一律自自托管/或
ModelScope 取数；GH Releases 仅作上游存档（其 `.tar.bz2` 需 bzip2 解包，
不宜浏览器直取）；同文件 SHALL 保 ≥2 个可用源（ModelScope 第三方镜像有
被删风险，自托管兜底是底线）。自托管 nginx SHALL 落实 Range 与跨域：
`sendfile on`、模型路径禁 gzip、CORS/Expose-Headers 恒发、反代上游
`proxy_force_ranges`＋`proxy_max_temp_file_size 0`、防滥用四件
（max_ranges/limit_conn/limit_rate 阶梯/防盗链）。hf-mirror.com SHALL
仅作开发期备胎，禁入生产 manifest。

#### Scenario: manifest 不含被禁渠道

- **WHEN** 审计 manifest sources 字段
- **THEN** 不出现 huggingface.co 作为国内用户默认源（海外可选保留），不
  出现 hf-mirror.com；不出现 ghproxy 族域名（ghproxy 族只能在非运行时文档/运维手册中引用）

### Requirement: 许可白名单（硬门）

两站可收录的模型/引擎 SHALL 全部落在宽松许可白名单内；禁入清单与审计
口径以 Scenario 为准。带可选义务的白名单项（CC-BY-4.0 署名、FunASR 系
Apache/自定义 MODEL_LICENSE 并存、OpenRAIL-M）SHALL 落 NOTICE/署名，
且 FunASR 系被法务否决时 SHALL 回落 Dolphin base int8（Apache-2.0）。

#### Scenario: 禁入清单（逐项审计口径）

- **WHEN** 审计仓库依赖/加载面/部署物
- **THEN** 不出现以下任一项：espeak-ng 数据/wasm 与内嵌它的默认包树
  （kokoro-js 默认包、npm phonemizer，GPL-3.0）；Piper 官方 piper1-gpl
  与 piper-phonemize（GPL，且 zh 音色数据许可 Unknown）；Moonshine
  非流式非英语包（Community License NC：Arabic/Japanese/Korean/
  Mandarin/Spanish/Ukrainian/Vietnamese）；F5-TTS / Spark-TTS /
  OuteTTS-0.2 / Canary-1b 权重（CC-BY-NC 系）；Matcha zh-baker
  （训练数据 NC）。

#### Scenario: sherpa 部署物不带 espeak

- **WHEN** 检查任一部署 dist／vendor 目录
- **THEN** 不存在 `espeak-ng-data/` 与 piper-phonemize 组件；sherpa-onnx
  版本 ≥ 2026-10-20（espeak 移除后）

#### Scenario: NOTICE 署名齐全

- **WHEN** 用户展开任一模型的「来源与许可」段（ai-guide 内）
- **THEN** 可见模型许可名、来源仓库/模型卡 URL、以及该模型适用的额外
  声明（CC-BY 署名/FunASR 双声明）

### Requirement: 引擎双轨与设备分层（能力探测，非身份枚举）

STT/TTS SHALL 按引擎双轨装载、按能力探测分档下发（不做 UA/身份枚举），
档位与体积在页内如实展示（含「桌面基准 RTF，实际以本机为准」的口径声明）。
具体档位分配：STT 默认引擎 `@huggingface/transformers`（MIT，npm 引用，
Whisper 全系＋时间戳＋多语——WebGPU 档 `navigator.gpu` 存在且 runtime
创建成功＝`whisper-large-v3-turbo q4f16` ≈0.5GB，仅 WASM＝whisper-base
q8/q4f16 ≈90MB 兜底，能力不足＝单文件 q8 最小档）；STT 中文优先档
sherpa-onnx WASM＋SenseVoice-Small int8（228MB，中粤英日韩＋情绪/事件标签）；
TTS 主力 sherpa-onnx WASM＋Kokoro v1.1-zh int8（≈157MB，100 中文音色
zf_001…zm_100、24kHz、中英混说），Kokoro v1.0 ONNX（英文 54 音色）为
英文默认可选项。

#### Scenario: 无 WebGPU 设备

- **WHEN** 用户在不支持 WebGPU 的浏览器打开 STT
- **THEN** WebGPU 大模型档不可见/不可选（能力探测隐藏），WASM 小档可用

#### Scenario: iOS 不载大模型

- **WHEN** 在 iOS Safari（未达 Safari 26 能力）打开两站
- **THEN** 全部大模型档（WebGPU 档、sherpa SenseVoice/Kokoro 全量）按
  minDeviceTier 排除，仅呈现小模型；页面明示「iOS 建议桌面使用」
  （非 UA 分支，以能力缺失为判据）

### Requirement: 长音频分片与显存回落

长音频转写 SHALL 分片处理＋定期重建 pipeline（transformers.js#1739 GPU
泄漏防御）；WebGPU 档 SHALL 维持「显存不足自动回落 WASM 小档」路径——
回落只以运行时失败信号为判据，不做设备型号枚举。

#### Scenario: 长音频不拖垮页面

- **WHEN** 转 ≥30 分钟音频（WebGPU 档）
- **THEN** 分片推进且 GPU 进程内存保持有界（重建点可视），不出现页面崩溃

#### Scenario: 显存不足回落

- **WHEN** WebGPU 档初始化失败（设备丢失/显存不足）
- **THEN** 自动回落 WASM 小档并提示「已切换兼容模式」

### Requirement: 转写产物＝带时间轴的 TranscriptDoc（单源投影）

转写产物 SHALL 是规范化 **TranscriptDoc**（canonical 单源，秒制浮点，
含 segments/words/language/engine/model 字段），UI 段列表、导出面、
WebMCP 返回值 SHALL 全部从它投影。导出 SHALL 支持 TXT/SRT/VTT/JSON/复制
全文，SRT/VTT 生成 SHALL 过边界处理规范（细节与实现参照见产品对标
research.md §8：Verbatim/Subtitler 形态，不 fork whisper-web）。

> 许可注：抄写形态的参照（Verbatim MIT / Subtitler BSD-3 / parakeet.js
> MIT）保留 attribution；vtt-editor-pro（CC BY-NC）与 Whishper（AGPL）
> 禁抄码只看交互。

#### Scenario: 时间轴导出

- **WHEN** 用户点击导出 SRT/VTT/JSON/TXT 任一格式
- **THEN** 下载文件名符合 `<站id>-<格式>。<ext>` 契约，SRT 用逗号毫秒、
  VTT 以 `WEBVTT` 头开始且 cue 文本内 `-->` 已转义，JSON 可回放还原段表

#### Scenario: 段级播放同步

- **WHEN** 音频播放中/用户点击任一段
- **THEN** 当前段高亮＋自动滚动（悬停列表暂停跟随），点击段跳播对应时刻；
  实现形态＝原生 `audio.currentTime`＋RAF＋二分查找＋DOM class
  （禁把 60fps 走 React state）

#### Scenario: 词级时间戳（能力可开）

- **WHEN** 该模型 `supports.wordTimestamps` 为真且用户开启词级
- **THEN** TranscriptDoc.words 由 `return_timestamps: "word"`（Whisper 系）
  或 token timestamps（SenseVoice/sherpa 系）填充，JSON 含词级；
  SRT/VTT 仍用段级 cue

### Requirement: 模型能力面 supports（单源多投影，同 Provider can(x) 语义）

manifest 每模型 SHALL 登记类型化 **`supports` 能力对象**，四个投影
（UI 显隐与范围 / WebMCP schema / URL 参数 / 运行时 reconcile 校验）
SHALL 全部由它单源驱动，有则亮、无则藏，禁假控件与静默忽略。

> 具体字段面（speed 范围对象/inlineTags 句法枚举/emotionScalar 中性点/
> voices 元数据……）与先例（sherpa ttsInstanceInfo/Inknarrate CAPS）见
> research.md §8；WebMCP 能力查询落地形态与 shared/webmcp 的
> schemaFromUrlParams 同思路。

#### Scenario: 假控件禁令

- **WHEN** 某 TTS 模型不支持 inlineTags（如 Kokoro 全系——已核实 v1.0/
  v1.1-zh 均无情绪标签）而用户在看该模型档
- **THEN** 语气词/风格面板不渲染（不是 disabled 灰置——能力未命中即不占
  位）；该模型的 WebMCP schema 与 URL 契约同样不接受 style 类参数

#### Scenario: 声明与实测不符

- **WHEN** 引擎加载后实测音色数/语言集与 manifest 声明不一致
- **THEN** UI 按实测降级（隐藏不存在项）并标注 degraded，日志里留
  mismatch（禁让用户见过期声明直接裸奔）

### Requirement: TTS 长文本流式与播放调度

TTS 长文本 SHALL 按「切句（稳定 ID＋长度安全）→ 引擎增量回调 →
AudioBuffer 时钟链无缝调度」管线**边生成边播**；生成任务 SHALL 可取消
（requestId＋abort）；句级结果 SHALL 按 hash(text+voice+speed+model 版本)
缓存以支持逐句重生成。调度参数形态（prime/lookahead/underrun）与引擎
约束（Kokoro 510 音素上限、rushing 特性）见 research.md §8。

> 实现参照：pocket-tts-js（MIT）StreamingPlayer；Inknarrate（GPL-3.0）
> 只抄思路不抄码。

#### Scenario: 边生成边播

- **WHEN** 用户对 2000 字长文点开始合成
- **THEN** 首句生成完即开始播放，后续句无逢衔接（prime 缓冲），全程
  可暂停/可取消；生成与播放状态分离展示

#### Scenario: 逐句重生成

- **WHEN** 用户仅修改文中一句后点重新合成
- **THEN** 未变化的句子命中缓存不重推，仅变更句重推并按稳定 ID 回填
  （音频与文本状态不漂移）
