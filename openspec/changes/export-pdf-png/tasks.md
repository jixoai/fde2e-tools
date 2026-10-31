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
