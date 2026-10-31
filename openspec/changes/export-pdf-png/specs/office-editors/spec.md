# office-editors 规格增量（ADDED）

## ADDED Requirements

### Requirement: 编辑器三站展示级导出（矢量 PDF 与长图 PNG）

系统 SHALL 在 xlsx/docx/pptx 三编辑站提供**展示级导出**（与既有文件级导出
.xlsx/.docx/.pptx 并存），全静态零上传。**PDF 一律矢量绘制且带真实文本层**
（可搜索/可复制）——这是 v2 视觉验收返工的硬要求（v1 位图 PDF 文本层为空，
xlsx 还把编辑器 UI 截进产物）：

- **xlsx 站**：`export_pdf`＝读工作簿快照（get_snapshot 同源，`wb.save()`）由
  jsPDF **矢量绘制** A4 纵向多页 PDF——**完全不碰 Univer DOM**；列宽按内容自
  适应（有上下限）、表头行加粗带浅底色、文字左对齐/数字右对齐、细灰网格、
  页边距 ≥15mm、多页重复表头、页脚「第 N 页 / 共 M 页」。`export_png`＝快照
  数据自绘 HTML 表格（全部工作表按 sheetOrder 顺序）→ 整簿长图 PNG（页边距
  ≥56px、列宽随内容、无空壳行）。
- **docx 站**：`export_pdf`＝TipTap JSON → 块模型 → jsPDF 矢量绘制 A4 纵向多页
  （h1 22pt / h2 17pt / h3 14pt 加粗、正文 11pt/行高 1.6、列表按层级缩进＋
  基线对齐圆点、表格边框＋统一表头底色、页脚页码）。`export_png`＝同一块模型
  →**结构化 HTML 长图**（不克隆编辑器 DOM：无容器边框/白条、圆点与内联代码
  背景均与正文基线对齐、表头统一加粗＋底色、行高 1.6）。
- **pptx 站**：`export_pdf`＝slides 数据（标题/要点文本）由 jsPDF 矢量绘制
  16:9 横向页：标题 32pt 加粗居上、要点 18pt 带项目符号逐行、页边距 ≥18mm、
  页眉带＋右下页码；每页幻灯一页。`export_png`＝PPTist ThumbnailSlide 离屏
  渲染逐页 PNG（vendored 源码零改动，胶水调用）；`export_long_png`＝逐页 PNG
  纵向拼接，**每页卡框＋间隔带＋「— i/n —」页码标注**（消除纯白接缝）。
- **中文字体嵌入**（文本层硬前提）：各站 PDF 嵌入 Noto Sans SC 子集
  （Regular/Bold，GB2312 全字符＋人名/地名补充，SIL OFL-1.1；资产随
  `@fde2e-tools/shared` 打入各站 dist，来源与再生成命令记 `OFL.txt`）。
  字体子集外的字符 SHALL 以 `?` 显式替身并在返回值 notice 中如实计数（不得
  静默丢字/整段丢行）。
- **色彩守卫**：凡走 html2canvas 的**长图**路径 SHALL 先挂 oklch 色守卫
  （TW4/solid-glass 令全元素色值走 oklch，html2canvas 1.4.x 不识别直接抛错）；
  PDF 矢量路径不经 html2canvas，无守卫义务。导出落定后卸载恢复主题。
- **长图上限诚实语义**：整节点高度超浏览器 canvas 上限（16384px）时先降
  scale，仍超则截断并在产物与返回值中**诚实标注**。
- **文件名契约**（safeFilename 单源清洗）：`xlsx-export.pdf` / `xlsx-long.png` /
  `docx-export.pdf` / `docx-long.png` / `pptx-export.pdf` / `pptx-page-N.png`
  （N 起 01）/ `pptx-long.png`。
- **vendored 一致性**：html2pdf.bundle.min.js（内含 jsPDF 4.0.0，MIT）于各站
  public/assets/ 持同一副本（sha 一致），站点独立可部署；字体资产由 shared
  单源经 Vite 各站各出一份；html2canvas(MIT) / jsPDF(MIT) / html-to-image(MIT)
  / Noto Sans SC(OFL-1.1) 许可记入 README。

#### Scenario: xlsx 矢量 PDF 带文本层且无编辑器 UI

- **WHEN** 用户点「导出 PDF」或 agent 调 `export_pdf`
- **THEN** 浏览器下载 xlsx-export.pdf：`%PDF` 头、页数≥1；`pdftotext` 能提取
  中文文本（含工作表名与数据关键词）；产物文本**不含**编辑器 UI 特征词
  （Start / Formulas / Arial / Univer / sample）

#### Scenario: docx 矢量 PDF 带文本层

- **WHEN** `export_pdf` 被调用
- **THEN** 下载 docx-export.pdf：多页 A4 纵向，`pdftotext` 能提取中文正文
  （标题/段落/列表/表格文本），页脚含「第 N 页 / 共 M 页」

#### Scenario: pptx 矢量 PDF 版面利用率

- **WHEN** `export_pdf` 被调用
- **THEN** 下载 pptx-export.pdf：页数=幻灯页数、16:9 横向；`pdftotext` 能提取
  标题与要点；每页光栅化后非白像素占比 ≥3%（防空洞版式回归）

#### Scenario: xlsx 全簿长图

- **WHEN** `export_png` 被调用且工作簿含多表数据
- **THEN** 下载 xlsx-long.png：全部工作表内容（按 sheetOrder）以 HTML 表格
  自绘后转为一张长图，像素解码非平凡（非空白）

#### Scenario: docx 长图版式

- **WHEN** `export_png` 被调用
- **THEN** 下载 docx-long.png（高度>宽度）：文档内容由块模型结构化渲染——
  列表圆点与正文首行基线对齐、内联代码背景不漂移、表头统一加粗＋浅底色、
  行高 1.6、外层容器无边框/底部无白条

#### Scenario: pptx 逐页与长图

- **WHEN** `export_png` / `export_long_png` 被调用
- **THEN** 分别下载 pptx-page-01.png…（逐页多文件）与 pptx-long.png
  （全部幻灯纵向拼接，页间有卡框、间隔带与「— i/n —」页码标注）

### Requirement: 内置示例内容真实性

三站 `?sample=` 与首载示例 SHALL 使用**真实业务内容**（青旅门店运营场景），
不得出现工程内部术语（编辑器内核名/许可证名/开发提示行/URL 参数说明等）或
canary 等内部哨兵值；数据量须撑得起版式（xlsx ≥6 列×8 行、docx 含三级标题＋
列表＋表格、pptx 每页 4-5 条要点）。

#### Scenario: 示例内容无污染

- **WHEN** 用户以 `?sample=1` 载入任一编辑器示例并导出 PDF
- **THEN** 产物文本不含 PPTist / AGPL / TipTap / mammoth / WebMCP / sample 等
  内部术语，也不含 `__canary__` 哨兵（导出侧对哨兵格一律视作空）

### Requirement: WebMCP 导出工具终态纪律

三站导出工具 SHALL 只在产物落定（下载已触发）后返回 `ok:true`＋文件名契约＋
产物元信息（尺寸/页数/是否截断/缺字替身计数）；渲染中间态返回 `ok:false`
（人话错误）；页面状态行「正在导出…」中间态不得含终态词（B3 词表纪律）。

#### Scenario: 未就绪显式拒绝

- **WHEN** 编辑器未就绪时调用任一导出工具
- **THEN** 返回 `ok:false` 与可重试的人话错误，页面状态行显示「正在导出…」
  类中间态（不含「已生成」等终态词），不谎报成功
