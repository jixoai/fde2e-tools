# change: office-suite

## Why

fde2e-tools 需要办公三件套（xlsx / docx / pptx）的**生成**能力：AI 与用户从结构化
输入（JSON / Markdown 子集 / 粘贴表格）一键产出真实可下载的 Office 文件。选型
digest（`.agents/reports/fde2e-tools/ranuts-digest.md`）实证：ranuts/document 是
OnlyOffice 系**编辑器**而非生成库（无任何数据→文件的函数式生成 API，AGPL-3.0 +
ONLYOFFICE 附加条款），生成正解＝轻量函数库（SheetJS 社区版 Apache-2.0 /
docx MIT / pptxgenjs MIT，三库与 ranuts 自己处理 CSV 的路线一致、有实证）。
编辑器诉求（打开/编辑/格式转换）由轨二的 ranuts/document 独立部署承接。

## What Changes

- **轨一（本轮核心）· 构建三站**（纯客户端生成，零后端）：
  - `apps/xlsx`（SheetJS 社区版）：JSON（sheets:[{name, rows[][]}]）或粘贴表格
    （TSV，`## 表名` 分工作表）→ 生成 .xlsx 下载；WebMCP `create_xlsx` /
    `add_sheet_sample`。
  - `apps/docx`（docx 库 MIT）：Markdown 子集（标题/段落/有序无序列表/表格/
    **粗** *斜*）→ 生成 .docx；解析单源（同一 AST 驱动预览与生成）；WebMCP
    `create_docx` / `append_docx_markdown`。
  - `apps/pptx`（pptxgenjs MIT）：JSON（slides:[{title, bullets[], notes?}]）→
    生成 .pptx；WebMCP `create_pptx` / `add_slide`。
  - 输入主路径＝页内结构化输入 + WebMCP 传参；URL 契约只做 `?sample=` 示例载入
    （URL 传大数据会爆长，不做数据通道）。
  - registry 单源加三条；黄页三卡自动收录；每站 ai-guide 块 + URL 契约说明。
  - 体积纪律：生成库一律动态 import 按需分包（各站独立 chunk），黄页与其它工具
    不背这些包。
- **绿门扩容（硬要求）· 真文件断言**：headless 里真生成文件后反读——xlsx 用
  SheetJS 反读核对单元格；docx/pptx 解 zip 核对 document.xml / slide1.xml /
  notesSlide 关键内容；webmcp-check 加 `--enable-blink-features=WebMCP` 下三站
  枚举 + create_* executeTool 全链（真下载捕获 + 文件名契约）。
- **轨二（本轮次要）· 编辑器部署**：ranuts/document 部署到
  `editor.tool.fde2e.com`。AGPL-3.0 合规形态＝**未修改的上游构建产物独立部署**
  （不 vendor 其源码进本 MIT/Apache 仓库、不改其代码；AI 消费走其自带 WebMCP
  7 工具与 embed API）。本轮实测结论：上游 GitHub release **无构建产物资产**
  （v0.0.5~v0.0.8 assets 全空）、自建需搬 300MB+ vendored 树、docker 镜像内含
  专用 static-web-server 编码配置（.br/.gz 头）——提取静态树给 OpenResty 直挂
  不成立，编辑器**降级为二期**，本轮落位：钉版本（镜像 digest）拉取/运行脚本
  + editor-hosting 规格（AGPL 合规形态 + 深度集成禁令边界）+ 部署方案文档。

## Capabilities

### 新增

- `office-generation`：三构建站能力（输入契约 / DOM id 稳定 / WebMCP 工具面 /
  体积纪律 / license 边界：三库全 MIT/Apache，禁 AGPL 依赖进生成链）。
- `real-file-assertion`：绿门的真文件断言要求（生成→反读，第三方解析器核对关键
  内容；不许只断言状态行）。
- `editor-hosting`：编辑器站的 AGPL 合规托管形态（未修改上游产物独立部署、
  source 指引义务、深度集成禁令）与二期部署方案。

## Impact

- apps/ 新增三个 app（dev 端口 5275~5277 回环）；registry +3；黄页卡片 3→6。
- 根 devDeps 增加 xlsx（SheetJS CDN tarball，绿门反读用）与 adm-zip（解 zip
  断言用）——仅测试链消费，不进任何 app 产物。
- webmcp-check.mjs / smoke-check.mjs 扩容；README / AGENTS / project.md 同步。
- 服务器侧（编排者）：三个新子域 vhost（xlsx/docx/pptx.tool.fde2e.com）；
  editor.tool.fde2e.com 二期上线时按 editor-hosting 方案配置。
- license 纪律：生成链依赖全 MIT/Apache；SheetJS 社区版 0.20.3 经官方 CDN
  tarball 引入（npm `xlsx` 停在 0.18.5 且带已修于新版的 CVE，规避之）——安装
  形态与 license 声明在 README 与 spec 如实记录。
