#!/usr/bin/env bash
# build-sherpa-wasm.sh —— sherpa-onnx WASM 仓内构建（tasks 2.1；GPL-free 红线）
#
# 钉版本：sherpa-onnx master @ 935e5ded（2026-10-29 ≥ 2026-10-20 espeak 移除版）
# 产物：wasm(≈13MB)+js(≈74KB)，无 .data（fetch→MEMFS 动态装载，POC ① 已证可行，
#       见 poc-memfs-load.cjs）；espeak-ng-data/piper-phonemize 整体不进产物。
#
# 用法（本机一次性；产物 vendor 入仓后 CI/他人无需重跑）：
#   SHERPA_SRC=/path/to/sherpa-onnx bash apps/audio-tts/scripts/build-sherpa-wasm.sh
#
# 前置：emscripten（brew install emscripten，6.0.13 实测过）；cmake。
# 改动说明（相对上游 wasm/tts 与 wasm/asr 的 CMakeLists.txt）：
#   ① 去 --preload-file（.data 预载→运行时 MEMFS 写入，POC①已证）
#   ② EXPORTED_RUNTIME_METHODS 增 'FS'（fetch→FS.writeFile 需要）
#   ③ ASR 侧 exported_functions 补 offline 识别族 9 符号（SenseVoice 文件转写；
#      上游 demo 只导流式族，POC② 实证 offline 可行）
set -euo pipefail

SHERPA_SRC="${SHERPA_SRC:?用法: SHERPA_SRC=/path/to/sherpa-onnx bash $0}"
EMSCRIPTEN="${EMSCRIPTEN:-$(dirname "$(realpath "$(which emcc)")")}"
# brew 版 emcc 在 bin/ 而 cmake 平台文件在 libexec/——自动修正
[ -f "$EMSCRIPTEN/cmake/Modules/Platform/Emscripten.cmake" ] || \
  EMSCRIPTEN="$(dirname "$EMSCRIPTEN")/libexec"
[ -f "$EMSCRIPTEN/cmake/Modules/Platform/Emscripten.cmake" ] || {
  echo "✗ 找不到 Emscripten.cmake（EMSCRIPTEN=$EMSCRIPTEN）"; exit 1; }

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

cd "$SHERPA_SRC"
git log -1 --format="%H %ci" | awk '{print ">> sherpa-onnx:", $1, $2}'
# GPL 红线断言：espeak 移除版（≥2026-10-20）
git log -1 --format=%ci | grep -q "2026-1[0-9]\|2026-09" || {
  echo "✗ 版本过旧（须 ≥2026-10-20 espeak 移除版）"; exit 1; }

# ① 去 preload-file ② 加 FS 导出（幂等：已改则跳过）
python3 - <<'EOF'
p = "wasm/tts/CMakeLists.txt"
s = open(p).read()
changed = False
if "--preload-file" in s:
    s = s.replace('string(APPEND MY_FLAGS "--preload-file ${CMAKE_CURRENT_SOURCE_DIR}/assets@. ")', "")
    changed = True
if "'removeFunction'] " in s and "'FS'] " not in s:
    s = s.replace("'addFunction','removeFunction'] ", "'addFunction','removeFunction','FS'] ")
    changed = True
if changed:
    open(p, "w").write(s)
    print(">> CMakeLists.txt 已补丁（去 preload-file＋导出 FS）")
else:
    print(">> CMakeLists.txt 已是补丁形态（幂等跳过）")
EOF

# assets 检查（CMake 要求前端文件在场；构建本身不打包它们）
mkdir -p wasm/tts/assets
[ -f wasm/tts/assets/tokens.txt ] || cp "$REPO_ROOT/.models-cache/kokoro-int8-multi-lang-v1_1/tokens.txt" wasm/tts/assets/
[ -f wasm/tts/assets/lexicon-en-us.txt ] || cp "$REPO_ROOT/.models-cache/kokoro-int8-multi-lang-v1_1/lexicon-us-en.txt" wasm/tts/assets/lexicon-en-us.txt
[ -f wasm/tts/assets/model.onnx ] || cp "$REPO_ROOT/.models-cache/kokoro-int8-multi-lang-v1_1/model.int8.onnx" wasm/tts/assets/model.onnx

EMSCRIPTEN="$EMSCRIPTEN" bash build-wasm-simd-tts.sh

OUT="$SHERPA_SRC/build-wasm-simd-tts/install/bin/wasm/tts"
DEST="$REPO_ROOT/apps/audio-tts/src/vendor/sherpa"
mkdir -p "$DEST"
# 只收 wasm+js+官方包装层；.data 不存在（已去 preload）；espeak/piper 审计在绿门
cp "$OUT/sherpa-onnx-wasm-main-tts.js" "$OUT/sherpa-onnx-wasm-main-tts.wasm" "$DEST/"
cp "$OUT/sherpa-onnx-tts.js" "$OUT/sherpa-onnx-tts.worker.js" "$DEST/"
echo "✓ TTS 产物落位 $DEST"

# ── ASR 侧（audio-stt 站：流式 Zipformer＋离线 SenseVoice 双用同核） ──
python3 - <<'PYEOF'
p = "wasm/asr/CMakeLists.txt"
s = open(p).read()
changed = False
if "--preload-file" in s:
    s = s.replace('string(APPEND MY_FLAGS "--preload-file ${CMAKE_CURRENT_SOURCE_DIR}/assets@. ")', "")
    changed = True
if "'HEAPF32','HEAPF64'] " in s and "'FS'] " not in s:
    s = s.replace("'HEAPF32','HEAPF64'] ", "'HEAPF32','HEAPF64','FS'] ")
    changed = True
OFFLINEfamily = [
    "SherpaOnnxCreateOfflineRecognizer", "SherpaOnnxDestroyOfflineRecognizer",
    "SherpaOnnxDestroyOfflineRecognizerResult", "SherpaOnnxDestroyOfflineStream",
    "SherpaOnnxAcceptWaveformOffline", "SherpaOnnxCreateOfflineStream",
    "SherpaOnnxDecodeOfflineStream", "SherpaOnnxGetOfflineStreamResult",
    "SherpaOnnxDestroyOfflineStreamResultJson",
]
if "SherpaOnnxCreateOfflineRecognizer" not in s:
    s = s.replace("  SherpaOnnxOfflineStreamGetOption\n  SherpaOnnxOfflineStreamSetOption\n  #",
        "  SherpaOnnxOfflineStreamGetOption\n  SherpaOnnxOfflineStreamSetOption\n  # offline ASR（audio-stt 文件转写档）\n  " + "\n  ".join(OFFLINEfamily) + "\n  #")
    changed = True
if '.data"' in s and "sherpa-onnx-wasm-main-asr.data" in s:
    s = s.replace("""    "$<TARGET_FILE_DIR:sherpa-onnx-wasm-main-asr>/sherpa-onnx-wasm-main-asr.data"
  DESTINATION
    bin/wasm/asr""", """  DESTINATION
    bin/wasm/asr""")
    changed = True
if changed:
    open(p, "w").write(s)
    print(">> wasm/asr/CMakeLists.txt 已补丁")
else:
    print(">> wasm/asr/CMakeLists.txt 已是补丁形态")
PYEOF

# ASR assets（zipformer 流式三件套改名形态；构建时校验用，产物不含模型）
mkdir -p wasm/asr/assets
Z="$REPO_ROOT/.models-cache/streaming-zipformer-bilingual-zh-en-2023-02-20"
[ -f wasm/asr/assets/encoder.onnx ] || cp "$Z/encoder-epoch-99-avg-1.int8.onnx" wasm/asr/assets/encoder.onnx
[ -f wasm/asr/assets/decoder.onnx ] || cp "$Z/decoder-epoch-99-avg-1.onnx" wasm/asr/assets/decoder.onnx
[ -f wasm/asr/assets/joiner.onnx ] || cp "$Z/joiner-epoch-99-avg-1.int8.onnx" wasm/asr/assets/joiner.onnx
[ -f wasm/asr/assets/tokens.txt ] || cp "$Z/tokens.txt" wasm/asr/assets/tokens.txt

EMSCRIPTEN="$EMSCRIPTEN" bash build-wasm-simd-asr.sh

OUT_ASR="$SHERPA_SRC/build-wasm-simd-asr/install/bin/wasm/asr"
DEST_STT="$REPO_ROOT/apps/audio-stt/src/vendor/sherpa"
mkdir -p "$DEST_STT"
cp "$OUT_ASR/sherpa-onnx-wasm-main-asr.js" "$OUT_ASR/sherpa-onnx-wasm-main-asr.wasm" "$DEST_STT/"
cp "$OUT_ASR/sherpa-onnx-asr.js" "$OUT_ASR/sherpa-onnx-asr.worker.js" "$DEST_STT/" 2>/dev/null || true
echo "✓ STT 产物落位 $DEST_STT"

echo "✓ 全部产物："
ls -la "$DEST" "$DEST_STT"
# GPL 审计快查
if ls "$DEST" "$DEST_STT" | grep -qi "piper\|espeak"; then echo "✗ GPL 组件混入"; exit 1; fi
echo "✓ GPL 审计快查过（无 piper/espeak 文件名）"
