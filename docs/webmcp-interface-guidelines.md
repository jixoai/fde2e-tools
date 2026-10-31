# WebMCP 接口设计指南（v1.1）

> 一等文档：全仓 WebMCP 工具的接口设计约束。**接口变更（新增/改参/改名）必须过
> 接口一致性审查——`node scripts/interface-lint.mjs` 静态断言 + 对照本文件逐条
> 自查**；绿门另有 `webmcp:check`（非法入参矩阵）与 `smoke:check`（真文件断言）。
> 审查来源：2026-10-31 接口一致性审查（40 工具全量矩阵，22 断层 High 7），本文件
> 即其裁决的制度化落仓。

## 1. 命名

- 工具名全仓唯一且跨站**同名必须同义**（`export_pdf` 在任何站都是「导出矢量
  PDF」）；同名不同义必须改名或显式区分（先例：pptx 逐页 PNG 占用了
  `export_png` 语义位，长图只能叫 `export_long_png`，并补别名工具
  `export_pages_png` 作为归一路径起点）。
- 参数名一律 camelCase（`startRow`/`filename`/`urlParams`）；与页面 URL 契约
  同名参数（如 img-tool 的 `src/text/pos`）保持逐字一致。
- 别名工具与本体 execute 同源（同一函数，仅 name/description 不同），禁复制逻辑。

## 2. 寻址与选择器（items 统一选择器）

- 「导出什么/操作哪个」的**选择器参数统一叫 `items`**，单元值域各域自定义：
  - xlsx：`{sheet: 表名|1起序号, range?: "A1:F20"}`（区域必须挂单表）；
  - docx：`{section: 标题文本}`（多节）；
  - pptx：`{page: 页码（1-based）}`。
- 旧名（`sheets`/`section`/`pages`）保留为**兼容别名**（v1 已发布契约，已有
  agent 在调用）；items 与旧名**同传＝显式人话报错**（禁静默取舍）。序号寻址
  一律 **1-based**（第 1 个＝1），跨站与 pptx `pages` 一致。
- 选择器解析失败（越界/不存在/形态混用/单元缺关键字段）必须人话报错并列出
  可用值（表名清单/标题清单/有效范围）。

## 3. 返回形态

- 成功返回 `ok: true` ＋ 业务字段；失败返回 `{ok: false, error: 人话}`——
  **execute 永不 reject**（抛错在函数体内 try/catch 转 ok:false；前置校验如
  A1 地址解析也转 ok:false，不裸 throw）。
- 只读查询类工具（list_tools/search_tools/get_snapshot）成功同样带 `ok: true`。
- 错误文案带「收到什么」的形态描述（如 `values 必须是非空二维数组（收到
  number（42））`），让调用方一眼可判。
- 选择性导出返回 `selected`（实际导出清单）：别名形态保持 v1 契约
  （xlsx=表名数组、pptx=页码数组、docx=节标题数组）；items 形态＝逐单元对象
  （`{sheet, range?}` / `{section}`）。

## 4. 文件名契约

- 每个下载型工具有**缺省契约名**（xlsx-export.pdf / docx-long.png /
  pptx-page-NN.png…），绿门断言。
- 选择性导出文件名：`resolveDownloadName`（shared/download.ts 单源）——
  **自定义 filename 为主、选择 tag 追加其上**（`<自定义stem>-<tag>.<ext>`；
  无自定义＝`<缺省名插 tag>`），tag 超长自动截断。
- 逐页多文件导出的 `filename` 参数为**前缀语义**（pptx export_png：传 foo 产出
  foo-01.png/foo-02.png，序号＝原 deck 页码；缺省前缀不变）。
- 用户提供的文件名经 `safeFilename` 清洗（去路径分隔/空字节、补扩展名）。

## 5. 错误形态与门禁

- 编辑器类工具未就绪（内核加载中/未 Rendered）＝`ok:false` ＋可重试人话错误，
  禁静默失败、禁谎报成功；中间态状态行文案不含终态词（「已生成」）。
- 幂等性：重复注册幂等（StrictMode 双跑安全）；同参重调允许（导出类重下载）。

## 6. 文档单源与 URL·工具契约区分

- registry.ts 是工具元数据唯一可信源：黄页卡片、工具页、`EXPECT` 绿门三面
  消费；**加新工具＝registry 加一条 + app buildTools 加一个 + webmcp-check
  EXPECT 加一个**，三面不一致＝lint 失败。
- **URL 层契约与工具层契约是两层，描述语汇必须区分**：
  - URL 参数（地址栏）写**编码后形态**（如 img-tool 颜色 `%23rrggbb`——`#`
    在 URL 里是 hash 保留字）；
  - 工具层 schema/description 写**解码后形态**（同例 `#rrggbb`）。
  - 工具 execute 对已发布调用方按旧文档传入的编码形态做**一层剥离兜底**
    （实测教训 F23：`%23` 经 URLSearchParams 再编码成 `%2523`，painter 正则
    不认 → 静默回退默认色还 ok:true）。
- description 是不可信文本（prompt injection 载体），只描述契约，不夹带指令。

## 7. 版本化与兼容规则

- v1 已发布参数名/文件名契约是兼容红线：改名走「别名并存＋同传互斥报错」，
  不直接删除（本轮 items 统一即此模式）。
- 实现能力宽于 schema 时（如 pages 也接受单数），**schema 如实补齐**（零谎言），
  不留「描述窄、实现宽」的暗面。
- 破坏性变更（C/D 批的 easy 改名、A1 主推等）必须立 openspec change 带
  migration 说明，本轮不做。

## 8. 断层台账（2026-10-31 审查）

- A 批（本轮修复）：F8 filename×tag 优先级、F16 裸 throw 残留、F15 ok:true、
  F23 颜色双重编码、F24 头注释路径、F26 错误文案带值形态、F27 schema 补齐。
- B 批（本轮修复）：items 统一选择器（F4）、docx 多节（F10）、filename 补齐
  （F1）、docx 选择 tag（F9）、xlsx 区域级导出与序号寻址与重名导入防御。
- C 批（排期 v1.2）：F14 error 增发、F17 selected 规范、F6 slideCount。
- D 批（排期 v2，破坏性带 migration）：F19 easy 改名、F12 统一 1 基、
  F11 A1 主推。
