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
        description: "触发「导出 PDF」（未渲染会先自动渲染），浏览器下载 pdf-tool-export.pdf（A4 纵向）",
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
        description: "触发「下载 PNG」，浏览器下载 img-tool-<宽>x<高>.png，返回结果元信息",
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
      "/?url=<encodeURIComponent(绝对URL)>（必填）&name=<显示名>&decoder=<解码器id> 打开即预览；decoder 可选 14 解码器 id（svg/image/video/audio/pdf/markdown/json/csv/html/docx/xlsx/pptx/zip/text），缺省自动判定（扩展名 > Content-Type > 文本兜底）；页内 #ai-guide 有同源 demo 示例链接。",
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
    ],
    tools: [
      {
        name: "preview_file",
        description:
          "带 url（必填）/name/decoder 参数打开文件预览：页面写 URL 即渲染（与浏览器返回键同一条 popstate 通路），返回渲染结果（解码器 id 与状态文本）",
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
      "JSON 填入 <textarea id=input-json>（{sheets:[{name,rows}]}）或表格粘贴进 <textarea id=input-tsv>（Tab 分列、## 表名分表），点 generate-xlsx-btn 生成 xlsx-export.xlsx；?sample=1 载入示例。",
    urlParams: [
      {
        name: "sample",
        description: "值=sample（或 1/示例）：自动载入内置示例工作簿并刷新预览（不触发生成）",
      },
    ],
    tools: [
      {
        name: "create_xlsx",
        description: "按 sheets 结构生成并下载 xlsx-export.xlsx（sheets:[{name, rows[][]}]，可自定义文件名），返回表数/行数与状态行结果",
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
      "md 子集填入 <textarea id=input-md>（#/##/### 标题、- 列表、1. 列表、| 表格、**粗** *斜*），点 generate-docx-btn 生成 docx-export.docx；?sample=1 载入示例。",
    urlParams: [
      {
        name: "sample",
        description: "值=sample（或 1/示例）：自动载入内置示例文档并刷新预览（不触发生成）",
      },
    ],
    tools: [
      {
        name: "create_docx",
        description: "按 Markdown 子集生成并下载 docx-export.docx（可自定义文件名），返回段落数/表格数与状态行结果",
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
      "slides JSON 填入 <textarea id=input-json>（{\"slides\":[{title,bullets[],notes?}]}），点 generate-pptx-btn 生成 pptx-export.pptx；?sample=1 载入示例。",
    urlParams: [
      {
        name: "sample",
        description: "值=sample（或 1/示例）：自动载入内置示例幻灯并刷新预览（不触发生成）",
      },
    ],
    tools: [
      {
        name: "create_pptx",
        description: "按 slides 结构生成并下载 pptx-export.pptx（[{title,bullets[],notes?}]，可自定义文件名），返回页数与状态行结果",
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
      "Univer 真表格网格编辑器（多 sheet 页签、公式引擎真算、样式与数字格式）＋SheetJS 双向桥（导入 .xlsx 即编辑、导出真 .xlsx，值/公式/基础样式保留）。AI 经 WebMCP 直接驱动编辑器内核（写入/公式/格式/建表/导入导出/读快照），写入全程生命周期门禁。纯前端零上传。",
    tags: ["excel", "xlsx", "表格", "编辑器", "公式", "univer"],
    subdomain: "xlsx.tool.fde2e.com",
    aiGuideSummary:
      "真表格网格：WebMCP set_cells/set_formula/format_range/add_sheet 直接写内核（未就绪返回 ok:false），import_xlsx({base64}) 导入、export_xlsx 导出 xlsx-export.xlsx、get_snapshot 读全簿；?sample=1 载入示例。",
    urlParams: [
      {
        name: "sample",
        description: "值=sample（或 1/示例）：载入内置示例工作簿（含公式与样式），可继续编辑或直接导出",
      },
    ],
    tools: [
      { name: "set_cells", description: "向工作表写入二维数据（values[][]，支持数字/字符串/布尔/null），返回写入摘要" },
      { name: "set_formula", description: "对 A1 区间写公式（如 =SUM(A1:A9)），返回公式引擎计算值——AI 可自检" },
      { name: "format_range", description: "对 A1 区间设置样式（bold/italic/color/bg/numfmt/align）" },
      { name: "add_sheet", description: "新增工作表（可带初始 rows 二维数组），返回表名与全簿表清单" },
      { name: "import_xlsx", description: "导入 .xlsx（base64）为可编辑工作簿，返回表清单与单元格统计" },
      { name: "export_xlsx", description: "导出当前工作簿为真 .xlsx 下载（缺省 xlsx-export.xlsx，值/公式/基础样式保留）" },
      { name: "get_snapshot", description: "只读：返回全簿快照 JSON（表名/cellData 值与公式），供 AI 读后写" },
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
      "真文档编辑器：WebMCP set_content({content,format=html|markdown|json})/append_markdown/insert_heading/insert_table 写内核，export_docx 下载 docx-export.docx，import_docx({base64}) 导入继续编辑；?sample=1 载入示例。",
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
      "真幻灯编辑器：WebMCP add_slide({layout=title|bullets|blank,title?,bullets?})/set_title/add_bullets 驱动 store，export_pptx 下载 pptx-export.pptx，import_pptx({base64}) 打开既有 .pptx；?sample=1 重置为内置示例。",
    urlParams: [
      {
        name: "sample",
        description: "值=sample（或 1/示例）：重置为内置示例演示（标题页+要点页），可继续编辑或直接导出",
      },
    ],
    tools: [
      { name: "add_slide", description: "新增一页（layout=title|bullets|blank，title/bullets[]/index?），返回页索引与元素清单" },
      { name: "set_title", description: "设置指定页（缺省当前页）标题文本（无标题元素则创建）" },
      { name: "add_bullets", description: "向指定页追加要点列表（items[]，自动排版在既有内容下方）" },
      { name: "export_pptx", description: "导出当前演示为真 .pptx 下载（缺省 pptx-export.pptx）" },
      { name: "import_pptx", description: "导入 .pptx（base64）为可编辑演示（pptxtojson 解析），返回页数" },
    ],
    repoPath: "apps/pptx",
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
