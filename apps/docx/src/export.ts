/*
 * 展示级导出 —— apps/docx/src/export.ts
 *
 * openspec: export-pdf-png。TipTap 是 DOM 渲染，html2canvas 天然适配：
 * - export_pdf＝文档纸面渲染节点离屏克隆 → html2pdf pagebreak 分页 → A4 纵向
 *   多页 PDF（长文档自动跨页；纸面自带 2.5/3rem 内边距，margin 0）。
 * - export_png＝整篇文档一张长图 PNG（超 16384px 先降 scale，仍超截断＋标注）。
 * 两条通道都挂色守卫（solid-glass 外框全元素 oklch，html2canvas 1.4.x 必炸）
 * 与终态词纪律（「已生成」；中间态「正在导出…」不含终态词）。
 */
import { downloadBlob, safeFilename } from "@fde2e-tools/shared/download";
import { mountOffscreen, normalizeWorkerContainer, openHtml2pdfWorker, renderNodeToPng, withColorGuard } from "@fde2e-tools/shared/export-kit";
import { getEditor } from "./editor";

export const DEFAULT_PDF_NAME = "docx-export.pdf";
export const DEFAULT_PNG_NAME = "docx-long.png";

function resolvePdfName(name: string | undefined): string {
  return safeFilename(name, DEFAULT_PDF_NAME, ".pdf");
}

function resolvePngName(name: string | undefined): string {
  return safeFilename(name, DEFAULT_PNG_NAME, ".png");
}

export interface ExportOk {
  ok: true;
  filename: string;
  width: number;
  height: number;
  pages?: number;
  truncated?: boolean;
  notice?: string;
}

export type ExportResult = ExportOk | { ok: false; error: string };

/** 纸面节点：取当前文档页并克隆为离屏导出节点（编辑器光标/选区不在克隆面） */
function clonePageNode(): { node: HTMLElement; unmount: () => void } | { error: string } {
  const ed = getEditor();
  if (!ed) return { error: "编辑器尚未就绪（内核加载中），请稍后重试" };
  const page = document.querySelector(".docx-page");
  if (!page) return { error: "找不到文档纸面节点" };
  if (ed.isEmpty) return { error: "文档为空——请先输入内容或点「载入示例」" };
  const node = page.cloneNode(true) as HTMLElement;
  // 解除继承自编辑区的任何尺寸约束（长文档要完整展开）
  node.style.height = "auto";
  node.style.maxHeight = "none";
  node.style.overflow = "visible";
  const unmount = mountOffscreen(node, 860);
  return { node, unmount };
}

/** export_pdf：离屏克隆 → 分页 A4 纵向 PDF（html2pdf pagebreak 管线） */
export async function exportDocPdf(filename?: string): Promise<ExportResult> {
  // 全管线 try/catch（对抗审查顺手项）：守卫内管线抛错一律转 {ok:false} 人话
  // 返回，WebMCP execute 不 reject（与 pptx 三通道同款对齐）
  try {
    const cloned = clonePageNode();
    if ("error" in cloned) return { ok: false, error: cloned.error };
    const { node, unmount } = cloned;
    const name = resolvePdfName(filename);
    try {
      // 守卫必挂（scope=离屏纸面克隆：子树字面量 oklch 内联钉扎），落定后卸载。
      // pagebreak css/legacy 让长文档按元素边界分页（与 pdf-tool 同管线）；
      // margin 0——纸面自带内边距。管线走显式分步：toContainer 后先做容器归一化
      // （克隆回原点＋容器按纸面尺寸定宽——html2pdf 只重置 position 不重置 left，
      // 离屏克隆会整体漂出容器，产物近空白——排障实证），再 .save() 全管线。
      await withColorGuard(async () => {
        const worker = openHtml2pdfWorker().set({
          margin: 0,
          filename: name,
          image: { type: "jpeg", quality: 0.95 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false, scrollX: 0, scrollY: 0 },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
          pagebreak: { mode: ["css", "legacy"] },
        }).from(node);
        await worker.toContainer();
        normalizeWorkerContainer(worker, 860, node.scrollHeight);
        await worker.save();
      }, node);
      return { ok: true, filename: name, width: 860, height: node.scrollHeight };
    } finally {
      unmount();
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.message ? e.message : String(e) };
  }
}

/** export_png：整篇文档一张长图 */
export async function exportDocLongPng(filename?: string): Promise<ExportResult> {
  // 全管线 try/catch（对抗审查顺手项，同 exportDocPdf）
  try {
    const cloned = clonePageNode();
    if ("error" in cloned) return { ok: false, error: cloned.error };
    const { node, unmount } = cloned;
    const name = resolvePngName(filename);
    try {
      const png = await withColorGuard(() => renderNodeToPng(node, { width: 860, scale: 2 }), node);
      downloadBlob(png.blob, name);
      return { ok: true, filename: name, width: png.width, height: png.height, truncated: png.truncated, notice: png.notice };
    } finally {
      unmount();
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.message ? e.message : String(e) };
  }
}
