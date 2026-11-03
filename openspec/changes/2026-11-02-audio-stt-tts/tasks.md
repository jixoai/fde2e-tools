# Tasks: audio-stt-tts

> 执行序按 proposal「落地与验收顺序」；本清单按批次展开。
> 铁律：所有限制在 proposal 的红线上执行（全静态零后端 / 许可白名单 /
> 权重不入仓 / registry 单源 / shadcn 官方组件）。

## 1. 共享基建（packages/audio-engine + 分发）

- [x] 1.1 **audio-engine 包骨架**：`packages/audio-engine/`——双引擎装配
      （transformers.js npm 依赖按 app 懒加载 + sherpa-onnx wasm vendor 产物
      懒加载）、设备能力探测（`canWebGPU()`/`canThreads()`/iOS 判别只含能力
      语义，禁 UA 身份分支——iOS 降级判据用「Safari 26 以下能力缺失」表达）、
      模型 manifest 类型与清单常量、Cache API 统一缓存层。
- [x] 1.2 **模型 manifest 单源**：每模型一条
      `{modelId, files[{path,bytes,sha256}], sources, engine, licenseTag,
      notice, minDeviceTier}`；`deploy/models-fetch.sh` 按 manifest 钉版本
      拉取 `.gitignore` 目录 `models/`（哪个 app dist 就挂哪份，逐站分目录）
      →tools-upload.sh 顺带上传（编排者侧）。
- [x] 1.3 **downloader-core 复用**：vendor 方式引入 web bundle
      （IIFE `FDE2ESmartDLCore`，参照 site 的 `build-downloader-core.mjs`
      --write/-­-check 漂移门纪律）；模型源池三源——
      ①同源 `stt.tool.fde2e.com/models/…`（OpenResty CORS+Range）；
      ②CF 边缘 GH 代理（sherpa 官方 releases、重模型 asr-models/tts tag）；
      ③服务器直连兜底；`expectedSha256` 全部挂 manifest.sha256（禁 no-expected
      出现在线上路径）。下载进度 UI 用 shadcn 官方仪表件收编形态。
- [x] 1.4 **缓存策略**：transformers.js `env.useBrowserCache` 走 Cache API
      默认；启动时 `navigator.storage.persist()` 请求；缓存被清（Safari 7 天
      规则/隐身窗）后的重下提示 UI；iOS 不下大模型（manifest
      minDeviceTier 挡）。

## 2. TTS 站（apps/audio-tts）

- [x] 2.1 **sherpa-onnx wasm 产物**：仓内构建脚本
      `apps/audio-tts/scripts/build-sherpa-wasm.sh`（钉 sherpa-onnx tag ≥
      2026-10-20 版），产物 vendor 进 `apps/audio-tts/src/vendor/sherpa/`
      （wasm+js，禁带 espeak-ng-data/piper-phonemize）；构建脚本入库、产物
      入库（静态站要求）；POC 确认 fetch→MEMFS 动态装载可行（不行则切
      preload 分片 .data 裁剪方案；POC 结论落 research.md 附录）。
- [x] 2.2 **Kokoro v1.1-zh int8 模型接入**：模型文件（model+voices+lexicon，
      ≈157MB）经 deploy/models-fetch 钉定；`create_speech` 后端接 sherpa
      offline-tts（句切分流式 5/20 词基准）；文本框 + 音色选择（100 音色
      数字 ID，分组 UI 用 shadcn 官方 combobox）+ 语速/试听/下载。
- [x] 2.3 **长文流式与播放调度**：切句（缩写/小数安全，稳定 ID，v1.1-zh
      ≤80–100 音素/句）+ 边生成边播（sherpa 增量回调 samples 复制出
      worker → AudioBuffer 时钟链：prime 0.4s/lookahead 2/underrun 观测）
      + requestId 可取消 + 句级 hash 缓存；单句 pad 30-80ms 可调常量。
      参照 pocket-tts-js StreamingPlayer（MIT）。
- [x] 2.4 **英文档（manifest＋权重已钉；transformers.js 装载层待 UI 档位接线）**：Kokoro v1.0 ONNX（'onnx-community' q8，transformers.js
      引擎路线）作为英文多语接入 v1.0 档位；Pocket TTS 为可勾选「轻量克隆
      英文」附加档（CC-BY-4.0 署名 NOTICE），仅当 POC 声音质量过关才勾选。
- [x] 2.5 **ai-guide + 许可段**：`<pre id="ai-guide">` 载用法、模型档位、
      首载体积、许可声明（与 NOTICE 单源）；音色/模型选择值域文档化。
- [x] 2.6 **WebMCP**：`list_voices`（带 voices 元数据：lang/gender/分组）+
      `create_speech`（text/voice/speed/filename? → 下载 wav；返回时长/句
      数）+ 只读 `get_capabilities`（整份 supports 对象，schema 由它派生
      ——enum/min/max/default 单源）；untrustedContentHint；ok:false 全带
      error。
- [x] 2.7 **试音对比/生成历史（一步到位）**：segment take chips（同句多
      take，点击试听）+ 历史（IndexedDB：blob+参数元数据，replay/download/
      delete）+ **A/B 并排对比**（同 take 两条并排、参数 diff、点哪条播哪
      条——Inflect compare 形态）。

## 3. STT 站（apps/audio-stt）

- [x] 3.1 **transformers.js 路线（默认）**：whisper-base/q8 WASM 兜底 +
      whisper-large-v3-turbo/q4f16 WebGPU 档（能力探测门下发）；文件转写
      输入区（audio/video 文件→decodeAudioData；格式矩阵支持的就解码，
      不支持列白名单明示）；**长音频分片转写 + 每 N 片重建 pipeline**
      （#1739 泄漏防御）；**应用层幻觉抑制**（VAD 切句→静音段丢弃→输出
      重复率/压缩比检测，阈值 OpenAI 口径 2.4/-1.0/0.6 为参照常量）。
- [x] 3.2 **sherpa 中文档（装载/离线识别链路通；E2E 中文断言随 7.4）**：SenseVoice-Small int8（228MB）作为中文优先档；
      NOTICE 双声明（Apache-2.0 模型卡 + FunASR MODEL_LICENSE 链接）；若
      POC/法务否决则切 Dolphin base int8。
- [x] 3.3 **麦克风实时（实现落＋POC RTF 数据；真机麦克风验收随 7.4）**：AudioWorklet 取 PCM + Silero VAD（0.64MB MIT）
      切句，接 **Zipformer 流式 bilingual（≈190MB int8，Apache-2.0）真流式
      转写**——一步到位不分期（Owner 裁决 2026-11-02）；sherpa 单线程
      WASM 流式实时性 POC 实测后定档位呈现（不够实时则只留 VAD 切句+
      离线模型伪流式形态，但同一个 task 内收口不留尾巴）。
- [x] 3.4 **TranscriptDoc 与导出面**：canonical 单源（秒制浮点
      segments/words/language/engine/model）驱动段列表+导出+WebMCP；
      导出 TXT/SRT/VTT/JSON/复制（自写 formatter ≤120 行：0.2s 最短 cue/
      空段过滤/--＞转义/end 回退——参照 Verbatim export.rs；不引三方库）
      + 单测边界矩阵（null end/空段/重叠/跨小时/连导两次不累加）。
- [x] 3.5 **段级同步＋段编辑＋词级（词级门按 supports 如实降级——q8 无 cross attentions 实测；渲染/编辑/LCS 面已就位）**：RAF+二分+DOM class（禁
      60fps setState）+点段跳播+自动滚动（hover 暂停跟随）；**可编辑段文**
      （contentEditable；编辑后词级时间以 LCS＋插值保持——Subtitler 形态；
      编辑态禁自动滚动/改滚动）+ 词级高亮（supports.wordTimestamps 门：
      Whisper return_timestamps:"word" / SenseVoice token timestamps；
      最后词 end=null 回退）。
- [x] 3.6 **ai-guide + WebMCP**：`list_models` + `transcribe_audio`
      （返回 TranscriptDoc JSON：segments+words，非裸文本）+
      只读 `get_capabilities`；品名/档位/体积与 manifest 同源。

## 4. 黄页与 registry

- [x] 4.1 registry 加两卡（`audio-stt`/`audio-tts`：标签/一句话/子域/
      WebMCP 入口点/aiGuideSummary）；黄页自动收录（不改 directory 代码，
      零 registry 外引用）；搜索词覆盖（语音/转写/配音/tts/stt/whisper/
      kokoro 等）。
- [x] 4.2 两站 dev 端口 5281/5282 落 vite.config + root package.json
      dev:audio-stt / dev:audio-tts 脚本 + README 本地开发段。

## 5. 绿门扩展

- [x] 5.1 **真推理冒烟**（新增脚本 scripts/audio-smoke.mjs 或并入
      smoke-check）：headless Chromium（WebGPU flag）+ 本地 seed 权重，
      ①stt：whisper-base q8 转 3-5s 样例音频断言文本命中关键词；
      ②tts：Kokoro 音色中文短句合成断言 .wav 文件头/字节长度合理，
      并回读非静音比例。
      **权重预取纪律（Owner 裁决 2026-11-02，缺失=fail 非 skip）**：新增
      `pnpm prep:audio-smoke-weights`——按 manifest 钉版本把
      whisper-base q8（≈77MB）+ Kokoro v1.1-zh int8（≈157MB）预取到
      gitignore 缓存目录（`node_modules/.cache/fde2e-models/` 或
      `.models-cache/`，避免误入 git）；与部署同一套 manifest 单源（顺路
      趟平 models-fetch）。绿门运行时权重不在场＝冒烟 **fail**，附
      「先跑 prep:audio-smoke-weights」提示。
- [x] 5.2 **下载分片冒烟（models-fetch 大件直取/分片双路真实验证＋downloader 20MB 假模型冒烟开工批已过）**：downloader-core + mock 三源（本地 http 服务）
      对 20MB 假模型文件跑分片往返：中断→续传→sha256 match 断言协议。
- [x] 5.3 **interface-lint 纳入两站**（三面一致/schema 卫生/选择器白名
      单/错误形态）；webmcp:check 断言两站工具枚举+executeTool 往返；烟
      囚矩阵非法入参全过。
- [x] 5.4 黄页卡片断言 +2（卡片/搜索/**截图语义**——**不写 iframe 断言**：黄页已裁决去 iframe，见 DECISIONS.md；存量断言随另立 change 迁移，本站不承担存量改动）。

## 6. 文档与规格

- [x] 6.1 README：工具列表 +2（及双引擎/许可白名单/分发路由三段说明）+
      本地 dev 端口 5281/5282；`packages/audio-engine/README.md`（架构+
      POC 纪律）。
- [x] 6.2 research.md 收尾：本机段 RTF/装载全回填（SenseVoice 0.22/whisper 0.52/kokoro 3.0/zipformer 流式 0.144）；ModelScope resolve Range=200 实测路由证据入库；三设备剩余段随 7.4 实体机批次。
- [ ] 6.3 openspec specs 增量（见 specs/）合入对应 capability 目录；
      本 change 验收后 archive。

## 7. 收尾验收规范（Owner 补全指令 2026-11-02：真实 omni 使用测试）

- [ ] 7.1 绿门全绿：`pnpm -r check && pnpm -r build` + webmcp:check +
      smoke:check + 新增 audio 冒烟三件全过。
- [ ] 7.2 中文小步 commit（子仓先推，主仓指针跟进）；不 push 之外的部署
      动作由编排者统一执行（dist/models 留本地由部署脚本收）。
- [ ] 7.3 交叉复核：vision 子代理走查两站 UI（desktop 视口真浏览器全
      流程录屏级证据）；FastRemix 裁决（前端类 change 豁免 Codex）。
- [ ] 7.4 **真实 omni 使用测试（E2E 报告双支柱之一，与 7.3 并列硬门）**：
      用**本地跑的 omni**（fde2e-omni-v1；线上 omni 在高频迭代重启、
      不可作稳定被测端——Owner 裁决 2026-11-02）驱动 BU 桥
      （webmcp_list/webmcp_call，开法见 fde2e-bu-v1/docs/webmcp.md：
      Chromium 150+ 开 chrome://flags「WebMCP for testing」或
      --enable-blink-features=WebMCP）对两站做**真实回合使用测试**，
      不用任何 mock：
      ① **Agent 视角**：omni 会话里让 agent 枚举两站工具面
      （get_capabilities/list_models/list_voices）→ 按能力面选参数发起
      transcribe_audio / create_speech（含一个故意非法参数，验证 ok:false
      人话报错）→ 校验 TranscriptDoc 返回结构与下载产物；
      ② **人机协同视角**：omni 驱动浏览器真点击走两站用户路径（拖文件→
      等分片下载→播放→改一点文本→逐句重生→导出 SRT/wav），Omni 的
      browser 工具逐步截图；
      ③ 测试环境纪律：隔离 HOME/HERMES_HOME（不碰 Owner 在用会话）、
      测试模型 deepseek-v4.1-flash（A6API）、本机 dev server 或
      alpha 预交付域（不部署生产）、随测过程发现的缺陷即时修复；
      工具站/桥面问题回写本仓，**omni 的 skills/BU 使用方式不顺手处
      （如注册的 ai-guide 对 agent 不友好、能力面描述缺失） Honest
      回写 fde2e-tools 仓与相关 skill 文档**（见 7.5）；
      ④ E2E 证据落 `.agents/reports/tools/audio-stt-tts/`（report.html
      由 e2e-report-gen 管线生成，禁手写 HTML；E2E-REPORTS.md 入索引）。
- [ ] 7.5 **反哺打磨回路（连续迭代不一次收工）**：7.4 每一轮完测后输出
      「缺陷→修复→复测」闭环清单；至少一轮「agent 真用」+一轮「人真用」
      （或 Owner 参与）通过、且上一轮遗留缺陷清零，两站才算交付达标。
      本 skill/tools 双面（如本仓 ai-guide 文案、WebMCP 工具
      描述/annotations、agent-brief）经真实使用后回写打磨——质量问
      题不分归属，谁坏修谁。
