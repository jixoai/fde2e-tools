# Tasks: project-bootstrap

## 1. 仓库骨架

- [x] 1.1 pnpm workspace 根（package.json / pnpm-workspace.yaml / tsconfig.base.json / .gitignore）
- [x] 1.2 packages/shared：package.json（exports 映射）/ tsconfig / registry 单源 / 主题 vendor / theme.ts
- [x] 1.3 solid-glass 官方主题 vendor（omni 审计过的 registry 原件，物理分离可 diff 上游）
- [x] 1.4 shadcn 官方 registry 组件收编（base-nova：button/input/textarea/label/badge/card/separator/radio-group/table，逐字 + 出处头注）
- [x] 1.5 四 app 脚手架（Vite+React+TW4+shadcn；dev 端口 5271~5274 回环；app.css 按 solid-glass 官方导入顺序 + @source 收窄）

## 2. 三工具迁移（功能与行为保真）

- [x] 2.1 pdf-tool：React 壳 + 非受控输入 + 状态行/导出参数/CONTENT_CSS/示例周报逐字迁移；vendored marked/html2pdf 字节一致入 public/assets
- [x] 2.2 img-tool：painter.ts 绘制管线逐字迁移（参数 clamp/cover/底衬投影/角标/示例底图）+ 两级 CORS 加载 + 下载/复制/粘贴/拖放
- [x] 2.3 url-tool：b64.ts（encode/decode/packedQ/joinQuery）+ 双模式拼接 + ?decode= 反向解码 + 参数行 DOM 读值
- [x] 2.4 三工具 ai-guide 逐字保留（含字面 `\n` 的双写转义）与示例链接绝对地址升级

## 3. 工具黄页

- [x] 3.1 directory：registry 渲染工具卡 + 纯前端搜索（空格分词 AND）+ 生产域 iframe 预览/本地新窗口兜底 + 入口

## 4. WebMCP（页面即 MCP server）

- [x] 4.1 官方 polyfill vendor（GoogleChromeLabs/webmcp-tools，Apache-2.0，逐字 + 侧车 d.ts + vendor/README）
- [x] 4.2 shared/webmcp.ts：ensureModelContext（原生探测 + 动态 polyfill）/ registerWebMCPTools（逐个容错）/ schemaFromUrlParams / readStatus / waitForStatusChange / clickById
- [x] 4.3 registry tools 字段填充真实入口点（pdf: render_preview/export_pdf；img: overlay_text/export_png；url: pack_url/decode_url）
- [x] 4.4 四 app 各自 webmcp.ts + App 接线（StrictMode 幂等）；黄页注册 list_tools/search_tools
- [x] 4.5 安全注解落位（untrustedContentHint/readOnlyHint 按 spec）

## 5. 部署与文档

- [x] 5.1 deploy/tools-upload.sh（rsync 优先 tar 兜底；TOOLS_DEST 待编排者给定）
- [x] 5.2 README.md（定位/架构/部署/本地开发/WebMCP 开启方式）
- [x] 5.3 AGENTS.md（给后续 agent 的仓库纪律）
- [x] 5.4 openspec：project.md + 本 change（proposal/tasks/specs，含演进边界 Requirement）

## 6. 验证与收口

- [x] 6.1 绿门前置：pnpm install 全绿（store 全复用）
- [x] 6.2 `pnpm -r check` 四 app 全绿
- [x] 6.3 `pnpm -r build` 四 app 产物齐全（含 pdf-tool vendored UMD 进 dist）
- [x] 6.4 scripts/webmcp-check.mjs：headless Chromium + WebMCP flag 下 getTools() 枚举断言（黄页 2 工具 + 三工具各 2 工具）＋ executeTool(pack_url) 往返字节一致
- [x] 6.5 浏览器冒烟：scripts/smoke-check.mjs 12/12 过（三工具参数契约抽测 + ?decode= 往返 + 黄页搜索 + WebMCP 投影）
- [x] 6.6 git init + gh repo create jixoai/fde2e-tools --public --source . --push（小步多次中文提交）
