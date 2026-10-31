/*
 * 展示级导出 —— apps/pptx/src/export.ts
 *
 * openspec: export-pdf-png。**复用 PPTist 自带图片导出内核**（vendored 源码零
 * 改动，胶水调用——与 useExport/ExportImage.vue 同一渲染路径）：离屏 Vue 岛
 * 挂 ThumbnailSlide（size=1600，与 PPTist 导出图片同宽）→ html-to-image 逐页
 * 捕获（PPTist 依赖，MIT）。三通道：
 * - export_pdf＝每页幻灯一页 PDF（页面尺寸随幻灯纵横比＝PPT 宽屏 338.67mm）；
 * - export_png＝逐页 PNG 多文件下载（间隔触发防浏览器多下载拦截）；
 * - export_long_png＝全部幻灯纵向拼一张长图（超 16384px 自动降 scale）。
 * 色守卫说明：html-to-image 走 SVG foreignObject 序列化（不解析色值，oklch 由
 * 浏览器自渲染），无需 oklch 守卫；jsPDF 只吃位图——守卫是 html2canvas 专属。
 * vendored 复刻点：捕获前清 foreignObject [xmlns]（useExport 内部同款 quirk）。
 */
import { downloadBlob, safeFilename } from "@fde2e-tools/shared/download";
import { pngsToPdf, stackPngsVertically } from "@fde2e-tools/shared/export-kit";
import { getIsland } from "./bridge";

export const DEFAULT_PDF_NAME = "pptx-export.pdf";
export const DEFAULT_LONG_NAME = "pptx-long.png";
export const PAGE_NAME_BASE = "pptx-page";

/** 捕获宽（与 PPTist useExport 的 config.width 同款 1600） */
const SLIDE_CAPTURE_WIDTH = 1600;
/** PPT 宽屏版式宽（13.333in = 338.67mm；高随幻灯纵横比） */
const PAGE_WIDTH_MM = 338.67;

function resolvePdfName(name: string | undefined): string {
  return safeFilename(name, DEFAULT_PDF_NAME, ".pdf");
}

function resolveLongName(name: string | undefined): string {
  return safeFilename(name, DEFAULT_LONG_NAME, ".png");
}

export interface ExportOk {
  ok: true;
  filename: string;
  width: number;
  height: number;
  /** pdf=页数；export_png=文件数 */
  pages?: number;
  files?: string[];
  truncated?: boolean;
  notice?: string;
}

export type ExportResult = ExportOk | { ok: false; error: string };

/* ---------- ThumbnailSlide 离屏渲染（PPTist 内核复用） ---------- */

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
    // 对齐上方页数不符分支：失败路径必须先拆离屏岛再上抛（外层拿不到 cap，
    // 不拆＝泄漏 fixed 容器＋整只 Vue app——对抗审查 P2）
    cleanup();
    throw new Error("幻灯渲染失败：" + (e instanceof Error && e.message ? e.message : String(e)));
  }
  return { blobs, width: SLIDE_CAPTURE_WIDTH, height: Math.round(SLIDE_CAPTURE_WIDTH * ratio), ratio, cleanup };
}

/* ---------- 三通道 ---------- */

/* 错误 → 人话（WebMCP execute 不 reject 的关键：未就绪/渲染失败一律
   {ok:false, error} 返回值形态——对抗审查 P1，spec「未就绪显式拒绝」SHALL） */
function toError(e: unknown): { ok: false; error: string } {
  return { ok: false, error: e instanceof Error && e.message ? e.message : String(e) };
}

/** export_pdf：每页幻灯一页 PDF（页面尺寸随幻灯纵横比，横向；JPEG 内嵌控体积） */
export async function exportSlidesPdf(filename?: string): Promise<ExportResult> {
  try {
    const name = resolvePdfName(filename);
    const cap = await captureSlidePngs();
    try {
      const pdf = await pngsToPdf(cap.blobs, {
        orientation: "landscape",
        pageSize: [PAGE_WIDTH_MM, +(PAGE_WIDTH_MM * cap.ratio).toFixed(2)],
        imageFormat: "JPEG",
      });
      downloadBlob(pdf.blob, name);
      return { ok: true, filename: name, width: cap.width, height: cap.height, pages: pdf.pages };
    } finally {
      cap.cleanup();
    }
  } catch (e) {
    return toError(e);
  }
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

/** export_long_png：全部幻灯纵向拼一张长图 */
export async function exportSlidesLongPng(filename?: string): Promise<ExportResult> {
  try {
    const name = resolveLongName(filename);
    const cap = await captureSlidePngs();
    try {
      const stack = await stackPngsVertically(cap.blobs, { gap: 12 });
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
