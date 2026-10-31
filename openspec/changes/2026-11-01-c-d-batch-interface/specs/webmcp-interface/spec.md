# webmcp-interface 规格增量（ADDED / MODIFIED）

## ADDED Requirements

### Requirement: 失败返回统一 error＋message（DOM 桥站 F14）

DOM 桥站（pdf-tool/img-tool/easy-xlsx/easy-docx/easy-pptx/file-viewer）工具
失败 SHALL 返回 `{ok:false, error: 人话, message: 与 error 同值}`——error 是
机器/调用方可检索的规范字段，message 与页面状态行语汇同值（人看来是同一句话）。

#### Scenario: 非法入参两字段在场

- **WHEN** DOM 桥站任一工具收到非法输入返回 ok:false
- **THEN** `error` 非空且 `message === error`（绿门 webmcp-check 断言）

### Requirement: slideCount 跨工具统一命名（F6）

pptx 编辑器 add_slide 成功返回 SHALL 包含 `slideCount`（追加后的总页数，与
import_pptx/export_pptx 同名字段）；v1 字段 `total` 保留（同值）。easy-pptx
add_slide 已用 slideCount（同名字段先例）。

#### Scenario: add_slide 返回页数

- **WHEN** `add_slide({layout:"bullets", title:"x"})` 编辑器站成功
- **THEN** 返回含 `slideCount`（整数＞0）与 `total` 同值

## MODIFIED Requirements

### Requirement: selected 清单形态（F17）

选择性导出工具成功 SHALL 返回 `selected`＝**实际导出的子单元清单**：xlsx
（sheets 形态＝表名数组；items 形态＝逐单元 `{sheet, range?}`）、pptx（页码
数组）、docx（section 形态＝节标题数组；items 形态＝逐单元 `{section}`）。
**全量导出（未给选择参数）时 `selected` MUST 为 `null`**（v1.1 及以前 docx
全量曾返回魔法哨兵 `["整篇"]`，v1.2 起废除——`null`＝全量是唯一规范形态）。
调用方判「是否全量」唯一依据＝`selected === null`。

#### Scenario: docx 全量导出

- **WHEN** `export_pdf({})`（无 items/section）成功
- **THEN** `selected` 为 `null`（不是数组、不含「整篇」哨兵）

#### Scenario: xlsx 选择导出不缩水

- **WHEN** `export_pdf({sheets:["周营收"]})` 成功
- **THEN** `selected=["周营收"]`（形态与 v1 一致）

### Requirement: easy 线缺省文件名区分（F19，v2）

easy-xlsx/easy-docx/easy-pptx 生成工具缺省下载名 SHALL 为
`easy-xlsx-export.xlsx` / `easy-docx-export.docx` / `easy-pptx-export.pptx`，
与专业编辑器站 `<站id>-export.*` 区分（同名管线 mob 养成：站 id 前缀自证
产物来源）。自定义 `filename` 形态不变（safeFilename 清洗）。

#### Scenario: 缺省名契约

- **WHEN** `create_xlsx({sheets:[…]})`（未指定 filename）成功
- **THEN** 真下载捕获 `easy-xlsx-export.xlsx`（绿门 FULL_CHAIN 断言）

#### Scenario: 旧行为复现路径

- **WHEN** 调用方需要旧缺省名
- **THEN** 传 `filename:"xlsx-export.xlsx"` 即得等值产物（migration 注记）

### Requirement: 写工具页码 1 基主形态 page（F12，v2）

pptx 编辑器写工具的目标页/插入位参数 SHALL 以 **`page`（1 基，第 1 页＝1）**
为主形态：add_slide（插入位置）、set_title（目标页）、add_bullets（目标页）。
v1 参数名 `index`（add_slide）与 `slideIndex`（set_title/add_bullets）保留为
0 基兼容别名（语义＝旧 0 基索引，不加不减）；`page` 与旧名同传 SHALL 显式
人话报错（禁静默取舍）。成功返回 SHALL 带自证页码：`page`（1 基）＋
`index`/`slideIndex`（0 基同值，v1 兼容读取）。全仓序号寻址一律 1 基（与
pptx pages/items.page、xlsx 1 起序号一致）。

#### Scenario: page=1 命中首页

- **WHEN** `set_title({page:1, text:"x"})`（三页 deck）
- **THEN** 首页标题变为 x（返回 page=1、index/slideIndex=0）

#### Scenario: 旧名行为不变

- **WHEN** `set_title({slideIndex:0, text:"x"})`
- **THEN** 依旧命中首页（0 基别名语义不变——migration 双形态同值实测）

#### Scenario: page×旧名同传

- **WHEN** `set_title({page:1, slideIndex:0, text:"x"})`
- **THEN** `ok:false` 且 error 含「只能用一个」

### Requirement: set_cells 双寻址形态（F11，v2）

xlsx set_cells SHALL 支持两种互斥的起始锚：**`start:"A2"`（A1 形态，文档主
推）**；或 v1 形态 `startRow:1, startCol:0`（0 基数字，兼容别名保留）。两者
同传 SHALL 显式人话报错；`start` 非法 A1（如 "!!"）人话报错。两形态产物
等价（同一单元格落位）。

#### Scenario: A1 锚与数字锚等价

- **WHEN** `set_cells({start:"A2", values:[["x"]]})` 与
  `set_cells({startRow:1, startCol:0, values:[["x"]]})` 各调一次
- **THEN** 两次落位同格（B2 语义首格＝A2；get_snapshot 核验等值）

#### Scenario: 双形态同传

- **WHEN** `set_cells({start:"A2", startRow:1, values:[["x"]]})`
- **THEN** `ok:false` 且 error 含「只能用一个」
