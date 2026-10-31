# real-file-assertion 规格增量（MODIFIED）

## MODIFIED Requirements

### Requirement: 绿门必须真文件反读断言

办公三件套产物绿门 SHALL 超越「状态行断言」：headless 里真实生成文件后，用与
生成库无亲缘关系的解析路径反读产物并核对关键内容——

- **easy-xlsx（轻量线，原样保留）**：SheetJS（Node 侧）`readFile` 反读，核对
  工作表名与抽样单元格的值/类型；
- **easy-docx / easy-pptx（轻量线，原样保留）**：解 zip 核对
  `word/document.xml` / `ppt/slides/slide1.xml` / notesSlide 关键内容与
  OOXML 命名空间；
- **xlsx 编辑站（升级）**：断言链 SHALL 为「WebMCP 写入（set_cells＋
  set_formula）→ 编辑器状态核验（get_snapshot）→ export_xlsx 真下载 →
  SheetJS Node 侧逐格反读（值、数字类型、公式 f 与计算值 v）」——编辑器
  路径，非表单路径；
- **docx 编辑站（升级）**：「WebMCP 写入（set_content＋insert_heading＋
  insert_table）→ 编辑器状态核验 → export_docx 真下载 → 解 zip 核对
  document.xml 标题层级/粗斜标记/表格文本」；
- **pptx 编辑站（升级）**：「WebMCP 写入（add_slide＋set_title＋add_bullets）
  → 编辑器状态核验（store 读取）→ export_pptx 真下载 → 解 zip 核对
  slideN.xml 标题与 bullet 文本」。

只断言「已生成」状态行而未反读产物 SHALL 视为绿门未覆盖生成链。此外
xlsx 编辑站 SHALL 保留 Univer 双坑回归断言（幽灵工作簿/Rendered 前写入必须
`ok:false`，见 univer-write-gate 能力）。

#### Scenario: xlsx 反读核对单元格

- **WHEN** smoke-check 驱动 xlsx 站生成示例工作簿并捕获下载
- **THEN** SheetJS 反读该文件，工作表名与预置单元格（含数字/字符串/负数）逐一
  相等

#### Scenario: docx 解 zip 核对 document.xml

- **WHEN** smoke-check 驱动 docx 站生成示例文档并捕获下载
- **THEN** 解 zip 得到合法 OOXML 结构（`[Content_Types].xml`、
  `word/document.xml` 在列），document.xml 含样例标题与粗体/斜体标记及表格
  文本

#### Scenario: pptx 解 zip 核对 slide 与备注

- **WHEN** smoke-check 驱动 pptx 站生成示例幻灯并捕获下载
- **THEN** 解 zip 得到 `ppt/slides/slide1.xml`（含标题文本）与备注 slide 的
  notesSlide XML（含备注文本）

#### Scenario: 编辑器路径全链反读（xlsx 站）

- **WHEN** smoke-check 经 WebMCP 在 xlsx 编辑站写入数据与公式、get_snapshot
  核验后 export_xlsx 并捕获下载
- **THEN** SheetJS 反读产物：写入值逐格相等、公式单元格含 f 公式串且计算值
  正确

#### Scenario: 编辑器路径全链反读（docx/pptx 站）

- **WHEN** smoke-check 经 WebMCP 在 docx/pptx 编辑站写入内容并导出捕获下载
- **THEN** 解 zip 反读产物核验 WebMCP 写入的关键内容（标题/标记/表格文本、
  slide 标题与 bullet 文本）

### Requirement: WebMCP 全链断言

webmcp-check SHALL 在 `--enable-blink-features=WebMCP` 原生路径下枚举三站全部
新工具，并对每站至少一次 create_* 走 executeTool 全链（真实下载捕获 + 文件名
契约 + 状态终态 ok）；polyfill 路径 SHALL 枚举三站工具面（与原生同形）。

编辑站 SHALL 以「等待编辑器就绪（写工具 ok:false 重试）→ 写入 → 导出」的
executeTool 全链覆盖：导出真下载捕获 + `<站id>-export.<ext>` 文件名契约 +
ok 终态；未就绪重试机制本身 SHALL 不得把 ok:false 误报为链路失败。

#### Scenario: 原生枚举与全链

- **WHEN** headless Chromium 带 WebMCP flag 打开三站
- **THEN** getTools() 能枚举到各站全部注册工具
- **AND** 导出工具的 executeTool 返回 DOMString（JSON.parse 后 ok=true 且
  filename 符合契约），期间捕获到 download 事件

#### Scenario: polyfill 枚举同形

- **WHEN** 无 flag 的 Chromium（polyfill 兜底）打开三站
- **THEN** getTools() 同样枚举到全部注册工具（官方 polyfill 同形 API）

### Requirement: 黄页与存量工具回归不破

工具站扩容后，存量绿门断言 SHALL 同步扩容且全部保持绿：directory 卡片数与
registry 条目一致、搜索计数投影正确（唯一性复核）；三存量工具与黄页、轻量
线 easy-* 的既有契约断言一字不改。

#### Scenario: directory 收录扩容

- **WHEN** 打开黄页并执行既有冒烟
- **THEN** 卡片总数与 registry 条目数一致，registry 搜索与 search_tools 投影
  正确反映各站
