# Proposal: file-viewer-migration

## Why

Owner 指令（2026-10-30）：「我开了一个 fde2e-tool 项目，我想把 fileviewer 并进来，并用
glass-viewer+shadcnui 来优化开发。这是一个开源项目。原本的 fileviewer 项目就可以删了。
统一归为 tool 项目来管理。」

fileviewer（通用文件预览站，原私仓 `jixoai/fde2e-fileviewer`，已在 fileviewer.fde2e.com
上线）与本仓技术栈完全同源（Vite+React 19+TW4+shadcn base-nova+solid-glass），并入后：

1. **归一**：shadcn 收编件、solid-glass 主题、WebMCP 助手全部改消费 `packages/shared`
   （原仓自带 vendor 副本退役——vendor 纪律「单源不落两份」）。
2. **registry 单源**：工具元数据入 `packages/shared/src/registry.ts`（黄页卡片＋工具页
   页头＋WebMCP schema 三面自动派生）。
3. **开源**：本仓 public，fileviewer 代码本就是本团队全新编写（无历史包袱/无密钥），
   并入即开源。
4. **删旧仓**：迁移验收后删除 `jixoai/fde2e-fileviewer`。

## What Changes

- 新增 `apps/file-viewer/`（源＝原 fileviewer 仓全量功能，14 解码器/URL 契约/E2E
  data 标记逐字保留）：
  - import 改 `@fde2e-tools/shared`（ui 收编件/solid-glass 令牌/webmcp 助手）；
  - registry 加一条（id=`file-viewer`，子域 `file-viewer.tool.fde2e.com`，urlParams
    契约＝`url`〔必填〕/`name`/`decoder`，WebMCP 入口点 `preview_file`）；
  - 页内补 `#ai-guide`（智能体用法说明——本仓工具族惯例）；
  - URL 契约一字不改（`/?url=<enc>&name=&decoder=`——omni 服务端 302 与素材库
    iframe 已按此契约接线，属「已有智能体按参数调用」同级的保真红线）。
- 部署：`deploy/tools-upload.sh file-viewer` → `file-viewer.tool.fde2e.com`；既有
  `fileviewer.fde2e.com` vhost root 指向同一 dist 作兼容别名（omni 默认
  `OMNI_FILEVIEWER_BASE=https://fileviewer.fde2e.com` 零改动）。
- 删除旧仓 `jixoai/fde2e-fileviewer`（GitHub 侧，Owner 已批；gh token 无 delete_repo
  scope 时提请 Owner 手动删）。

## Capabilities

### 新增
- `file-viewer-tool`：并入后的工具契约（URL 契约保真、解码器清单、E2E 标记、
  ai-guide、registry/WebMCP 三面单源）。

## Impact

- fde2e-tools：apps/file-viewer 新增＋registry 一条＋（如缺）shared/ui 补收编件。
- omni（不改代码）：`OMNI_FILEVIEWER_BASE` 默认域名继续有效（兼容别名承载）。
- 旧私仓：删除（GitHub）＋本地检出清理＋omni E2E 的 `FV_VIEWER_REPO` 环境变量改指
  本仓 apps/file-viewer 构建产物。

## 决策记录

- Owner 2026-10-30：并入 fde2e-tools＋开源＋删旧仓（本 change 的立项依据）。
- 兼容别名策略＝MainAgent 裁量：fileviewer.fde2e.com 保留服务（omni 默认基址零改），
  canonical 域名归工具族子域。
