# change: export-pdf-png

## Why

编辑器三站（apps/xlsx / apps/docx / apps/pptx，office-editorial-upgrade 现役）
已有 .xlsx/.docx/.pptx 文件级导出，但缺「展示级」导出：用户与 AI 经常需要把
编辑产物变成 **PDF**（打印/分发/存档的通用语）与**长图 PNG**（聊天/文档嵌入
的通用语）。pdf-tool 站已验证的 html2canvas + jsPDF 管线（vendored bundle，
oklch 色守卫护体）可复用到三站——共享化为 `@fde2e-tools/shared/export-kit`
单源，三站接线 + WebMCP 工具面同步。

已知最大技术风险＝**Univer 是 canvas 渲染**：html2canvas 对 `<canvas>` 元素
「原样拷贝」位图（1.4.x CanvasElementContainer 走 drawImage），但必须实跑验证
网格内容真被画进去；空图＝不可用，备选方案＝读 Univer 快照数据自绘 HTML 表格
再走管线（get_snapshot 同源数据）。

## What Changes

- **packages/shared 新增 `export-kit.ts` 单源**：
  - `withColorGuard(fn)`：把 apps/pdf-tool/src/export-color-guard.ts 通用化
    迁入（oklch 变量全量钉扎＋通配色兜底，导出落定后卸载）；pdf-tool 改引
    shared、删原地副本。
  - `renderNodeToPng(node, {width?, scale?})`：html2canvas → PNG blob（整节点
    全高一张；超浏览器 canvas 上限 16384px 先降 scale、仍超则截断＋诚实标注
    「内容过长已截断至 X px」）。
  - `pngsToPdf(blobs, {orientation?, pageSize?})`：jsPDF 每图一页组装 PDF
    （jsPDF 构造器经 vendored bundle 的 worker prop 惰性提取，不新增 vendored
    文件）。html2canvas(MIT) / jsPDF(MIT) 许可记入 README。
  - vendored 落位裁决：**各 app public/assets/ 各持同一份
    html2pdf.bundle.min.js 副本（sha 一致）**——保持站点独立可部署；不新增
    第二种 vendored 文件。
- **apps/xlsx**：`export_pdf`（网格渲染节点 →PDF，纵向；Univer canvas 经
  html2canvas 原样拷贝，实跑验证裁决记录在案）＋ `export_png`（长图：读快照
  数据自绘 HTML 表格——全 sheet 内容一张图，canvas 视口只含可见区，长图诚实
  走数据面）；两工具＋页面按钮（大按钮＋状态行「正在导出…→已生成」）。
- **apps/docx**：`export_pdf`（纸面渲染节点 →PDF 纵向，html2pdf pagebreak
  分页）＋ `export_png`（整篇文档一张长图）；TipTap 是 DOM 渲染天然适配。
- **apps/pptx**：复用 PPTist 自带图片导出内核（ThumbnailSlide 离屏渲染＋
  html-to-image，vendored 源零改动、胶水调用）——`export_pdf`（每页幻灯一页
  PDF，横向）＋ `export_png`（逐页 PNG 多文件下载）＋ `export_long_png`（全部
  幻灯纵向拼一张长图）；AGPL 红线不碰（apps/pptx 内仅胶水层改动）。
- **WebMCP 返回纪律**：工具 execute 只在产物落定后返回 ok:true（「已生成」
  终态词表），渲染中间态 ok:false / 状态行中间态不含终态词（B3 教训）。
- **绿门扩展（既有断言零缩水）**：
  - webmcp-check：EXPECT ＋新增工具枚举；三站 export_pdf 真下载断言（%PDF 头）
    ＋docx/xlsx export_png 断言（PNG 头）＋xlsx 空图证伪（像素解码非平凡）。
  - smoke-check：三站 export_pdf 真下载（%PDF 头＋页数≥1）；docx export_png
    （PNG 头＋高度>宽度）；xlsx export_png 空图证伪断言；pptx 逐页 PNG/长图
    断言。
- **registry / ai-guide**：三站 tools 面与 AI 说明同步新增导出能力。

## Non-Goals

- 不做分页完美排版（PDF 由光栅图组装，所见即所得，非矢量文本层）。
- 不动 PPTist vendored 源码（AGPL 纪律：仅胶水层调用其自带导出内核）。
- 不做 xlsx 长图滚动拼接（视口外内容走数据自绘表格，不做 scroll+stitch）。

## Risk

- **Univer canvas 捕获（最大技术风险，优先最先验证）**：html2canvas 对 canvas
  原样拷贝的实跑验证先行；失败即切换数据自绘表格方案并如实记录所选路径。
- Chrome 多文件下载拦截（pptx 逐页 PNG）：下载间加间隔；绿门以逐个 download
  事件捕获裁决。

## v2 视觉验收返工（2026-10-31，判词驱动）

视觉验收五张全 FAIL，核心路径重做（本 change 不另立新案）：

- **P0-1 xlsx export_pdf 语义错误**：v1 截的是 Univer 编辑器 UI（菜单/工具栏/
  公式栏/列标行号/选中框/开发提示行）。v2 改为**读快照数据矢量绘制**，不碰
  编辑器 DOM。
- **P0-2 两个 PDF 无文本层**：v1 是 html2canvas 位图 + addImage（pdftotext 全
  空、283ppi 有损 JPEG）。v2 三站 PDF 全部改为 jsPDF `text()`/`rect()` **矢量
  绘制**，并嵌入 Noto Sans SC 子集（OFL-1.1）产生真实 ToUnicode 文本层。
- **P0-3 pptx 版式空洞**：v2 矢量化重排（标题 32pt/要点 18pt/页眉带/页码），
  长图补页框＋间隔带＋页码标注。
- **P0-4 内容污染**：三站示例重写为青旅门店运营真实业务内容；canary 哨兵
  （`__canary__`，曾把 xlsx 导出撑出 27 列并混入 PDF）在导出侧一律视作空。
- **P1 docx 长图细节**：改由文档块模型渲染结构化 HTML（不克隆编辑器 DOM），
  圆点/内联代码基线对齐、表头统一加粗＋底色、行高 1.6、无容器边框白条。
- **绿门强化**：新增 `scripts/pdf-assert.mjs`——pdftotext 文本层非空＋中文＋
  关键词＋xlsx 无 UI 特征词；pptx 每页 pdftoppm 光栅化非白像素占比 ≥3%。

## v2 Non-Goals

- 不追求 Word/PPT 级分页引擎（孤行控制/分栏/图文环绕不做）；表格只画边框与
  表头底色，不做合并单元格跨页拆分。
- 长图路径仍是位图（docx/xlsx 走结构化 HTML、pptx 走 PPTist 内核），不追求
  长图矢量。
