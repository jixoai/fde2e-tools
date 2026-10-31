#!/usr/bin/env bash
# tools-upload.sh <app> —— 上传一个 app 的静态构建产物到其线上目录（tar-over-ssh，先清后传等效 --delete）
#
# 用法：
#   TOOLS_DEST=/opt/1panel/apps/openresty/openresty/www/tools bash deploy/tools-upload.sh <app>
#   <app> ∈ directory|pdf-tool|img-tool|url-tool|file-viewer|easy-xlsx|easy-docx|easy-pptx|xlsx|docx|pptx
# 目标映射：directory → $TOOLS_DEST/_home（黄页＝tool.fde2e.com 根）；其余 → $TOOLS_DEST/<app>
#   （easy-* = 轻量快速档；xlsx/docx/pptx = 专业编辑器三站，office-editorial-upgrade 2026-10-31
#    现役上线——注意 pptx 目录含 AGPL 上游 webfonts，dist ≈48MB）
# 传输用 tar-over-ssh（alpha-upload.sh 的兜底通道，实证稳；rsync 在本机-服务器组合上报协议错）。
# 注：editor（ranuts/document 编辑器站）不走本脚本——AGPL 未修改上游镜像独立部署，
#     见 deploy/editor-fetch.sh 与 openspec editor-hosting 规格。
set -euo pipefail
app="${1:?用法: tools-upload.sh <app>（directory|pdf-tool|img-tool|url-tool|file-viewer|easy-xlsx|easy-docx|easy-pptx|xlsx|docx|pptx）}"
case "${app}" in
  directory|pdf-tool|img-tool|url-tool|file-viewer|easy-xlsx|easy-docx|easy-pptx|xlsx|docx|pptx) ;;
  *) echo "✗ 未知 app: ${app}"; exit 1 ;;
esac
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${REPO_ROOT}/apps/${app}/dist"
[ -d "${SRC}" ] || { echo "✗ 构建产物不存在: ${SRC}（先 pnpm --filter ${app} build）"; exit 1; }
[ -f "${SRC}/index.html" ] || { echo "✗ ${SRC} 缺 index.html"; exit 1; }

DEST_ROOT="${TOOLS_DEST:-}"
case "${DEST_ROOT}" in
  /opt/1panel/apps/openresty/openresty/www/tools) ;;
  *) echo "✗ TOOLS_DEST 必须为宿主路径 /opt/1panel/apps/openresty/openresty/www/tools（白名单校验，防误写任意目录）"; exit 2 ;;
esac
if [ -z "${DEST_ROOT}" ]; then
  echo "✗ 未设置 TOOLS_DEST（目标目录由编排者给定，如 /opt/1panel/apps/openresty/openresty/www/tools，容器内即 /www/tools）——不猜测目标"
  echo "  用法示例: TOOLS_DEST=/opt/1panel/apps/openresty/openresty/www/tools bash deploy/tools-upload.sh ${app}"
  exit 2
fi
case "${app}" in
  directory) DEST="${DEST_ROOT}/_home" ;;
  *)         DEST="${DEST_ROOT}/${app}" ;;
esac

/usr/bin/ssh fde2e-cloud "rm -rf '${DEST}' && mkdir -p '${DEST}'"
tar -czf - -C "${SRC}" . | /usr/bin/ssh fde2e-cloud "tar -xzf - -C '${DEST}'"
echo "✓ ${app} 已上传：${DEST}（对应 https://${app}.tool.fde2e.com/；directory 对应 https://tool.fde2e.com/）"
