/*
 * Canvas 字体目录 —— apps/canvas/src/font-catalog.ts
 *
 * 只记录来源/许可/URL 与载入方式，**不托管、不转存字体字节**（openspec
 * canvas-preprocess-v2）。两条使用路径：
 * - `usage:"satori"`：内置 Noto Sans SC（打包常用字 WOFF2 子集），Satori 直接排版；
 * - `usage:"text_to_svg"`：外部字体经 `font_info({url})` + `text_to_svg` 转 path，
 *   或写进 `preprocess` 的 `text` 条目。
 *
 * 直链优先 @fontsource（jsDelivr，CORS `*`）；没有验证过直链的条目只给官方
 * 来源页 + notes，**绝不编造 404 URL**。中文 WOFF2 通常 1.5–2.7MB，按需加载
 * 并由 Worker 缓存。
 */

export interface FontCatalogEntry {
  id: string;
  family: string;
  languages: Array<"zh" | "en">;
  /** "sans" | "serif" | "display" | "hand" | "mono" */
  styles: string[];
  weights: number[];
  license: string;
  /** 官方/字体源站 */
  source: string;
  /** 可直接交给 font_info / text_to_svg 的 WOFF2/TTF 直链 */
  url?: string;
  /** Google Fonts CSS（.cn 优先；无直链时的加载线索） */
  cssUrl?: string;
  usage: "satori" | "text_to_svg";
  builtin: boolean;
  notes?: string;
}

const FONTSOURCE = (pkg: string, file: string) =>
  `https://cdn.jsdelivr.net/npm/@fontsource/${pkg}@5.1.0/files/${file}`;

const GOOGLE_CSS = (family: string) =>
  `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}&display=swap`;

export const FONT_CATALOG: FontCatalogEntry[] = [
  /* ---------------- 中文 ---------------- */
  {
    id: "noto-sans-sc",
    family: "Noto Sans SC",
    languages: ["zh"],
    styles: ["sans"],
    weights: [400, 700],
    license: "OFL-1.1",
    source: "https://fonts.google.com/noto/specimen/Noto+Sans+SC",
    usage: "satori",
    builtin: true,
    notes:
      "内置 Satori 字体（打包常用字 WOFF2 子集，无需网络）；spec 里 fontFamily:\"Noto Sans SC\" 直接可用。" +
      "需要转 path 时可复用内置资产 font-noto-sans-sc 的 fontUrl（text_to_svg）。",
  },
  {
    id: "noto-serif-sc",
    family: "Noto Serif SC",
    languages: ["zh"],
    styles: ["serif"],
    weights: [400, 700],
    license: "OFL-1.1",
    source: "https://fonts.google.com/noto/specimen/Noto+Serif+SC",
    url: FONTSOURCE("noto-serif-sc", "noto-serif-sc-chinese-simplified-400-normal.woff2"),
    cssUrl: GOOGLE_CSS("Noto Serif SC"),
    usage: "text_to_svg",
    builtin: false,
    notes: "中文 WOFF2 体积较大（约 2.7MB），首次 text_to_svg 按需加载并缓存。",
  },
  {
    id: "zcool-xiaowei",
    family: "ZCOOL XiaoWei",
    languages: ["zh"],
    styles: ["serif", "display"],
    weights: [400],
    license: "OFL-1.1",
    source: "https://fonts.google.com/specimen/ZCOOL+XiaoWei",
    url: FONTSOURCE("zcool-xiaowei", "zcool-xiaowei-chinese-simplified-400-normal.woff2"),
    cssUrl: GOOGLE_CSS("ZCOOL XiaoWei"),
    usage: "text_to_svg",
    builtin: false,
    notes: "站酷小薇：国风标题字；中文 WOFF2 约 2MB。",
  },
  {
    id: "zcool-kuaile",
    family: "ZCOOL KuaiLe",
    languages: ["zh"],
    styles: ["display", "hand"],
    weights: [400],
    license: "OFL-1.1",
    source: "https://fonts.google.com/specimen/ZCOOL+KuaiLe",
    cssUrl: GOOGLE_CSS("ZCOOL KuaiLe"),
    usage: "text_to_svg",
    builtin: false,
    notes: "站酷快乐体：活泼标题；暂无已核验的固定直链，用 cssUrl / 官方页取 WOFF2 后走 font_info。",
  },
  {
    id: "ma-shan-zheng",
    family: "Ma Shan Zheng",
    languages: ["zh"],
    styles: ["hand", "display"],
    weights: [400],
    license: "OFL-1.1",
    source: "https://fonts.google.com/specimen/Ma+Shan+Zheng",
    url: FONTSOURCE("ma-shan-zheng", "ma-shan-zheng-chinese-simplified-400-normal.woff2"),
    cssUrl: GOOGLE_CSS("Ma Shan Zheng"),
    usage: "text_to_svg",
    builtin: false,
    notes: "马善政毛笔楷书；中文 WOFF2 约 2.6MB。",
  },
  {
    id: "long-cang",
    family: "Long Cang",
    languages: ["zh"],
    styles: ["hand", "display"],
    weights: [400],
    license: "OFL-1.1",
    source: "https://fonts.google.com/specimen/Long+Cang",
    url: FONTSOURCE("long-cang", "long-cang-chinese-simplified-400-normal.woff2"),
    cssUrl: GOOGLE_CSS("Long Cang"),
    usage: "text_to_svg",
    builtin: false,
    notes: "龙藏手写体；中文 WOFF2 约 1.5MB。",
  },
  {
    id: "lxgw-wenkai",
    family: "LXGW WenKai",
    languages: ["zh"],
    styles: ["hand", "serif"],
    weights: [400, 700],
    license: "OFL-1.1",
    source: "https://github.com/lxgw/LxgwWenKai",
    usage: "text_to_svg",
    builtin: false,
    notes: "霞鹜文楷：GitHub Releases 提供 TTF/OTF；未固定直链（避免 404），需自行取文件或上传素材库。",
  },
  {
    id: "smiley-sans",
    family: "Smiley Sans",
    languages: ["zh"],
    styles: ["display", "sans"],
    weights: [400, 700],
    license: "OFL-1.1",
    source: "https://github.com/atelier-anchor/smiley-sans",
    usage: "text_to_svg",
    builtin: false,
    notes: "得意黑：GitHub Releases 提供 OTF/WOFF2；未固定直链，需自行取文件或上传素材库。",
  },
  {
    id: "alibaba-puhuiti",
    family: "Alibaba PuHuiTi",
    languages: ["zh"],
    styles: ["sans"],
    weights: [400, 500, 700],
    license: "商业字体（需在官方站确认授权）",
    source: "https://www.alibabafonts.com/",
    usage: "text_to_svg",
    builtin: false,
    notes: "阿里巴巴普惠体：官方站免费商用授权需自行确认；无固定直链，用官方下载后上传素材库。",
  },

  /* ---------------- 英文 ---------------- */
  {
    id: "inter",
    family: "Inter",
    languages: ["en"],
    styles: ["sans"],
    weights: [400, 500, 600, 700],
    license: "OFL-1.1",
    source: "https://fonts.google.com/specimen/Inter",
    url: FONTSOURCE("inter", "inter-latin-400-normal.woff2"),
    cssUrl: GOOGLE_CSS("Inter"),
    usage: "text_to_svg",
    builtin: false,
    notes: "现代无衬线；拉丁 400 直链约 100KB。",
  },
  {
    id: "space-grotesk",
    family: "Space Grotesk",
    languages: ["en"],
    styles: ["sans", "display"],
    weights: [400, 500, 700],
    license: "OFL-1.1",
    source: "https://fonts.google.com/specimen/Space+Grotesk",
    url: FONTSOURCE("space-grotesk", "space-grotesk-latin-400-normal.woff2"),
    cssUrl: GOOGLE_CSS("Space Grotesk"),
    usage: "text_to_svg",
    builtin: false,
    notes: "科技感标题字。",
  },
  {
    id: "playfair-display",
    family: "Playfair Display",
    languages: ["en"],
    styles: ["serif", "display"],
    weights: [400, 600, 700],
    license: "OFL-1.1",
    source: "https://fonts.google.com/specimen/Playfair+Display",
    url: FONTSOURCE("playfair-display", "playfair-display-latin-400-normal.woff2"),
    cssUrl: GOOGLE_CSS("Playfair Display"),
    usage: "text_to_svg",
    builtin: false,
    notes: "高对比衬线，杂志标题常用。",
  },
  {
    id: "bebas-neue",
    family: "Bebas Neue",
    languages: ["en"],
    styles: ["display", "sans"],
    weights: [400],
    license: "OFL-1.1",
    source: "https://fonts.google.com/specimen/Bebas+Neue",
    url: FONTSOURCE("bebas-neue", "bebas-neue-latin-400-normal.woff2"),
    cssUrl: GOOGLE_CSS("Bebas Neue"),
    usage: "text_to_svg",
    builtin: false,
    notes: "窄体大写海报标题。",
  },
  {
    id: "caveat",
    family: "Caveat",
    languages: ["en"],
    styles: ["hand"],
    weights: [400, 700],
    license: "OFL-1.1",
    source: "https://fonts.google.com/specimen/Caveat",
    url: FONTSOURCE("caveat", "caveat-latin-400-normal.woff2"),
    cssUrl: GOOGLE_CSS("Caveat"),
    usage: "text_to_svg",
    builtin: false,
    notes: "手写体，适合备注/便签。",
  },
  {
    id: "jetbrains-mono",
    family: "JetBrains Mono",
    languages: ["en"],
    styles: ["mono"],
    weights: [400, 700],
    license: "OFL-1.1",
    source: "https://fonts.google.com/specimen/JetBrains+Mono",
    url: FONTSOURCE("jetbrains-mono", "jetbrains-mono-latin-400-normal.woff2"),
    cssUrl: GOOGLE_CSS("JetBrains Mono"),
    usage: "text_to_svg",
    builtin: false,
    notes: "等宽，代码/终端风。",
  },
  {
    id: "manrope",
    family: "Manrope",
    languages: ["en"],
    styles: ["sans"],
    weights: [400, 600, 700, 800],
    license: "OFL-1.1",
    source: "https://fonts.google.com/specimen/Manrope",
    cssUrl: GOOGLE_CSS("Manrope"),
    usage: "text_to_svg",
    builtin: false,
    notes: "几何无衬线；暂无已核验的固定直链，用 cssUrl / 官方页取 WOFF2。",
  },
  {
    id: "dm-sans",
    family: "DM Sans",
    languages: ["en"],
    styles: ["sans"],
    weights: [400, 500, 700],
    license: "OFL-1.1",
    source: "https://fonts.google.com/specimen/DM+Sans",
    cssUrl: GOOGLE_CSS("DM Sans"),
    usage: "text_to_svg",
    builtin: false,
    notes: "低对比几何无衬线；暂无已核验的固定直链，用 cssUrl / 官方页取 WOFF2。",
  },
  {
    id: "oswald",
    family: "Oswald",
    languages: ["en"],
    styles: ["sans", "display"],
    weights: [400, 500, 700],
    license: "OFL-1.1",
    source: "https://fonts.google.com/specimen/Oswald",
    cssUrl: GOOGLE_CSS("Oswald"),
    usage: "text_to_svg",
    builtin: false,
    notes: "窄体无衬线；暂无已核验的固定直链，用 cssUrl / 官方页取 WOFF2。",
  },
  {
    id: "libre-baskerville",
    family: "Libre Baskerville",
    languages: ["en"],
    styles: ["serif"],
    weights: [400, 700],
    license: "OFL-1.1",
    source: "https://fonts.google.com/specimen/Libre+Baskerville",
    cssUrl: GOOGLE_CSS("Libre Baskerville"),
    usage: "text_to_svg",
    builtin: false,
    notes: "经典书籍衬线；暂无已核验的固定直链，用 cssUrl / 官方页取 WOFF2。",
  },
];

export interface FontCatalogFilter {
  language?: "zh" | "en";
  style?: string;
  q?: string;
}

export function listFontCatalog(filter: FontCatalogFilter = {}): FontCatalogEntry[] {
  const q = filter.q?.trim().toLowerCase();
  const style = filter.style?.trim().toLowerCase();
  return FONT_CATALOG.filter((f) => {
    if (filter.language && !f.languages.includes(filter.language)) return false;
    if (style && !f.styles.some((s) => s.toLowerCase() === style)) return false;
    if (q) {
      const hay = `${f.id} ${f.family} ${f.languages.join(" ")} ${f.styles.join(" ")} ${f.license} ${f.source}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function getFontCatalogEntry(id: string): FontCatalogEntry | null {
  return FONT_CATALOG.find((f) => f.id === id) ?? null;
}
