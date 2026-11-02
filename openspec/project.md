# fde2e-tools 项目上下文

## 目的

FDE2E 工具集：`tool.fde2e.com`（工具黄页：预览 + 搜索 + 入口）＋ `<tool>.tool.fde2e.com`
（各工具独立站）。存量静态工具 pdf-tool / url-tool 规范化迁入，Canvas 画布工具
（canvas，change canvas-tool-v1）承接图片排版生成，办公三件套生成站
（xlsx / docx / pptx，change office-suite）扩容，未来工具按「registry 加一条」扩容。
对外 GitHub 公开仓 `jixoai/fde2e-tools`。

## 技术栈与约束

- **全静态、零后端**：所有工具纯前端实现，构建产物纯静态托管；不设任何服务端。
- pnpm workspace；各 app Vite + React + Tailwind4 + shadcn（base-nova style，
  组件一律官方 registry 一手源收编，禁手写仿制）；视觉＝solid-glass 主题
  （官方 registry 原件 vendor 于 packages/shared/src/theme/）。
- **工具元数据单源**：`packages/shared/src/registry.ts`（id/名称/一句话/子域/标签/
  URL 参数契约/WebMCP 入口点）——黄页、各工具页、WebMCP 注册三面共用；加新工具
  ＝registry 加一条 + 新建 apps/<id>。
- **URL 参数契约保真**：pdf-tool / url-tool 已有智能体按 URL 参数调用，契约
  一字不改；各工具页内 `<pre id="ai-guide">` 用法说明保留（id 与文案是行为的
  一部分）。canvas 的工具契约是 JSON spec（WebMCP tools 面），旧 img-tool URL
  参数契约随站点退役、不做兼容。办公三站 URL 契约只有 `?sample=`（URL 不承载
  数据通道，生成数据走页内输入区或 WebMCP 传参）。
- **可交互元素 id 稳定**：ai-guide 引用的全部 DOM id 在迁移后保持不变；输入类
  元素非受控（智能体程序化 set value 后点按钮必须仍然生效）。
- **办公线红线（office-suite ＋ office-editorial-upgrade）**：轻量生成链依赖全
  MIT/Apache 禁 AGPL；生成/编辑器库一律 dynamic import 独立 chunk（黄页不背，
  grep 验证）；下载文件名契约：编辑器站 `<站id>-export.<ext>`、easy 轻量线
  `easy-<域>-export.<ext>`（v2 F19 缺省名区分；旧调用方显式传 filename 复现旧名）。
  **apps/pptx 目录 AGPL-3.0
  隔离**（PPTist vendored 逐字零改动；禁入 shared/其它 app；见 apps/pptx/README.md）。
  Univer 写入双坑防御（完整快照 seed 工厂＋canary；Rendered 门禁显式 ok:false）
  见 change office-editorial-upgrade 的 univer-write-gate 规格。
- **编辑器站（editor，二期）**：ranuts/document AGPL-3.0——未修改上游镜像钉
  digest 独立部署（deploy/editor-fetch.sh），禁 vendor/改源码/深度集成；
  见 openspec change office-suite 的 editor-hosting 规格。
- 部署：`deploy/tools-upload.sh`（tar-over-ssh；目录与 vhost 由编排者管理）；
  本仓禁把密钥/服务器路径硬编码进任何入库文件。
- 本地 dev 端口：directory 5271 / pdf-tool 5272 / canvas 5273 / url-tool 5274 /
  easy-xlsx 5275 / easy-docx 5276 / easy-pptx 5277 / xlsx 编辑站 5278 /
  docx 编辑站 5279 / pptx 编辑站 5280（仅绑 IPv4 回环，不进 frp 段、不登记
  PORT.md——非对外端口）。

## WebMCP（页面即 MCP server）

- 标准：W3C WebML CG CG-DRAFT（API＝`document.modelContext` 的
  registerTool/getTools/executeTool，出入参结构化 JSON）。
- 每个工具 app 注册其核心能力（pdf: render_preview/export_pdf；img: overlay_text/
  export_png；url: pack_url/decode_url；xlsx: create_xlsx/add_sheet_sample；
  docx: create_docx/append_docx_markdown；pptx: create_pptx/add_slide）；黄页注册
  list_tools/search_tools（agent 到黄页一次枚举全部工具）。
- inputSchema 双轨：URL 参数型从 registry urlParams 派生（schemaFromUrlParams），
  结构化参数型在 app webmcp.ts 内定义（url-tool pack_url 先例）；registry tools
  字段登记工具名与说明（黄页投影单源），不落两份。
- Chrome 149+ 经 `--enable-blink-features=WebMCP` 启用；无原生支持的浏览器由
  官方 polyfill 兜底（GoogleChromeLabs/webmcp-tools，Apache-2.0，逐字 vendor 于
  packages/shared/src/vendor/，不走 CDN）。

## 交付门

- 绿门：`pnpm -r check && pnpm -r build` 全绿；外加 `node scripts/webmcp-check.mjs`
  （headless Chromium + WebMCP flag 下 getTools() 能枚举到各页注册工具；办公三站
  create_* executeTool 全链真下载）与 `node scripts/smoke-check.mjs`（参数契约
  冒烟 + 办公三站真文件反读断言：xlsx SheetJS 逐格、docx/pptx 解 zip）。
- 三工具迁移以「功能与行为保真」为验收线：URL 契约、状态行文案、导出参数、
  下载文件名逐项对表原单文件版。
- 办公三站验收线＝**真文件反读**：生成产物必须被非亲缘解析路径核对关键内容，
  只断言状态行不算覆盖（spec: real-file-assertion）。

## 关键决策

- 静态对外；未来网络代理类动态功能（如图片代理解跨域）出现时才引入服务端，
  且必须加认证限制（见 change project-bootstrap 的演进边界 Requirement）。
- 黄页实况预览（iframe 嵌子域）仅生产域开放；本地构建一律新窗口兜底。
- 品牌色不引入：solid-glass 官方主题原样使用（中性玻璃 + 官方三源光），
  不做 omni 式品牌 teal 换肤。
- 办公生成走轻量函数库（easy-* 线）；**编辑器三站（xlsx/docx/pptx 主域名）已于
  2026-10-31 office-editorial-upgrade 转现役**：内核＝Univer preset-sheets-core
  （Apache-2.0）/ TipTap v3（MIT）/ PPTist v2 整库嵌入（AGPL-3.0，apps/pptx
  目录独立许可）——AI 经 WebMCP 直调编辑器内核（不再走 DOM 桥）。ranuts/
  document（editor.tool.fde2e.com）仍为「未修改上游镜像钉 digest 独立部署」
  二期形态（见 change office-suite 的 editor-hosting）。SheetJS 社区版经官方
  CDN tarball 钉 0.20.3（npm 0.18.5 带 CVE 禁引入）。
