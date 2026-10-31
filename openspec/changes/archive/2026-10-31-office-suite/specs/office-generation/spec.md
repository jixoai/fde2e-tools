# office-generation 规格增量（ADDED）

## ADDED Requirements

### Requirement: 三构建站纯客户端生成

系统 SHALL 提供三个纯客户端生成站（全静态、零后端、内容不离开本机）：

- `xlsx` 站：输入 JSON（`{sheets:[{name, rows: any[][]}]}`）或粘贴表格（TSV，
  行内 Tab 分列、换行分行、`## 表名` 行切换工作表，缺省表名 Sheet1）→ 生成
  .xlsx 下载（SheetJS 社区版）。
- `docx` 站：输入 Markdown 子集（`#/##/###` 标题、段落、`-` 无序列表、`1.`
  有序列表、`|` 管道表格、`**粗**`/`*斜*`）→ 生成 .docx 下载（docx 库）。
- `pptx` 站：输入 JSON（`{slides:[{title, bullets[], notes?}]}`）→ 生成 .pptx
  下载（pptxgenjs）。

生成 SHALL 在浏览器本地完成，禁引入任何服务端。

#### Scenario: JSON 生成 xlsx 并下载

- **WHEN** 用户/agent 在 `<textarea id="input-json">` 填入合法 sheets JSON 并点
  `id=generate-xlsx-btn`
- **THEN** 浏览器下载 xlsx-export.xlsx（缺省文件名契约 `<站id>-export.<ext>`）
- **AND** `#status` 进入含「已生成」的终态并带表数与行数摘要

#### Scenario: md 子集生成 docx 并下载

- **WHEN** 用户/agent 在 `<textarea id="input-md">` 填入 md 子集并点
  `id=generate-docx-btn`
- **THEN** 浏览器下载 docx-export.docx
- **AND** 标题层级、列表、表格与粗/斜体在产物中可被第三方解析器读回

#### Scenario: slides JSON 生成 pptx 并下载

- **WHEN** 用户/agent 在 `<textarea id="input-json">` 填入合法 slides JSON 并点
  `id=generate-pptx-btn`
- **THEN** 浏览器下载 pptx-export.pptx
- **AND** 每页标题、bullet 列表与备注在产物中可被第三方解析器读回

#### Scenario: 非法输入给出人话错误

- **WHEN** 输入为空、JSON 语法错误或缺 sheets/slides 结构时点生成
- **THEN** 不触发下载，`#status` 以 error 色显示具体错误文案（含「失败」或
  「请先」）

### Requirement: 解析单源驱动预览与生成

docx 站的 md 子集解析 SHALL 只有一份实现（解析 AST 同时驱动预览渲染与 docx
模型构造），xlsx 站与 pptx 站的输入解析 SHALL 同样单源，预览与产物不得各写
一套解析。

#### Scenario: 预览与产物同源

- **WHEN** 任一站载入同一输入并分别观察预览与生成产物
- **THEN** 两者反映同一份解析结果（预览的结构树 = 反读产物的结构树）

### Requirement: DOM id 稳定与输入非受控

三站 ai-guide 引用的全部可交互元素 id SHALL 保持稳定（input-json / input-tsv /
input-md / load-sample / generate-xlsx-btn / generate-docx-btn /
generate-pptx-btn / preview / status / ai-guide）；输入类元素 SHALL 非受控
（ref 读 DOM 值），智能体程序化 set value 后点按钮必须生效。

#### Scenario: 程序化输入生效

- **WHEN** agent 对 `#input-json` / `#input-md` set value 后点对应生成按钮
- **THEN** 生成行为与手工输入一致（状态行与下载产物同形）

### Requirement: WebMCP 工具面

三站各 SHALL 注册 ≥2 个 WebMCP 工具（原生 API 与官方 polyfill 同形）：

- xlsx：`create_xlsx`（sheets[, filename] → 生成并下载）+
  `add_sheet_sample`（向当前工作簿追加示例工作表，细粒度构建）；
- docx：`create_docx`（markdown[, filename] → 生成并下载）+
  `append_docx_markdown`（向当前文档追加 md 片段）；
- pptx：`create_pptx`（slides[, filename] → 生成并下载）+ `add_slide`
  （向当前 slides 追加一页）。

create_* 的结构化 inputSchema 在各站 webmcp.ts 定义（registry urlParams 是扁平
URL 契约面，承载不了嵌套结构——与 url-tool pack_url 先例一致）；registry
`tools` 字段 SHALL 同步登记工具名与说明（黄页投影单源）。工具输出含用户可控
内容的 SHALL 标 `untrustedContentHint`。

#### Scenario: executeTool 全链

- **WHEN** 在 headless Chromium（`--enable-blink-features=WebMCP`）对三站各
  executeTool 一次 create_*
- **THEN** 每次调用触发真实下载（捕获 download 事件），文件名符合缺省契约
- **AND** `#status` 终态文案经 waitForStatusChange 返回 ok=true

### Requirement: URL 契约只做示例载入

三站 URL 契约 SHALL 只有 `?sample=`（值 sample/1/示例）：自动载入内置示例输入
并刷新预览，不触发生成。URL 不承载数据通道（生成数据经页内输入或 WebMCP
传参，URL 传大数据会爆长）。

#### Scenario: sample 直达

- **WHEN** 打开任一站 `?sample=1`
- **THEN** 输入区载入内置示例且预览刷新，`#status` 显示「示例已载入」类终态，
  不自动下载

### Requirement: 体积纪律（生成库按需分包）

三个生成库（xlsx / docx / pptxgenjs）SHALL 全部经动态 import 进入各站独立
chunk，首屏主包不携带；黄页与其它工具站的产物 SHALL 不包含任何生成库代码。

#### Scenario: 黄页不背生成库

- **WHEN** 构建 directory 与任一非办公站
- **THEN** 其 dist 内无 xlsx/docx/pptxgenjs 代码（grep 产物验证）

### Requirement: license 边界（生成链禁 AGPL）

生成链依赖 SHALL 全部 MIT/Apache（docx MIT、pptxgenjs MIT、SheetJS 社区版
Apache-2.0）；AGPL-3.0 的 ranuts/document SHALL NOT 以任何依赖形态进入三站
生成链（vendored、import、submodule 均禁）。SheetJS 社区版经官方 CDN tarball
钉版引入（0.20.3）并如实记录 license 声明形态；npm `xlsx` 0.18.5（带已修于
新版的 CVE）SHALL NOT 被引入。

#### Scenario: 依赖审计

- **WHEN** 审计三站 package.json 依赖树
- **THEN** 全部许可证为 MIT 或 Apache-2.0，无 AGPL 依赖
