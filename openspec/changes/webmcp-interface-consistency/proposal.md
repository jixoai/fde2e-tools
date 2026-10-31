# change: webmcp-interface-consistency

## Why

2026-10-31 接口一致性审查（40 工具全量矩阵，22 断层其中 High 7）暴露三类系统性问题：
①**参数面不齐/语义重叠**——三站选择器三名（sheets/section/pages）、导出家族
filename 参数缺失、选择参数静默丢弃自定义文件名（F8）；②**契约静默失败**——
颜色双重编码（F23：文档教 %23、工具层再编码成 %2523、painter 正则不认→静默
回退默认色还 ok:true）、裸 throw 残留（F16）、ok:false 不带 error、schema 窄于
实现（F27）；③**文档与绿门失守**——工具面投影不齐（F15）、头注释路径残留
（F24）、无程序化接口门禁。B 批（items 统一选择器/区域导出/重名防御/trim 契约）
随 `export-pdf-png` 第 10 节交付；本 change 收 A 批修复＋制度化落仓＋C/D 排期。

## What Changes

### A 批（本轮零破坏修复）

- **F23 img-tool 颜色双重编码**：工具层 description 改裸 `#rrggbb`（工具层永远
  写解码后形态，成文规则入指南）；execute 对 `%23` 开头色值自动剥一层编码
  （兜底已发布调用方）；绿门两形态各喂一次断言底衬色正确落画布。
- **F8 filename×选择参数静默丢弃**：优先级＝自定义 filename 为主、选择 tag
  追加其上（`<自定义stem>-<tag>.<ext>`）；shared `resolveDownloadName` 单源，
  xlsx export_pdf/export_png/export_xlsx、pptx export_pdf/export_long_png、
  docx export_pdf/export_png 全部改正＋绿门断言。
- **F16 裸 throw 残留**：xlsx set_formula/format_range 的 parseA1 前置校验移入
  ok:false；file-viewer preview_file 缺 url → ok:false（全部改 resolve 不 reject）。
- **F15/F24/F26/F27**：directory list_tools/search_tools 成功补 ok:true；
  easy-* 三站 webmcp.ts 头注释路径修正；set_cells 错误文案带收到值形态；
  pptx pages schema 补单数 number 形态（实现已宽于 schema，如实对齐）。

### 制度化（Owner 指令：接口审查纳入工作流）

- **Guidelines v1 落仓**：`docs/webmcp-interface-guidelines.md`（七条：命名/
  寻址 items 统一选择器/返回形态/文件名契约/错误形态/文档单源与 URL·工具契约
  区分/版本化与兼容规则）——一等文档，README/AGENTS 指针。
- **绿门程序化断言**：`scripts/interface-lint.mjs` 静态 lint（schema
  additionalProperties:false／参数 camelCase／选择器 items 白名单旧名／ok:false
  必带 error／registry↔webmcp↔EXPECT 三面一致／img-tool 双层契约）；webmcp-check
  新增违法入参矩阵（每工具 2-3 个非法输入必须 resolve {ok:false, error} 且不
  reject）＋ directory 正例 ok:true。
- **AGENTS.md 工作流条目**：接口变更（新增/改参/改名）必须过接口一致性审查
  （interface-lint＋webmcp-check 矩阵＋对照指南）；同名工具跨站必须同名且同义，
  同名不同义必须改名或显式区分。

### 排期（本轮不做，记 openspec 后续）

- **C 批（v1.2）**：F14 error 增发全站扫尾、F17 selected 规范统一、F6 slideCount。
- **D 批（v2，破坏性带 migration）**：F19 easy 站改名、F12 全仓统一 1 基、F11 A1 主推。

## Non-Goals

- 不做 D 批破坏性改名（easy-* 站名、参数基址）——需 migration 方案与对外通告。
- 不重构 PPTist/Univer vendored 代码；不新增运行时依赖（zip 手术用浏览器原生
  DecompressionStream/TextEncoder）。

## Risk

- **F23 剥离逻辑只作用于 color/bg 两键**：label 等自由文本不动（防止把用户
  文本里的 %23 误剥）。两形态绿门已钉死。
- **items 与旧名并存**：兼容期双面维护，指南 §7 版本化规则约束（旧名不删除、
  同传互斥报错）；D 批再评估收口。

## Acceptance

1. `pnpm -r check && pnpm -r build` 全绿。
2. `node scripts/interface-lint.mjs` 全过（10 app 三面一致）。
3. `pnpm webmcp:check`：原生/polyfill 双路径 + 非法入参矩阵全绿。
4. `pnpm smoke:check`：新增断言全过、既有断言零缩水（F23 两形态、F8/F5/F9
   文件名契约、docx items 多节、xlsx G1/G2/G3 全部实测）。
