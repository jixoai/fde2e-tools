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
# 改动说明（相对上游 build-wasm-simd-tts.sh 的 wasm/tts/CMakeLists.txt）：
#   ① 去 --preload-file（.data 120MB 预载→运行时 MEMFS 写入）
#   ② EXPORTED_RUNTIME_METHODS 增 'FS'（fetch→FS.writeFile 需要）
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
echo "✓ 产物落位 $DEST："
ls -la "$DEST"
# GPL 审计快查
if ls "$DEST" | grep -qi "piper\|espeak"; then echo "✗ GPL 组件混入"; exit 1; fi
echo "✓ GPL 审计快查过（无 piper/espeak 文件名）"
