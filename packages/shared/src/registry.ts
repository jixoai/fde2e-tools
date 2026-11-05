/*
 * 工具 registry 单源 —— packages/shared/src/registry.ts
 *
 * 角色：全仓工具元数据的**唯一可信源**。黄页（apps/directory）从它渲染工具卡片
 * 与搜索索引；各工具 app 自身也消费它（页头标语/元信息与黄页不漂移）。
 * **加新工具 ＝ 本文件加一条 + 新建 apps/<id>/**，其余零改动。
 *
 * WebMCP：`tools` 字段登记每个工具经 document.modelContext 暴露的可调用
 * 入口（schema 从 urlParams 派生）；黄页可直接渲染「该工具有哪些可调用能力」。
 *
 * URL 参数契约（urlParams）：三个存量工具已有智能体在按参数调用，契约文档
 * 必须与 apps/<id> 实现逐字对齐——改参数语义 = 改这里 + 改 app + 改 ai-guide。
 */

/** 工具的 URL 参数契约项（文档单源；实现以各 app 为准，两者不一致视为 bug） */
export interface ToolUrlParam {
  /** 参数名（如 src、autoload、q） */
  name: string;
  /** 一句话语义说明 */
  description: string;
  /** 可选值枚举（派生 JSON Schema 时带上） */
  enum?: string[];
}

/**
 * WebMCP 入口点：本工具经 document.modelContext 注册的可调用能力。
 * name 与各 app src/webmcp.ts 的注册保持一致；入参 JSON Schema 由
 * shared/webmcp.ts 的 schemaFromUrlParams 从 urlParams 派生（单源不落两份）。
 */
export interface ToolEntryPoint {
  /** 工具名（spec 约束：1-128 字符，[a-zA-Z0-9_.-]） */
  name: string;
  /** 一句话说明 */
  description: string;
}

export interface ToolMeta {
  /** 工具 id：同时是子域前缀（<id>.tool.fde2e.com）与 apps/ 目录名 */
  id: string;
  /** 展示名 */
  name: string;
  /** 一句话定位 */
  tagline: string;
  /** 稍长描述（黄页卡片正文） */
  description: string;
  /** 检索标签 */
  tags: string[];
  /**
   * 独立站子域（域名体系 Owner 2026-10-30：<tool>.tool.fde2e.com；
   * 2026-10-31 裁决：轻量生成线用 easy-* 前缀子域，xlsx/docx/pptx 主域
   * = 专业编辑器（office-editorial-upgrade 已现役，占位目已转正式条目）。
   */
  subdomain: string;
  /** 给 AI/自动化代理的用法摘要（黄页展示；全文以各工具页内 #ai-guide 为准） */
  aiGuideSummary: string;
  /** URL 参数契约文档（契约保真红线：已有智能体在用，一字不改） */
  urlParams: ToolUrlParam[];
  /** WebMCP 预留位（本轮为空数组） */
  tools: ToolEntryPoint[];
  /** 仓库内实现路径 */
  repoPath: string;
  /**
   * 建设中占位目（可选，缺省 false）：独立站尚未上线，本条仅作黄页占位——
   * 黄页渲染「建设中」Badge 且禁用「打开工具」入口（当前无占位条目：
   * xlsx/docx/pptx 专业编辑器已于 2026-10-31 office-editorial-upgrade 转现役）。
   */
  comingSoon?: boolean;
}

/** 独立站首页 URL */
export function toolHomeUrl(tool: ToolMeta): string {
  return `https://${tool.subdomain}/`;
}

/**
 * 实况预览是否可用（iframe 嵌各工具子域）：
 * 仅当黄页自身跑在 fde2e.com 生产域时启用 iframe（X-Frame-Options 放行由
 * 服务器侧配置）；本地构建/预览一律走「新窗口打开」兜底。
 */
export function livePreviewAvailable(locationHost: string): boolean {
  return locationHost === "tool.fde2e.com" || locationHost.endsWith(".fde2e.com");
}

export const TOOLS: ToolMeta[] = [
  {
    id: "pdf-tool",
    name: "PDF 工具站",
    tagline: "把网页内容变成 PDF",
    description:
      "粘贴 Markdown 或 HTML → 渲染预览 → 一键导出 PDF（A4 纵向）。纯前端工具，内容不离开本机；marked.js + html2pdf.js 全部本地内嵌，无外网依赖。",
    tags: ["pdf", "markdown", "html", "导出", "文档"],
    subdomain: "pdf-tool.tool.fde2e.com",
    aiGuideSummary:
      "内容填入 <textarea id=input-content>（MD/HTML 自动识别），点 render-btn 渲染预览，export-btn 导出 pdf-tool-export.pdf；?autoload=sample 自动载入示例直达导出。",
    urlParams: [
      {
        name: "autoload",
        description: "值=sample（或「示例」）：自动载入内置示例周报并渲染好预览，直接从导出步骤开始",
      },
    ],
    tools: [
      {
        name: "render_preview",
        description: "把 Markdown/HTML 内容填入输入框并触发渲染预览，返回状态行结果",
      },
      {
        name: "export_pdf",
        description: "触发「导出 PDF」（未渲染会先自动渲染），浏览器下载 pdf-tool-export.pdf（A4 纵向；可选 filename 自定义下载文件名）",
      },
    ],
    repoPath: "apps/pdf-tool",
  },
  {
    id: "img-tool",
    name: "图片处理工具站",
    tagline: "URL 参数即绘制指令",
    description:
      "「网页链接＝函数调用」：带参数打开即完成一次渲染——底图加载 → 文字/角标叠加 → 画布渲染。支持 https/data: URL 底图与魔法值 src=sample，产物可下载 PNG 或复制 Data URL。",
    tags: ["图片", "canvas", "水印", "角标", "画布", "url参数"],
    subdomain: "img-tool.tool.fde2e.com",
    aiGuideSummary:
      "GET 参数即绘制指令（src/text/pos/size/color/bg/pad/w/h/label 全可组合，颜色写 %23rrggbb）；结果在 <canvas id=canvas-result>，download-btn 下载 PNG，copy-btn 复制 Data URL。",
    urlParams: [
      { name: "src", description: "底图地址：https 图片 URL / data: URL / 魔法值 sample（内置示例底图，离线可测）；省略进手工模式" },
      { name: "text", description: "叠加文字；换行用 %0A" },
      { name: "pos", description: "文字块垂直位置（默认 bottom）", enum: ["top", "center", "bottom"] },
      { name: "size", description: "文字字号 px（默认随画布宽度自适应，约宽度的 6%）" },
      { name: "color", description: "文字颜色 %23rrggbb（默认白色，无底衬时自动加深色投影）" },
      { name: "bg", description: "文字底衬颜色 %23rrggbb；bg=none 或省略＝无底衬" },
      { name: "pad", description: "内边距 px（默认 24）：底衬厚度/文字块距边距离" },
      { name: "w", description: "输出画布宽 px；只给 w 按底图纵横比推算高" },
      { name: "h", description: "输出画布高 px；与 w 同给＝cover 居中裁切，输出严格 w×h" },
      { name: "label", description: "左上角小角标文字（如「效果图」合规角标）" },
    ],
    tools: [
      {
        name: "overlay_text",
        description:
          "按 URL 参数契约绘制：底图加载 → 文字/角标叠加 → 画布渲染。参数与页面 URL 契约同名（src/text/pos/size/color/bg/pad/w/h/label）",
      },
      {
        name: "export_png",
        description: "触发「下载 PNG」，浏览器下载 img-tool-<宽>x<高>.png（可选 filename 自定义下载文件名），返回结果元信息",
      },
    ],
    repoPath: "apps/img-tool",
  },
  {
    id: "url-tool",
    name: "URL 拼接器",
    tagline: "把复杂参数拼成一个紧凑 URL",
    description:
      "base URL ＋ 参数键值对 → 最终 URL。标准查询串或 packed 紧凑包（JSON → encodeURIComponent → base64url 塞进单一 ?q=）；?decode= 反向解码还原键值对。base64url 自实现，零依赖。",
    tags: ["url", "query", "base64", "编码", "拼接", "url参数"],
    subdomain: "url-tool.tool.fde2e.com",
    aiGuideSummary:
      "?base=<base>&mode=query|packed&<k>=<v>… 打开即出结果（base/mode 为保留键）；?decode=<q值> 反向解码出键值对表。手工：id=base-url 填 base，params-rows 加参数行，copy-btn 复制。",
    urlParams: [
      { name: "base", description: "保留键：base URL；其余非保留参数全部成为拼接参数，打开即生成结果" },
      { name: "mode", description: "保留键：query（标准查询串）| packed（紧凑包 ?q=）；缺省 query", enum: ["query", "packed"] },
      { name: "decode", description: "反向解码：值＝packed URL 里的 q 值，打开自动解析出键值对表" },
      { name: "（其余）", description: "全部成为拼接参数（query 模式保留重复键；packed 重复键保留最后一个）" },
    ],
    tools: [
      {
        name: "pack_url",
        description: "把 base URL ＋ 参数对象拼成最终 URL（纯函数：query 标准查询串或 packed 紧凑包），不经页面输入框",
      },
      {
        name: "decode_url",
        description: "反向解码 packed 的 ?q= 值，还原键值对（纯函数）",
      },
    ],
    repoPath: "apps/url-tool",
  },
  {
    id: "file-viewer",
    name: "通用文件预览站",
    tagline: "浏览器里直接看一切文件",
    description:
      "带 url 参数打开即预览：14 类解码器（image/video/audio/pdf/markdown/text〔含编码切换 UTF-8/auto/GBK/Big5/Shift_JIS/Latin-1〕/json/csv/html/svg/docx/xlsx/pptx/zip）按需加载；未支持格式优雅兜底＋二进制嗅探拒渲染。纯前端零后端，文件字节不落任何服务器。",
    tags: ["文件预览", "解码器", "markdown", "csv", "docx", "xlsx", "pptx", "zip", "视频", "音频", "url参数"],
    subdomain: "file-viewer.tool.fde2e.com",
    aiGuideSummary:
      "/?url=<encodeURIComponent(绝对URL)>（必填）&name=<显示名>&decoder=<解码器id> 打开即预览；decoder 可选 14 解码器 id（svg/image/video/audio/pdf/markdown/json/csv/html/docx/xlsx/pptx/zip/text），缺省自动判定（扩展名 > Content-Type > 文本兜底）；&frameless=1（可配 size=WxH、background）进入无壳截图面（隐藏全部预览器 chrome，渲染落定后 data-frameless-ready=1）；页内 #ai-guide 有同源 demo 示例链接。",
    urlParams: [
      { name: "url", description: "必填：文件的绝对 URL（http/https，encodeURIComponent 编码后放入），打开即拉取并预览" },
      { name: "name", description: "可选：显示名（缺省取 URL 路径末段；影响解码判定与下载命名）" },
      {
        name: "decoder",
        description: "可选：强制解码器 id（未知 id 视为无效，回自动判定）；缺省按 扩展名 > Content-Type > 文本兜底",
        enum: [
          "svg",
          "image",
          "video",
          "audio",
          "pdf",
          "markdown",
          "json",
          "csv",
          "html",
          "docx",
          "xlsx",
          "pptx",
          "zip",
          "text",
        ],
      },
      {
        name: "frameless",
        description:
          "可选：无壳模式。值=1（或 true）时隐藏全部预览器 chrome（顶栏/底栏/媒体控件），只留文件内容本体，适合截图取图；其余值/缺省＝常规预览",
        enum: ["1", "true"],
      },
      {
        name: "size",
        description:
          "可选（仅 frameless）：内容盒尺寸 WxH（CSS px，1–8192 整数，如 1080x1440）；非法/缺省＝视口尺寸（静默回退，不报错）",
      },
      {
        name: "background",
        description:
          "可选（仅 frameless）：无壳背景色（CSS 颜色，如 %23ffffff 表示 #ffffff）；缺省透明",
      },
    ],
    tools: [
      {
        name: "preview_file",
        description:
          "带 url（必填）/name/decoder/frameless/size/background 参数打开文件预览：页面写 URL 即渲染（与浏览器返回键同一条 popstate 通路），返回渲染结果（解码器 id、无壳就绪信号与状态文本）",
      },
    ],
    repoPath: "apps/file-viewer",
  },
  {
    id: "easy-xlsx",
    name: "简易表格生成站",
    tagline: "开箱即用快速档：从数据生成真正的 .xlsx 文件",
    description:
      "轻量快速档：输入 JSON（sheets:[{name, rows[][]}]）或多工作表粘贴表格（TSV，## 表名分表）→ 预览 → 一键得到 .xlsx 下载。SheetJS 社区版（Apache-2.0）浏览器本地生成，零后端零上传。专业编辑场景由另线编辑器承接（建设中）。",
    tags: ["excel", "xlsx", "表格", "简易", "快速", "sheetjs"],
    subdomain: "easy-xlsx.tool.fde2e.com",
    aiGuideSummary:
      "JSON 填入 <textarea id=input-json>（{sheets:[{name,rows}]}）或表格粘贴进 <textarea id=input-tsv>（Tab 分列、## 表名分表），点 generate-xlsx-btn 生成 easy-xlsx-export.xlsx（v2 F19 缺省名，与专业站 xlsx-export.xlsx 区分）；?sample=1 载入示例。",
    urlParams: [
      {
        name: "sample",
        description: "值=sample（或 1/示例）：自动载入内置示例工作簿并刷新预览（不触发生成）",
      },
    ],
    tools: [
      {
        name: "create_xlsx",
        description: "按 sheets 结构生成并下载 easy-xlsx-export.xlsx（v2 F19 缺省名；sheets:[{name, rows[][]}]，可自定义文件名——传 filename 可显式指定任意名），返回表数/行数与状态行结果",
      },
      {
        name: "add_sheet_sample",
        description: "向当前工作簿追加一张示例工作表（可自定义表名），刷新预览并返回工作簿 JSON——细粒度逐表构建",
      },
    ],
    repoPath: "apps/easy-xlsx",
  },
  {
    id: "easy-docx",
    name: "简易文档生成站",
    tagline: "开箱即用快速档：从 Markdown 生成真正的 .docx 文件",
    description:
      "轻量快速档：输入 Markdown 子集（标题/段落/有序无序列表/管道表格/**粗** *斜*）→ 结构预览 → 一键得到 .docx 下载。docx 库（MIT）浏览器本地生成，解析单源（同一 AST 驱动预览与产物），零后端零上传。专业编辑场景由另线编辑器承接（建设中）。",
    tags: ["word", "docx", "文档", "markdown", "简易", "快速"],
    subdomain: "easy-docx.tool.fde2e.com",
    aiGuideSummary:
      "md 子集填入 <textarea id=input-md>（#/##/### 标题、- 列表、1. 列表、| 表格、**粗** *斜*），点 generate-docx-btn 生成 easy-docx-export.docx（v2 F19 缺省名，与专业站 docx-export.docx 区分）；?sample=1 载入示例。",
    urlParams: [
      {
        name: "sample",
        description: "值=sample（或 1/示例）：自动载入内置示例文档并刷新预览（不触发生成）",
      },
    ],
    tools: [
      {
        name: "create_docx",
        description: "按 Markdown 子集生成并下载 easy-docx-export.docx（v2 F19 缺省名；可自定义文件名——传 filename 可显式指定任意名），返回段落数/表格数与状态行结果",
      },
      {
        name: "append_docx_markdown",
        description: "向当前文档追加 Markdown 片段（细粒度逐段构建），刷新预览并返回文档统计",
      },
    ],
    repoPath: "apps/easy-docx",
  },
  {
    id: "easy-pptx",
    name: "简易幻灯生成站",
    tagline: "开箱即用快速档：从大纲 JSON 生成真正的 .pptx 文件",
    description:
      "轻量快速档：输入 JSON（slides:[{title, bullets[], notes?}]）→ 页面大纲预览 → 一键得到 .pptx 下载（16:9）。pptxgenjs（MIT）浏览器本地生成，零后端零上传。专业编辑场景由另线编辑器承接（建设中）。",
    tags: ["powerpoint", "pptx", "幻灯", "演示", "简易", "快速"],
    subdomain: "easy-pptx.tool.fde2e.com",
    aiGuideSummary:
      "slides JSON 填入 <textarea id=input-json>（{\"slides\":[{title,bullets[],notes?}]}），点 generate-pptx-btn 生成 easy-pptx-export.pptx（v2 F19 缺省名，与专业站 pptx-export.pptx 区分）；?sample=1 载入示例。",
    urlParams: [
      {
        name: "sample",
        description: "值=sample（或 1/示例）：自动载入内置示例幻灯并刷新预览（不触发生成）",
      },
    ],
    tools: [
      {
        name: "create_pptx",
        description: "按 slides 结构生成并下载 easy-pptx-export.pptx（v2 F19 缺省名；[{title,bullets[],notes?}]，可自定义文件名——传 filename 可显式指定任意名），返回页数与状态行结果",
      },
      {
        name: "add_slide",
        description: "向当前 slides 追加一页（title/bullets/notes，细粒度逐页构建），刷新预览并返回大纲 JSON",
      },
    ],
    repoPath: "apps/easy-pptx",
  },
  // ---------- 专业编辑器三站（office-editorial-upgrade，2026-10-31 现役）----------
  // Owner 2026-10-31 裁决的落地：xlsx/docx/pptx 主域名 = 真编辑器工作区
  // （Univer / TipTap / PPTist），AI 经 WebMCP 直接驱动编辑器内核；轻量生成
  // 线继续在 easy-* 子域（开箱即用快速档）。
  {
    id: "xlsx",
    name: "专业表格编辑器",
    tagline: "真表格网格工作区：单元格/公式/多表/导入导出 .xlsx",
    description:
      "Univer 真表格网格编辑器（多 sheet 页签、公式引擎真算、样式与数字格式）＋SheetJS 双向桥（导入 .xlsx 即编辑、导出真 .xlsx，值/公式保留；v1 样式与列宽不落导出文件）。AI 经 WebMCP 直接驱动编辑器内核（写入/公式/格式/建表/导入导出/读快照），写入全程生命周期门禁。纯前端零上传。",
    tags: ["excel", "xlsx", "表格", "编辑器", "公式", "univer"],
    subdomain: "xlsx.tool.fde2e.com",
    aiGuideSummary:
      "真表格网格：WebMCP set_cells/set_formula/format_range/add_sheet 直接写内核（未就绪返回 ok:false），import_xlsx({base64}) 导入（重名表自动去重＋warning）、export_xlsx 导出 xlsx-export.xlsx、get_snapshot 读全簿、export_pdf/export_png 展示级导出（矢量 PDF／全簿长图；可选 items 导出单元 {sheet: 表名或1起序号, range?: \"A1:F20\"} 或 sheets 选表）；?sample=1 载入示例。",
    urlParams: [
      {
        name: "sample",
        description: "值=sample（或 1/示例）：载入内置示例工作簿（含公式与样式），可继续编辑或直接导出",
      },
    ],
    tools: [
      { name: "set_cells", description: "向工作表写入二维数据（values[][]，支持数字/字符串/布尔/null；起始锚 start A1 形态主推如 \"A2\"，或 startRow/startCol 0 基 v1 兼容别名，同传报错），返回写入摘要与 A1 起点自证" },
      { name: "set_formula", description: "对 A1 区间写公式（如 =SUM(A1:A9)），返回公式引擎计算值——AI 可自检" },
      { name: "format_range", description: "对 A1 区间设置样式（bold/italic/color/bg/numfmt/align/border）" },
      { name: "add_sheet", description: "新增工作表（可带初始 rows 二维数组），返回表名与全簿表清单" },
      { name: "import_xlsx", description: "导入 .xlsx（base64）为可编辑工作簿，返回表清单与单元格统计；重名表自动去重（「周报 (2)」）并在 warning 声明" },
      { name: "export_xlsx", description: "导出当前工作簿为真 .xlsx 下载（缺省 xlsx-export.xlsx；值/公式保留，v1 样式与列宽不落文件）；可选 items 导出单元（{sheet: 表名或1起序号, range?}）或 sheets 选表（表名/序号数组）" },
      { name: "get_snapshot", description: "只读：返回全簿快照 JSON（表名/cellData 值与公式），供 AI 读后写" },
      { name: "export_pdf", description: "数据面矢量 PDF 导出下载（缺省 xlsx-export.pdf；真实文本层；A4 纵向多页，列宽自适应/表头加粗/页码）；可选 items 导出单元（{sheet, range: \"A1:F20\"} 区域级，文件名 xlsx-export-表名-A1F20.pdf）或 sheets 选表（表名/1起序号数组）" },
      { name: "export_png", description: "全部工作表纯数据表格导出长图 PNG 下载（缺省 xlsx-long.png；值与公式）；可选 items 导出单元（{sheet, range} 区域级）或 sheets 选表（选择导出文件名 xlsx-long-表1.png）" },
    ],
    repoPath: "apps/xlsx",
  },
  {
    id: "docx",
    name: "专业文档编辑器",
    tagline: "真文档工作区：标题/段落/列表/表格/粗斜，导出真 .docx",
    description:
      "TipTap 富文本编辑器（标题/段落/有序无序列表/表格/粗斜体 WYSIWYG）＋docx 双向桥（TipTap JSON → docx 库导出真 .docx；mammoth 导入 .docx 继续编辑）。AI 经 WebMCP 语义算子驱动（set_content/append_markdown/insert_table/insert_heading）。纯前端零上传。",
    tags: ["word", "docx", "文档", "编辑器", "tiptap"],
    subdomain: "docx.tool.fde2e.com",
    aiGuideSummary:
      "真文档编辑器：WebMCP set_content({content,format=html|markdown|json})/append_markdown/insert_heading/insert_table 写内核，export_docx 下载 docx-export.docx，import_docx({base64}) 导入继续编辑，export_pdf/export_png 整篇导出 PDF／长图；?sample=1 载入示例。",
    urlParams: [
      {
        name: "sample",
        description: "值=sample（或 1/示例）：载入内置示例文档（标题/列表/表格/粗斜体），可继续编辑或直接导出",
      },
    ],
    tools: [
      { name: "set_content", description: "整篇替换文档内容（format=html|markdown|json，缺省 html），返回段落数/字数统计" },
      { name: "append_markdown", description: "向文末追加 Markdown 子集（#/##/###、- 列表、1. 列表、| 表格、**粗** *斜*）" },
      { name: "insert_heading", description: "在文末插入标题（text + level 1-3）" },
      { name: "insert_table", description: "在文末插入表格（rows/cols/data[][]/header?）" },
      { name: "export_docx", description: "导出当前文档为真 .docx 下载（缺省 docx-export.docx，标题/列表/表格/粗斜保留）" },
      { name: "import_docx", description: "导入 .docx（base64）为可编辑文档（mammoth 解析），返回文档统计" },
      { name: "export_pdf", description: "整篇文档导出矢量 PDF 下载（缺省 docx-export.pdf；真实文本层；A4 纵向多页，标题分级/列表/表格/页码）；可选 items 多节选择（[{section: 标题}]）或 section 单节别名（选择导出文件名 docx-export-节1.pdf）" },
      { name: "export_png", description: "整篇文档导出结构化长图 PNG 下载（缺省 docx-long.png；超 16384px 截断并在产物标注）；可选 items 多节选择或 section 单节别名（选择导出文件名 docx-long-节1.png）" },
    ],
    repoPath: "apps/docx",
  },
  {
    id: "pptx",
    name: "专业幻灯编辑器",
    tagline: "真幻灯工作区：整库 PPTist 嵌入，导入导出真 .pptx",
    description:
      "PPTist 幻灯编辑器整库嵌入（节编辑/文本形状图片表格图表/主题/放映模式），Pinia store 为编程面：AI 经 WebMCP add_slide/set_title/add_bullets 语义化建页，export_pptx 产真 .pptx、import_pptx 打开既有 .pptx。纯前端零上传（AGPL 目录隔离，见根 README 许可分区）。",
    tags: ["powerpoint", "pptx", "幻灯", "编辑器", "pptist"],
    subdomain: "pptx.tool.fde2e.com",
    aiGuideSummary:
      "真幻灯编辑器：WebMCP add_slide({layout=title|bullets|blank,title?,bullets?,page? 插入位置1基})/set_title/add_bullets（目标页 page 1 基主形态，slideIndex 0 基 v1 兼容别名）驱动 store，export_pptx 下载 pptx-export.pptx，import_pptx({base64}) 打开既有 .pptx，export_pdf/export_png/export_long_png 逐页/长图导出；?sample=1 重置为内置示例。",
    urlParams: [
      {
        name: "sample",
        description: "值=sample（或 1/示例）：重置为内置示例演示（标题页+要点页），可继续编辑或直接导出",
      },
    ],
    tools: [
      { name: "add_slide", description: "新增一页（layout=title|bullets|blank，title/bullets[]/page 插入位置1基=插最前或 index 0 基 v1 别名），返回 slideCount（总页数，与 import_pptx/export_pptx 同名）＋page/index/slideIndex 双基位置与元素清单" },
      { name: "set_title", description: "设置指定页标题文本（目标页 page 1 基主形态第 1 页=1 或 slideIndex 0 基 v1 兼容别名，同传报错；无标题元素则创建）" },
      { name: "add_bullets", description: "向指定页追加要点列表（items[]，自动排版在既有内容下方；目标页 page 1 基主形态或 slideIndex 0 基 v1 兼容别名，同传报错）" },
      { name: "export_pptx", description: "导出当前演示为真 .pptx 下载（缺省 pptx-export.pptx）" },
      { name: "import_pptx", description: "导入 .pptx（base64）为可编辑演示（pptxtojson 解析），返回页数" },
      { name: "export_pdf", description: "每页幻灯一页导出矢量 PDF 下载（缺省 pptx-export.pdf；16:9 横向，真实文本层，右下页码）；可选 items 页单元（[{page: 2}]）或 pages 选页（1-based 数组/区间/单数；选择导出文件名 pptx-export-p2-3.pdf）" },
      { name: "export_png", description: "逐页多文件导出（每页一个 PNG）独立下载（pptx-page-01.png 起两位序号＝原 deck 页码；可选 filename 作文件名前缀）；可选 items 页单元或 pages 选页" },
      { name: "export_pages_png", description: "export_png 的别名工具（逐页多文件导出，每页一个 PNG；参数与行为同 export_png）" },
      { name: "export_long_png", description: "幻灯纵向拼接导出长图 PNG 下载（缺省 pptx-long.png；页框/间隔带/页码标注，超上限等比缩放）；可选 items 页单元或 pages 选页（选择导出文件名 pptx-long-p2-3.png）" },
    ],
    repoPath: "apps/pptx",
  },
  // ---------- editor 二期（2026-11-01 上线，AGPL 未修改上游镜像独立部署）----------
  // Owner 指 ranuts/document 全能套件：既有复杂文件（多方协作出品/复杂样式）
  // 的打开续改归它；从零生成交付物走上面三件套（WebMCP 直驱）。上游 AGPL-3.0，
  // 本仓零 vendor 零修改（源码指引见 editor.tool.fde2e.com/fde2e-source-note.html）。
  {
    id: "editor",
    name: "全能办公编辑器",
    tagline: "第三方套件：现有的复杂 xlsx/docx/pptx 打开查看＋小幅续改",
    description:
      "ranuts/document 全能办公套件（表格/文档/幻灯一体 ONLYOFFICE 内核），既有 .xlsx/.docx/.pptx/.csv 原件打开、查看、编辑、另存。上游镜像**未修改**直接部署（AGPL-3.0，「源码与许可说明」见页内悬浮条）。注意分工：本站是「人用的续改工作区」——从零生成 AI 交付物走 xlsx/docx/pptx 三件套（WebMCP 直驱、行为可预期）。",
    tags: ["office", "onlyoffice", "docx", "xlsx", "pptx", "编辑器", "查看"],
    subdomain: "editor.tool.fde2e.com",
    aiGuideSummary:
      "既有复杂文件续改站（AI 无 WebMCP 面，走页面拟真；从零生成走三件套专业站）。落地页选 New Word/Sheet/Slide 进入对应编辑器；页内右下角有「源码与许可说明（AGPL-3.0）」悬浮条（上游 ranuts/document，digest 钉定记录见 deploy/editor-pinned.txt）。",
    urlParams: [],
    tools: [],
    repoPath: "external:ghcr.io/ranuts/document（AGPL 未修改镜像，不经本仓构建）",
  },
  // ---------- 浏览器视频剪辑（web-openfilm-editor，独立 MIT fork 仓）----------
  // 外部静态工具：实现与 35 项 WebMCP 面都在 fde2e-tools-film；本 registry 只做
  // 黄页/搜索/agent 枚举投影，不复制实现或 schema。
  {
    id: "film",
    name: "浏览器视频剪辑工作台",
    tagline: "时间轴剪辑、版本保存与本地导出，全程在浏览器完成",
    description:
      "纯浏览器视频剪辑工作台：项目、素材、版本与导出物保存在本机 OPFS；支持时间轴剪辑、页面动画片段、示例工程、项目包收发、WebCodecs 主力编码与同源单线程 ffmpeg.wasm 特殊格式兜底。无需账号，不上传项目，不在浏览器保存任何模型或生成服务密钥。",
    tags: ["视频", "剪辑", "时间轴", "OPFS", "WebCodecs", "ffmpeg", "导出", "WebMCP", "项目包"],
    subdomain: "film.tool.fde2e.com",
    aiGuideSummary:
      "35 项 WebMCP 分四族：film_* 读取工程，edit_* 原子剪辑/版本，projects_* 管理项目/素材/项目包/示例，produce_* 探测产出能力；可从 projects_load_example({id:'one-prompt'}) 或 projects_create 开始。媒体接料仅接受本地二进制、base64/data URL 或三域 HTTPS 白单，不接受 provider/API key。",
    urlParams: [],
    tools: [
      { name: "film_state", description: "读取当前工程的画布、轨道、片段、问题与本机能力" },
      { name: "film_problems", description: "读取当前工程协议/文件问题；健康时为空" },
      { name: "film_overrides", description: "读取页面片段的人为覆盖层" },
      { name: "edit_apply", description: "按官方编辑操作集原子应用一批变更" },
      { name: "edit_move_clip", description: "移动片段时间或轨道" },
      { name: "edit_remove_clip", description: "从时间轴移除片段" },
      { name: "edit_insert_clip", description: "把项目素材/页面插入时间轴" },
      { name: "edit_split_clip", description: "在指定时间切开片段" },
      { name: "edit_trim_clip", description: "修改片段源入点/出点" },
      { name: "edit_set_speed", description: "设置片段速度（0.1–100）" },
      { name: "edit_set_volume", description: "设置片段音量/增益/静音" },
      { name: "edit_set_box", description: "设置画面片段的位置、尺寸与旋转" },
      { name: "edit_set_props", description: "批量设置片段属性" },
      { name: "edit_set_track", description: "设置轨道锁定/隐藏/静音" },
      { name: "edit_reorder_tracks", description: "调整轨道顺序" },
      { name: "edit_set_stage", description: "设置工程画布尺寸" },
      { name: "edit_restore_overrides", description: "破坏性清除片段的人为覆盖层" },
      { name: "edit_write_page", description: "带 expect 并发门写入项目页面/文本文件" },
      { name: "edit_read_page", description: "读取项目页面/文本文件" },
      { name: "edit_list_versions", description: "列出保存版本与工作副本状态" },
      { name: "edit_save_version", description: "保存命名版本" },
      { name: "edit_checkout_version", description: "检出保存版本" },
      { name: "edit_discard_changes", description: "破坏性丢弃工作副本变更" },
      { name: "edit_copy_version", description: "把保存版本复制为新项目" },
      { name: "projects_list", description: "列出本机 OPFS 项目" },
      { name: "projects_list_media", description: "列出项目素材" },
      { name: "projects_import_media", description: "被动接入 URL/base64 媒体到 OPFS" },
      { name: "projects_create", description: "创建空白项目" },
      { name: "projects_open", description: "打开已有项目" },
      { name: "projects_delete", description: "破坏性删除整个项目" },
      { name: "projects_export_package", description: "导出带 manifest/checksum 的项目包" },
      { name: "projects_load_example", description: "复制并打开内置校验示例" },
      { name: "produce_look", description: "探测/请求静帧产出能力" },
      { name: "produce_render", description: "探测/请求视频渲染能力" },
      { name: "produce_export_status", description: "读取编码与导出环境状态" },
    ],
    repoPath: "external:fde2e-tools-film/packages/openfilm（MIT fork，独立仓）",
  },
  // ---------- audio-stt / audio-tts（audio-stt-tts change，2026-11 开工）----------
  // 浏览器本地语音双工具（WebGPU/WASM 推理，零云端）：模型权重不入仓、
  // 按模型 manifest 分发（deploy/models-fetch.sh），许可白名单见各站 ai-guide。
  {
    id: "audio-stt",
    name: "本地语音转文字",
    tagline: "音频→带时间轴文本（whisper/SenseVoice 本地推理）",
    description:
      "音频文件或麦克风 → 带时间轴的转写稿。双引擎档位：Whisper base q8（多语兜底 77MB）与 SenseVoice-Small int8（中文优先 228MB，含情绪事件标签）＋Zipformer 流式（麦克风实时，真流式）。30s 分片转写＋长音频 pipeline 重建防御；段级同步/编辑；导出 SRT/VTT/TXT/JSON。全部在本浏览器推理，音频不离开设备（首次使用需下载所选模型）。",
    tags: ["语音", "转写", "字幕", "srt", "stt", "whisper", "sensevoice", "语音识别", "asr", "麦克风"],
    subdomain: "stt.tool.fde2e.com",
    aiGuideSummary:
      "音频填 <input id=input-file>（wav/mp3/m4a/ogg/flac/webm/mp4/mov），选模型 id=model-select，点 transcribe-btn 转写；段列表 id=segments 点段跳播、段文可编辑；导出 export-srt/vtt/txt/json。WebMCP：transcribe_audio（fileUrl→TranscriptDoc JSON）＋list_models＋get_capabilities。麦克风实时＝mic-btn（Zipformer 真流式）。",
    urlParams: [],
    tools: [
      { name: "transcribe_audio", description: "音频 URL → TranscriptDoc JSON（segments+words 时间轴；模型可选 whisper-base-q8/sensevoice-small-int8；首次需下载模型）" },
      { name: "list_models", description: "枚举转写模型档位（id/引擎/体积/许可）——transcribe_audio 的 model 取值域" },
      { name: "get_capabilities", description: "只读能力面（引擎/分片参数/导出格式/支持格式清单）" },
    ],
    repoPath: "apps/audio-stt",
  },
  {
    id: "audio-tts",
    name: "本地语音合成",
    tagline: "文本→语音（Kokoro 中文 103 音色本地合成）",
    description:
      "文本 → 24kHz 语音（wav 下载/试听）。Kokoro v1.1-zh int8（Apache-2.0，103 音色 zf_001…zm_100，中英混说，约 188MB 首载）经 sherpa-onnx WASM 本地合成；长文自动切句流式（边生成边播）；生成历史（IndexedDB）与 A/B 并排对比。模型不支持情绪/语气标签（能力如实声明，界面无假控件）。全部本地推理，文本与音频不离开设备。",
    tags: ["语音", "合成", "配音", "tts", "kokoro", "文字转语音", "朗读", "音色"],
    subdomain: "tts.tool.fde2e.com",
    aiGuideSummary:
      "文本填 <textarea id=input-text>，音色 id=voice-select（103 选，按名字如 zf_001），语速 #speed-range（0.5-2.0），点 generate-btn 合成 → audio-player 试听 / download-btn 下载 audio-tts-export.wav。WebMCP：create_speech（text/voice/speed/filename→下载 wav）＋list_voices（103 音色）＋get_capabilities。本模型不支持情绪标签。",
    urlParams: [],
    tools: [
      { name: "create_speech", description: "文本 → 合成并下载 .wav（Kokoro v1.1-zh；voice=音色名见 list_voices；speed 0.5-2.0；长文自动切句流式；返回时长/句数）" },
      { name: "list_voices", description: "枚举 103 音色（sid/name/分组）——create_speech 的 voice 取值域" },
      { name: "get_capabilities", description: "只读能力面（模型/音色数/语速范围/许可；不支持的情绪标签如实标注）" },
    ],
    repoPath: "apps/audio-tts",
  },
];

export function getTool(id: string): ToolMeta | undefined {
  return TOOLS.find((t) => t.id === id);
}

/**
 * 黄页纯前端搜索：在 name/tagline/description/tags/aiGuideSummary 里做
 * 不区分大小写的子串匹配（多词 AND——空格分隔的词都必须命中）。
 */
export function searchTools(query: string): ToolMeta[] {
  const q = query.trim().toLowerCase();
  if (!q) return TOOLS;
  const words = q.split(/\s+/);
  return TOOLS.filter((t) => {
    const hay = [t.id, t.name, t.tagline, t.description, t.tags.join(" "), t.aiGuideSummary]
      .join(" ")
      .toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
