/*
 * 矢量 PDF 绘制套件 —— packages/shared/src/pdf-vector.ts
 *
 * openspec: export-pdf-png（v2，视觉验收返工）。为什么存在：
 * - v1 三站 export_pdf 走「html2canvas 位图 → jsPDF addImage」——产物是整页
 *   位图，**没有文本层**（pdftotext 全空，不可搜索/复制），xlsx 还把 Univer
 *   编辑器 UI（菜单/工具栏/列标/行号/选中框）一并截进 PDF（P0-1/P0-2）。
 * - v2 改为 jsPDF **矢量绘制**：文字用 text()（真实文本层）、表格用 rect/line，
 *   版面由数据模型计算，不碰任何编辑器 DOM。
 *
 * 依赖：vendored html2pdf.bundle.min.js 内的 jsPDF（4.0.0，MIT；构造器不可
 * new，经 probe worker 取实例——export-kit.createJsPdfDocument）。
 *
 * 中文文本层的硬前提＝嵌入 CJK 字体：jsPDF 内置 Helvetica 没有汉字，缺字会
 * 静默丢字形且 pdfEscape16 遇到 glyph 0 会整段放弃。本模块从
 * ../assets/fonts/NotoSansSC-{Regular,Bold}.ttf 取子集（GB2312 全字符 7570
 * 码位，OFL-1.1，来源与再分发说明见同目录 OFL.txt），addFileToVFS + addFont
 * 注册为 Identity-H Type0 字体——probe 实证 pdftotext 能提取中文、jsPDF 只
 * 嵌入实际使用的字形（10.5MB 全字库 → 2.2MB 子集 → 单份 PDF 约 170KB）。
 *
 * 终验返工（F2）：断行算法抽为模块级 wrapByMeasure（measure 注入），pptx
 * 位图模板渲染器共享同一断行/样式源；CJK_FONT_URLS 供 canvas FontFace 加载
 * 同一字体资产——两种介质字形/断行完全一致。
 */
import { createJsPdfDocument, type JsPdfDoc } from "./export-kit";

const PT_TO_MM = 25.4 / 72;

/** 字体族名（注册进 PDF 的 family；文件名为 VFS 键） */
const CJK_FAMILY = "FDE2ECJK";
const CJK_REGULAR_FILE = "NotoSansSC-Regular.ttf";
const CJK_BOLD_FILE = "NotoSansSC-Bold.ttf";

/**
 * 子集字体资产 URL（Vite 构建各站 dist 各出一份）。位图渲染器（pptx 模板通道
 * 的 canvas 文本）经 FontFace 加载同一字体源——PDF 与位图两种介质字形一致。
 */
export const CJK_FONT_URLS = {
  regular: new URL(`../assets/fonts/${CJK_REGULAR_FILE}`, import.meta.url).href,
  bold: new URL(`../assets/fonts/${CJK_BOLD_FILE}`, import.meta.url).href,
};

export { CJK_FAMILY };

/** 缺字替身（ASCII，恒在子集内） */
const MISSING_GLYPH = "?";

export interface VectorPdfCreateOptions {
  /** jsPDF format：命名（"a4"）或自定义 [宽, 高]（mm——pptx 16:9 用） */
  format: "a4" | [number, number];
  orientation: "portrait" | "landscape";
  /** PDF 元数据标题（可选） */
  title?: string;
}

export interface TextOptions {
  /** 字号（pt；与 jsPDF setFontSize 同语义） */
  size?: number;
  bold?: boolean;
  /** 十六进制色值（#rrggbb） */
  color?: string;
  align?: "left" | "center" | "right";
  /** 行高倍数（相对字号；缺省 1.5） */
  lineHeight?: number;
  /** 最大行宽（mm；缺省为「页宽 - 右页边距 15mm」） */
  maxWidth?: number;
}

/* ---------- 字体资产（fetch + VFS 注册，module 级缓存） ---------- */

interface FontAssets {
  regularB64: string;
  boldB64: string;
}

let fontAssetsPromise: Promise<FontAssets> | null = null;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function fetchFontBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`中文字体加载失败（${url.split("/").pop()} HTTP ${res.status}）——部署资源不完整，PDF 导出已中止`);
  }
  return bytesToBase64(new Uint8Array(await res.arrayBuffer()));
}

function loadFontAssets(): Promise<FontAssets> {
  if (!fontAssetsPromise) {
    fontAssetsPromise = (async () => {
      // Vite 资产管线：new URL(..., import.meta.url) 会被构建器改写成产物 URL，
      // 各站 dist 自带一份字体（站点独立可部署）；shared 单源只存一份源文件。
      const [regularB64, boldB64] = await Promise.all([
        fetchFontBase64(CJK_FONT_URLS.regular),
        fetchFontBase64(CJK_FONT_URLS.bold),
      ]);
      return { regularB64, boldB64 };
    })().catch((e) => {
      fontAssetsPromise = null; // 失败不缓存（下次导出重试）
      throw e;
    });
  }
  return fontAssetsPromise;
}

/* ---------- 中英混排断行 ---------- */

/** CJK / 全角标点：可在任意字符间断行 */
function isCjkChar(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (
    (c >= 0x2e80 && c <= 0x9fff) || // 部首扩展 + CJK 统一表意
    (c >= 0x3000 && c <= 0x303f) || // CJK 标点
    (c >= 0xff00 && c <= 0xffef) || // 全角字符
    (c >= 0xf900 && c <= 0xfaff) // 兼容表意
  );
}

/** 行首禁则（避免「，。」等落在行首） */
const NO_LINE_START = "，。、；：！？）》」』】〕｝〉》”’…—·,.;:!?)]}%";

/** 行内 token：拉丁词整词、空格、CJK/全角单字 */
export function tokenizeText(text: string): string[] {
  const tokens: string[] = [];
  let latin = "";
  const flushLatin = () => {
    if (latin) {
      tokens.push(latin);
      latin = "";
    }
  };
  for (const ch of text) {
    if (ch === " " || ch === "\t" || ch === "\u00a0") {
      flushLatin();
      tokens.push(" ");
    } else if (isCjkChar(ch)) {
      flushLatin();
      tokens.push(ch);
    } else {
      latin += ch;
    }
  }
  flushLatin();
  return tokens;
}

/**
 * 中英混排断行（共享算法本体）：CJK 逐字断、拉丁按词断、超长词硬切；
 * 行首禁则把标点黏回上一行。measure 由调用方注入（jsPDF getTextWidth 或
 * canvas measureText——pptx 位图模板渲染器与矢量 PDF 共享同一断行源）。
 */
export function wrapByMeasure(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const tokens = tokenizeText(text);
  const lines: string[] = [];
  let line = "";
  let lineW = 0;

  const pushLine = () => {
    lines.push(line.replace(/\s+$/g, ""));
    line = "";
    lineW = 0;
  };

  for (const token of tokens) {
    if (token === " ") {
      if (!line) continue;
      const w = measure(" ");
      if (lineW + w <= maxWidth) {
        line += " ";
        lineW += w;
      }
      continue;
    }
    const w = measure(token);
    if (lineW + w <= maxWidth) {
      line += token;
      lineW += w;
      continue;
    }
    if (line) {
      // 行首禁则：标点类 token 硬留在本行（允许轻微溢出）
      if (token.length === 1 && NO_LINE_START.includes(token)) {
        line += token;
        lineW += w;
        continue;
      }
      pushLine();
    }
    if (w <= maxWidth) {
      line = token;
      lineW = w;
      continue;
    }
    // 超长拉丁词：按字符硬切
    let cur = "";
    let curW = 0;
    for (const ch of token) {
      const cw = measure(ch);
      if (cur && curW + cw > maxWidth) {
        lines.push(cur);
        cur = ch;
        curW = cw;
      } else {
        cur += ch;
        curW += cw;
      }
    }
    line = cur;
    lineW = curW;
  }
  if (line || !lines.length) pushLine();
  return lines;
}

/* ---------- VectorPdf ---------- */

export class VectorPdf {
  private readonly doc: JsPdfDoc;
  /** 字体子集覆盖的码位（jsPDF TTFFont cmap 反查——缺字显式替身，防整段丢字） */
  private readonly covered: Set<number>;
  private missing = 0;
  private pageTotal = 1;
  /** 页宽/页高（mm） */
  readonly widthMm: number;
  readonly heightMm: number;

  private constructor(doc: JsPdfDoc, covered: Set<number>, widthMm: number, heightMm: number) {
    this.doc = doc;
    this.covered = covered;
    this.widthMm = widthMm;
    this.heightMm = heightMm;
  }

  /** 建文档（首启即第 1 页；probe 占位页已删除） */
  static async create(opts: VectorPdfCreateOptions): Promise<VectorPdf> {
    const doc = await createJsPdfDocument(opts.format, opts.orientation);
    const widthMm = doc.internal.pageSize.getWidth();
    const heightMm = doc.internal.pageSize.getHeight();
    doc.deletePage(1); // probe 占位页（先读 pageSize 再删——删空后 getter 炸）

    const assets = await loadFontAssets();
    doc.addFileToVFS(CJK_REGULAR_FILE, assets.regularB64);
    doc.addFont(CJK_REGULAR_FILE, CJK_FAMILY, "normal");
    doc.addFileToVFS(CJK_BOLD_FILE, assets.boldB64);
    doc.addFont(CJK_BOLD_FILE, CJK_FAMILY, "bold");

    // 覆盖率：cmap.unicode.codeMap 的键是十进制码位（jspdf TTFFont parse 产物）
    const metadata = doc.internal.getFont(CJK_FAMILY, "normal").metadata;
    const codeMap = metadata.cmap?.unicode?.codeMap ?? {};
    const covered = new Set<number>();
    for (const key of Object.keys(codeMap)) covered.add(Number(key));

    doc.setProperties({
      title: opts.title ?? "FDE2E 导出文档",
      subject: opts.title ?? "",
      creator: "FDE2E Tools（矢量导出）",
      author: "FDE2E",
    });
    doc.addPage(opts.format, opts.orientation);
    return new VectorPdf(doc, covered, widthMm, heightMm);
  }

  get pages(): number {
    return this.pageTotal;
  }

  /** 缺字替身计数（导出方可据此给「N 个字符不在内置字体覆盖范围」的诚实提示） */
  get missingChars(): number {
    return this.missing;
  }

  addPage(): void {
    this.doc.addPage();
    this.pageTotal = this.doc.getNumberOfPages();
  }

  setPage(page: number): void {
    this.doc.setPage(page);
  }

  /* ---------- 文本 ---------- */

  private sanitize(text: string): string {
    let out = "";
    for (const ch of text) {
      // 控制字符不进 PDF；制表转空格
      if (ch === "\t") {
        out += "  ";
        continue;
      }
      const c = ch.codePointAt(0) ?? 0;
      if (c < 0x20 || c === 0x7f) continue;
      if (c > 0xffff || !this.covered.has(c)) {
        this.missing++;
        out += MISSING_GLYPH;
        continue;
      }
      out += ch;
    }
    return out;
  }

  measure(text: string, size = 11, bold = false): number {
    this.doc.setFont(CJK_FAMILY, bold ? "bold" : "normal");
    this.doc.setFontSize(size);
    return this.doc.getTextWidth(this.sanitize(text));
  }

  /** 基线相对文本顶部的偏移（Noto Sans SC ascent ≈ 0.88em；取 0.82 视觉居中） */
  static baselineOffset(sizePt: number): number {
    return sizePt * PT_TO_MM * 0.82;
  }

  /** 行高（mm） */
  static lineHeightMm(sizePt: number, multiple = 1.5): number {
    return sizePt * multiple * PT_TO_MM;
  }

  /**
   * 中英混排断行：CJK 逐字断、拉丁按词断、超长词硬切；行首禁则把标点黏回上一行。
   * （算法本体在模块级 wrapByMeasure——pptx 位图模板渲染器共享同一断行源。）
   */
  wrap(text: string, maxWidth: number, size = 11, bold = false): string[] {
    const safe = this.sanitize(text).replace(/\r/g, "");
    return wrapByMeasure(safe, maxWidth, (s: string) => this.measure(s, size, bold));
  }

  /** 单行文本（y 为基线；调用方一般用 textBlock） */
  drawText(
    text: string,
    x: number,
    baselineY: number,
    opts: { size?: number; bold?: boolean; color?: string; align?: "left" | "center" | "right"; boxWidth?: number } = {},
  ): void {
    const size = opts.size ?? 11;
    const bold = opts.bold ?? false;
    const safe = this.sanitize(text);
    if (!safe) return;
    this.doc.setFont(CJK_FAMILY, bold ? "bold" : "normal");
    this.doc.setFontSize(size);
    this.doc.setTextColor(opts.color ?? "#1f2937");
    let x0 = x;
    if (opts.align && opts.align !== "left" && opts.boxWidth !== undefined) {
      const w = this.doc.getTextWidth(safe);
      x0 = opts.align === "center" ? x + (opts.boxWidth - w) / 2 : x + opts.boxWidth - w;
    }
    this.doc.text(safe, x0, baselineY);
  }

  /**
   * 文本块（自动断行）。topY 是首行文本顶部；返回块底 y（mm）。
   */
  textBlock(text: string, x: number, topY: number, opts: TextOptions = {}): number {
    const size = opts.size ?? 11;
    const bold = opts.bold ?? false;
    const lh = VectorPdf.lineHeightMm(size, opts.lineHeight ?? 1.5);
    const maxWidth = opts.maxWidth ?? this.widthMm - x - 15;
    const lines = this.wrap(text, maxWidth, size, bold);
    const baseline0 = VectorPdf.baselineOffset(size);
    let y = topY;
    for (const line of lines) {
      this.drawText(line, x, y + baseline0, { size, bold, color: opts.color, align: opts.align, boxWidth: maxWidth });
      y += lh;
    }
    return y;
  }

  /* ---------- 图形 ---------- */

  fillRect(x: number, y: number, w: number, h: number, color: string): void {
    this.doc.setFillColor(color);
    this.doc.rect(x, y, w, h, "F");
  }

  strokeRect(x: number, y: number, w: number, h: number, color: string, lineWidth = 0.15): void {
    this.doc.setDrawColor(color);
    this.doc.setLineWidth(lineWidth);
    this.doc.rect(x, y, w, h, "S");
  }

  line(x1: number, y1: number, x2: number, y2: number, color = "#d8dde5", lineWidth = 0.15): void {
    this.doc.setDrawColor(color);
    this.doc.setLineWidth(lineWidth);
    this.doc.line(x1, y1, x2, y2);
  }

  /* ---------- 收口 ---------- */

  /** 每页页脚（页码等），在全部内容绘制完后调用（需要总页数）。 */
  stampFooters(label: (page: number, total: number) => string, opts: { size?: number; color?: string; bottomMm?: number } = {}): void {
    const total = this.doc.getNumberOfPages();
    for (let p = 1; p <= total; p++) {
      this.doc.setPage(p);
      this.drawText(label(p, total), 0, this.heightMm - (opts.bottomMm ?? 8), {
        size: opts.size ?? 8.5,
        color: opts.color ?? "#8a94a6",
        align: "center",
        boxWidth: this.widthMm,
      });
    }
    this.doc.setPage(total);
  }

  toBlob(): Blob {
    return this.doc.output("blob");
  }
}
