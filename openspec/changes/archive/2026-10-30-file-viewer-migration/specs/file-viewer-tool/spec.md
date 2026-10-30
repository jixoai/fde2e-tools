# file-viewer-tool Specification（delta）

## ADDED Requirements

### Requirement: URL 契约保真

file-viewer 的 URL 契约 SHALL 为 `/?url=<encodeURIComponent(绝对URL)>`（必填）＋
`&name=<显示名>`（可选）＋`&decoder=<解码器id>`（可选强制）；契约一 hashed 入
registry urlParams（单源），变更＝改 registry＋改 app＋改 ai-guide 三面同步。消费方
（omni 服务端 302 分流、素材库 right-sheet iframe）按此契约接线，任何重构 MUST 保持
字节级兼容。

#### Scenario: omni 分流落点

- **WHEN** omni `GET /uploads/x.png`（导航 Accept）302 至 `fileviewer.fde2e.com/?url=...`
- **THEN** 本应用按 url 参数渲染 image 解码器（契约字节级兼容）

### Requirement: 解码器能力面（并入基线）

SHALL 保留 14 解码器（image/video/audio/pdf/markdown/text〔编码切换 UTF-8/auto/
GBK/Big5/Shift_JIS/Latin-1〕/json/csv/html/svg/docx/xlsx/pptx/zip，按需 chunk）、
未支持格式文本兜底＋二进制嗅探拒渲染、解码器手动强制切换；`data-viewer-*`/
`data-decoder-*` E2E 标记家族逐字保留。

#### Scenario: 优雅拒绝

- **WHEN** 打开二进制内容且强制 `decoder=text`
- **THEN** 显示「未支持＋下载」态，不渲染乱码

### Requirement: 本仓三面单源

工具元数据 MUST 只活在本仓 `packages/shared/src/registry.ts`（黄页/页头/WebMCP
schema 三面派生）；shadcn 收编件与 solid-glass 令牌 MUST 消费 `packages/shared`
（原私仓 vendor 副本不随迁）；WebMCP 注册 MUST 走 shared 助手（入口点
`preview_file`，schema 由 urlParams 派生，输出标 `untrustedContentHint`）。

#### Scenario: 黄页自动出卡

- **WHEN** registry 加 file-viewer 条目后构建 apps/directory
- **THEN** 黄页出现工具卡片且实况预览指向 `file-viewer.tool.fde2e.com`

### Requirement: 智能体用法页内说明

工具页 SHALL 提供 `#ai-guide` 锚（URL 契约三参数逐字语义＋解码器清单＋可复制示例
链接），与本仓既有工具族惯例一致。

#### Scenario: 智能体自发现

- **WHEN** 智能体打开工具页读 #ai-guide
- **THEN** 可仅凭该节拼出合法预览链接并调用
