# Tasks: c-d-batch-interface

## 1. C 批（v1.2 零破坏）

- [x] 1.1 **F14 error 增发扫尾**：easy 三站 normalize 失败分支＋easy-pptx
      add_slide 空 title＋file-viewer 缺 url 分支补 `message`（同值）；
      webmcp-check 非法入参矩阵对 DOM 桥站加「ok:false 必含 message=error
      同值」断言（7 站 f14: true 矩阵口）。
- [x] 1.2 **F17 selected 规范**：docx export.ts `["整篇"]` → `null`（类型
      `| null`）；guideline §3 补规范句；smoke 断言「全量导出 selected=null」。
- [x] 1.3 **F6 slideCount**：pptx 编辑器 add_slide 返回值增 `slideCount`
      （total 保留）；registry tools 投影＋页内 ai-guide 同步；smoke/
      webmcp-check 双断言 slideCount=total。

## 2. D 批（v2 破坏性带 migration）

- [x] 2.1 **F19 缺省名区分**：easy 三站 DEFAULT_EXPORT_NAME →
      `easy-*-export.*`；App ai-guide/webmcp 工具描述/registry
      aiGuideSummary 与 tools 描述/gates FULL_CHAIN＋smoke 全部同改。
- [x] 2.2 **F12 页码 1 基**：pptx 编辑器三写工具 `page`（1 基）主形态＋
      `index`/`slideIndex` 0 基兼容别名＋同传报错；返回值增 `page`（双基
      自证 page/index/slideIndex）；三面同改＋绿门 page=1 命中首页
      （smoke 双形态≡＋webmcp-check pageProbe）。
- [x] 2.3 **F11 A1 锚点**：xlsx set_cells 增 `start:"A1"`（与 startRow/
      startCol 互斥报错；非法 A1 人话报错；返回 `start` A1 自证）；文档
      主推 A1；绿门两形态等价断言（A11/B11 落格＋互斥＋非法形态）。

## 3. 文档与规格

- [x] 3.1 guideline：§3 selected/F14 规范句、§4 F19 缺省名分线、§7 D 批
      三条破坏性裁决落档；§8 台账 A/B 结清、C/D 移入「已修」；§2 序号
      寻址 1 基补 pptx 写工具裁决。
- [x] 3.2 openspec specs 增量（webmcp-interface）：F17 selected-null、
      F6 slideCount、F19 缺省名、F12 page 1 基、F11 A1 锚点五 Requirements
      ＋Scenario；migration 注记落 proposal。

## 4. 绿门与收口

- [x] 4.1 `pnpm -r check && pnpm -r build` 全绿；interface-lint 全过；
      webmcp:check 92/92；smoke:check 45/45（断言不缩水＋新增全过）。
- [x] 4.2 中文小步 commit（不 push、不部署——dist 留本地由编排者统一执行）。
