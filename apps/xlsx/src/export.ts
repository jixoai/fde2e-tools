/*
 * 展示级导出 —— apps/xlsx/src/export.ts
 *
 * openspec: export-pdf-png（v2 视觉验收返工）。两条通道：
 * - export_pdf＝**矢量 PDF**（jsPDF 直接绘制，真实文本层）。数据源＝
 *   get_snapshot 同源快照（wb.save()），**完全不碰 Univer DOM**——v1 截图路径
 *   把编辑器 UI（Start/Formulas 菜单、工具栏、公式栏、A–M 列标、行号、选中框、
 *   开发提示行）全带进 PDF 且无文本层（P0-1/P0-2，视觉验收判词原文）。
 *   版式：列宽按内容自适应（有上下限）、表头加粗带浅底色、文字左对齐数字右
 *   对齐、细灰网格、页边距 15mm、多页重复表头、页脚页码。
 * - export_png＝读快照数据自绘 HTML 表格 → 整簿长图 PNG（v1 保留，补页边距与
 *   列宽自适应）。canvas 只含可视视口（200 行簿的可见区仅 ~20 行），「全 sheet
 *   内容一张图」诚实走数据面（get_snapshot 同源数据，全部工作表按 sheetOrder）。
 *
 * 人机同路径：App 按钮与 WebMCP 工具都走本模块；状态行文案含终态词
 * （「已生成」），中间态（「正在导出…」）不含（B3 词表纪律）。
 */
import { downloadBlob, safeFilename, withSelectionTag } from "@fde2e-tools/shared/download";
import { mountOffscreen, renderNodeToPng, withColorGuard } from "@fde2e-tools/shared/export-kit";
import { VectorPdf } from "@fde2e-tools/shared/pdf-vector";
import { getHost } from "./editor";
import { CANARY_MARK, filterSheetIds, type SeedCell } from "./snapshot";

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

export interface ExportOk {
  ok: true;
  filename: string;
  /** 长图＝像素宽高；矢量 PDF＝页面尺寸（mm） */
  width: number;
  height: number;
  pages?: number;
  /** 实际导出的工作表名清单（selective-export；缺省＝全部表） */
  selected?: string[];
  truncated?: boolean;
  notice?: string;
}

export type ExportResult = ExportOk | { ok: false; error: string };

/* ---------- 快照结构与单元格显示文本 ---------- */

interface SnapshotSheet {
  name?: string;
  cellData?: Record<number, Record<number, SeedCell>>;
}

interface WorkbookSnapshot {
  sheetOrder?: string[];
  sheets: Record<string, SnapshotSheet>;
}

/** 单元格显示文本：计算值优先，公式兜底（v 缺失时灰显 =f） */
function cellText(cell: SeedCell | undefined): { text: string; isFormulaFallback: boolean } {
  if (!cell) return { text: "", isFormulaFallback: false };
  // canary 哨兵视作空（setValue(null) 不落快照的实证防线，双重保险）
  if (cell.v === CANARY_MARK) return { text: "", isFormulaFallback: false };
  if (cell.v !== undefined && cell.v !== null && cell.v !== "") return { text: String(cell.v), isFormulaFallback: false };
  if (cell.f) return { text: cell.f, isFormulaFallback: true };
  return { text: "", isFormulaFallback: false };
}

/** 表头行＝首个含内容的行；已用范围只认有内容格（空壳行键不进导出） */
function usedRange(cellData: Record<number, Record<number, SeedCell>>): { maxR: number; maxC: number; hasContent: boolean } {
  let maxR = -1;
  let maxC = -1;
  for (const rKey of Object.keys(cellData)) {
    const r = Number(rKey);
    for (const cKey of Object.keys(cellData[r])) {
      const c = Number(cKey);
      if (cellText(cellData[r]?.[c]).text === "") continue;
      if (r > maxR) maxR = r;
      if (c > maxC) maxC = c;
    }
  }
  return { maxR, maxC, hasContent: maxR >= 0 };
}

function isNumericText(cell: SeedCell | undefined): boolean {
  if (!cell || cell.v === undefined || cell.v === null) return false;
  if (typeof cell.v === "number") return true;
  return /^-?[\d,]+(\.\d+)?%?$/.test(String(cell.v).trim());
}

/* ---------- export_pdf：快照数据 → 矢量 PDF（文本层真实存在） ---------- */

const PDF_MARGIN_X = 15;
const PDF_MARGIN_TOP = 16;
const PDF_MARGIN_BOTTOM = 20;
const CELL_FONT = 8.5;
const CELL_PAD_X = 2.2;
const CELL_PAD_Y = 1.7;
const MIN_COL_MM = 11;
const MAX_COL_MM = 72;
const MAX_CELL_LINES = 6;

/** 列宽：按该列全部显示文本测宽（含表头），夹在 [11, 72] mm，再按可用宽度等比收敛 */
function computeColumnWidths(pdf: VectorPdf, cellData: Record<number, Record<number, SeedCell>>, maxC: number, avail: number): number[] {
  const widths: number[] = [];
  for (let c = 0; c <= maxC; c++) {
    let w = MIN_COL_MM;
    for (const rKey of Object.keys(cellData)) {
      const text = cellText(cellData[Number(rKey)]?.[c]).text;
      if (!text) continue;
      // 长文本只取前 24 字符测宽（单元格内部会换行，不按全文撑列）
      w = Math.max(w, pdf.measure(text.slice(0, 24), CELL_FONT, false) + CELL_PAD_X * 2);
    }
    widths.push(Math.min(MAX_COL_MM, Math.ceil(w)));
  }
  const total = widths.reduce((a, b) => a + b, 0);
  if (total <= avail) {
    // 内容较窄时适度铺开（上限 1.8 倍、单列 ≤60mm），避免表格挤在左半边
    const scale = Math.min(avail / total, 1.8);
    return widths.map((w) => Math.min(60, w * scale));
  }
  // 超宽：等比收敛，但不低于 11mm；仍超则继续压缩（极端宽表优先完整入页）
  const scale = avail / total;
  return widths.map((w) => Math.max(8, w * scale));
}

function drawSheetTitle(pdf: VectorPdf, name: string, y: number): number {
  pdf.drawText(name, PDF_MARGIN_X, y + VectorPdf.baselineOffset(12), { size: 12, bold: true, color: "#0f3f8c" });
  pdf.line(PDF_MARGIN_X, y + 6.2, PDF_MARGIN_X + 32, y + 6.2, "#0f62d6", 0.6);
  return y + 9.5;
}

export async function exportGridPdf(filename?: string, sheets?: string[]): Promise<ExportResult> {
  const name = resolvePdfName(filename);
  // 全管线 try/catch（对抗审查顺手项）：抛错一律转 {ok:false} 人话返回，
  // WebMCP execute 不 reject（与 pptx 通道同款对齐）
  try {
    const gate = await ensureReady();
    if (!gate.ok) return gate;
    const h = getHost();
    const wb = h!.api.getActiveWorkbook();
    if (!wb) return { ok: false, error: "当前无活动工作簿" };
    const snapshot = wb.save() as unknown as WorkbookSnapshot;
    // 选择性导出（openspec: selective-export）：按表名过滤，不存在的表名人话报错
    const filter = filterSheetIds(snapshot, sheets);
    if (filter.error) return { ok: false, error: filter.error };
    const ids = filter.ids;
    const selectedTag = sheets !== undefined && sheets !== null ? filter.selected.join("-") : null;

    const pdf = await VectorPdf.create({ format: "a4", orientation: "portrait", title: h!.workbookName });
    const contentW = pdf.widthMm - PDF_MARGIN_X * 2;
    const today = new Date().toISOString().slice(0, 10);

    // 抬头：工作簿名 + 导出日期（不出现任何编辑器 UI 词汇——无 UI 特征断言）
    let y = PDF_MARGIN_TOP;
    pdf.drawText(h!.workbookName, PDF_MARGIN_X, y + VectorPdf.baselineOffset(15), { size: 15, bold: true, color: "#111827" });
    y += 7.5;
    pdf.drawText(`导出日期 ${today} · 共 ${ids.length} 个工作表`, PDF_MARGIN_X, y + VectorPdf.baselineOffset(8.5), {
      size: 8.5,
      color: "#6b7280",
    });
    y += 6.5;

    for (const id of ids) {
      const sheet = snapshot.sheets[id];
      if (!sheet) continue;
      const sheetName = sheet.name ?? id;
      const cellData = sheet.cellData ?? {};
      const range = usedRange(cellData);
      if (y + 20 > pdf.heightMm - PDF_MARGIN_BOTTOM) {
        pdf.addPage();
        y = PDF_MARGIN_TOP;
      }
      y = drawSheetTitle(pdf, sheetName, y);
      if (!range.hasContent) {
        pdf.drawText("（空表）", PDF_MARGIN_X, y + VectorPdf.baselineOffset(9), { size: 9, color: "#9ca3af" });
        y += 8;
        continue;
      }

      const widths = computeColumnWidths(pdf, cellData, range.maxC, contentW);
      const totalW = widths.reduce((a, b) => a + b, 0);
      // 表头行＝首个有内容行；后续行按顺序，空行跳过
      const rows: number[] = [];
      for (let r = 0; r <= range.maxR; r++) {
        const rowCells = cellData[r] ?? {};
        if (Object.keys(rowCells).some((cKey) => cellText(rowCells[Number(cKey)]).text !== "")) rows.push(r);
      }
      if (!rows.length) continue;
      const headerRow = rows[0];

      const drawHeader = (): void => {
        const hLines = Math.max(1, ...widths.map((w, c) => pdf.wrap(cellText(cellData[headerRow]?.[c]).text, w - CELL_PAD_X * 2, CELL_FONT, true).length));
        const rowH = Math.min(20, hLines * VectorPdf.lineHeightMm(CELL_FONT, 1.35) + CELL_PAD_Y * 2);
        pdf.fillRect(PDF_MARGIN_X, y, totalW, rowH, "#eef2f7");
        let x = PDF_MARGIN_X;
        for (let c = 0; c <= range.maxC; c++) {
          const text = cellText(cellData[headerRow]?.[c]).text;
          const lines = pdf.wrap(text, widths[c] - CELL_PAD_X * 2, CELL_FONT, true).slice(0, MAX_CELL_LINES);
          let ty = y + CELL_PAD_Y;
          for (const line of lines) {
            pdf.drawText(line, x + CELL_PAD_X, ty + VectorPdf.baselineOffset(CELL_FONT), { size: CELL_FONT, bold: true, color: "#334155" });
            ty += VectorPdf.lineHeightMm(CELL_FONT, 1.35);
          }
          x += widths[c];
        }
        pdf.strokeRect(PDF_MARGIN_X, y, totalW, rowH, "#c9d2df", 0.2);
        // 列分隔线
        let lx = PDF_MARGIN_X;
        for (let c = 0; c < range.maxC; c++) {
          lx += widths[c];
          pdf.line(lx, y, lx, y + rowH, "#c9d2df", 0.15);
        }
        y += rowH;
      };

      drawHeader();

      for (const r of rows.slice(1)) {
        const rowCells = cellData[r] ?? {};
        const cellLines: string[][] = [];
        let lineCount = 1;
        for (let c = 0; c <= range.maxC; c++) {
          const text = cellText(rowCells[c]).text;
          let lines = pdf.wrap(text, widths[c] - CELL_PAD_X * 2, CELL_FONT, false);
          if (lines.length > MAX_CELL_LINES) {
            lines = lines.slice(0, MAX_CELL_LINES);
            lines[lines.length - 1] += "…";
          }
          cellLines.push(lines);
          lineCount = Math.max(lineCount, lines.length);
        }
        const rowH = lineCount * VectorPdf.lineHeightMm(CELL_FONT, 1.35) + CELL_PAD_Y * 2;
        if (y + rowH > pdf.heightMm - PDF_MARGIN_BOTTOM) {
          pdf.addPage();
          y = PDF_MARGIN_TOP;
          y = drawSheetTitle(pdf, `${sheetName}（续）`, y);
          drawHeader();
        }
        let x = PDF_MARGIN_X;
        for (let c = 0; c <= range.maxC; c++) {
          const cell = rowCells[c];
          const align = isNumericText(cell) ? "right" : "left";
          const color = cellText(cell).isFormulaFallback ? "#7c3aed" : "#1f2937";
          let ty = y + CELL_PAD_Y;
          for (const line of cellLines[c]) {
            pdf.drawText(line, x + CELL_PAD_X, ty + VectorPdf.baselineOffset(CELL_FONT), {
              size: CELL_FONT,
              color,
              align,
              boxWidth: widths[c] - CELL_PAD_X * 2,
            });
            ty += VectorPdf.lineHeightMm(CELL_FONT, 1.35);
          }
          x += widths[c];
        }
        // 行底线 + 列分隔线 + 左右外框（细灰网格）
        pdf.line(PDF_MARGIN_X, y + rowH, PDF_MARGIN_X + totalW, y + rowH, "#d8dde5", 0.12);
        pdf.line(PDF_MARGIN_X, y, PDF_MARGIN_X, y + rowH, "#c9d2df", 0.12);
        pdf.line(PDF_MARGIN_X + totalW, y, PDF_MARGIN_X + totalW, y + rowH, "#c9d2df", 0.12);
        let lx = PDF_MARGIN_X;
        for (let c = 0; c < range.maxC; c++) {
          lx += widths[c];
          pdf.line(lx, y, lx, y + rowH, "#d8dde5", 0.12);
        }
        y += rowH;
      }
      y += 9;
    }

    pdf.stampFooters((page, total) => `第 ${page} 页 / 共 ${total} 页`);
    const blob = pdf.toBlob();
    const finalName = selectedTag ? safeFilename(withSelectionTag(resolvePdfName(undefined), selectedTag), DEFAULT_PDF_NAME, ".pdf") : name;
    downloadBlob(blob, finalName);
    return {
      ok: true,
      filename: finalName,
      width: pdf.widthMm,
      height: pdf.heightMm,
      pages: pdf.pages,
      selected: filter.selected,
      notice: pdf.missingChars > 0 ? `${pdf.missingChars} 个字符不在内置字体覆盖范围，已以 ? 代替` : undefined,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.message ? e.message : String(e) };
  }
}

/* ---------- export_png：快照数据自绘表格 → 整簿长图 ---------- */

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const TABLE_CSS = `
.xl-export { font-family: ui-sans-serif, system-ui, "PingFang SC", sans-serif; color: #1c2330; background: #fff; padding: 56px 64px 64px; }
.xl-export h1 { font-size: 24px; margin: 0 0 6px; font-weight: 700; }
.xl-export .meta { font-size: 13px; color: #6b7280; margin-bottom: 32px; }
.xl-export h2 { font-size: 16px; margin: 30px 0 10px; padding-bottom: 5px; border-bottom: 2px solid #0f62d6; display: inline-block; font-weight: 600; }
.xl-export table { border-collapse: collapse; table-layout: auto; margin-bottom: 10px; }
.xl-export td, .xl-export th { border: 1px solid #d5dbe4; padding: 7px 14px; font-size: 13px; line-height: 1.6; white-space: nowrap; text-align: left; }
.xl-export thead th { background: #eef2f7; color: #334155; font-weight: 600; }
.xl-export td.num { text-align: right; font-variant-numeric: tabular-nums; }
.xl-export td.formula { color: #7c3aed; }
.xl-export .empty { color: #9ca3af; font-size: 13px; padding: 6px 0; }
`;

/**
 * 快照 → 自绘表格 HTML（全部工作表按 sheetOrder，纯数据表：无列字母/行号
 * chrome；数据首行作表头，对齐矢量 PDF 路径的表格形态）。
 * 与 get_snapshot 同源（wb.save()）。
 */
export function snapshotToTablesHtml(snapshot: WorkbookSnapshot, workbookName: string): string {
  const ids = snapshot.sheetOrder?.length ? snapshot.sheetOrder : Object.keys(snapshot.sheets);
  const sections = ids.map((id) => {
    const sheet = snapshot.sheets[id];
    if (!sheet) return "";
    const cellData = sheet.cellData ?? {};
    // 已用范围只认**有内容**的格（v/f 非空）——canary 探针会在远端行写入又
    // 清空，快照里留下空壳行键（r 键在、cell 全空），按键算 maxR 会把长图撑
    // 出上百空行
    const { maxR, maxC, hasContent } = usedRange(cellData);
    const head = `<h2>${escapeHtml(sheet.name ?? id)}</h2>`;
    if (!hasContent) return `${head}<p class="empty">（空表）</p>`;
    // 纯数据表（对齐矢量 PDF 路径）：无 A/B/C 列字母头、无 1/2/3 行号列、无角格；
    // 数据首行 = 表头（加粗浅底），其余行为数据
    const contentRows: number[] = [];
    for (let r = 0; r <= maxR; r++) {
      const rowCells = cellData[r] ?? {};
      if (Object.keys(rowCells).some((cKey) => cellText(rowCells[Number(cKey)]).text !== "")) contentRows.push(r);
    }
    if (!contentRows.length) return `${head}<p class="empty">（空表）</p>`;
    const headerRow = contentRows[0];
    let thead = "<thead><tr>";
    for (let c = 0; c <= maxC; c++) thead += `<th>${escapeHtml(cellText(cellData[headerRow]?.[c]).text)}</th>`;
    thead += "</tr></thead>";
    let tbody = "<tbody>";
    for (const r of contentRows.slice(1)) {
      tbody += "<tr>";
      for (let c = 0; c <= maxC; c++) {
        const cell = cellData[r]?.[c];
        const { text, isFormulaFallback } = cellText(cell);
        const cls = [isFormulaFallback ? "formula" : "", isNumericText(cell) && !isFormulaFallback ? "num" : ""]
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
  return `<div class="xl-export"><style>${TABLE_CSS}</style><h1>${escapeHtml(workbookName)}</h1><p class="meta">导出日期 ${today} · ${ids.length} 个工作表</p>${sections.join("")}</div>`;
}

export async function exportSheetLongPng(filename?: string, sheets?: string[]): Promise<ExportResult & { truncated?: boolean; notice?: string }> {
  const name = resolvePngName(filename);
  // 全管线 try/catch（对抗审查顺手项，同 exportGridPdf）
  try {
    const gate = await ensureReady();
    if (!gate.ok) return gate;
    const h = getHost();
    const wb = h!.api.getActiveWorkbook();
    if (!wb) return { ok: false, error: "当前无活动工作簿" };
    const snapshot = wb.save() as unknown as WorkbookSnapshot;
    const filter = filterSheetIds(snapshot, sheets);
    if (filter.error) return { ok: false, error: filter.error };
    const filtered: WorkbookSnapshot = { ...snapshot, sheetOrder: filter.ids };
    const selectedTag = sheets !== undefined && sheets !== null ? filter.selected.join("-") : null;
    const node = document.createElement("div");
    node.innerHTML = snapshotToTablesHtml(filtered, h!.workbookName);
    const unmount = mountOffscreen(node, 920);
    try {
      const png = await withColorGuard(() => renderNodeToPng(node, { width: 920, scale: 2 }), node);
      const finalName = selectedTag ? safeFilename(withSelectionTag(resolvePngName(undefined), selectedTag), DEFAULT_PNG_NAME, ".png") : name;
      downloadBlob(png.blob, finalName);
      return { ok: true, filename: finalName, width: png.width, height: png.height, selected: filter.selected, truncated: png.truncated, notice: png.notice };
    } finally {
      unmount();
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.message ? e.message : String(e) };
  }
}
