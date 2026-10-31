# change: office-editorial-upgrade

## Why

xlsx/docx/pptx 主域名（`<id>.tool.fde2e.com`）此前是「建设中」占位（Owner
2026-10-31 裁决让位给专业编辑器）。选型 digest
（`.agents/reports/fde2e-tools/editor-upgrade-digest.md`，2026-10-31 实调）已
定稿三站内核与风险方案：

- **xlsx 站 = Univer（preset-sheets-core，Apache-2.0）**：真表格网格（多
  sheet 页签/单元格编辑/公式引擎）。官方 Exchange（xlsx 导入导出）是 Pro 收费
  ——纯 OSS 路线＝Univer ↔ SheetJS 自建双向桥（实调往返成功：值/公式/基础样式
  保留）。
- **docx 站 = TipTap v3（MIT）**：headless 富文本（标题/段落/列表/表格/粗斜）。
  官方 DOCX 转换是 Pro 云服务——自建桥（TipTap JSON → docx 库导出真 .docx；
  mammoth 导入 .docx → HTML）实调通过。
- **pptx 站 = PPTist 整库嵌入（AGPL-3.0，Owner 已按推荐方向拍板执行）**：
  Pinia store 即编程面（addSlide/updateElement 实调通过），`exportPPTX` 产真
  .pptx，`useImport`（pptxtojson）支持真 .pptx 导入。

AI 经 WebMCP 像操作本地 Office 一样驱动编辑器内核（工具直接调内核 API，不再
走 DOM 桥）。digest 定位的 **Univer 两大坑（库级 footgun，官方 playground
100% 复现）必须内建防御**：

1. **幽灵工作簿**：`createWorkbook` 的 seed 必须用完整快照格式（`sheets` 为按
   sheetId 的 Record ＋ `sheetOrder` 数组＋各 sheet 带 id）——简化格式创建的
   工作簿**静默拒绝一切写入**（幽灵「range protected」弹窗、save() 冻结在创建
   态）。
2. **Rendered 前写入静默失败**：生命周期未到 Rendered（stage 2，加载后
   1~2s）时 Facade 写命令静默失败/被权限拦截。

## What Changes

- **apps/xlsx（新）**：Univer preset-sheets-core 真表格网格工作区
  （solid-glass 外框包 Univer 画布）；编辑真相源＝Univer snapshot；SheetJS
  降级为文件编解码器（双向桥：导入 .xlsx → 快照；导出快照 → 真 .xlsx）；WebMCP
  工具面 `set_cells` / `set_formula` / `format_range` / `add_sheet` /
  `import_xlsx` / `export_xlsx` / `get_snapshot`（只读）；工具层内建双坑防御
  （完整快照格式 seed 单源工厂＋canary 写入校验；Rendered 门禁——未就绪一律
  `ok:false` 拒绝，禁静默失败）；`?sample=` 载入示例。
- **apps/docx（新）**：TipTap v3 真文档工作区（StarterKit＋Table；solid-glass
  外框）；TipTap JSON 为真相源；docx@9（MIT）导出真 .docx + mammoth（BSD-2）
  导入 .docx；WebMCP `set_content` / `append_markdown` / `insert_table` /
  `insert_heading` / `export_docx` / `import_docx`；`?sample=`。
- **apps/pptx（新）**：PPTist（上游 v2.0.0，AGPL-3.0）整库嵌入——源码自包含于
  `apps/pptx/src/pptist/`（逐字 vendor 零改动，仅排除其 main.ts 入口），React
  solid-glass 外框挂 Vue 编辑器岛；Pinia store 驱动 WebMCP `add_slide` /
  `set_title` / `add_bullets` / `export_pptx` / `import_pptx`（pptxtojson）；
  **AGPL 隔离纪律**：apps/pptx 目录独立 LICENSE（AGPL-3.0）＋目录级 README 声明
  许可边界；PPTist 代码禁入 packages/shared 或其它 MIT/Apache app；仓库根
  README 增许可分区说明。
- **registry**：xlsx/docx/pptx 三条 comingSoon 占位转现役（去 comingSoon，
  subdomain 不变＝主域名，urlParams=?sample=，webmcpTools 面单填实，repoPath
  落 apps/<id>）；黄页自动收录为现役卡。
- **绿门扩展（既有断言零缩水）**：
  - webmcp-check：EXPECT ＋3 编辑站工具枚举；三站 executeTool 全链（等待编辑器
    就绪→写入→导出真下载＋文件名契约）。
  - smoke-check：真文件断言升级为**编辑器路径**——每站「WebMCP 写入→编辑器
    状态核验→导出→反读」（xlsx 用 SheetJS Node 侧逐格核对含公式；docx/pptx
    解 zip 核对 OOXML）；**Univer 双坑各加一条回归断言**（幽灵工作簿写入必须
    `ok:false`＋健康恢复后 `ok:true`；Rendered 门禁挂起时写入必须 `ok:false`，
    释放后 `ok:true`）。
  - 轻量线 easy-* 全部既有断言原样保留。
- **体积纪律**：Univer（≈1.84MB gzip）与 PPTist 大库一律 dynamic import 懒
  加载独立 chunk；黄页与其余工具站产物 grep 零编辑器库代码。
- **端口**：xlsx 5278 / docx 5279 / pptx 5280（回环，续 5271~5277 惯例）。

## Capabilities

### 新增

- `office-editors`：三编辑站能力（编辑器工作区 / WebMCP 工具面直调内核 /
  双向桥保真边界 / 体积懒加载 / `?sample=` 契约）。
- `univer-write-gate`：Univer 双坑防御 Requirement（完整快照格式 seed 单源＋
  canary 写入校验拒绝幽灵工作簿；Rendered 生命周期门禁——就绪前写命令一律显式
  `ok:false`）＋绿门回归断言要求。

### 修改

- `real-file-assertion`：真文件断言升级为编辑器路径（WebMCP 写入→编辑器状态
  核验→导出→第三方解析器反读；Univer 双坑回归断言）。

## Impact

- apps/ 新增三个编辑站 app（xlsx 5278 / docx 5279 / pptx 5280）。
- license 面变化：apps/pptx 目录及其上游依赖为 **AGPL-3.0**（PPTist）——目录
  级 LICENSE/README 隔离；仓库根保持 Apache-2.0（独立程序边界），README 增许可
  分区说明；easy-* 生成链「禁 AGPL」红线不变且不放宽。
- devDeps：mammoth（真文件反读独立验证，BSD-2）；@vitejs/plugin-vue、vue、
  pinia 等进 apps/pptx 自身依赖（不进 shared）。
- webmcp-check.mjs / smoke-check.mjs 扩容；README / AGENTS / project.md /
  deploy/tools-upload.sh 白名单同步。
- 服务器侧（编排者）：xlsx/docx/pptx.tool.fde2e.com 三 vhost 由 easy-* 泛域名
  形态切换为主域名形态（本仓只产出静态目录，上传白名单＋3）。
