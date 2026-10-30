#!/usr/bin/env bash
# tools-upload.sh <app> —— 上传一个 app 的静态构建产物到其目标目录（rsync 优先，tar 兜底）
#
# 模式抄自主仓 deploy/scripts/alpha-upload.sh（rsync -az --delete；服务器无 rsync 时
# tar-over-ssh 先清后传，等效 --delete）。
#
# 目标目录（TOOLS_DEST）待编排者给定后写死或经环境变量注入；当前支持的注入顺序：
#   1. 环境变量 TOOLS_DEST（如 /www/tools/<app>）
#   2. 未注入时打印用法并退出（不猜测目标——域名体系 tool.fde2e.com 由编排者配）
#
# 用法：
#   pnpm --filter <app> build && bash deploy/tools-upload.sh <app>
#   TOOLS_DEST=/www/tools bash deploy/tools-upload.sh pdf-tool
set -euo pipefail
app="${1:?用法: tools-upload.sh <app>（directory|pdf-tool|img-tool|url-tool）}"
case "$app" in
  directory|pdf-tool|img-tool|url-tool) ;;
  *) echo "✗ 未知 app: $app（应为 directory|pdf-tool|img-tool|url-tool）"; exit 1 ;;
esac
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO_ROOT/apps/$app/dist"
[ -d "$SRC" ] || { echo "✗ 构建产物不存在: $SRC（先 pnpm --filter $app build）"; exit 1; }
[ -f "$SRC/index.html" ] || { echo "✗ $SRC 缺 index.html"; exit 1; }

DEST_ROOT="${TOOLS_DEST:-}"
if [ -z "$DEST_ROOT" ]; then
  echo "✗ 未设置 TOOLS_DEST（目标目录由编排者给定，如 /www/tools）——不猜测目标"
  echo "  用法示例: TOOLS_DEST=/www/tools bash deploy/tools-upload.sh $app"
  exit 2
fi
DEST="$DEST_ROOT/$app"

if command -v rsync >/dev/null 2>&1 && /usr/bin/ssh fde2e-cloud 'command -v rsync' >/dev/null 2>&1; then
  rsync -az --delete -e /usr/bin/ssh "$SRC"/ "fde2e-cloud:$DEST/"
else
  # tar-over-ssh 兜底（服务器精简安装无 rsync，2026-10-12 实证）：先清后传，等效 --delete
  /usr/bin/ssh fde2e-cloud "rm -rf '$DEST' && mkdir -p '$DEST'"
  tar -czf - -C "$SRC" . | /usr/bin/ssh fde2e-cloud "tar -xzf - -C '$DEST'"
fi
echo "✓ $app 已上传：$DEST（对应 https://$app.tool.fde2e.com/，vhost/X-Frame-Options 由编排者配置）"
