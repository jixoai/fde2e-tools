#!/usr/bin/env bash
# editor-fetch.sh —— editor.tool.fde2e.com（ranuts/document 编辑器）二期上线的
# 钉版本拉取/验证准备脚本（AGPL-3.0 合规形态，见 openspec change office-suite
# 的 editor-hosting 规格）。
#
# 背景（2026-10-31 实测三事实，why 本轮降级二期）：
# 1. 上游 GitHub release（v0.0.5~v0.0.8）**均无构建产物资产**；
# 2. 自建须搬 300MB+ vendored 树（sdkjs 125MB + fonts 184MB）跑其官方构建流程；
# 3. 官方 docker 镜像（ghcr.io/ranuts/document）内含专用 static-web-server 与
#    sws.toml 编码/缓存配置（.br/.gz）——提取静态树给 OpenResty 直挂不成立。
# => 合规且省力形态＝**未修改的上游镜像钉 digest 独立部署**（容器自服务，
#    OpenResty 反代 editor.tool.fde2e.com → 本机回环端口）。
#
# 用法（二期上线时由编排者执行；端口认领按主仓 .agents/docs/PORT.md 台账纪律）：
#   bash deploy/editor-fetch.sh pin                 # 记录当前 latest 的 digest（写入 deploy/editor-pinned.txt）
#   bash deploy/editor-fetch.sh pull                # 按钉定 digest 拉取镜像
#   bash deploy/editor-fetch.sh run <host-port>     # 回环端口起容器（仅绑 127.0.0.1）
#   bash deploy/editor-fetch.sh smoke <host-port>   # 本地 headless 冒烟（页面可加载）
#
# 红线：不得修改上游任何文件后部署（改源码触发 AGPL §13 更重义务）；本仓不得
# vendor 其源码/构建产物；上线前须补 source 指引页（/fde2e-source-note.html，
# 声明上游仓库 + 钉定版本 + AGPL-3.0 说明，不修改上游文件）。
set -euo pipefail

IMAGE="ghcr.io/ranuts/document"
PIN_FILE="$(cd "$(dirname "$0")" && pwd)/editor-pinned.txt"
CONTAINER_NAME="fde2e-tools-editor"

get_pinned() {
  [ -f "${PIN_FILE}" ] || { echo "✗ 尚未钉版本：先执行 bash deploy/editor-fetch.sh pin"; exit 2; }
  grep -v '^#' "${PIN_FILE}" | tail -1
}

case "${1:-}" in
  pin)
    echo ">> 拉取 ${IMAGE}:latest 以解析当前 digest…"
    docker pull "${IMAGE}:latest" >/dev/null
    DIGEST="$(docker image inspect "${IMAGE}:latest" --format '{{index .RepoDigests 0}}' | sed 's|.*@||')"
    {
      echo "# ranuts/document 钉定记录（$(date '+%F %T')）——AGPL-3.0，上游 https://github.com/ranuts/document"
      echo "${DIGEST}"
    } > "${PIN_FILE}"
    echo "✓ 已钉定 digest：${DIGEST}（写入 ${PIN_FILE}；后续 pull/run 一律用 digest，不追 latest）"
    ;;
  pull)
    REF="$(get_pinned)"
    echo ">> 按钉定 digest 拉取 ${IMAGE}@${REF}"
    docker pull "${IMAGE}@${REF}"
    echo "✓ 镜像就绪"
    ;;
  run)
    REF="$(get_pinned)"
    PORT="${2:?用法: editor-fetch.sh run <host-port>（回环端口，先按 PORT.md 认领）}"
    docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
    docker run -d --name "${CONTAINER_NAME}" --restart unless-stopped \
      -p "127.0.0.1:${PORT}:8080" "${IMAGE}@${REF}"
    echo "✓ 编辑器已起：http://127.0.0.1:${PORT}/（容器 ${CONTAINER_NAME}）"
    echo "  下一步：OpenResty 反代 editor.tool.fde2e.com → 127.0.0.1:${PORT}；补 source 指引页；跑 smoke"
    ;;
  smoke)
    PORT="${2:?用法: editor-fetch.sh smoke <host-port>}"
    CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/")"
    [ "${CODE}" = "200" ] || { echo "✗ 首页非 200：${CODE}"; exit 1; }
    CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/editor?new=docx")"
    [ "${CODE}" = "200" ] || { echo "✗ /editor 非 200：${CODE}"; exit 1; }
    echo "✓ smoke 通过（首页与 /editor 均 200；深度 headless 引擎冒烟见 openspec editor-hosting 二期 checklist）"
    ;;
  *)
    echo "用法: bash deploy/editor-fetch.sh pin|pull|run <port>|smoke <port>"
    exit 2
    ;;
esac
