/*
 * 展示级导出 —— apps/pptx/src/export.ts
 *
 * openspec: export-pdf-png（v2 视觉验收返工；终验回单 F2 再修）。
 *
 * **同一模板函数出两种介质**（终验 F2 硬要求）：矢量 PDF 与位图（逐页 PNG /
 * 长图）共用一套「幻灯模板样式源」（TEMPLATE 常量）＋同一布局计算
 * （computeSlideLayout：标题 32pt 加粗居上、要点 18pt 项目符号、放不下逐档
 * 缩字号不裁切）＋同一断行算法（pdf-vector.wrapByMeasure，measure 注入）＋
 * 同一字体资产（canvas FontFace 加载 pdf-vector.CJK_FONT_URLS 的 Noto Sans SC
 * 子集——与 PDF 嵌入字形完全一致）。位图不再是 ThumbnailSlide 裸渲染
 * （F0/F2 问题：标题正文几乎同大、内容仅占框内 10-20%）。
 *
 * 通道：
 * - export_pdf＝jsPDF 矢量绘制（真实文本层）；
 * - export_png＝逐页位图（模板 canvas 渲染）多文件下载；
 * - export_long_png＝逐页位图纵向拼接＋卡框＋「— i/n —」间隔带页码标注。
 * 选路：**纯文本语义 deck**（全部元素为 text）走模板位图渲染（观感与 PDF 一
 * 致）；含图片/图表/形状等复杂元素的 deck 保留 PPTist ThumbnailSlide 离屏捕
 * 获（所见即所得优先，vendored 源码零改动、胶水调用）。
 * AGPL 纪律：apps/pptx/src/pptist 源码零改动（仅胶水层调用其渲染内核）。
 */
import { canvasToBlob, stackSlidesWithFrames } from "@fde2e-tools/shared/export-kit";
import { downloadBlob, safeFilename, withSelectionTag } from "@fde2e-tools/shared/download";
import { VectorPdf, wrapByMeasure, CJK_FONT_URLS } from "@fde2e-tools/shared/pdf-vector";
import { getIsland, type PPTSlide, type PPTTextElement } from "./bridge";

export const DEFAULT_PDF_NAME = "pptx-export.pdf";
export const DEFAULT_LONG_NAME = "pptx-long.png";
export const PAGE_NAME_BASE = "pptx-page";

/* ---------- 幻灯模板样式源（PDF 与位图两种介质的唯一样式定义） ---------- */

const TEMPLATE = {
  /** 16:9 版式页宽（13.333in = 338.67mm；高 = 宽 × 9/16） */
  pageWidthMm: 338.67,
  pageHeightMm: 190.5,
  marginX: 26,
  top: 26,
  bottom: 18,
  mastheadMm: 11,
  mastheadColor: "#0f3f8c",
  mastheadTextSize: 9.5,
  titleSize: 32,
  titleLineHeight: 1.25,
  titleColor: "#111827",
  accentWidthMm: 46,
  accentHeightMm: 1.2,
  accentColor: "#0f62d6",
  bulletSize: 18,
  bulletMinSize: 12,
  bulletLineHeight: 1.5,
  /** 段间距（mm）= 字号(pt) × factor */
  bulletGapFactor: 0.5,
  bulletColor: "#374151",
  bulletMarkerColor: "#0f62d6",
  /** 要点文本相对 marker 的缩进（mm） */
  bulletIndent: 9,
  markerOffset: 1,
  pageNumSize: 9,
  pageNumColor: "#94a3b8",
} as const;

/** 位图通道画布宽（与 PPTist useExport 的 config.width 同款 1600） */
const BITMAP_WIDTH_PX = 1600;
/** px per mm（位图画布的物理比例；字号 pt → px = pt × 25.4/72 × PX_PER_MM） */
const PX_PER_MM = BITMAP_WIDTH_PX / TEMPLATE.pageWidthMm;
/** 位图 canvas 用的字体族名（与 PDF 注册的 family 同名同资产） */
const CANVAS_FONT_FAMILY = "FDE2ECJK";

function resolvePdfName(name: string | undefined): string {
  return safeFilename(name, DEFAULT_PDF_NAME, ".pdf");
}

function resolveLongName(name: string | undefined): string {
  return safeFilename(name, DEFAULT_LONG_NAME, ".png");
}

export interface ExportOk {
  ok: true;
  filename: string;
  /** 单页 PNG＝像素宽高；矢量 PDF＝页面尺寸（mm） */
  width: number;
  height: number;
  /** pdf=页数；export_png=文件数 */
  pages?: number;
  files?: string[];
  /** 实际导出的页码清单（1-based；selective-export；缺省＝全部页） */
  selected?: number[];
  truncated?: boolean;
  notice?: string;
}

export type ExportResult = ExportOk | { ok: false; error: string };

/* ---------- slides 数据 → 文本模型 ---------- */

interface SlideText {
  title: string;
  bullets: string[];
  background?: string;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** PPTist 文本元素 content（HTML 段落）→ 纯文本行 */
function htmlLines(html: string): string[] {
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h[1-6]|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ");
  return decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/^[\s•·▪◦\-–—*]+/, "").trim())
    .filter(Boolean);
}

function slideTextOf(slide: PPTSlide): SlideText {
  const textEls = slide.elements.filter((el): el is PPTTextElement => el.type === "text");
  const nonEmpty = textEls.filter((el) => htmlLines(el.content || "").length > 0);
  const titleEl = nonEmpty.find((el) => el.textType === "title") ?? [...nonEmpty].sort((a, b) => a.top - b.top)[0];
  const bullets: string[] = [];
  for (const el of nonEmpty) {
    if (el === titleEl) continue;
    bullets.push(...htmlLines(el.content || ""));
  }
  const titleLines = titleEl ? htmlLines(titleEl.content || "") : [];
  const bg = typeof slide.fill === "string" ? slide.fill : undefined;
  return {
    title: titleLines.join(" "),
    bullets,
    background: bg && bg !== "#ffffff" && bg !== "#fff" ? bg : undefined,
  };
}

/** 纯文本语义 deck（全元素皆 text）→ 可走模板位图渲染（与 PDF 同源观感） */
function isPlainSemanticDeck(slides: PPTSlide[]): boolean {
  return slides.every((s) => s.elements.every((el) => el.type === "text"));
}

/* ---------- 选择性导出：页码解析（openspec: selective-export） ---------- */

export interface PageSelection {
  /** 0-based 页索引（过滤后，保持调用方给出的顺序） */
  indices: number[];
  /** 1-based 页码（返回值 selected 字段） */
  selected: number[];
  error?: string;
}

/**
 * pages 参数解析：数组 [2,3]（1-based）或区间字符串 "2-3"；缺省/空＝全部页。
 * 越界/格式非法/起止颠倒一律人话报错。
 */
export function resolvePageSelection(pages: unknown, total: number): PageSelection {
  const all = Array.from({ length: total }, (_, i) => i);
  if (pages === undefined || pages === null || pages === "") {
    return { indices: all, selected: all.map((i) => i + 1) };
  }
  let nums: number[];
  if (typeof pages === "string") {
    const m = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(pages);
    if (!m) return { indices: [], selected: [], error: `pages 区间格式应为 "起-止"（如 "2-3"），收到「${pages}」` };
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > b) return { indices: [], selected: [], error: `pages 区间起止颠倒（${a}-${b}）——应为 "起-止"（如 "2-3"）` };
    nums = Array.from({ length: b - a + 1 }, (_, k) => a + k);
  } else if (Array.isArray(pages)) {
    if (pages.length === 0) return { indices: all, selected: all.map((i) => i + 1) };
    if (pages.some((p) => !Number.isInteger(p))) {
      return { indices: [], selected: [], error: `pages 数组项须为整数页码（1-based，如 [2,3]），收到「${JSON.stringify(pages)}」` };
    }
    nums = pages as number[];
  } else if (typeof pages === "number") {
    if (!Number.isInteger(pages)) return { indices: [], selected: [], error: `pages 须为整数页码或区间字符串，收到「${pages}」` };
    nums = [pages];
  } else {
    return { indices: [], selected: [], error: `pages 参数须为页码数组（[2,3]）或区间字符串（"2-3"），收到「${JSON.stringify(pages)}」` };
  }
  const oob = nums.filter((n) => n < 1 || n > total);
  if (oob.length) return { indices: [], selected: [], error: `页码越界：${oob.join("、")}——当前演示共 ${total} 页（1-${total}）` };
  const indices = nums.map((n) => n - 1);
  return { indices, selected: indices.map((i) => i + 1) };
}

/** 选择导出的文件名 tag（p2-3）：仅当调用方**显式传了 pages** 才加（全量导出保持缺省契约名） */
function selectionTag(sel: PageSelection, pagesExplicit: boolean): string | null {
  return pagesExplicit ? `p${sel.selected.join("-")}` : null;
}

function isPagesExplicit(pages: unknown): boolean {
  return pages !== undefined && pages !== null && pages !== "";
}

interface SlideLayout {
  /** 页眉带文本（deck 名，40 字截断） */
  mastheadText: string;
  titleLines: string[];
  /** 标题块总高（mm；含 accent 条与间距；空标题占位 4mm） */
  titleBlockHeightMm: number;
  bulletSize: number;
  /** 每要点的断行结果 */
  bullets: string[][];
  lineHeightMm: number;
  gapMm: number;
}

function deckMastheadText(title: string): string {
  return title.length > 40 ? `${title.slice(0, 40)}…` : title;
}

/**
 * 幻灯版面计算（唯一样式源 TEMPLATE＋唯一断行 wrapByMeasure）：
 * 标题最多两行；要点从 18pt 起放不下逐档缩到 12pt（内容不裁切）。
 * measure(text, sizePt, bold) → 宽度（mm），由介质注入（jsPDF/canvas）。
 */
function computeSlideLayout(
  measure: (text: string, size: number, bold: boolean) => number,
  deckTitle: string,
  model: SlideText,
  contentW: number,
  contentHeightMm: number,
): SlideLayout {
  const mastheadText = deckMastheadText(deckTitle);
  const titleLines = model.title
    ? wrapByMeasure(model.title, contentW, (s) => measure(s, TEMPLATE.titleSize, true)).slice(0, 2)
    : [];
  const titleLineHeight = VectorPdf.lineHeightMm(TEMPLATE.titleSize, TEMPLATE.titleLineHeight);
  const titleBlockHeightMm = titleLines.length
    ? titleLines.length * titleLineHeight + 2.5 + TEMPLATE.accentHeightMm + 9
    : 4;

  const bulletW = contentW - TEMPLATE.bulletIndent;
  let bulletSize = TEMPLATE.bulletSize;
  let bullets: string[][] = [];
  let lineHeightMm = 0;
  let gapMm = 0;
  for (;;) {
    lineHeightMm = VectorPdf.lineHeightMm(bulletSize, TEMPLATE.bulletLineHeight);
    gapMm = bulletSize * TEMPLATE.bulletGapFactor;
    bullets = model.bullets.map((b) => wrapByMeasure(b, bulletW, (s) => measure(s, bulletSize, false)));
    const total = bullets.reduce((acc, ls) => acc + ls.length * lineHeightMm + gapMm, 0);
    if (titleBlockHeightMm + total <= contentHeightMm || bulletSize <= TEMPLATE.bulletMinSize) break;
    bulletSize -= 1;
  }
  return { mastheadText, titleLines, titleBlockHeightMm, bulletSize, bullets, lineHeightMm, gapMm };
}

/* ---------- 介质一：矢量 PDF ---------- */

async function renderSlidesPdf(
  slides: PPTSlide[],
  deckTitle: string,
): Promise<{ blob: Blob; pages: number; width: number; height: number; missing: number }> {
  const pdf = await VectorPdf.create({
    format: [TEMPLATE.pageWidthMm, TEMPLATE.pageHeightMm],
    orientation: "landscape",
    title: deckTitle,
  });
  const contentW = pdf.widthMm - TEMPLATE.marginX * 2;
  const bottomY = pdf.heightMm - TEMPLATE.bottom;
  const models = slides.map(slideTextOf);

  for (let i = 0; i < models.length; i++) {
    if (i > 0) pdf.addPage();
    const model = models[i];
    if (model.background) pdf.fillRect(0, 0, pdf.widthMm, pdf.heightMm, model.background);

    // 页眉带（深蓝底＋白色文稿名；版式锚点，同时压住「版面空洞」）
    pdf.fillRect(0, 0, pdf.widthMm, TEMPLATE.mastheadMm, TEMPLATE.mastheadColor);
    pdf.drawText(deckMastheadText(deckTitle), TEMPLATE.marginX, TEMPLATE.mastheadMm / 2 + VectorPdf.baselineOffset(TEMPLATE.mastheadTextSize) - 1, {
      size: TEMPLATE.mastheadTextSize,
      bold: true,
      color: "#ffffff",
    });

    // 布局（与位图介质共享同一函数/样式源）
    const layout = computeSlideLayout(
      (text, size, bold) => pdf.measure(text, size, bold),
      deckTitle,
      model,
      contentW,
      bottomY - TEMPLATE.top,
    );

    // 标题（32pt 加粗，最多两行）
    let y = TEMPLATE.top;
    const titleLh = VectorPdf.lineHeightMm(TEMPLATE.titleSize, TEMPLATE.titleLineHeight);
    for (const line of layout.titleLines) {
      pdf.drawText(line, TEMPLATE.marginX, y + VectorPdf.baselineOffset(TEMPLATE.titleSize), {
        size: TEMPLATE.titleSize,
        bold: true,
        color: TEMPLATE.titleColor,
      });
      y += titleLh;
    }
    if (layout.titleLines.length) {
      y += 2.5;
      pdf.fillRect(TEMPLATE.marginX, y, TEMPLATE.accentWidthMm, TEMPLATE.accentHeightMm, TEMPLATE.accentColor);
      y += TEMPLATE.accentHeightMm + 9;
    } else {
      y += layout.titleBlockHeightMm;
    }

    // 要点（bullet 蓝点＋悬挂缩进；字号已在布局阶段按空间收敛）
    const bulletX = TEMPLATE.marginX + TEMPLATE.bulletIndent;
    for (const lines of layout.bullets) {
      for (let li = 0; li < lines.length; li++) {
        if (y + layout.lineHeightMm > bottomY) break;
        if (li === 0) {
          pdf.drawText("•", TEMPLATE.marginX + TEMPLATE.markerOffset, y + VectorPdf.baselineOffset(layout.bulletSize), {
            size: layout.bulletSize,
            color: TEMPLATE.bulletMarkerColor,
          });
        }
        pdf.drawText(lines[li], bulletX, y + VectorPdf.baselineOffset(layout.bulletSize), {
          size: layout.bulletSize,
          color: TEMPLATE.bulletColor,
        });
        y += layout.lineHeightMm;
      }
      y += layout.gapMm;
    }

    // 右下页码
    pdf.drawText(`${i + 1} / ${models.length}`, 0, pdf.heightMm - 9, {
      size: TEMPLATE.pageNumSize,
      color: TEMPLATE.pageNumColor,
      align: "right",
      boxWidth: pdf.widthMm - TEMPLATE.marginX,
    });
  }

  return { blob: pdf.toBlob(), pages: pdf.pages, width: pdf.widthMm, height: pdf.heightMm, missing: pdf.missingChars };
}

/** export_pdf：每页幻灯一页 16:9 矢量 PDF（可选 pages 选择页码） */
export async function exportSlidesPdf(filename?: string, pages?: unknown): Promise<ExportResult> {
  try {
    const m = getIsland();
    if (!m) return { ok: false, error: "幻灯编辑器尚未就绪（内核加载中），请稍后重试" };
    const slides = m.slides.slides;
    if (!slides.length) return { ok: false, error: "当前演示为空（无页可导出）——请先建页或导入 .pptx" };
    const sel = resolvePageSelection(pages, slides.length);
    if (sel.error) return { ok: false, error: sel.error };
    const deckTitle = m.slides.title || slides.map(slideTextOf).find((s) => s.title)?.title || "演示文稿";
    const out = await renderSlidesPdf(sel.indices.map((i) => slides[i]), deckTitle);
    const tag = selectionTag(sel, isPagesExplicit(pages));
    const name = resolvePdfName(filename);
    const finalName = tag ? safeFilename(withSelectionTag(resolvePdfName(undefined), tag), DEFAULT_PDF_NAME, ".pdf") : name;
    downloadBlob(out.blob, finalName);
    return {
      ok: true,
      filename: finalName,
      width: out.width,
      height: out.height,
      pages: out.pages,
      selected: sel.selected,
      notice: out.missing > 0 ? `${out.missing} 个字符不在内置字体覆盖范围，已以 ? 代替` : undefined,
    };
  } catch (e) {
    return toError(e);
  }
}

/* ---------- 介质二：模板位图（canvas；与 PDF 同模板/字体/断行） ---------- */

let canvasFontPromise: Promise<void> | null = null;

/** FontFace 加载 vendored Noto Sans SC 子集（与 PDF 嵌入同一字形源） */
async function ensureCanvasFonts(): Promise<void> {
  if (!canvasFontPromise) {
    canvasFontPromise = (async () => {
      const regular = new FontFace(CANVAS_FONT_FAMILY, `url(${CJK_FONT_URLS.regular})`, { weight: "400" });
      const bold = new FontFace(CANVAS_FONT_FAMILY, `url(${CJK_FONT_URLS.bold})`, { weight: "700" });
      const loaded = await Promise.all([regular.load(), bold.load()]);
      loaded.forEach((f) => document.fonts.add(f));
    })().catch((e) => {
      canvasFontPromise = null; // 失败不缓存（下次导出重试）
      throw e;
    });
  }
  return canvasFontPromise;
}

function canvasFont(sizePt: number, bold: boolean): string {
  const px = sizePt * (25.4 / 72) * PX_PER_MM;
  return `${bold ? "700" : "400"} ${px.toFixed(2)}px ${CANVAS_FONT_FAMILY}`;
}

/** 模板位图渲染：每页一张 canvas → PNG blob（版面与矢量 PDF 同构） */
async function renderTemplateSlideBitmaps(
  slides: PPTSlide[],
  deckTitle: string,
): Promise<{ blobs: Blob[]; width: number; height: number }> {
  await ensureCanvasFonts();
  const width = Math.round(TEMPLATE.pageWidthMm * PX_PER_MM);
  const height = Math.round(TEMPLATE.pageHeightMm * PX_PER_MM);
  const models = slides.map(slideTextOf);
  const blobs: Blob[] = [];

  for (let i = 0; i < models.length; i++) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("画布创建失败（模板位图渲染不可用）");
    const model = models[i];

    // 底色
    ctx.fillStyle = model.background ?? "#ffffff";
    ctx.fillRect(0, 0, width, height);
    // 页眉带
    ctx.fillStyle = TEMPLATE.mastheadColor;
    ctx.fillRect(0, 0, width, Math.round(TEMPLATE.mastheadMm * PX_PER_MM));
    ctx.fillStyle = "#ffffff";
    ctx.font = canvasFont(TEMPLATE.mastheadTextSize, true);
    ctx.textBaseline = "alphabetic";
    ctx.fillText(
      deckMastheadText(deckTitle),
      TEMPLATE.marginX * PX_PER_MM,
      (TEMPLATE.mastheadMm / 2 + VectorPdf.baselineOffset(TEMPLATE.mastheadTextSize) - 1) * PX_PER_MM,
    );

    // 布局（与 PDF 同一函数/样式源）
    const layout = computeSlideLayout(
      (text, size, bold) => {
        ctx.font = canvasFont(size, bold);
        return ctx.measureText(text).width / PX_PER_MM;
      },
      deckTitle,
      model,
      TEMPLATE.pageWidthMm - TEMPLATE.marginX * 2,
      TEMPLATE.pageHeightMm - TEMPLATE.bottom - TEMPLATE.top,
    );

    // 标题
    ctx.fillStyle = TEMPLATE.titleColor;
    ctx.font = canvasFont(TEMPLATE.titleSize, true);
    let y = TEMPLATE.top;
    const titleLh = VectorPdf.lineHeightMm(TEMPLATE.titleSize, TEMPLATE.titleLineHeight);
    for (const line of layout.titleLines) {
      ctx.fillText(line, TEMPLATE.marginX * PX_PER_MM, (y + VectorPdf.baselineOffset(TEMPLATE.titleSize)) * PX_PER_MM);
      y += titleLh;
    }
    if (layout.titleLines.length) {
      y += 2.5;
      ctx.fillStyle = TEMPLATE.accentColor;
      ctx.fillRect(
        TEMPLATE.marginX * PX_PER_MM,
        y * PX_PER_MM,
        TEMPLATE.accentWidthMm * PX_PER_MM,
        TEMPLATE.accentHeightMm * PX_PER_MM,
      );
      y += TEMPLATE.accentHeightMm + 9;
    } else {
      y += layout.titleBlockHeightMm;
    }

    // 要点（bullet 蓝点＋悬挂缩进）
    const bulletX = TEMPLATE.marginX + TEMPLATE.bulletIndent;
    for (const lines of layout.bullets) {
      for (let li = 0; li < lines.length; li++) {
        if (y + layout.lineHeightMm > TEMPLATE.pageHeightMm - TEMPLATE.bottom) break;
        ctx.font = canvasFont(layout.bulletSize, false);
        if (li === 0) {
          ctx.fillStyle = TEMPLATE.bulletMarkerColor;
          ctx.fillText(
            "•",
            (TEMPLATE.marginX + TEMPLATE.markerOffset) * PX_PER_MM,
            (y + VectorPdf.baselineOffset(layout.bulletSize)) * PX_PER_MM,
          );
        }
        ctx.fillStyle = TEMPLATE.bulletColor;
        ctx.fillText(lines[li], bulletX * PX_PER_MM, (y + VectorPdf.baselineOffset(layout.bulletSize)) * PX_PER_MM);
        y += layout.lineHeightMm;
      }
      y += layout.gapMm;
    }

    // 右下页码
    ctx.fillStyle = TEMPLATE.pageNumColor;
    ctx.font = canvasFont(TEMPLATE.pageNumSize, false);
    ctx.textAlign = "right";
    ctx.fillText(
      `${i + 1} / ${models.length}`,
      (TEMPLATE.pageWidthMm - TEMPLATE.marginX) * PX_PER_MM,
      (TEMPLATE.pageHeightMm - 9) * PX_PER_MM,
    );
    ctx.textAlign = "left";

    blobs.push(await canvasToBlob(canvas));
  }
  return { blobs, width, height };
}

/* ---------- 位图通道选路与 PPTist 裸捕获（复杂 deck 保真回退） ---------- */

interface SlideCapture {
  blobs: Blob[];
  width: number;
  height: number;
  cleanup: () => void;
}

/** 位图通道：纯文本语义 deck 走模板渲染（与 PDF 同版式）；否则 PPTist 裸捕获 */
async function captureBitmaps(): Promise<SlideCapture> {
  const m = getIsland();
  if (!m) throw new Error("幻灯编辑器尚未就绪（内核加载中），请稍后重试");
  const slides = m.slides.slides;
  if (!slides.length) throw new Error("当前演示为空（无页可导出）——请先建页或导入 .pptx");

  if (isPlainSemanticDeck(slides)) {
    const deckTitle = m.slides.title || slides.map(slideTextOf).find((s) => s.title)?.title || "演示文稿";
    const out = await renderTemplateSlideBitmaps(slides, deckTitle);
    return { blobs: out.blobs, width: out.width, height: out.height, cleanup: () => {} };
  }
  return await captureSlidePngs(slides);
}

/** PPTist ThumbnailSlide 离屏捕获（复杂 deck 的所见即所得通道；vendored 零改动） */
async function captureSlidePngs(slides: PPTSlide[]): Promise<SlideCapture> {
  const ratio = (() => {
    const m = getIsland();
    return m?.slides.viewportRatio || 0.5625;
  })();

  const { createApp, h, nextTick } = await import("vue");
  const { default: ThumbnailSlide } = await import("./pptist/views/components/ThumbnailSlide/index.vue");
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;left:-10000px;top:0;display:flex;flex-direction:column;";
  document.body.appendChild(container);
  const app = createApp({
    render: () => slides.map((s) => h(ThumbnailSlide, { slide: s, size: BITMAP_WIDTH_PX, key: s.id })),
  });
  const pinia = (() => {
    const m = getIsland();
    return m ? m.pinia : undefined;
  })();
  if (pinia) app.use(pinia); // 与主岛同一 pinia：ThumbnailSlide 读 viewportRatio 等全局状态
  app.mount(container);
  const cleanup = () => {
    app.unmount();
    container.remove();
  };

  await nextTick();
  // 等位图元素加载完（图片/图表异步落定；5s 上限兜底）＋ 200ms 排版稳定（PPTist 同款）
  const deadline = Date.now() + 5000;
  for (;;) {
    const imgs = Array.from(container.querySelectorAll("img"));
    if (imgs.every((i) => i.complete) || Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 120));
  }
  await new Promise((r) => setTimeout(r, 200));

  const els = Array.from(container.querySelectorAll<HTMLElement>(".thumbnail-slide"));
  if (els.length !== slides.length) {
    cleanup();
    throw new Error(`离屏渲染页数不符（${els.length}/${slides.length}）——请重试`);
  }

  const { toPng } = await import("html-to-image");
  const blobs: Blob[] = [];
  try {
    for (const el of els) {
      // PPTist useExport 同款 quirk 修复：foreignObject 内带 xmlns 的节点会让
      // 序列化字体/样式丢失，导出前摘除
      el.querySelectorAll("foreignObject [xmlns]").forEach((n) => n.removeAttribute("xmlns"));
      const dataUrl = await toPng(el, { quality: 1, width: BITMAP_WIDTH_PX, backgroundColor: "#ffffff" });
      const blob = await (await fetch(dataUrl)).blob();
      blobs.push(blob);
    }
  } catch (e) {
    // 失败路径必须先拆离屏岛再上抛（外层拿不到 cap，不拆＝泄漏 fixed 容器＋整只 Vue app）
    cleanup();
    throw new Error("幻灯渲染失败：" + (e instanceof Error && e.message ? e.message : String(e)));
  }
  return {
    blobs,
    width: BITMAP_WIDTH_PX,
    height: Math.round(BITMAP_WIDTH_PX * ratio),
    cleanup,
  };
}

/* 错误 → 人话（WebMCP execute 不 reject 的关键：未就绪/渲染失败一律
   {ok:false, error} 返回值形态——对抗审查 P1，spec「未就绪显式拒绝」SHALL） */
function toError(e: unknown): { ok: false; error: string } {
  return { ok: false, error: e instanceof Error && e.message ? e.message : String(e) };
}

/** pageName(i)：pptx-page-01.png 起两位序号（文件名契约） */
export function pageName(index: number): string {
  return `${PAGE_NAME_BASE}-${String(index + 1).padStart(2, "0")}.png`;
}

/** export_png：逐页位图多文件下载（模板渲染与 PDF 同版式；可选 pages，文件名用原 deck 页码） */
export async function exportSlidesPng(pages?: unknown): Promise<ExportResult> {
  try {
    const m = getIsland();
    if (!m) throw new Error("幻灯编辑器尚未就绪（内核加载中），请稍后重试");
    const slides = m.slides.slides;
    if (!slides.length) throw new Error("当前演示为空（无页可导出）——请先建页或导入 .pptx");
    const sel = resolvePageSelection(pages, slides.length);
    if (sel.error) return { ok: false, error: sel.error };
    const cap = await captureBitmaps();
    try {
      const files: string[] = [];
      for (let k = 0; k < sel.indices.length; k++) {
        const name = pageName(sel.indices[k]); // 文件名契约＝原 deck 页码
        downloadBlob(cap.blobs[sel.indices[k]], name);
        files.push(name);
        // 间隔触发：防浏览器「多文件下载」拦截吞掉后续文件
        if (k < sel.indices.length - 1) await new Promise((r) => setTimeout(r, 350));
      }
      return { ok: true, filename: files[0], files, pages: files.length, width: cap.width, height: cap.height, selected: sel.selected };
    } finally {
      cap.cleanup();
    }
  } catch (e) {
    return toError(e);
  }
}

/** export_long_png：全部幻灯纵向拼一张长图（卡框＋间隔带＋页码标注；可选 pages） */
export async function exportSlidesLongPng(filename?: string, pages?: unknown): Promise<ExportResult> {
  try {
    const m = getIsland();
    if (!m) throw new Error("幻灯编辑器尚未就绪（内核加载中），请稍后重试");
    const slides = m.slides.slides;
    if (!slides.length) throw new Error("当前演示为空（无页可导出）——请先建页或导入 .pptx");
    const sel = resolvePageSelection(pages, slides.length);
    if (sel.error) return { ok: false, error: sel.error };
    const cap = await captureBitmaps();
    try {
      const picked = sel.indices.map((i) => cap.blobs[i]);
      const stack = await stackSlidesWithFrames(picked); // 分隔带标注用过滤后集合内序号 i/n
      const tag = selectionTag(sel, isPagesExplicit(pages));
      const name = resolveLongName(filename);
      const finalName = tag ? safeFilename(withSelectionTag(resolveLongName(undefined), tag), DEFAULT_LONG_NAME, ".png") : name;
      downloadBlob(stack.blob, finalName);
      return {
        ok: true,
        filename: finalName,
        width: stack.width,
        height: stack.height,
        pages: picked.length,
        selected: sel.selected,
        truncated: stack.truncated,
        notice: stack.notice,
      };
    } finally {
      cap.cleanup();
    }
  } catch (e) {
    return toError(e);
  }
}
