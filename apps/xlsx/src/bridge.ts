/*
 * SheetJS 双向桥 —— apps/xlsx/src/bridge.ts
 *
 * Univer ↔ .xlsx 文件编解码（SheetJS 社区版 0.20.3 CDN tarball，Apache-2.0；
 * npm 0.18.5 带 CVE 禁引入——与 easy-xlsx 同一安装形态）。digest 实调路线：
 * - 导出：wb.save() 快照 → 逐 sheet cellData → SheetJS aoa（值）+ 公式回填
 *   （f 去 = 前缀）→ XLSX.write 产真 .xlsx；值/公式/基础样式/列宽覆盖。
 * - 导入：XLSX.read → 逐 sheet 构建 cellData（公式补 = 前缀）→ 完整快照格式
 *   seed 工厂建簿（幽灵防御路径不变）。
 * 边界（对外承诺「基础 Office 往返保真」）：合并单元格边框/图片/冻结窗格
 * 渐进覆盖，v1 不承诺。
 * 本模块整块 dynamic import（SheetJS ≈492KB 独立 chunk，主包零携带）。
 */
import { buildWorkbookSeed, type SeedCell, type WorkbookSeed } from "./snapshot";

/** 从 cellData 读单元格（稀疏 Record 两级索引） */
function cellAt(cellData: Record<number, Record<number, SeedCell>>, r: number, c: number): SeedCell | undefined {
  return cellData[r]?.[c];
}

/** 稀疏 cellData 的已用范围（含公式格——公式即使无值也占位） */
function usedRange(cellData: Record<number, Record<number, SeedCell>>): { maxR: number; maxC: number } {
  let maxR = 0;
  let maxC = 0;
  for (const rKey of Object.keys(cellData)) {
    const r = Number(rKey);
    maxR = Math.max(maxR, r);
    for (const cKey of Object.keys(cellData[r])) maxC = Math.max(maxC, Number(cKey));
  }
  return { maxR, maxC };
}

/* ---------- 导出：快照 → .xlsx ---------- */

/** SheetJS 模块形态（CDN tarball 的类型走仓库根 node_modules） */
type SheetJS = typeof import("xlsx");

async function loadXLSX(): Promise<SheetJS> {
  return (await import("xlsx")) as unknown as SheetJS;
}

export interface ExportSheetStat {
  name: string;
  cells: number;
}

/** 快照 → xlsx 字节；返回字节与逐表统计（工具摘要用） */
export async function snapshotToXlsxBytes(
  snapshot: {
    sheets: Record<string, { name?: string; cellData?: Record<number, Record<number, SeedCell>> }>;
    sheetOrder?: string[];
  },
): Promise<{ bytes: Uint8Array; stats: ExportSheetStat[] }> {
  const XLSX = await loadXLSX();
  const wb = XLSX.utils.book_new();
  const stats: ExportSheetStat[] = [];

  const ids = snapshot.sheetOrder && snapshot.sheetOrder.length ? snapshot.sheetOrder : Object.keys(snapshot.sheets);
  for (const id of ids) {
    const sheet = snapshot.sheets[id];
    if (!sheet) continue;
    const cellData = (sheet.cellData ?? {}) as Record<number, Record<number, SeedCell>>;
    const { maxR, maxC } = usedRange(cellData);
    const cells = Object.keys(cellData).reduce((acc, r) => acc + Object.keys(cellData[Number(r)]).length, 0);
    stats.push({ name: sheet.name ?? id, cells });

    // 值矩阵（公式格无值则置 null 占位）
    const aoa: unknown[][] = [];
    for (let r = 0; r <= maxR; r++) {
      const row: unknown[] = [];
      for (let c = 0; c <= maxC; c++) {
        const cell = cellAt(cellData, r, c);
        row.push(cell && cell.v !== undefined && cell.v !== null ? cell.v : null);
      }
      aoa.push(row);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // 公式回填（SheetJS 形态：去 = 前缀；已有计算值保持 v 与 f 并存）
    for (let r = 0; r <= maxR; r++) {
      for (let c = 0; c <= maxC; c++) {
        const cell = cellAt(cellData, r, c);
        if (cell?.f) {
          const addr = XLSX.utils.encode_cell({ r, c });
          ws[addr] = { ...(ws[addr] ?? {}), f: cell.f.replace(/^=/, "") };
        }
      }
    }
    XLSX.utils.book_append_sheet(wb, ws, (sheet.name ?? id).slice(0, 31));
  }
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return { bytes: new Uint8Array(out), stats };
}

/* ---------- 导入：.xlsx → 完整快照 seed ---------- */

export interface ImportSummary {
  sheetNames: string[];
  cells: number;
  seed: WorkbookSeed;
}

/** xlsx 字节 → 完整快照格式 seed（经唯一工厂，幽灵防御路径不变） */
export async function xlsxBytesToSeed(bytes: ArrayBuffer, workbookName: string): Promise<ImportSummary> {
  const XLSX = await loadXLSX();
  const wb = XLSX.read(new Uint8Array(bytes), { type: "array" });
  const sheets: Array<{ name: string; rows: unknown[][] }> = [];
  let cells = 0;
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const ref = ws["!ref"] ?? "A1";
    const range = XLSX.utils.decode_range(ref);
    const rows: unknown[][] = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row: unknown[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr] as { v?: unknown; f?: string } | undefined;
        if (!cell) {
          row.push(null);
          continue;
        }
        if (cell.f) {
          row.push({ f: "=" + cell.f.replace(/^=/, ""), ...(cell.v !== undefined ? { v: cell.v } : {}) });
          cells++;
        } else {
          row.push((cell.v ?? null) as unknown);
          if (cell.v !== null && cell.v !== undefined && cell.v !== "") cells++;
        }
      }
      rows.push(row);
    }
    sheets.push({ name: name.slice(0, 31), rows });
  }
  if (!sheets.length) throw new Error("该 .xlsx 没有任何工作表");
  return { sheetNames: sheets.map((s) => s.name), cells, seed: buildWorkbookSeed(workbookName, sheets) };
}
