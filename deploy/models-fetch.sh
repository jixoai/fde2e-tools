#!/usr/bin/env bash
# models-fetch.sh —— 模型权重拉取入口（tasks 1.2；实现内核＝models-fetch.mjs）
#
# 用法（编排者侧 seed 与开发机 prep 共用同一入口）：
#   bash deploy/models-fetch.sh list               # 清单概览
#   bash deploy/models-fetch.sh verify             # 本地缓存 sha256 全量对表（绿门用）
#   bash deploy/models-fetch.sh check              # manifest 投影漂移门
#   bash deploy/models-fetch.sh fetch [modelId]    # 拉取（缺省全量；幂等）
#   bash deploy/models-fetch.sh seed-upload        # 把 .models-cache 推上服务器
#                                                  # /www/tools/models/（编排者侧；ssh fde2e-cloud）
#
# 落位：.models-cache/<root>/<path>（gitignore）。部署 dist 时编排者把
# .models-cache/* 同步到 $TOOLS_DEST/models/（tools-upload 不背模型）。
set -euo pipefail
cd "$(dirname "$0")/.."

case "${1:-fetch}" in
  list)        node deploy/models-fetch.mjs --list ;;
  verify)      node deploy/models-fetch.mjs --verify ;;
  check)       node deploy/models-fetch.mjs --check ;;
  fetch)       node deploy/models-fetch.mjs ${2:+--model "$2"} ;;
  seed-upload)
    [ -d .models-cache ] || { echo "✗ .models-cache 不存在（先 fetch）"; exit 1; }
    echo ">> 推送 .models-cache → fde2e-cloud:/opt/1panel/apps/openresty/openresty/www/tools/models/"
    /usr/bin/ssh fde2e-cloud "mkdir -p /opt/1panel/apps/openresty/openresty/www/tools/models"
    tar -czf - -C .models-cache . | /usr/bin/ssh fde2e-cloud "tar -xzf - -C /opt/1panel/apps/openresty/openresty/www/tools/models"
    echo "✓ seed 完成（服务器侧对应 https://<tool>.fde2e.com/models/…）"
    ;;
  *) echo "用法: models-fetch.sh list|verify|check|fetch [modelId]|seed-upload"; exit 1 ;;
esac
