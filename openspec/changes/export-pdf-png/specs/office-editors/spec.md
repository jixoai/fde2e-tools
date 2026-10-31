# office-editors 规格增量（ADDED）

## ADDED Requirements

### Requirement: 编辑器三站展示级导出（PDF 与长图 PNG）

系统 SHALL 在 xlsx/docx/pptx 三编辑站提供**展示级导出**（与既有文件级导出
.xlsx/.docx/.pptx 并存），全静态零上传：

- **xlsx 站**：`export_pdf`＝Univer 网格渲染节点（`.univer-canvas-wrap`）经
  html2canvas 捕获 → A4 纵向 PDF（单页，所见即所得）；`export_png`＝读工作簿
  快照数据**自绘 HTML 表格**（全部工作表按 sheetOrder 顺序，值/公式计算值）→
  整簿长图 PNG（canvas 只含可视视口，全量内容诚实走数据面）。
- **docx 站**：`export_pdf`＝文档纸面渲染节点离屏克隆 → html2pdf pagebreak
  分页 A4 纵向 PDF（多页）；`export_png`＝整篇文档一张长图 PNG。
- **pptx 站**：复用 PPTist 自带图片导出内核（ThumbnailSlide 离屏渲染＋
  html-to-image；vendored 源码零改动，胶水调用）——`export_pdf`＝每页幻灯
  一页横向 PDF（页面尺寸随幻灯纵横比）；`export_png`＝逐页 PNG 多文件下载；
  `export_long_png`＝全部幻灯纵向拼一张长图。
- **色彩守卫**：凡走 html2canvas 的导出 SHALL 先挂 oklch 色守卫（TW4/solid-glass
  令全元素色值走 oklch，html2canvas 1.4.x 不识别直接抛错——守卫方案与 pdf-tool
  同源，共享化于 `@fde2e-tools/shared/export-kit`），导出落定（成功或失败）后
  卸载恢复主题。
- **长图上限诚实语义**：整节点高度超浏览器 canvas 上限（16384px）时先降
  scale，仍超则截断并在产物与返回值中**诚实标注**「内容过长已截断至 X px」。
- **文件名契约**（safeFilename 单源清洗）：`xlsx-export.pdf` / `xlsx-long.png` /
  `docx-export.pdf` / `docx-long.png` / `pptx-export.pdf` / `pptx-page-N.png`
  （N 起 01）/ `pptx-long.png`。
- **vendored 一致性**：html2pdf.bundle.min.js 于各站 public/assets/ 持同一
  副本（sha 一致），站点独立可部署；html2canvas(MIT) / jsPDF(MIT) /
  html-to-image(MIT) 许可记入 README。

#### Scenario: xlsx 网格 PDF 所见即所得

- **WHEN** 用户点「导出 PDF」或 agent 调 `export_pdf`
- **THEN** 浏览器下载 xlsx-export.pdf（%PDF 头、页数≥1），网格内容
  （含公式计算值）真实出现在产物中（html2canvas 对 canvas 位图原样拷贝，
  空图视为不可用——绿门以像素解码证伪）

#### Scenario: xlsx 全簿长图

- **WHEN** `export_png` 被调用且工作簿含多表数据
- **THEN** 下载 xlsx-long.png：全部工作表内容（按 sheetOrder）以 HTML 表格
  自绘后转为一张长图，像素解码非平凡（非空白）

#### Scenario: docx 整篇文档两种形态

- **WHEN** `export_pdf` / `export_png` 被调用
- **THEN** 分别下载 docx-export.pdf（多页 A4 纵向）与 docx-long.png
  （高度>宽度的长图）

#### Scenario: pptx 逐页与长图

- **WHEN** `export_pdf` / `export_png` / `export_long_png` 被调用
- **THEN** 分别下载 pptx-export.pdf（页数=幻灯页数，横向）、
  pptx-page-01.png…（逐页多文件）与 pptx-long.png（全部幻灯纵向拼接）

### Requirement: WebMCP 导出工具终态纪律

三站导出工具 SHALL 只在产物落定（下载已触发）后返回 `ok:true`＋文件名契约＋
产物元信息（尺寸/页数/是否截断）；渲染中间态返回 `ok:false`（人话错误）；
页面状态行「正在导出…」中间态不得含终态词（B3 词表纪律）。

#### Scenario: 未就绪显式拒绝

- **WHEN** 编辑器未就绪时调用任一导出工具
- **THEN** 返回 `ok:false` 与可重试的人话错误，页面状态行显示「正在导出…」
  类中间态（不含「已生成」等终态词），不谎报成功
