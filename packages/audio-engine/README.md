# @fde2e-tools/audio-engine

音频引擎装载层（audio-stt-tts change）——两站共享的模型/能力/缓存/下载基建。

## 模块

| 导出 | 角色 |
|---|---|
| `./manifest` | **模型 manifest 单源**：每模型 `{modelId, files[{path,bytes,sha256}], sources, engine, licenseTag, notice, minDeviceTier, supports}`——浏览器下载门、deploy/models-fetch、页内 ai-guide 三面对表（spec「三面对表」Scenario）。sources 按「国内默认序」：自托管同源 primary → ModelScope → HF（ghproxy 禁入运行时） |
| `./capabilities` | 设备能力探测（`detectCapabilities`/`tierAllows`）：纯能力语义（WebGPU/存储/AudioDecoder），禁 UA 分支；tier 分档＝manifest minDeviceTier 门 |
| `./cache` | Cache API 统一层（`fde2e-audio-models` 单 Cache；persist/usage/clear） |
| `./downloader` | 模型下载集成层：vendored smart-dl-core（IIFE）＋源探针择路＋sha256 fail-closed；小件与 200-Range 源直取、大件分片续传；产物入 cache |

## vendor

`vendor/smart-dl-core.js`——主仓 `packages/downloader-core`（web.ts 单源）经
`scripts/build-downloader-core.mjs` rolldown IIFE 产出；`--check` 漂移门把守
（重建 diff 必须为零）。

## 纪律

- **sha 门 fail-closed**：线上路径禁 `expectedSha256` 缺失（no-expected 不出现在下载完成态）。
- **模型权重不入仓**：`.models-cache/` gitignore；绿门运行时权重不在场＝fail（`pnpm prep:audio-smoke-weights`）。
- **许可白名单**：manifest `licenseTag`/`notice` 与页内 ai-guide 单源；禁入清单（espeak-ng-data/piper 等 GPL 面）在 openspec spec。
- **能力非身份**：档位下发只看 `detectCapabilities()` 结果，任何 UA 解析＝返工。

## POC 纪律（research.md §6）

POC 产物（wasm 构建脚本、RTF 实测脚本、实测数字）直接 commit，不留本地——
research §6 是唯一真值表；POC 结论变更须同步回填。
