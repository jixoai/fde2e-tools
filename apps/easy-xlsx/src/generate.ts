/*
 * .xlsx 生成 —— apps/xlsx/src/generate.ts
 *
 * SheetJS 社区版（Apache-2.0）动态 import：生成库只进独立 chunk（体积纪律），
 * 首屏主包不携带。writeFile 在浏览器触发本地下载（headless download 事件同路径）。
 */
import type { WorkbookSpec } from "./spec";

export async function generateXlsx(spec: WorkbookSpec, filename: string): Promise<void> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (const s of spec.sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows), s.name);
  }
  XLSX.writeFile(wb, filename, { bookType: "xlsx" });
}
