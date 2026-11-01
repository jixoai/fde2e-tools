# Tasks: audio-stt-tts

> 执行序按 proposal「落地与验收顺序」；本清单按批次展开。
> 铁律：所有限制在 proposal 的红线上执行（全静态零后端 / 许可白名单 /
> 权重不入仓 / registry 单源 / shadcn 官方组件）。

## 1. 共享基建（packages/audio-engine + 分发）

- [ ] 1.1 **audio-engine 包骨架**：`packages/audio-engine/`——双引擎装配
      （transformers.js npm 依赖按 app 懒加载 + sherpa-onnx wasm vendor 产物
      懒加载）、设备能力探测（`canWebGPU()`/`canThreads()`/iOS 判别只含能力
      语义，禁 UA 身份分支——iOS 降级判据用「Safari 26 以下能力缺失」表达）、
      模型 manifest 类型与清单常量、Cache API 统一缓存层。
- [ ] 1.2 **模型 manifest 单源**：每模型一条
      `{modelId, files[{path,bytes,sha256}], sources, engine, licenseTag,
      notice, minDeviceTier}`；`deploy/models-fetch.sh` 按 manifest 钉版本
      拉取 `.gitignore` 目录 `models/`（哪个 app dist 就挂哪份，逐站分目录）
      →tools-upload.sh 顺带上传（编排者侧）。
- [ ] 1.3 **downloader-core 复用**：vendor 方式引入 web bundle
      （IIFE `FDE2ESmartDLCore`，参照 site 的 `build-downloader-core.mjs`
      --write/-­-check 漂移门纪律）；模型源池三源——
      ①同源 `stt.tool.fde2e.com/models/…`（OpenResty CORS+Range）；
      ②CF 边缘 GH 代理（sherpa 官方 releases、重模型 asr-models/tts tag）；
      ③服务器直连兜底；`expectedSha256` 全部挂 manifest.sha256（禁 no-expected
      出现在线上路径）。下载进度 UI 用 shadcn 官方仪表件收编形态。
- [ ] 1.4 **缓存策略**：transformers.js `env.useBrowserCache` 走 Cache API
      默认；启动时 `navigator.storage.persist()` 请求；缓存被清（Safari 7 天
      规则/隐身窗）后的重下提示 UI；iOS 不下大模型（manifest
      minDeviceTier 挡）。

## 2. TTS 站（apps/audio-tts）

- [ ] 2.1 **sherpa-onnx wasm 产物**：仓内构建脚本
      `apps/audio-tts/scripts/build-sherpa-wasm.sh`（钉 sherpa-onnx tag ≥
      2026-10-20 版），产物 vendor 进 `apps/audio-tts/src/vendor/sherpa/`
      （wasm+js，禁带 espeak-ng-data/piper-phonemize）；构建脚本入库、产物
      入库（静态站要求）；POC 确认 fetch→MEMFS 动态装载可行（不行则切
      preload 分片 .data 裁剪方案；POC 结论落 research.md 附录）。
- [ ] 2.2 **Kokoro v1.1-zh int8 模型接入**：模型文件（model+voices+lexicon，
      ≈157MB）经 deploy/models-fetch 钉定；`create_speech` 后端接 sherpa
      offline-tts（句切分流式 5/20 词基准）；文本框 + 音色选择（100 音色
      数字 ID，分组 UI 用 shadcn 官方 combobox）+ 语速/试听/下载。
- [ ] 2.3 **gapless 播放**：AudioBufferSourceNode.start(when) 音频时钟链
      （禁 setTimeout 串联/禁 performance.now 混钟）；句间 pad 30-80ms 可调
      常量；长文本进度与试听中断可恢复。
- [ ] 2.4 **英文档**：Kokoro v1.0 ONNX（'onnx-community' q8，transformers.js
      引擎路线）作为英文多语接入 v1.0 档位；Pocket TTS 为可勾选「轻量克隆
      英文」附加档（CC-BY-4.0 署名 NOTICE），仅当 POC 声音质量过关才勾选。
- [ ] 2.5 **ai-guide + 许可段**：`<pre id="ai-guide">` 载用法、模型档位、
      首载体积、许可声明（与 NOTICE 单源）；音色/模型选择值域文档化。
- [ ] 2.6 **WebMCP**：`list_voices`（枚举音色+默认配置）+
      `create_speech`（text/voice/speed/filename? → 下载 wav 落 stub）；
      untrustedContentHint 标注（text 含用户可控内容）；ok:false 全带 error。

## 3. STT 站（apps/audio-stt）

- [ ] 3.1 **transformers.js 路线（默认）**：whisper-base/q8 WASM 兜底 +
      whisper-large-v3-turbo/q4f16 WebGPU 档（能力探测门下发）；文件转写
      输入区（audio/video 文件→decodeAudioData；格式矩阵支持的就解码，
      不支持列白名单明示）；**长音频分片转写 + 每 N 片重建 pipeline**
      （#1739 泄漏防御）；**应用层幻觉抑制**（VAD 切句→静音段丢弃→输出
      重复率/压缩比检测，阈值 OpenAI 口径 2.4/-1.0/0.6 为参照常量）。
- [ ] 3.2 **sherpa 中文档**：SenseVoice-Small int8（228MB）作为中文优先档；
      NOTICE 双声明（Apache-2.0 模型卡 + FunASR MODEL_LICENSE 链接）；若
      POC/法务否决则切 Dolphin base int8。
- [ ] 3.3 **麦克风实时（v2 排程锚点）**：本 change 只落 AudioWorklet 取流
      管线 + Silero VAD 接入（0.64MB MIT）；Zipformer 流式真转写挂 v2
      （ duiding 明示「实验」或干脆 v2 前不展示麦克风入口）。
- [ ] 3.4 **ai-guide + WebMCP**：`list_models` + `transcribe_audio`
      （audio?/language?/model?/filename? → 转写文本作为返回值；
      untrustedContentHint 标注 DOM 桥输入）；品名/档位/体积与 manifest 同源。

## 4. 黄页与 registry

- [ ] 4.1 registry 加两卡（`audio-stt`/`audio-tts`：标签/一句话/子域/
      WebMCP 入口点/aiGuideSummary）；黄页自动收录（不改 directory 代码，
      零 registry 外引用）；搜索词覆盖（语音/转写/配音/tts/stt/whisper/
      kokoro 等）。
- [ ] 4.2 两站 dev 端口 5281/5282 落 vite.config + root package.json
      dev:audio-stt / dev:audio-tts 脚本 + README 本地开发段。

## 5. 绿门扩展

- [ ] 5.1 **真推理冒烟**（新增脚本 scripts/audio-smoke.mjs 或并入
      smoke-check）：headless Chromium（WebGPU flag）+ 本地 seed 权重，
      ①stt：whisper-base q8 转 3-5s 样例音频断言文本命中关键词；
      ②tts：Kokoro 音色中文短句合成断言 .wav 文件头/字节长度合理，
      并回读非静音比例。
- [ ] 5.2 **下载分片冒烟**：downloader-core + mock 三源（本地 http 服务）
      对 20MB 假模型文件跑分片往返：中断→续传→sha256 match 断言协议。
- [ ] 5.3 **interface-lint 纳入两站**（三面一致/schema 卫生/选择器白名
      单/错误形态）；webmcp:check 断言两站工具枚举+executeTool 往返；烟
      囚矩阵非法入参全过。
- [ ] 5.4 黄页卡片断言 +2（卡片/搜索/预览降级说明），存量断言零缩水。

## 6. 文档与规格

- [ ] 6.1 README：工具列表 +2（及双引擎/许可白名单/分发路由三段说明）+
      本地 dev 端口 5281/5282；`packages/audio-engine/README.md`（架构+
      POC 纪律）。
- [ ] 6.2 research.md 收尾：POC 实测数字（RTF/首载/内存三设备）回填选型表；
      下载路由实跑证据（sherpa releases 三源并发各源吞吐）。
- [ ] 6.3 openspec specs 增量（见 specs/）合入对应 capability 目录；
      本 change 验收后 archive。

## 7. 收口

- [ ] 7.1 绿门全绿：`pnpm -r check && pnpm -r build` + webmcp:check +
      smoke:check + 新增 audio 冒烟三件全过。
- [ ] 7.2 中文小步 commit（子仓先推，主仓指针跟进）；不 push 之外的部署
      动作由编排者统一执行（dist/models 留本地由部署脚本收）。
- [ ] 7.3 交叉复核：vision 子代理走查两站 UI（desktop 视口真浏览器全
      流程录屏级证据）；FastRemix 裁决（前端类 change 豁免 Codex）。
