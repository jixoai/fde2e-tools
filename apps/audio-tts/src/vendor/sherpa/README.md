# sherpa-onnx WASM vendor（tasks 2.1）

来源：`k2-fsa/sherpa-onnx` @ `935e5ded`（2026-10-29，≥2026-10-20 espeak 移除版，
GPL-free；Apache-2.0）。由 `apps/audio-tts/scripts/build-sherpa-wasm.sh` 仓内构建
（emscripten 6.0.13；相对上游 CMakeLists 两处补丁：去 `--preload-file`、
`EXPORTED_RUNTIME_METHODS` 增 `FS`——fetch→MEMFS 动态装载，POC ① 已证可行，
见 `apps/audio-tts/scripts/poc-memfs-load.cjs`）。

## 文件

| 文件 | 角色 |
|---|---|
| `sherpa-onnx-wasm-main-tts.js/.wasm` | emcc 产物（引擎本体；`.data` 无——运行时 MEMFS 写模型） |
| `sherpa-onnx-tts.js` | 官方包装层（`createOfflineTts` 等；modelType 8 = kokoro-multi-lang） |
| `sherpa-onnx-tts.worker.js` | 官方 worker 形态（两站 worker 化的参照） |

## 红线

- **禁带 `espeak-ng-data/` 与 piper-phonemize**（GPL）：本构建已整体排除；
  文本前端走 **lexicon 路线**（`lexicon-us-en.txt,lexicon-zh.txt`，Apache-2.0 模型包内文件）。
- 升级＝改 `build-sherpa-wasm.sh` 的钉版本断言后重跑，产物 diff 入 commit。
