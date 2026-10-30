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
  /** 独立站子域（域名体系 Owner 2026-10-30：<tool>.tool.fde2e.com） */
  subdomain: string;
  /** 给 AI/自动化代理的用法摘要（黄页展示；全文以各工具页内 #ai-guide 为准） */
  aiGuideSummary: string;
  /** URL 参数契约文档（契约保真红线：已有智能体在用，一字不改） */
  urlParams: ToolUrlParam[];
  /** WebMCP 预留位（本轮为空数组） */
  tools: ToolEntryPoint[];
  /** 仓库内实现路径 */
  repoPath: string;
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
