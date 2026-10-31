/*
 * 展示级导出 —— apps/xlsx/src/export.ts
 *
 * openspec: export-pdf-png。两条通道（openspec 裁决记录）：
 * - export_pdf＝网格渲染节点（.univer-canvas-wrap）经 html2canvas 捕获 → A4
 *   纵向 PDF（所见即所得）。Univer 是 canvas 渲染，html2canvas 1.4.x 对
 *   canvas 子元素按位图原样拷贝——probe 实证像素级可用（含公式计算值/页签/
 *   工具栏）；**色守卫必挂**（裸捕获 100% 炸 oklch——probe 复现）。
 * - export_png＝读工作簿快照数据自绘 HTML 表格 → 整簿长图 PNG。canvas 只含
 *   可视视口（200 行簿的可见区仅 ~20 行），「全 sheet 内容一张图」诚实走数据面
 *   （get_snapshot 同源数据，全部工作表按 sheetOrder 顺序）。
 *
 * 人机同路径：App 按钮与 WebMCP 工具都走本模块；状态行文案含终态词
 * （「已生成」），中间态（「正在导出…」）不含（B3 词表纪律）。
 */
import { downloadBlob, safeFilename } from "@fde2e-tools/shared/download";
import { mountOffscreen, pngsToPdf, renderNodeToPng, withColorGuard } from "@fde2e-tools/shared/export-kit";
import { getHost } from "./editor";
import type { SeedCell } from "./snapshot";

export const DEFAULT_PDF_NAME = "xlsx-export.pdf";
export const DEFAULT_PNG_NAME = "xlsx-long.png";

function resolvePdfName(name: string | undefined): string {
  return safeFilename(name, DEFAULT_PDF_NAME, ".pdf");
}

function resolvePngName(name: string | undefined): string {
  return safeFilename(name, DEFAULT_PNG_NAME, ".png");
}

/* ---------- 就绪门（导出前置校验，与 export_xlsx 同语义） ---------- */

async function ensureReady(): Promise<{ ok: false; error: string } | { ok: true }> {
  const h = getHost();
  if (!h) return { ok: false, error: "编辑器尚未启动（内核加载中），请稍后重试" };
  const ready = await h.gate.ensureReady(h.api);
  if (!ready) return { ok: false, error: "编辑器尚未渲染完成（未到 Rendered），导出已拒绝——请稍后重试" };
  return { ok: true };
}

function gridNode(): HTMLElement | null {
  return document.querySelector(".univer-canvas-wrap");
}

/* ---------- export_pdf：网格画布捕获 → A4 纵向 PDF ---------- */

export interface ExportOk {
  ok: true;
  filename: string;
  width: number;
  height: number;
  truncated?: boolean;
  notice?: string;
}

export type ExportResult = ExportOk | { ok: false; error: string };

export async function exportGridPdf(filename?: string): Promise<ExportResult> {
  const gate = await ensureReady();
  if (!gate.ok) return gate;
  const wrap = gridNode();
  if (!wrap) return { ok: false, error: "找不到网格画布节点（编辑器未挂载？）" };
  const name = resolvePdfName(filename);
  // 守卫必挂（scope=网格画布：子树字面量 oklch 内联钉扎）且包住**全管线**——
  // pngsToPdf 的 probe worker 挂在 body 上（容器缺省 border-color 会落回
  // TW4 preflight 的 oklch 变量），守卫中途卸载=stage2 裸奔（本轮排障实证）
  const result = await withColorGuard(async () => {
    // PDF 内嵌走 JPEG（jsPDF 对 PNG 不做有损压缩，10MB 级产物过大——排障实证）
    const png = await renderNodeToPng(wrap, { scale: 2, imageType: "jpeg", quality: 0.92 });
    const pdf = await pngsToPdf([png.blob], { orientation: "portrait", pageSize: "a4", imageFormat: "JPEG" });
    downloadBlob(pdf.blob, name);
    return { width: png.width, height: png.height, truncated: png.truncated, notice: png.notice };
  }, wrap);
  return { ok: true, filename: name, ...result };
}

/* ---------- export_png：快照数据自绘表格 → 整簿长图 ---------- */

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 单元格显示文本：计算值优先，公式兜底（v 缺失时灰显 =f） */
function cellText(cell: SeedCell | undefined): { text: string; isFormulaFallback: boolean } {
  if (!cell) return { text: "", isFormulaFallback: false };
  if (cell.v !== undefined && cell.v !== null && cell.v !== "") return { text: String(cell.v), isFormulaFallback: false };
  if (cell.f) return { text: cell.f, isFormulaFallback: true };
  return { text: "", isFormulaFallback: false };
}

const TABLE_CSS = `
.xl-export { font-family: ui-sans-serif, system-ui, "PingFang SC", sans-serif; color: #1c2330; background: #fff; padding: 28px; }
.xl-export h1 { font-size: 20px; margin: 0 0 4px; }
.xl-export .meta { font-size: 12px; color: #6b7280; margin-bottom: 18px; }
.xl-export h2 { font-size: 15px; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #0f62d6; display: inline-block; }
.xl-export table { border-collapse: collapse; table-layout: fixed; margin-bottom: 6px; }
.xl-export td, .xl-export th { border: 1px solid #d8dde5; padding: 4px 10px; font-size: 13px; line-height: 1.5; min-width: 72px; height: 26px; overflow: hidden; white-space: nowrap; }
.xl-export thead th { background: #f1f4f9; color: #4b5563; font-weight: 600; text-align: center; width: 56px; }
.xl-export tbody th { background: #f8fafc; color: #6b7280; font-weight: 500; text-align: center; }
.xl-export td.num { text-align: right; }
.xl-export td.formula { color: #9333ea; }
.xl-export .empty { color: #9ca3af; font-size: 13px; padding: 6px 0; }
`;

/**
 * 快照 → 自绘表格 HTML（全部工作表按 sheetOrder；列头 A/B/C、行头 1/2/3；
 * 只铺已用范围）。与 get_snapshot 同源（wb.save()）。
 */
export function snapshotToTablesHtml(
  snapshot: {
    sheetOrder?: string[];
    sheets: Record<string, { name?: string; cellData?: Record<number, Record<number, SeedCell>> }>;
  },
  workbookName: string,
): string {
  const ids = snapshot.sheetOrder?.length ? snapshot.sheetOrder : Object.keys(snapshot.sheets);
  const colName = (c: number): string => {
    let s = "";
    let n = c;
    while (n >= 0) {
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26) - 1;
    }
    return s;
  };
  const sections = ids.map((id) => {
    const sheet = snapshot.sheets[id];
    if (!sheet) return "";
    const cellData = sheet.cellData ?? {};
    // 已用范围只认**有内容**的格（v/f 非空）——canary 探针会在远端行写入又清空，
    // 快照里留下空壳行键（r 键在、cell 全空），按键算 maxR 会把长图撑出上百空行
    let maxR = -1;
    let maxC = -1;
    const cellIsContentful = (cell: SeedCell | undefined): boolean => {
      if (!cell) return false;
      const { text } = cellText(cell);
      return text !== "";
    };
    for (const rKey of Object.keys(cellData)) {
      const r = Number(rKey);
      for (const cKey of Object.keys(cellData[r])) {
        const c = Number(cKey);
        if (cellIsContentful(cellData[r]?.[c])) {
          if (r > maxR) maxR = r;
          if (c > maxC) maxC = c;
        }
      }
    }
    const head = `<h2>${escapeHtml(sheet.name ?? id)}</h2>`;
    if (maxR < 0 && maxC < 0) return `${head}<p class="empty">（空表）</p>`;
    let thead = "<thead><tr><th></th>";
    for (let c = 0; c <= maxC; c++) thead += `<th>${colName(c)}</th>`;
    thead += "</tr></thead>";
    let tbody = "<tbody>";
    for (let r = 0; r <= maxR; r++) {
      // 整行无内容则整行跳过（同上：空壳行不进长图）
      const rowHasContent = Object.keys(cellData[r] ?? {}).some((cKey) => cellIsContentful(cellData[r]?.[Number(cKey)]));
      if (!rowHasContent) continue;
      tbody += `<tr><th>${r + 1}</th>`;
      for (let c = 0; c <= maxC; c++) {
        const { text, isFormulaFallback } = cellText(cellData[r]?.[c]);
        const cls = [isFormulaFallback ? "formula" : "", /^-?\d+(\.\d+)?$/.test(text) && !isFormulaFallback ? "num" : ""]
          .filter(Boolean)
          .join(" ");
        tbody += `<td${cls ? ` class="${cls}"` : ""}>${escapeHtml(text)}</td>`;
      }
      tbody += "</tr>";
    }
    tbody += "</tbody>";
    return `${head}<table>${thead}${tbody}</table>`;
  });
  const today = new Date().toISOString().slice(0, 10);
  return `<div class="xl-export"><style>${TABLE_CSS}</style><h1>${escapeHtml(workbookName)}</h1><p class="meta">导出日期 ${today} · ${ids.length} 个工作表 · 数据面导出（值与公式，样式 v1 不落展示图）</p>${sections.join("")}</div>`;
}

export async function exportSheetLongPng(filename?: string): Promise<ExportResult & { truncated?: boolean; notice?: string }> {
  const gate = await ensureReady();
  if (!gate.ok) return gate;
  const h = getHost();
  const wb = h!.api.getActiveWorkbook();
  if (!wb) return { ok: false, error: "当前无活动工作簿" };
  const name = resolvePngName(filename);
  const snapshot = wb.save() as {
    sheetOrder?: string[];
    sheets: Record<string, { name?: string; cellData?: Record<number, Record<number, SeedCell>> }>;
  };
  const node = document.createElement("div");
  node.innerHTML = snapshotToTablesHtml(snapshot, h!.workbookName);
  const unmount = mountOffscreen(node, 920);
  try {
    const png = await withColorGuard(() => renderNodeToPng(node, { width: 920, scale: 2 }), node);
    downloadBlob(png.blob, name);
    return { ok: true, filename: name, width: png.width, height: png.height, truncated: png.truncated, notice: png.notice };
  } finally {
    unmount();
  }
}
