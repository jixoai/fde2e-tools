/*
 * 展示级导出 —— apps/pptx/src/export.ts
 *
 * openspec: export-pdf-png（v2 视觉验收返工）。三条通道：
 * - export_pdf＝**矢量 PDF**：从 slides 数据（标题/要点文本）绘制 16:9 横向页，
 *   标题 32pt 加粗居上、要点 18pt 带项目符号逐行、页边距 ≥18mm、右下页码——
 *   真实文本层（v1 是逐页位图，pdftotext 全空；P0-2）。
 * - export_png＝逐页 PNG（PPTist ThumbnailSlide 离屏渲染，vendored 源码零改动，
 *   胶水调用，与 v1 同路径——保留「所见即所得」的单页图片）。
 * - export_long_png＝逐页 PNG 纵向拼接，**每页加卡框＋间隔带＋「— i/n —」页码**
 *   （shared stackSlidesWithFrames），消除 v1「两页接缝整行纯白无页界标记」
 *   （P0-3）。
 * AGPL 纪律：apps/pptx/src/pptist 源码零改动（仅胶水层调用其渲染内核）。
 */
import { downloadBlob, safeFilename } from "@fde2e-tools/shared/download";
import { stackSlidesWithFrames } from "@fde2e-tools/shared/export-kit";
import { VectorPdf } from "@fde2e-tools/shared/pdf-vector";
import { getIsland, type PPTSlide, type PPTTextElement } from "./bridge";

export const DEFAULT_PDF_NAME = "pptx-export.pdf";
export const DEFAULT_LONG_NAME = "pptx-long.png";
export const PAGE_NAME_BASE = "pptx-page";

/** 捕获宽（与 PPTist useExport 的 config.width 同款 1600） */
const SLIDE_CAPTURE_WIDTH = 1600;
/** 16:9 版式页宽（13.333in = 338.67mm；高 = 宽 × 9/16 = 190.5mm） */
const SLIDE_PAGE_WIDTH_MM = 338.67;
const SLIDE_PAGE_HEIGHT_MM = 190.5;

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

/* ---------- export_pdf：slides 数据 → 矢量 PDF（真实文本层） ---------- */

const PDF_MARGIN_X = 26;
const PDF_TOP = 26;
const PDF_BOTTOM = 18;
const TITLE_SIZE = 32;
const ACCENT_MM = 1.2;
/** 页眉带（装订线色带＋文稿名）：撑住版面利用率，页间观感统一 */
const MASTHEAD_MM = 11;

async function renderSlidesPdf(slides: PPTSlide[], title: string): Promise<{ blob: Blob; pages: number; width: number; height: number; missing: number }> {
  const pdf = await VectorPdf.create({
    format: [SLIDE_PAGE_WIDTH_MM, SLIDE_PAGE_HEIGHT_MM],
    orientation: "landscape",
    title,
  });
  const contentW = pdf.widthMm - PDF_MARGIN_X * 2;
  const bottomY = pdf.heightMm - PDF_BOTTOM;
  const models = slides.map(slideTextOf);

  for (let i = 0; i < models.length; i++) {
    if (i > 0) pdf.addPage();
    const model = models[i];
    if (model.background) pdf.fillRect(0, 0, pdf.widthMm, pdf.heightMm, model.background);
    // 页眉带：深蓝底＋白色文稿名（版式锚点；同时把「版面空洞」压下去）
    pdf.fillRect(0, 0, pdf.widthMm, MASTHEAD_MM, "#0f3f8c");
    pdf.drawText(title.length > 40 ? `${title.slice(0, 40)}…` : title, PDF_MARGIN_X, MASTHEAD_MM / 2 + VectorPdf.baselineOffset(9.5) - 1, {
      size: 9.5,
      bold: true,
      color: "#ffffff",
    });

    // 标题（32pt 加粗，最多两行）
    const titleLines = model.title ? pdf.wrap(model.title, contentW, TITLE_SIZE, true).slice(0, 2) : [];
    let y = PDF_TOP;
    const titleLh = VectorPdf.lineHeightMm(TITLE_SIZE, 1.25);
    for (const line of titleLines) {
      pdf.drawText(line, PDF_MARGIN_X, y + VectorPdf.baselineOffset(TITLE_SIZE), { size: TITLE_SIZE, bold: true, color: "#111827" });
      y += titleLh;
    }
    if (titleLines.length) {
      y += 2.5;
      pdf.fillRect(PDF_MARGIN_X, y, 46, ACCENT_MM, "#0f62d6");
      y += ACCENT_MM + 9;
    } else {
      y += 4;
    }

    // 要点：18pt 起，放不下逐档缩到 12pt（内容不裁切）
    const bulletX = PDF_MARGIN_X + 9;
    const bulletW = contentW - 9;
    let size = 18;
    let gaps = 0;
    let total = 0;
    for (;;) {
      const lh = VectorPdf.lineHeightMm(size, 1.5);
      gaps = size * 0.5;
      total = model.bullets.reduce((acc, b) => acc + pdf.wrap(b, bulletW, size, false).length * lh + gaps, 0);
      if (y + total <= bottomY || size <= 12) break;
      size -= 1;
    }
    for (const bullet of model.bullets) {
      const lines = pdf.wrap(bullet, bulletW, size, false);
      const lh = VectorPdf.lineHeightMm(size, 1.5);
      for (let li = 0; li < lines.length; li++) {
        if (y + lh > bottomY) break;
        if (li === 0) {
          pdf.drawText("•", PDF_MARGIN_X + 1, y + VectorPdf.baselineOffset(size), { size, color: "#0f62d6" });
        }
        pdf.drawText(lines[li], bulletX, y + VectorPdf.baselineOffset(size), { size, color: "#374151" });
        y += lh;
      }
      y += gaps;
    }

    // 右下页码
    pdf.drawText(`${i + 1} / ${models.length}`, 0, pdf.heightMm - 9, {
      size: 9,
      color: "#94a3b8",
      align: "right",
      boxWidth: pdf.widthMm - PDF_MARGIN_X,
    });
  }

  return { blob: pdf.toBlob(), pages: pdf.pages, width: pdf.widthMm, height: pdf.heightMm, missing: pdf.missingChars };
}

/** export_pdf：每页幻灯一页 16:9 矢量 PDF */
export async function exportSlidesPdf(filename?: string): Promise<ExportResult> {
  try {
    const name = resolvePdfName(filename);
    const m = getIsland();
    if (!m) return { ok: false, error: "幻灯编辑器尚未就绪（内核加载中），请稍后重试" };
    const slides = m.slides.slides;
    if (!slides.length) return { ok: false, error: "当前演示为空（无页可导出）——请先建页或导入 .pptx" };
    const title = m.slides.title || slides.map(slideTextOf).find((s) => s.title)?.title || "演示文稿";
    const out = await renderSlidesPdf(slides, title);
    downloadBlob(out.blob, name);
    return {
      ok: true,
      filename: name,
      width: out.width,
      height: out.height,
      pages: out.pages,
      notice: out.missing > 0 ? `${out.missing} 个字符不在内置字体覆盖范围，已以 ? 代替` : undefined,
    };
  } catch (e) {
    return toError(e);
  }
}

/* ---------- 位图通道（逐页 PNG / 长图，PPTist 内核复用） ---------- */

interface SlideCapture {
  blobs: Blob[];
  width: number;
  height: number;
  ratio: number;
  cleanup: () => void;
}

async function captureSlidePngs(opts: { format?: "png" | "jpeg" } = {}): Promise<SlideCapture> {
  const format = opts.format ?? "png";
  const m = getIsland();
  if (!m) throw new Error("幻灯编辑器尚未就绪（内核加载中），请稍后重试");
  const slides = m.slides.slides;
  if (!slides.length) throw new Error("当前演示为空（无页可导出）——请先建页或导入 .pptx");
  const ratio = m.slides.viewportRatio || 0.5625;

  const { createApp, h, nextTick } = await import("vue");
  const { default: ThumbnailSlide } = await import("./pptist/views/components/ThumbnailSlide/index.vue");
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;left:-10000px;top:0;display:flex;flex-direction:column;";
  document.body.appendChild(container);
  const app = createApp({
    render: () => slides.map((s) => h(ThumbnailSlide, { slide: s, size: SLIDE_CAPTURE_WIDTH, key: s.id })),
  });
  app.use(m.pinia); // 与主岛同一 pinia：ThumbnailSlide 内部读 viewportRatio/viewportSize
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

  const { toPng, toJpeg } = await import("html-to-image");
  const toImage = format === "jpeg" ? toJpeg : toPng;
  const blobs: Blob[] = [];
  try {
    for (const el of els) {
      // PPTist useExport 同款 quirk 修复：foreignObject 内带 xmlns 的节点会让
      // 序列化字体/样式丢失，导出前摘除
      el.querySelectorAll("foreignObject [xmlns]").forEach((n) => n.removeAttribute("xmlns"));
      const dataUrl = await toImage(el, { quality: format === "jpeg" ? 0.92 : 1, width: SLIDE_CAPTURE_WIDTH, backgroundColor: "#ffffff" });
      const blob = await (await fetch(dataUrl)).blob();
      blobs.push(blob);
    }
  } catch (e) {
    // 失败路径必须先拆离屏岛再上抛（外层拿不到 cap，不拆＝泄漏 fixed 容器＋整只 Vue app）
    cleanup();
    throw new Error("幻灯渲染失败：" + (e instanceof Error && e.message ? e.message : String(e)));
  }
  return { blobs, width: SLIDE_CAPTURE_WIDTH, height: Math.round(SLIDE_CAPTURE_WIDTH * ratio), ratio, cleanup };
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

/** export_png：逐页 PNG 多文件下载 */
export async function exportSlidesPng(): Promise<ExportResult> {
  try {
    const cap = await captureSlidePngs();
    try {
      const files: string[] = [];
      for (let i = 0; i < cap.blobs.length; i++) {
        const name = pageName(i);
        downloadBlob(cap.blobs[i], name);
        files.push(name);
        // 间隔触发：防浏览器「多文件下载」拦截吞掉后续文件
        if (i < cap.blobs.length - 1) await new Promise((r) => setTimeout(r, 350));
      }
      return { ok: true, filename: files[0], files, pages: files.length, width: cap.width, height: cap.height };
    } finally {
      cap.cleanup();
    }
  } catch (e) {
    return toError(e);
  }
}

/** export_long_png：全部幻灯纵向拼一张长图（卡框＋间隔带＋页码标注） */
export async function exportSlidesLongPng(filename?: string): Promise<ExportResult> {
  try {
    const name = resolveLongName(filename);
    const cap = await captureSlidePngs();
    try {
      const stack = await stackSlidesWithFrames(cap.blobs);
      downloadBlob(stack.blob, name);
      return {
        ok: true,
        filename: name,
        width: stack.width,
        height: stack.height,
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
