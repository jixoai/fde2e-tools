# change: audio-stt-tts ——跨机开工 handoff（2026-11-02）

> 本文是给「另一台电脑开工」的交接说明：状态、环境前提、开工次序、裁决
> 清单一页读完。选型与调研细节不重复——都在 proposal/research.md。

## 1. 当前进度（全部已 commit 于本仓子模块分支 `task/audio-stt-tts`）

| commit | 内容 |
|---|---|
| `68ae3d4` | 立项四件套（proposal/tasks/specs/research）＋四路选型调研 |
| `d4d237c` | 三裁决：黄页去 iframe（另立 `directory-snapshot-preview` 承接存量）/COOP-COEP v1 不采/真推理冒烟权重预取缺失=fail；.gitignore 补 `models/` |
| `abfcad1` | 产品对标落笔：TranscriptDoc 时间轴导出（SRT/VTT/JSON）＋段级同步＋supports 四投影能力面（假控件禁令）＋TTS 长文流式；裁决＝**抄形态、重建、不 fork**（whisper-web 47% 命中否决、kokoro-web 两小时 demo 否决） |
| `118fc7a` | 一步到位裁决（不分期）：麦克风实时（Zipformer 流式＋VAD）/段编辑＋词级（LCS 时间插值）/TTS 历史与 A/B 全部并入主线 |
| `2f09e85` | 收尾验收规范：**真实 omni 使用测试入交付门**（本地跑 omni＋BU 桥）＋反哺打磨回路 |

五件套齐：proposal.md / tasks.md / specs/audio-ai-tools/spec.md /
research.md（§1-8 调研＋对标存档）/ DECISIONS.md（裁决记录）。
`openspec validate --changes` = 0 failed。

## 2. 新电脑开工环境前提（一次性）

1. **主仓克隆**＋`git submodule update --init`（fde2e 主仓 jixoai/fde2e；
   本仓是 submodule `jixoai/fde2e-tools`）。分支直接拉
   `task/audio-stt-tts`（子仓远端）或在新机上自建 worktree：
   `git -C fde2e-tools-v0 worktree add <主仓>/.worktrees/fde2e-tools-v0-task-audio-stt-tts -b task/audio-stt-tts origin/task/audio-stt-tts`
   （先在旧机把分支 push 到子仓远端——见 §4 收口待办①）。
2. Node ≥22、pnpm 12（corepack）；`pnpm install` 后
   `pnpm -r check && pnpm -r build` 应全绿（旧机未动任何 app 源码，
   纯 docs 提交，理论上必绿）。
3. **模型权重不需要预下载**——绿门才需要（tasks 5.1：
   `pnpm prep:audio-smoke-weights` 按实现批落地）；开发与 POC 阶段按需
   从 manifest 三源拉（自托管/ModelScope/HF——HF 国内不可达，就用
   ModelScope 或旧机已缓存的 `.models-cache/` 拷贝）。
4. 端口约定（已登记 proposal，无冲突）：stt 5281 / tts 5282 / 既有
   5271-5280；非对外端口，不用动 PORT.md。

## 3. 开工次序（tasks 已写全，这里给「第一步怎么迈」）

1. **第 1 批＝tasks 1.x 基建**：`packages/audio-engine/`（manifest 类型
   ＋能力探测＋Cache 层）→ `deploy/models-fetch.sh` ＋ registry ——
   **models-fetch 做完即可 POC**。
2. **POC 必答（回填 research.md §6）**——这是整个 change 的最大不确定
   面，先跑再写工序：sherpa WASM `fetch→MEMFS` 动态装载可行性
   （tasks 1.2 注明「不可行则 preload 分片 .data」）；浏览器实际 RTF
   三设备（M 系/中低端 Win/手机）；transformers.js v4 WebGPU vs WASM。
   **POC 产物（wasm 构建脚本、实测数字）直接 commit，不要留在本地。**
3. 之后按 tasks 2→3→4→5→6→7 顺滚；注意 7.4/7.5 是交付门不是收尾参考
   （真实 omni 使用测试＋连续打磨回路）。

## 4. 需要注意的裁决/坑（新会话容易踩错）

- **不 fork**：whisper-web/kokoro-web 都否决过，参照系＝Subtitler(BSD-3)/
  Verbatim(MIT)/pocket-tts-js(MIT)/sherpa wasm demo(Apache——它的 worker
  丢了 samples，增量播放要自己 `slice()` 复制)/Inknarrate(GPL 禁抄码)。
- **sherpa 内核版本钉 ≥ 2026-10-20**（espeak-ng 移除版），部署物禁带
  `espeak-ng-data`——GPL 红线。
- **Kokoro 无情绪标签**：supports 如实声明，UI 禁假控件（spec 有
  Scenario）。
- **句切目标**：v1.1-zh 每句 ≤80–100 音素（>100 token
  rushing、510 音素硬上限）。
- **黄页预览**：新站条目一律按「构建期截图」语义写（去 iframe 裁决），
  存量迁移不归本 change。
- **URL 参数/工具名/文件名契约**：按仓 AGENTS.md 红线与
  docs/webmcp-interface-guidelines.md；两新工具是结构化参数型
  （registry tools 登记＋app webmcp.ts 定义）。

## 5. 本机遗留收口待办（不阻塞开工，但注意）

1. **分支未 push**——起步前先做：`git push -u origin task/audio-stt-tts`
   （本 worktree 执行；若新机已从 origin 拉，跳过）。
2. 旧机主仓共享检出仍停在 `302d1ff`（main），**无需更新指针**——任务
   分支合回 main 时再跟指针；不要在共享检出上 rebase/checkout 本分支。
3. 旧机 worktree 在收工交接后可保留（若新机需要 rerun 绿门对照）或
   `git worktree remove` 回收（worktree 本体无独占资源，models 缓存
   `.models-cache/` 可拷给新机省 250MB 下载）。

## 6. 本 change 未置顶的开放项（写入 tasks 的 POC 框）

- SenseVoice/Paraformer 的 FunASR 许可双声明待法务/Owner 口径（否决则切
  Dolphin）；POC 结果落位在 research.md §6，随开工回填。
- 真实 omni 测试的具体驱动脚本（BU 桥如何被新会话调用）依赖 omni 本地
  跑法——旧仓有先例（E2E-REPORTS session-running-ws 等批次的隔离
  HOME/pgrep 回收纪律），开工批次参考即可。
