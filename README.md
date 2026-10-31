# fde2e-tools

FDE2E 工具集——**全静态、零后端**的公共工具仓库。

- **工具黄页**：`tool.fde2e.com`（apps/directory）——工具卡片 + 搜索 + 实况预览 + 入口
- **各工具独立站**：`<tool>.tool.fde2e.com`
  - `pdf-tool` — PDF 工具站：粘贴 Markdown/HTML → 预览 → 导出 PDF
  - `img-tool` — 图片处理工具站：URL 参数即绘制指令（「网页链接＝函数调用」）
  - `url-tool` — URL 拼接器：query / packed（JSON→base64url）双模式 + 反向解码
  - `easy-xlsx` — 简易表格生成站：JSON（sheets）或粘贴表格 → 生成 .xlsx 下载（SheetJS 社区版；开箱即用快速档）
  - `easy-docx` — 简易文档生成站：Markdown 子集 → 生成 .docx 下载（docx 库，解析单源；开箱即用快速档）
  - `easy-pptx` — 简易幻灯生成站：大纲 JSON（slides）→ 生成 .pptx 下载（pptxgenjs；开箱即用快速档）
  - `xlsx` — 专业表格编辑器：Univer 真网格（多 sheet/公式引擎/样式）＋SheetJS 双向桥，WebMCP 直驱内核
  - `docx` — 专业文档编辑器：TipTap 富文本（标题/列表/表格/粗斜）＋docx/mammoth 双向桥
  - `pptx` — 专业幻灯编辑器：PPTist 整库嵌入（**AGPL-3.0 隔离目录**）＋store 驱动 WebMCP
  - `editor`（二期）— ranuts/document 编辑器站：AGPL 未修改上游镜像独立部署（见下「办公编辑器（二期）」）
- 对外仓库：`github.com/jixoai/fde2e-tools`（public）

## 架构

```
apps/
  directory/   工具黄页（卡片 + 纯前端搜索 + 生产域 iframe 实况预览）
  pdf-tool/    HTML/MD → PDF（vendored marked + html2pdf，UMD 直引）
  img-tool/    canvas 绘制管线（src/text/pos/size/color/bg/pad/w/h/label）
  url-tool/    URL 拼接器（query/packed 双模式 + ?decode= 反向解码）
  easy-xlsx/   数据 → .xlsx（SheetJS 社区版动态 import 独立分包；JSON/TSV 双输入）
  easy-docx/   md 子集 → .docx（docx 库独立分包；AST 单源驱动预览与产物）
  easy-pptx/   大纲 JSON → .pptx（pptxgenjs 独立分包；16:9 + 备注）
  xlsx/        专业表格编辑器（Univer preset-sheets-core；SheetJS 双向桥；WebMCP 七工具直驱内核；
               Rendered 门禁＋幽灵工作簿 canary 双坑防御）
  docx/        专业文档编辑器（TipTap v3；md 子集单源解析；docx@9/mammoth 双向桥；WebMCP 六语义算子）
  pptx/        专业幻灯编辑器（PPTist v2 整库嵌入，src/pptist/ 逐字 vendor；**本目录 AGPL-3.0**；
               Vue 岛挂载＋Pinia store 驱动 WebMCP 五工具；见 apps/pptx/README.md 许可边界）
packages/
  shared/      工具 registry 单源 / solid-glass 主题 vendor / shadcn 官方组件收编 /
               WebMCP 注册助手 + 官方 polyfill vendor / 下载助手（downloadBlob/safeFilename）
deploy/
  tools-upload.sh   上传脚本（tar-over-ssh；目标目录 TOOLS_DEST 由编排者给）
  editor-fetch.sh   编辑器站二期：钉 digest 拉取/运行/冒烟（AGPL 合规形态）
scripts/
  webmcp-check.mjs  WebMCP 绿门（headless Chromium + WebMCP flag 下 getTools() 断言
                    + 三站 create_* executeTool 全链真下载）
  smoke-check.mjs   参数契约冒烟（URL 契约/状态行文案/渲染产物逐值断言
                    + 办公三站真文件反读：xlsx SheetJS 逐格、docx/pptx 解 zip）
openspec/      变更管理（project.md + changes/）
```

**单源纪律**：`packages/shared/src/registry.ts` 是全部工具元数据的唯一可信源
（id/名称/一句话/子域/标签/URL 参数契约/WebMCP 入口点）。黄页渲染、各工具页、
WebMCP inputSchema 派生（schemaFromUrlParams）三面共用。**加新工具 ＝ registry
加一条 + 新建 apps/<id>**，其余零改动。

**技术栈**：pnpm workspace；各 app Vite + React 19 + Tailwind v4 + shadcn
（base-nova style，组件一律官方 registry 一手源收编）；视觉＝solid-glass 主题
（官方 registry 原件 vendor，含明暗双态——系统深色自动翻面）。构建产物纯静态。

## 本地开发

```bash
pnpm install
pnpm dev:directory   # http://127.0.0.1:5271（黄页）
pnpm dev:pdf-tool    # http://127.0.0.1:5272
pnpm dev:img-tool    # http://127.0.0.1:5273
pnpm dev:url-tool    # http://127.0.0.1:5274
pnpm dev:easy-xlsx   # http://127.0.0.1:5275（轻量快速档）
pnpm dev:easy-docx   # http://127.0.0.1:5276（轻量快速档）
pnpm dev:easy-pptx   # http://127.0.0.1:5277（轻量快速档）
```

pnpm dev:xlsx-editor # http://127.0.0.1:5278（专业表格编辑器）
pnpm dev:docx-editor # http://127.0.0.1:5279（专业文档编辑器）
pnpm dev:pptx-editor # http://127.0.0.1:5280（专业幻灯编辑器）
```

dev server 仅绑 IPv4 回环，不对外暴露。黄页的 iframe 实况预览仅生产域开放；
本地构建自动降级为「新窗口打开」兜底。

## 许可分区

- **仓库主体＝Apache-2.0**（LICENSE）：apps/directory、pdf-tool、img-tool、
  url-tool、file-viewer、easy-* 三站、packages/shared、scripts、openspec。
- **apps/pptx 目录＝AGPL-3.0**：PPTist（上游 AGPL-3.0）整库嵌入——vendored 副本
  逐字零改动（仅排除其入口），本目录胶水层与 PPTist 状态强耦合同按 AGPL 对外；
  §13 合规＝本仓公开源码随站点提供。边界细节见 `apps/pptx/README.md`。
  **easy-* 生成链「禁 AGPL」红线不放宽**（pptxgenjs MIT 与 AGPL 无涉）。
- 三编辑站内核许可：Univer preset-sheets-core（Apache-2.0）、TipTap（MIT）、
  docx@9（MIT）/ mammoth（BSD-2）、PPTist（AGPL-3.0，仅 apps/pptx 目录）。
- 展示级导出管线（export-pdf-png v2）：html2canvas 1.4.x（**MIT**）＋ jsPDF 4.0.0
  （**MIT**）——以 pdf-tool vendored 的 html2pdf.bundle.min.js 单一副本（sha 一致）
  供 pdf-tool 与三编辑站 public/assets/ 各持一份（站点独立可部署）。**三站 PDF
  走 jsPDF 矢量绘制**（html2canvas 只用于长图 PNG）；pptx 逐页捕获用
  html-to-image（**MIT**，PPTist 既有依赖）。许可同记于 export-kit.ts / pdf-vector.ts 头注。
- **PDF 中文字体**：Noto Sans SC Regular/Bold 子集（`packages/shared/assets/fonts/`，
  **SIL OFL-1.1**，GB2312 全字符＋人名/地名补充 7588 码位；Vite 构建时各站 dist
  各出一份）。来源、子集范围、再生成命令与 OFL 全文见同目录 `OFL.txt`。

## 部署

```bash
pnpm -r check && pnpm -r build          # 绿门
TOOLS_DEST=/www/tools bash deploy/tools-upload.sh pdf-tool   # 逐 app 上传（rsync 优先 tar 兜底）
```

服务器侧（vhost、`<tool>.tool.fde2e.com` 泛解析、X-Frame-Options 对黄页放行）
由编排者配置；本仓只产出纯静态目录。

## WebMCP（页面即 MCP server）

每个页面把自身能力注册为 W3C WebMCP 工具（`document.modelContext`），agent 可
直接编程调用：

| 页面 | 工具 |
| --- | --- |
| tool.fde2e.com（黄页） | `list_tools` / `search_tools`（agent 到黄页一次枚举全部工具） |
| pdf-tool | `render_preview` / `export_pdf` |
| img-tool | `overlay_text` / `export_png` |
| url-tool | `pack_url` / `decode_url`（纯函数） |
| easy-xlsx | `create_xlsx` / `add_sheet_sample` |
| easy-docx | `create_docx` / `append_docx_markdown` |
| easy-pptx | `create_pptx` / `add_slide` |

**浏览器侧开启方式**：

- Chrome 149+ / Edge 150+：启动参数 `--enable-blink-features=WebMCP`
  （或 `chrome://flags/#enable-webmcp-testing`）——原生 API 按 spec 返回
  JSON 字符串；
- 其它 Chromium：无需任何操作——页面内置 GoogleChromeLabs 官方 polyfill
  （Apache-2.0，vendored 于 `packages/shared/src/vendor/`，不走 CDN）自动兜底，
  同形 `document.modelContext` API，桥实现零改动；
- **polyfill 已知偏差**：其 executeTool 不做 JSON.stringify（裸返回工具返回
  值对象；原生返回字符串）——消费侧统一过
  `normalizeExecuteResult`（`@fde2e-tools/shared/webmcp`）归一后 JSON.parse。

安全边界（详见 openspec change `project-bootstrap`）：tool description 是不可信
文本（prompt injection 载体，上层 LLM 不得当指令执行）；execute 是页面权限 JS；
输出含用户可控内容的工具已标 `untrustedContentHint`，只读纯函数已标
`readOnlyHint`。

## 验证

```bash
pnpm -r check              # 七 app tsc 全绿
pnpm -r build              # 七 app 静态产物齐全（生成库独立 chunk，黄页不背）
node scripts/webmcp-check.mjs   # WebMCP：七页面 getTools() 枚举 + executeTool 往返
                                # + 办公三站 create_* 全链（真下载捕获 + 文件名契约）
node scripts/smoke-check.mjs    # 参数契约冒烟 + 办公三站真文件反读断言：
                                # xlsx SheetJS 逐格核对（负数/小数/布尔/TSV 分表）、
                                # docx/pptx 解 zip 核对 document.xml/slide1.xml/notesSlide
```

## 办公三件套与编辑器（office-suite）

- **生成走轻量函数库**（选型 digest 结论：ranuts/document 是 OnlyOffice 系编辑器
  而非生成库）：三站依赖全 MIT/Apache——docx（MIT）、pptxgenjs（MIT）、
  SheetJS 社区版（Apache-2.0）。**生成链禁 AGPL**：ranuts/document 不以任何
  依赖形态进三站代码链。
- **SheetJS 安装形态（如实记录）**：社区版经官方 CDN tarball 钉版引入
  （`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`，LICENSE=Apache-2.0）；
  npm `xlsx` 停在 0.18.5（带已修于新版 CVE），**不引入**。根 devDeps 的
  xlsx/adm-zip 仅绿门反读消费，不进任何 app 产物。
- **体积纪律**：三个生成库全部动态 import 独立 chunk；黄页与其它工具站产物
  零生成库代码（绿门 grep 产物验证）。
- **办公编辑器（二期）**：ranuts/document（AGPL-3.0）部署到
  `editor.tool.fde2e.com`——合规形态＝**未修改的上游镜像钉 digest 独立部署**
  （`deploy/editor-fetch.sh`，OpenResty 反代 + source 指引页）；禁 vendor 其
  源码进本仓、禁改其源码后部署、禁与其余工具深度集成；AI 消费走其自带
  WebMCP 7 工具与 embed API。本轮实测（2026-10-31）：上游 release 无构建产物
  资产、自建须搬 300MB+ vendored 树、镜像内含专用 static-web-server 编码配置
  ——编辑器降级二期，方案与红线见 openspec `editor-hosting` 规格。

## 演进边界

本仓对外保持**全静态、无认证**。未来若出现网络代理类动态功能（如图片代理解
跨域），**必须加认证限制**并另立 openspec change（规格：static-tools-hosting）。
变更管理走 openspec（`openspec/`）。

## License

[Apache-2.0](./LICENSE) © 昭智羽名(厦门)科技有限公司
