# change: c-d-batch-interface（v1.2 零破坏 ＋ v2 破坏性带 migration）

## Why

2026-10-31 接口一致性审查遗留的 C/D 两批排期项（见归档 change
webmcp-interface-consistency tasks §5）。C 批（v1.2 零破坏）补齐错误形态与
返回形态的收尾断层；D 批（v2 破坏性）解决 easy 线与专业线缺省文件名歧义、
pptx 写工具页码基址不一致、xlsx 写入寻址双层形态——三者均带兼容 migration，
红线是「旧名不删除、同传互斥报错、绿门断言不缩水」。

## What Changes

### C 批（v1.2 零破坏）

- **F14 error 字段增发扫尾**：DOM 桥站（pdf-tool/img-tool/easy-xlsx/easy-docx/
  easy-pptx/file-viewer）失败分支统一 `{ok:false, error: 状态行原文,
  message: 同值}`——easy 三站 normalize 失败分支补 message；绿门
  webmcp-check 非法入参矩阵对 DOM 桥站加「message 同值」断言。
- **F17 selected 规范**：docx export_pdf/export_png 全量导出时 `selected`
  从魔法哨兵 `["整篇"]` 改为 `null`（规范句入 guideline §3：选择性导出带
  `selected`＝实际导出清单，全量导出＝`null`）；选择导出形态不变（smoke
  断言不缩水）。
- **F6 slideCount**：pptx 编辑器 add_slide 增返 `slideCount`（与
  import_pptx/export_pptx 同名字段；`total` 保留）；registry tools 投影与
  页内 ai-guide 同步说明。

### D 批（v2 破坏性带 migration）

- **F19 easy 线缺省文件名区分**：easy-xlsx/easy-docx/easy-pptx 缺省导出名
  改 `easy-xlsx-export.xlsx` / `easy-docx-export.docx` /
  `easy-pptx-export.pptx`（与专业站 `<站id>-export.*` 区分）。三面同改
  （各 app export-name 常量/ai-guide、registry aiGuideSummary 与 tools 描述、
  绿门 FULL_CHAIN/smoke 文件名断言）；migration 注记：旧名兼容期——调用方
  传 `filename` 可显式指定任意名，缺省名变更仅影响未指定 filename 的调用。
- **F12 页码统一 1 基**：pptx 编辑器写工具（add_slide 插入定位/set_title
  目标页/add_bullets 目标页）编号参数从 0 基改 **1 基主形态 `page`**
  （第 1 页＝1，与 pptx pages/items.page、xlsx 1 起序号全仓一致）；旧名
  `index`（add_slide）/`slideIndex`（set_title/add_bullets）保留为 v1 兼容
  别名（语义＝0 基索引），同传＝显式人话报错；返回值新增 `page`（1 基页码）
  并保留 `index`/`slideIndex`。三面同改＋migration 注记＋绿门 page=1 命中
  首页断言。
- **F11 A1 锚点主推**：xlsx set_cells 增可选 `start: "A2"` A1 锚点形态（与
  startRow/startCol 互斥、同传报错）；文档主推 A1（startRow/startCol 保留为
  v1 兼容别名）；绿门断言两形态产物等价（同一像素/同一单元格落位）。

## Non-Goals

- 不部署（线上在跑 wave3 验证；dist 留在本地 build 产物，由编排者统一执行）。
- 不 push（commit 落本地）。
- 不动 URL 参数契约（pdf/img/url/file-viewer 的 urlParams 一字不改）。
- 不重构 vendored PPTist/Univer 源码。

## Migration（v2 对外兼容说明）

1. **F19 缺省名**：未指定 `filename` 的 easy 站调用，下载名随缺省值变更；
   已有调用方如断言旧缺省名，改传 `filename:"xlsx-export.xlsx"`（等值显式
   形态）即可 100% 复现旧行为。专业站缺省名不变。
2. **F12 页码**：已有调用方传 0 基 `index`/`slideIndex` 的行为**不变**（别名
   语义照旧 0 基）；新代码用 `page`（1 基）。同一请求同时传 `page` 与
   旧名＝`ok:false` 报「只能用一个」。返回值 `page`（1 基）与
   `index`/`slideIndex`（0 基同值）并存一个版本。
3. **F11 A1**：已有调用方的 startRow/startCol 调用不变；`start` 与
   startRow/startCol 同传＝`ok:false` 报「只能用一个」。

## Acceptance

1. `pnpm -r check && pnpm -r build` 全绿。
2. `node scripts/interface-lint.mjs` 全过（10 app 三面一致，断言不缩水）。
3. `pnpm webmcp:check`：全栈矩阵＋新增断言（F14 message 同值/F6 slideCount/
   D 批缺省名page=1/A1 两形态等价/互斥报错）全绿。
4. `pnpm smoke:check`：既有断言零缩水＋D 批新断言全绿（easy 缺省名×三站、
   page=1 命中首页、A1≡startRow/startCol、互斥报错、selected=null）。
5. `docs/webmcp-interface-guidelines.md` 补 F17 规范句与 D 批基址裁决；
   松耦合落 openspec specs 增量。
