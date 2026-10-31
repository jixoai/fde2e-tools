# Tasks: office-editorial-upgrade

## 1. 规格与 registry

- [ ] 1.1 openspec specs 增量落位（office-editors / univer-write-gate 新增，
      real-file-assertion 修改）
- [ ] 1.2 registry 三条 comingSoon 占位转现役（xlsx/docx/pptx：去 comingSoon、
      名称/描述/aiGuide 换编辑器形态、urlParams=?sample=、webmcpTools 填实、
      repoPath=apps/<id>）
- [ ] 1.3 directory 黄页适配（registry 驱动自动生效；页首 AI 说明「建设中」段
      更新为编辑器现役表述）

## 2. apps/xlsx · Univer 编辑器

- [ ] 2.1 脚手架（package.json / vite 5278 / tsconfig / solid-glass 外框）
- [ ] 2.2 编辑器内核：dynamic import preset-sheets-core；完整快照格式 seed 单源
      工厂（禁简化格式）；LifecycleGate（Rendered 门禁＋测试缝）；canary 写入
      校验（幽灵工作簿运行时探测）
- [ ] 2.3 SheetJS 双向桥：快照 → .xlsx 导出（值/公式/基础样式/列宽）；.xlsx →
      快照导入；导出文件名契约 xlsx-export.xlsx（safeFilename 单源）
- [ ] 2.4 WebMCP 工具面：set_cells / set_formula / format_range / add_sheet /
      import_xlsx / export_xlsx / get_snapshot（全量过 Rendered 门禁＋健康
      校验，未就绪 ok:false）
- [ ] 2.5 UI：示例载入 / 导入 / 导出按钮（非受控 file input）＋ #status 终态
      文案 ＋ ai-guide ＋ ?sample=

## 3. apps/docx · TipTap 编辑器

- [ ] 3.1 脚手架（package.json / vite 5279 / solid-glass 外框）
- [ ] 3.2 TipTap 工作区（StarterKit＋Table；单例 editor；页面样式为文档内容
      排版层）＋工具栏（标题/粗斜/列表/表格）
- [ ] 3.3 md 子集 → TipTap JSON 转换（append_markdown / set_content markdown
      格式共用单源）
- [ ] 3.4 docx 双向桥：TipTap JSON → docx@9 导出真 .docx（heading/段落/粗斜/
      列表/表格）；mammoth 导入 .docx → HTML → set_content
- [ ] 3.5 WebMCP 工具面：set_content / append_markdown / insert_table /
      insert_heading / export_docx / import_docx ＋ UI（示例/导入/导出/
      ai-guide/?sample=）

## 4. apps/pptx · PPTist 嵌入

- [ ] 4.1 vendor PPTist v2.0.0 源码至 apps/pptx/src/pptist/（逐字零改动，仅
      排除其 main.ts 入口；vendor README 记录来源/版本/许可/排除项）＋ public
      资产（mocks/imgs/favicon）
- [ ] 4.2 AGPL 隔离：apps/pptx/LICENSE（AGPL-3.0 全文）＋目录级 README 许可
      边界声明＋仓库根 README 许可分区说明；grep 验证 PPTist 代码零泄漏进
      packages/shared 与其它 app
- [ ] 4.3 Vue 岛挂载：React solid-glass 外框 ＋ bridge（createApp＋pinia＋
      directive＋全局样式；暴露 store/export/import 编程面）；vite 双插件
      （react+vue）＋scss/icon 插件链
- [ ] 4.4 WebMCP 工具面：add_slide / set_title / add_bullets（store 驱动，
      元素 schema 与实调一致）/ export_pptx（文件名契约 pptx-export.pptx）/
      import_pptx（pptxtojson，cover 替换）
- [ ] 4.5 UI：ai-guide ＋ ?sample= ＋ #status ＋ Vue 岛容器

## 5. 绿门扩展

- [ ] 5.1 webmcp-check：EXPECT ＋3 编辑站；编辑站 executeTool 全链（就绪等待
      重试→真下载＋文件名契约＋ok 终态）；easy-* 既有断言原样保留
- [ ] 5.2 smoke-check 真文件断言升级（编辑器路径）：xlsx set_cells+set_formula
      →get_snapshot 核验→导出→SheetJS Node 反读逐格；docx set_content+
      insert_heading/insert_table→导出→解 zip 核对 document.xml；pptx
      add_slide/set_title/add_bullets→导出→解 zip 核对 slideN.xml
- [ ] 5.3 Univer 双坑回归断言：幽灵工作簿注入→set_cells 必须 ok:false→恢复
      健康后 ok:true；Rendered 门禁挂起→set_cells 必须 ok:false→释放后 ok:true
- [ ] 5.4 directory 断言更新（10 卡现役/0 建设中 Badge；搜索词唯一性复核）；
      easy-* 既有断言零缩水

## 6. 文档与收口

- [ ] 6.1 README（三编辑站段落＋许可分区）/ AGENTS.md（AGPL 隔离纪律＋部署
      白名单）/ openspec project.md（端口 5278~5280、编辑器现役）/ deploy/
      tools-upload.sh 白名单 ＋3
- [ ] 6.2 体积纪律验证：编辑器库独立 chunk；黄页与其余站产物 grep 零编辑器
      库代码
- [ ] 6.3 绿门全量重跑：pnpm -r check && pnpm -r build && webmcp:check &&
      smoke:check
- [ ] 6.4 headless 全链自测：每站 WebMCP 写入→编辑器状态核验→导出→反读
- [ ] 6.5 小步中文 commit（不 push）；openspec 任务勾选
