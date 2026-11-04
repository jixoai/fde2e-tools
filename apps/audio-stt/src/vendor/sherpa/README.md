# sherpa-onnx WASM vendor（audio-stt 站；tasks 3.2/3.3）

来源与构建同 `apps/audio-tts/src/vendor/sherpa/README.md`（同一脚本
`apps/audio-tts/scripts/build-sherpa-wasm.sh` 双站一键产出）。本目录只保留
**ASR 核**（`sherpa-onnx-wasm-main-asr.js/.wasm` 含 offline 识别族 9 符号
＋`sherpa-onnx-asr.js` 包装层）。

装载形态：fetch→MEMFS 动态写模型（POC ① 已证；无 `.data`）。

红线：禁带 espeak-ng-data/piper-phonemize（GPL）。
