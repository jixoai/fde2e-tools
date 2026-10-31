# Tasks: office-editorial-upgrade

## 1. 规格与 registry

- [x] 1.1 openspec specs 增量落位（office-editors / univer-write-gate 新增，
      real-file-assertion 修改）
- [x] 1.2 registry 三条 comingSoon 占位转现役（xlsx/docx/pptx：去 comingSoon、
      名称/描述/aiGuide 换编辑器形态、urlParams=?sample=、webmcpTools 填实、
      repoPath=apps/<id>）
- [x] 1.3 directory 黄页适配（registry 驱动自动生效；页首 AI 说明「建设中」段
      更新为编辑器现役表述）

## 2. apps/xlsx · Univer 编辑器

- [x] 2.1 脚手架（package.json / vite 5278 / tsconfig / solid-glass 外框）
- [x] 2.2 编辑器内核：dynamic import preset-sheets-core（独立 chunk 1.70MB
      gzip）；完整快照格式 seed 单源工厂（snapshot.ts，grep 无旁路）；
      LifecycleGate（Rendered 门禁＋forcePending 测试缝）；canary 写入落盘校验
      ＋健康绑定 workbookId（切簿即重验）
- [x] 2.3 SheetJS 双向桥：快照 → .xlsx 导出（值/公式回填/列宽）；.xlsx → seed
      导入；导出文件名契约 xlsx-export.xlsx（safeFilename 单源）
- [x] 2.4 WebMCP 七工具：set_cells / set_formula（返回引擎计算值）/ format_range
      / add_sheet / import_xlsx / export_xlsx / get_snapshot（全量过门禁＋健康
      校验，未就绪 ok:false）
- [x] 2.5 UI：示例载入 / 导入 / 导出按钮（非受控 file input）＋ #status 终态
      文案 ＋ ai-guide ＋ ?sample=
- [x] 2.6（追加）幽灵形态本地矩阵实证：sheet 缺 id/数组形态即拒绝一切写入
      （D-record-noorder/E-order-empty 不中招）——defense 按真实边界落位

## 3. apps/docx · TipTap 编辑器

- [x] 3.1 脚手架（package.json / vite 5279 / solid-glass 外框）
- [x] 3.2 TipTap 工作区（StarterKit＋Table 四件套；单例 editor；纸面排版层）＋
      工具栏（标题/粗斜/列表/表格/引用/代码块/撤销重做）
- [x] 3.3 md 子集 → TipTap JSON 转换（md-lite.ts；append_markdown 与 set_content
      markdown 格式共用单源）
- [x] 3.4 docx 双向桥：TipTap JSON → docx@9 导出真 .docx（Heading 样式/粗斜/
      列表/表格/有序列表独立 numbering）；mammoth 导入 .docx → HTML → setContent
- [x] 3.5 WebMCP 工具面：set_content / append_markdown / insert_table /
      insert_heading / export_docx / import_docx ＋ UI（示例/导入/导出/
      ai-guide/?sample=）

## 4. apps/pptx · PPTist 嵌入

- [x] 4.1 vendor PPTist v2.0.0 源码至 apps/pptx/src/pptist/（git archive HEAD
      逐字零改动，仅排除入口 main.ts 与上游开发 harness；UPSTREAM-README.md
      保留上游自述）＋ public 资产（mocks/imgs/favicon）
- [x] 4.2 AGPL 隔离：apps/pptx/LICENSE（AGPL-3.0 全文）＋目录级 README 许可
      边界声明（§13 合规路径/云特性不代理/隔离红线）＋仓库根 README 许可分区
      ＋grep 验证 PPTist 代码零泄漏进 packages/shared 与其它 app
- [x] 4.3 Vue 岛挂载：React solid-glass 外框 ＋ bridge（createApp＋pinia＋
      directive＋全局样式逐字同上游 main.ts；初始 deck 落定门）；vite 双插件
      （react+vue）＋scss/icon 插件链；大库 dynamic import 独立 chunk
- [x] 4.4 WebMCP 工具面：add_slide（layout=title|bullets|blank＋空画布安全）/
      set_title / add_bullets / export_pptx（标题临时换名实现文件名契约
      pptx-export.pptx）/ import_pptx（pptxtojson cover 置换）
- [x] 4.5 UI：ai-guide ＋ ?sample=（确定性双页示例）＋ #status ＋ Vue 岛容器
- [x] 4.6（追加）绿门实证竞态修复：初始 mock 载入与写入竞态——bridge 初始
      deck 落定门（非空＋长度稳定才报就绪）＋sample 重置等待初始 deck

## 5. 绿门扩展

- [x] 5.1 webmcp-check：EXPECT ＋3 编辑站；编辑站 executeTool 全链（就绪等待
      重试→真下载＋文件名契约＋ok 终态）；easy-* 既有断言原样保留
      （31 断言全绿；两处实现怪癖实证修正见 commit af3c768）
- [x] 5.2 smoke-check 真文件断言升级（编辑器路径）：xlsx set_cells+set_formula
      →get_snapshot 核验→导出→SheetJS Node 反读逐格（值/数字/公式 f＋计算值
      v）；docx 三写工具→状态核验→导出→解 zip（Heading2/<w:b/>/<w:i/>/表格）
      ＋mammoth 独立回读；pptx 三写工具→deck 核验→导出→解 zip slideN.xml
- [x] 5.3 Univer 双坑回归断言：幽灵工作簿注入→set_cells 必须 ok:false（含幽灵
      判定文案）→恢复健康后 ok:true；Rendered 门禁挂起→必须 ok:false（含未渲染
      文案）→释放后 ok:true 且写入落快照
- [x] 5.4 directory 断言更新（10 卡现役/0 建设中 Badge；「图片」搜索 1→2 实况
      ＋「univer」唯一性抽查）；easy-* 既有断言零缩水

## 6. 文档与收口

- [x] 6.1 README（三编辑站段落＋许可分区）/ AGENTS.md（AGPL 隔离纪律＋双坑
      防御纪律）/ openspec project.md（端口 5278~5280、编辑器现役）/ deploy/
      tools-upload.sh 白名单 ＋3
- [x] 6.2 体积纪律验证：编辑器库独立 chunk（univer-boot 1.70MB gzip；
      tiptap-boot 135KB gzip；pptx island 1.66MB 级）；黄页与其余站产物 grep
      零编辑器库代码（registry 描述文案除外）
- [x] 6.3 绿门全量重跑：pnpm -r check && pnpm -r build && webmcp:check（31/31）
      && smoke:check（34/34）
- [x] 6.4 headless 全链自测：每站 WebMCP 写入→编辑器状态核验→导出→反读
      （probe 脚本三站全过，证据见验收附注）
- [x] 6.5 小步中文 commit（不 push）；openspec 任务勾选

## 附：验收证据（2026-10-31 实测）

- webmcp-check 31/31 全绿：11 站 × 原生/polyfill 双路径枚举齐；easy-* 三站
  create_* 全链真下载；编辑器三站「写入（就绪重试）→导出真下载＋文件名契约」
  全链（xlsx-export.xlsx / docx-export.docx / pptx-export.pptx）。
- smoke-check 34/34 全绿（既有 26 项零缩水＋8 项编辑器路径）：
  - xlsx 编辑器：A9=绿门探针 · B9=42.5(n) · B10 f=B9*2 v=85（引擎真算）。
  - 双坑回归：幽灵注入 ok=false（含幽灵判定）→恢复 ok=true；门禁挂起
    ok=false（含未渲染判定）→释放 ok=true 且写入落快照。
  - docx 编辑器：zip 17 项 · document.xml 含标题/Heading2/<w:b/>/<w:i/>/表格
    · mammoth 独立回读全命中。
  - pptx 编辑器：zip 49 项 · slide2.xml 含改名标题/要点/追加要点。
- 双坑防御本地矩阵实证（1.3.1）：sheets 数组形态与 sheet 缺 id（Record 无 id）
  →写入不落快照（幽灵）；Record 带 id 无 sheetOrder/sheetOrder 缺项 →不中招
  （Univer 自合成）。防御按真实边界落位：seed 工厂＋assertCompleteSeed＋canary
  落盘校验＋健康绑定 workbookId。
- 产物隔离：黄页与其它工具站 dist grep 零编辑器库可执行代码（registry 描述
  文案除外）；apps/pptx dist ≈48MB（上游 CJK webfonts 随附，浏览器按需加载）。
- 实现怪癖记录：Chrome 原生 WebMCP 注册队列对高频 getTools() 轮询敏感
  （250ms 轮询→后注册工具永久丢失）；同浏览器连续多站枚举后开页面不收敛——
  枚举改「页面就绪后低频单次枚举×8＋每站独立浏览器」，全链断言靠 executeTool
  就绪重试容忍抖动。
