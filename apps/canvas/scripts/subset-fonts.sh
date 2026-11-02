#!/usr/bin/env bash
# subset-fonts.sh —— 生成内置 CJK 字体常用字 WOFF2 子集（B7）
#
# 依赖：fonttools（pyftsubset）+ brotli。生成物随仓库入库；本脚本只用于可复现重建。
# 用法：bash apps/canvas/scripts/subset-fonts.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
FONTS="${ROOT}/packages/shared/assets/fonts"
UNICODES='U+0020-007E,U+00A0-00FF,U+2000-206F,U+3000-303F,U+4E00-9FFF,U+FF00-FFEF'
for weight in Regular Bold; do
  pyftsubset "${FONTS}/NotoSansSC-${weight}.ttf" \
    --unicodes="${UNICODES}" \
    --flavor=woff2 \
    --layout-features='*' \
    --no-hinting \
    --output-file="${FONTS}/NotoSansSC-${weight}.subset.woff2"
  echo "✓ NotoSansSC-${weight}.subset.woff2"
done
