# Tasks: office-suite

## 1. 轨一 · 构建三站

- [x] 1.1 registry 加三条（xlsx/docx/pptx：id/名称/一句话/子域/标签/?sample= 契约/WebMCP 入口点）
- [x] 1.2 根 package.json：dev:xlsx(5275)/dev:docx(5276)/dev:pptx(5277) + 绿门 devDeps（xlsx CDN tarball、adm-zip）
- [x] 1.3 apps/xlsx：SheetJS 生成（JSON sheets + TSV 粘贴表格双输入、解析单源、动态 import 分包）+ ai-guide + ?sample=
- [x] 1.4 apps/docx：md 子集解析单源（AST 驱动预览与 docx 模型）+ docx 库生成 + ai-guide + ?sample=
- [x] 1.5 apps/pptx：slides JSON → pptxgenjs 生成（title/bullets/notes）+ ai-guide + ?sample=
- [x] 1.6 三站 WebMCP：create_xlsx/add_sheet_sample、create_docx/append_docx_markdown、create_pptx/add_slide（结构化 schema 站内定义 + untrustedContentHint）

## 2. 绿门扩容（真文件断言）

- [x] 2.1 webmcp-check：EXPECT +3 站；原生路径 executeTool 全链（真下载捕获 + 文件名契约 + 终态 ok）；polyfill 枚举
- [x] 2.2 smoke-check：xlsx 生成 → SheetJS Node 反读核对单元格；docx/pptx 生成 → 解 zip 核对 document.xml/slide1.xml/notesSlide 关键内容
- [x] 2.3 directory 冒烟扩容到 6 卡 + 搜索计数投影更新（存量断言一字不破）

## 3. 轨二 · 编辑器部署（形态合规先行）

- [x] 3.1 editor-hosting 规格落位（AGPL 合规形态 + source 指引 + 深度集成禁令 + 二期方案）
- [x] 3.2 deploy/editor-fetch.sh（钉 digest 拉取/验证准备脚本，本轮不执行）
- [x] 3.3 README 取舍记录（上游 release 无产物/自建成本/镜像编码配置三事实）

## 4. 文档与收口

- [x] 4.1 README / AGENTS / openspec project.md：七 app、端口 5275~5277、WebMCP 表、license 记录（SheetJS CDN 0.20.3 形态 + npm 0.18.5 CVE 规避）
- [x] 4.2 绿门全绿：pnpm -r check && pnpm -r build && webmcp:check（20/20）&& smoke:check（24/24，含真文件反读证据）
- [x] 4.3 小步中文 commit（不 push）；openspec 任务勾选

## 附：验收证据（2026-10-31 实测）

- webmcp-check：20/20 全绿——七页面原生/polyfill 双路径枚举齐；三站 create_* 全链
  真下载（xlsx-export.xlsx / docx-export.docx / pptx-export.pptx）+ ok 终态。
- smoke-check：24/24 全绿——反读证据：
  - xlsx：SheetJS 反读 2 表（报销明细/汇总），B2=1280.5(n) B4=-80(n) B5=true(b)
    汇总 B2=张三；TSV 路径 ## 分表（表A!B2=3.5(n)、表B!B1=-2(n)）。
  - docx：zip 17 项，document.xml 含标题/列表/表格文本 + `<w:b/>`/`<w:i/>` 标记 +
    wordprocessingml 命名空间。
  - pptx：zip 47 项，slide1.xml 含标题与 bullet、notesSlide1.xml 含备注、
    slide3.xml 含第三页标题。
- 体积纪律：xlsx chunk 492KB / pptxgen chunk 368KB / docx chunk 独立；黄页与其余
  工具站产物 grep 零生成库代码（registry 描述文案除外）。
