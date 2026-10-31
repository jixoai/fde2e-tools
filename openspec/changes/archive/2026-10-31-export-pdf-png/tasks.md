# Tasks: export-pdf-png

## 1. 技术验证（先行，最大风险前置）

- [x] 1.1 Univer canvas 捕获实验：html2canvas 经 vendored bundle worker（toCanvas）
      对 `.univer-canvas-wrap` 原样拷贝——像素级捕获成功（网格数据/公式计算值/
      工具栏/页签全部在图；非白像素 16%，深色文字像素 0.58%）；**色守卫必须
      先挂**（裸捕获 100% 炸 oklch）。证据：/tmp/xlsx-capture.png（probe 实跑）
- [x] 1.2 jsPDF 组装实验：bundle 只暴露 `window.html2pdf`（html2canvas/jspdf
      均不泄漏为全局）——经 worker `prop.pdf` 取 jsPDF 实例，`deletePage(1)`（先
      读 pageSize 再删）＋`addPage`＋`addImage`＋`output("blob")` 组装多页 PDF
      实测 `%PDF-` 头 2 页（`new ctor()` 不可行：prop.pdf.constructor=Object）

## 2. 共享层 packages/shared

- [x] 2.1 `export-kit.ts`：`withColorGuard(fn)`（export-color-guard 通用化迁入）
      ＋ `renderNodeToPng(node,{width?,scale?})`（16384px 上限：先降 scale 再
      截断＋诚实标注）＋ `pngsToPdf(blobs,{orientation?,pageSize?})`（worker
      prop.pdf 组装）＋ `waitForImageDecode` 等内部助手
- [x] 2.2 pdf-tool 改引 shared（删原地 export-color-guard.ts 副本）
- [x] 2.3 vendored 落位：html2pdf.bundle.min.js 同一副本（sha 一致）拷入
      apps/xlsx / apps/docx / apps/pptx 的 public/assets/（站点独立可部署）；
      各站 index.html 普通 script 载入；README license 记 html2canvas(MIT)/
      jsPDF(MIT)

## 3. 三站接线（工具＋按钮＋状态行）

- [x] 3.1 apps/xlsx：`export_pdf`（.univer-canvas-wrap 捕获 → A4 纵向 PDF，
      守卫必挂）＋ `export_png`（快照数据自绘 HTML 表格→整簿长图；canvas 只有
      视口区，全量内容走数据面——路径裁决记入 ai-guide）＋按钮
      export-pdf-btn / export-png-btn ＋ export.ts 人机同路径
- [x] 3.2 apps/docx：`export_pdf`（纸面节点离屏克隆 → html2pdf pagebreak 分页
      A4 纵向）＋ `export_png`（整篇文档一张长图）＋按钮＋export.ts
- [x] 3.3 apps/pptx：复用 PPTist 内核（ThumbnailSlide 离屏 Vue 岛＋html-to-image，
      vendored 零改动）——`export_pdf`（每页一页横向 PDF）＋ `export_png`
      （逐页 PNG 多文件下载，间隔防多下载拦截）＋ `export_long_png`（纵向拼一张
      长图，超 16384px 自动缩 size）＋三按钮＋export.ts
- [x] 3.4 WebMCP 纪律：工具 execute 只在产物落定后返回 ok:true（「已生成」终态）；
      状态行「正在导出…」中间态不含终态词（B3 词表）；未就绪 ok:false 人话错误

## 4. registry / ai-guide / 文档

- [x] 4.1 registry：xlsx/docx tools 面 ＋2、pptx ＋3（描述含文件名契约）
- [x] 4.2 三站 AI_GUIDE 更新（新工具＋按钮 id＋文件名契约＋xii 长图路径说明）
- [x] 4.3 README 许可分区补 html2canvas/jsPDF/html-to-image 行；本 change 任务勾选

## 5. 绿门扩展（既有断言零缩水）＋全量重跑

- [x] 5.1 webmcp-check：EXPECT 三站工具清单扩展；编辑器全链追加三站 export_pdf
      （真下载＋%PDF 头）与 export_png（真下载＋PNG 头）断言
- [x] 5.2 smoke-check：xlsx export_pdf（%PDF）＋export_png（PNG 像素解码非平凡
      ——空图证伪）；docx export_pdf（%PDF）＋export_png（PNG 头＋高>宽）；
      pptx export_pdf（%PDF＋页数≥页数）＋export_png（≥2 文件逐页）＋
      export_long_png（高>宽长图）
- [x] 5.3 `pnpm -r check && pnpm -r build` 全绿；webmcp:check / smoke:check 全绿
      （新断言实跑通过，既有断言零缩水）

## 6. 收口

- [x] 6.1 小步中文 commit（不 push）
- [ ] 6.2 change 归档（交付验证后随 commit 入库）

## 7. 追加（排障实证 2026-10-31，实现期发现）

- [x] 7.1 **pdf-tool 空白产物修复（既有 bug）**：html2pdf 只把克隆 position 重置为
      relative 不重置 left——export-area 的 left:-10000 令克隆整体漂出容器，导出
      产物近空白（3058 字节空壳；既有绿门 %PDF 头＋size≥1000 断言抓不到）。
      修复＝shared `normalizeWorkerContainer`（克隆回原点＋容器按目标尺寸定宽高）
      接入 pdf-tool / docx 的 .save() 管线；pdf-tool 产物 278KB 完整周报（目检）
- [x] 7.2 **色守卫两级扩展**（Univer 局部主题变量实证）：①变量钉扎从 :root/.dark
      扩为**任意选择器**的 oklch 变量全量钉扎（含 @layer 递归）；②新增**导出子树
      字面量 oklch 计算色内联钉扎**（sweepScopeColors，withColorGuard scope 参数）
      ——变量钉扎挡不住字面量/局部变量路径。probeJsPdf 自带守卫（pptx 无外层守卫
      仍需过 html2canvas 文档底色解析）
- [x] 7.3 **xlsx 快照空壳行防御**：canary 探针在远端行写入又清空，快照留空壳行键
      ——长图 used range 只认有内容格（v/f 渲染文本非空），防长图撑出上百空行
- [x] 7.4 **对抗审查回单闭合（8.5/10 → 修后重跑全绿）**：P1＝pptx 三导出工具
      未就绪走异常通道（execute promise reject）→ captureSlidePngs 三通道全包
      try/catch 转 {ok:false} 人话返回（WebMCP 与按钮同源受益）；P2＝捕获失败
      泄漏离屏 Vue 岛 → catch 内先 cleanup() 再上抛；顺手＝xlsx/docx 四个导出
      函数全管线 try/catch 转 {ok:false}（站内风格统一）。新增绿门断言
      「未就绪门」（smoke 38/38）：xlsx forcePending 挂起→resolve {ok:false}；
      pptx CDP 限速岛加载窗口早调用→resolve {ok:false} 不 reject（P1 回归）

## 8. v2 视觉验收返工（2026-10-31，判词逐条闭合）

- [x] 8.1 **最小验证（先行门禁）**：vendored jsPDF 4.0.0 + Noto Sans SC 子集
      → 浏览器实跑生成中文文本 PDF，`pdftotext` 实测提取「青旅运营周报 · 2026
      第 43 周 / 门店营收 128,600 元，入住率 82%」等完整中文（方案成立）。
- [x] 8.2 字体资产：Noto Sans SC Regular/Bold 子集（GB2312 全字符＋人名/地名
      补充 7588 码位，pyftsubset；每字重 ≈2.2MB）落 `packages/shared/assets/
      fonts/`，Vite 各站 dist 各出一份；OFL.txt 记来源/再生成命令/许可全文。
- [x] 8.3 `@fde2e-tools/shared/pdf-vector`：VectorPdf（jsPDF 实例获取/注册字体/
      中英混排断行/文块/矩形/线条/页脚页码/缺字显式替身），并有覆盖率探测
      （cmap 反查，缺字画 ? 且计数）。
- [x] 8.4 xlsx：`export_pdf` 改快照数据矢量绘制（列宽自适应＋表头加粗底色＋
      数字右对齐＋多页重复表头＋页脚页码；不碰 Univer DOM）；长图补页边距/
      列宽自适应；canary 哨兵导出侧视作空（PDF/xlsx 桥双防线）。
- [x] 8.5 docx：`export_pdf` 改 TipTap JSON→块模型→矢量绘制；`export_png` 改
      块模型→结构化 HTML（P1 四项闭合：圆点/内联代码基线对齐、表头统一加粗
      ＋底色、行高 1.6、无容器边框白条）。
- [x] 8.6 pptx：`export_pdf` 改 slides 数据矢量绘制（16:9/标题 32pt/要点 18pt/
      页眉带/右下页码）；`export_long_png` 补卡框＋间隔带＋「— i/n —」页码。
- [x] 8.7 示例去污染：xlsx＝青旅房源价格表（7×8）＋周营收（7×9，含公式）；
      docx＝门店周报（三级标题/列表/表格/引用）；pptx＝周会 3 页（每页 4-5 要点）。
- [x] 8.8 绿门强化：`scripts/pdf-assert.mjs`（pdftotext 文本层＋中文＋关键词＋
      无 UI 特征词；pdftoppm 光栅化非白像素 ≥3%）接入 smoke-check 与
      webmcp-check；既有断言零缩水。
- [x] 8.9 `pnpm -r check && pnpm -r build` 全绿；smoke-check / webmcp-check
      重跑全绿（证据见本轮报告）。

## 9. 终验回单（2026-10-31 下午）：F1/F2 ＋ 选择性导出

- [x] 9.1 **F1**：xlsx-long 去 A–G 列头/行号列/角格（DOM 实测：thead=数据首行、
      tbodyTh=0、无列字母、meta 无开发说明语汇）。
- [x] 9.2 **F2**：pdf-vector 抽 wrapByMeasure（measure 注入）＋CJK_FONT_URLS；
      pptx 新增 TEMPLATE 样式源/computeSlideLayout 共享布局/canvas 模板位图
      渲染器（FontFace 同字体源）；export_png/export_long_png 纯文本 deck 走
      模板通道（复杂 deck 保留 ThumbnailSlide 裸捕获）。位图页与 PDF 页同构
      实测：正文占宽 84.6%/84.6%，标题/要点字号 53/30px（位图）vs 44/25px（PDF）。
- [x] 9.3 **选择性导出**：pptx pages / xlsx sheets / docx section 三站三形态
      （解析/越界与缺名人话报错/文件名 tag/返回值 selected），shared
      withSelectionTag 单源（超长截断）；schema 与描述同步（含示例）。
- [x] 9.4 绿门：smoke-check 新增「编辑器选择性导出」check（pptx pages=[2]
      单页＋内容正反断言、xlsx sheets 单表、docx section 单节、越界/缺节/缺表
      人话报错）；smoke 39/39 全绿、webmcp-check 原生/polyfill 双路径全绿。

## 10. xlsx 导出能力三层＋接口一致性（2026-10-31 晚，G1/G2/G3 ＋ items 统一）

- [x] 10.1 **G1 items 统一选择器**（接口重设计：sheet+range 平行参数收回
      items 单元）：`export_pdf/export_png/export_xlsx` 加 `items`
      （`{sheet: 表名|1起序号, range?: "A1:F20"}` 单元数组）；sheets（表名/1起
      序号数组）降为兼容糖；items×sheets 同传人话报错；区域 ∩ usedRange 收敛
      （文件名/返回值按收敛后区域，如 A1:Z99→A1:D6）；多单元 PDF 每单元一节、
      顺序按 items；文件名 `xlsx-export-<单元1>-<单元2>.pdf`（区域单元
      `表名-A1F20`）；resolveExportSelection/buildUnitWorkSnapshot 落
      snapshot.ts 单源（A1 地址解析 parseA1/parseA1Range/encodeA1 同迁）。
- [x] 10.2 **G2 寻址加固**：import_xlsx 重名表防御（外部构造文件可携带重名
      表，SheetJS read 的 wb.Sheets 按名字键互相覆盖、两表数据塌缩成最后一张
      ——本地 0.20.3 矩阵实证）→ zip 级改名手术（xlsx-dup-repair.ts：中央目录
      解析＋workbook.xml 重名改写「周报 (2)」＋STORE 重建，DecompressionStream
      deflate-raw＋自实现 CRC-32，不可解形态原样返回）＋桥接层
      dedupeSheetNames 兜底＋返回值 warning 声明。
- [x] 10.3 **G3 trim 契约钉死**：planSheetDraw 单源（PDF/PNG 双路径共用）——
      行域＝首末内容行之间**中间空行保留**（占位全宽）；有内容行右边界＝自身
      最右内容列（不规则右边界：右侧空区不画格线不渲染空格）。三绿门断言：
      ①尾部空区不进产物（远端 canary 壳键 → 产物恰 1 页＋文本无 __canary__）；
      ②中间空行占位（pdftotext -bbox 行距几何证据：R2→R4 行距 ≈2×R1→R2）；
      ③不规则右边界（绘制计划 seam＋HTML td 数结构断言）。usedRange 扩
      minR/minC 返回。
- [x] 10.4 绿门：smoke-check 新增 4 个 xlsx check（trim①+区域收敛、items 三
      形态＋序号 sheets＋7 项非法入参、trim②③、重名导入）＋pdf-assert 新增
      pdfWordBoxes；webmcp-check 非法入参矩阵；既有断言零缩水（v1 sheets 表名
      形态 selected/文件名断言原样保留）。
