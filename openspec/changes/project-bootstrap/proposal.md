# change: project-bootstrap

## Why

三个已上线的静态工具（pdf-tool / img-tool / url-tool）目前是散落的裸 HTML 单文件，
无仓库、无工程化、无统一视觉、无机器可枚举的工具目录。本项目从零建起
`fde2e-tools-v0`（对外 GitHub 公开仓 `jixoai/fde2e-tools`）：规范化迁移三工具、
建工具黄页（tool.fde2e.com）、确立「registry 单源 + 全静态零后端」的演进地基，
并把 WebMCP（页面即 MCP server）作为一等能力接入——agent 可编程调用每个工具。

## What Changes

- **仓库骨架**：pnpm workspace（apps/* + packages/*）、Vite + React + TW4 +
  shadcn（base-nova 官方 registry 一手源）、solid-glass 官方主题 vendor。
- **三工具迁移**（功能与行为保真，视觉升级 solid-glass）：
  - pdf-tool：Markdown/HTML → 预览 → 导出 PDF（vendored marked/html2pdf 保留）；
  - img-tool：URL 参数即绘制指令（canvas 绘制管线逐字迁移）；
  - url-tool：URL 拼接器（query/packed 双模式 + 反向解码）。
- **工具黄页 apps/directory**：工具卡片 + 纯前端搜索 + 生产域 iframe 实况预览
  （本地构建新窗口兜底）+ 入口。
- **registry 单源** packages/shared：工具元数据（id/名称/一句话/子域/标签/URL
  参数契约/WebMCP 入口点）——黄页、工具页、WebMCP schema 派生三面共用。
- **WebMCP 一等能力**：document.modelContext 统一注册助手（shared/webmcp.ts）；
  每工具注册核心能力；黄页注册 list_tools/search_tools；官方 polyfill vendor 兜底。
- **部署脚本** deploy/tools-upload.sh（rsync 优先 tar 兜底）。

## Capabilities

### 新增

- `static-tools-hosting`：全静态托管边界与「静态对外 → 未来动态代理类功能须加
  认证限制」的演进边界。
- `tool-registry`：工具元数据单源与扩容流程（加工具＝registry 加一条）。
- `tool-directory`：黄页的搜索/预览/入口行为。
- `webmcp-tools`：页面工具注册、polyfill 兜底、安全边界（description 不可信、
  execute 是页面权限 JS）。
- `legacy-tools-parity`：三工具迁移的功能保真验收（URL 契约/状态行文案/导出参数/
  下载文件名/DOM id 稳定）。

## Impact

- 新仓 `jixoai/fde2e-tools`（public）；主仓根新增 `fde2e-tools-v0/` 目录
  （主仓 .gitignore 由编排者处理）。
- 服务器侧（编排者，不在本 change 范围）：tool.fde2e.com 与
  `<tool>.tool.fde2e.com` 的 vhost、X-Frame-Options 放行、上传目标目录。
- 存量单文件工具（xhs-training-camp worktree 内）迁移后由编排者决定退役节奏。
