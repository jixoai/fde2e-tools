# real-file-assertion 规格增量（ADDED）

## ADDED Requirements

### Requirement: 绿门必须真文件反读断言

三站绿门 SHALL 超越「状态行断言」：headless 里真实生成文件后，用与生成库无
亲缘关系的解析路径反读产物并核对关键内容——

- xlsx：SheetJS（Node 侧）`readFile` 反读，核对工作表名与抽样单元格的值/类型；
- docx：解 zip 核对 `word/document.xml` 存在且含样例关键文本（标题/粗体运行
  `<w:b/>`/表格内容）、OOXML 命名空间正确；
- pptx：解 zip 核对 `ppt/slides/slide1.xml` 存在且含首页标题文本、bullet 页
  内容、`ppt/notesSlides/` 备注文件存在。

只断言「已生成」状态行而未反读产物 SHALL 视为绿门未覆盖生成链。

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

### Requirement: WebMCP 全链断言

webmcp-check SHALL 在 `--enable-blink-features=WebMCP` 原生路径下枚举三站全部
新工具，并对每站至少一次 create_* 走 executeTool 全链（真实下载捕获 + 文件名
契约 + 状态终态 ok）；polyfill 路径 SHALL 枚举三站工具面（与原生同形）。

#### Scenario: 原生枚举与全链

- **WHEN** headless Chromium 带 WebMCP flag 打开三站
- **THEN** getTools() 能枚举到各站 ≥2 个注册工具
- **AND** create_* 的 executeTool 返回 DOMString（JSON.parse 后 ok=true 且
  filename 符合契约），期间捕获到 download 事件

#### Scenario: polyfill 枚举同形

- **WHEN** 无 flag 的 Chromium（polyfill 兜底）打开三站
- **THEN** getTools() 同样枚举到全部注册工具（官方 polyfill 同形 API）

### Requirement: 黄页与存量工具回归不破

三站接入后，存量绿门断言 SHALL 同步扩容且全部保持绿：directory 卡片数 6、
搜索计数投影（如「图片」1 / 6）；三存量工具与黄页的既有契约断言一字不改。

#### Scenario: directory 收录三卡

- **WHEN** 打开黄页并执行既有冒烟
- **THEN** 卡片总数为 6，registry 搜索与 search_tools 投影正确反映三站
