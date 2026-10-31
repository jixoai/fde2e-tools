# office-editors 规格增量（ADDED）

## ADDED Requirements

### Requirement: 三编辑站真编辑器工作区

系统 SHALL 在 xlsx/docx/pptx 主域名（`<id>.tool.fde2e.com`）提供三个**真编辑器
工作区**（全静态、零后端、内容不离开本机），取代「表单生成器」形态：

- `xlsx` 站 = Univer preset-sheets-core（Apache-2.0）真表格网格：多 sheet 页签、
  单元格编辑、公式引擎（`set_formula` 后引擎真算）、基础样式与数字格式。
  xlsx 文件编解码＝SheetJS 双向桥（导入 .xlsx → Univer 快照；导出快照 → 真
  .xlsx）。**保真边界（真话）**：值/公式双向保留；v1 样式与列宽**不落导出
  文件**（快照样式引用与列宽均不映射——v2 规划往返映射，列宽 SheetJS 社区
  版可写、优先落地）。编辑真相源＝Univer snapshot（`wb.save()`）。
- `docx` 站 = TipTap v3（MIT）真文档编辑器：标题/段落/有序无序列表/表格/
  粗斜体 WYSIWYG。docx 文件编解码＝自建桥（TipTap JSON → docx@9 导出真
  .docx；mammoth 导入 .docx → HTML → setContent）。真相源＝TipTap JSON。
- `pptx` 站 = PPTist（v2.0.0，AGPL-3.0）整库嵌入：Vue 编辑器岛（节编辑/元素/
  主题/放映），Pinia store 为编程面；导出走其 `exportPPTX`（真 .pptx），导入
  走其 pptxtojson 解析。真相源＝Pinia slides store。

三站 UI SHALL 以 solid-glass 外框包编辑器画布，页面含 `#ai-guide`、`#status`
（终态词惯例）、示例载入 / 文件导入 / 文件导出入口；URL 契约只有 `?sample=`
（载入示例，不触发生成/导出）。

#### Scenario: xlsx 编辑器写入与公式

- **WHEN** agent 经 WebMCP `set_cells` 写入二维数据并对某格 `set_formula`
  「=SUM(...)」
- **THEN** 网格即时呈现数据，公式格返回引擎计算值（get_snapshot 可核验 v 与 f
  同格并存）

#### Scenario: xlsx 文件双向桥

- **WHEN** `import_xlsx` 传入合法 .xlsx 的 base64 后再 `export_xlsx`
- **THEN** 导入后编辑器可继续写入（导入即得可编辑工作簿），导出产物可被
  SheetJS 反读且导入的单元格数据保真

#### Scenario: docx 导出真 .docx

- **WHEN** 经 set_content/insert_heading/insert_table 构建文档后 `export_docx`
- **THEN** 浏览器下载 docx-export.docx，document.xml 含标题/粗斜标记/表格文本
  （第三方解析路径可核）

#### Scenario: pptx store 驱动与导出

- **WHEN** 经 add_slide/set_title/add_bullets 构建演示后 `export_pptx`
- **THEN** 浏览器下载 pptx-export.pptx，slideN.xml 含写入的标题与 bullet 文本

### Requirement: 三编辑站 WebMCP 工具面直调内核

三站 SHALL 注册下列 WebMCP 工具（结构化 schema 站内定义，`untrustedContentHint`
纪律沿用），**直接调用编辑器内核 API**（Univer Facade / TipTap commands /
PPTist store），不走 DOM 输入区桥：

- xlsx：`set_cells`（sheet?/startRow?/startCol?/values[][]）、`set_formula`
  （sheet?/range/formula，返回计算值）、`format_range`（sheet?/range/styles，
  支持 bold/italic/color/bg/numfmt/align）、`add_sheet`（name?/rows?）、
  `import_xlsx`（base64）、`export_xlsx`（filename?，缺省
  xlsx-export.xlsx）、`get_snapshot`（只读）。
- docx：`set_content`（content/format?=html|markdown|json）、`append_markdown`
  （markdown 子集）、`insert_table`（rows/cols/data?/header?）、
  `insert_heading`（text/level?）、`export_docx`（filename?，缺省
  docx-export.docx）、`import_docx`（base64）。
- pptx：`add_slide`（layout=title|bullets|blank/title?/bullets?/index?）、
  `set_title`（slideIndex?/text）、`add_bullets`（slideIndex?/items[]）、
  `export_pptx`（filename?，缺省 pptx-export.pptx）、`import_pptx`（base64）。

所有写工具 SHALL 在编辑器未就绪时显式返回 `ok:false`（见
univer-write-gate 能力），成功返回变更摘要；`export_*` SHALL 经 shared
`safeFilename` 单源清洗并复用 `downloadBlob` 下载通路。

#### Scenario: 工具面枚举一致

- **WHEN** 黄页 list_tools / 各站 getTools 枚举
- **THEN** registry webmcpTools 面单与页面实际注册的工具名一一对应（单源投影，
  不落两份）

#### Scenario: 未就绪显式拒绝

- **WHEN** 编辑器尚在加载（如 Univer 生命周期未到 Rendered）时调用任一写工具
- **THEN** 返回 `ok:false` 并附人话原因（未渲染完成/未就绪），不静默失败也不
  谎报成功

### Requirement: 大库懒加载与产物隔离

Univer（≈1.84MB gzip）与 PPTist（≈2MB 级）SHALL 一律 dynamic import 懒加载
独立 chunk；黄页与其余工具站（directory/pdf-tool/img-tool/url-tool/file-viewer/
easy-*）构建产物 SHALL 经 grep 验证零编辑器库代码。PPTist 源码 SHALL 仅存在于
`apps/pptx/` 目录树内（AGPL 隔离，见根 README 许可分区），禁入
packages/shared 或任何其它 app。

#### Scenario: 产物隔离验证

- **WHEN** 全仓构建后对黄页与其它站 dist grep 编辑器库特征串（univerjs/
  tiptap/pptist 等）
- **THEN** 零命中（registry 描述文案除外）

### Requirement: AGPL 目录隔离（apps/pptx）

apps/pptx SHALL 自带 AGPL-3.0 LICENSE 全文与目录级 README，声明：本目录含
PPTist（AGPL-3.0）上游源码副本（逐字 vendor 零改动，仅排除其 main.ts 入口由
本仓胶水层承担）、许可边界（对本站点用户提供服务时按 AGPL §13 提供源码——本
仓公开即满足）、以及 PPTist 可选云特性（AI 生成/图片搜索）依赖其上游服务端、
本站不代理不配置（点击即上游报错，核心编辑/导入/导出全离线可用）。仓库根
README SHALL 增许可分区说明（根 Apache-2.0；apps/pptx 目录 AGPL-3.0；easy-*
生成链维持禁 AGPL 红线不放宽）。

#### Scenario: 许可文件齐备

- **WHEN** 审查 apps/pptx 目录
- **THEN** LICENSE=AGPL-3.0 全文、README 含来源/版本/上游 License/排除项/
  云特性说明；`apps/pptx/src/pptist/` 内文件头保留上游原样

#### Scenario: 生成链红线不放宽

- **WHEN** 审查 packages/shared 与 easy-* 依赖
- **THEN** 零 AGPL 依赖（PPTist 依赖只出现在 apps/pptx/package.json）
