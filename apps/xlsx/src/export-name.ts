/*
 * 下载文件名契约 —— apps/xlsx/src/export-name.ts
 *
 * 缺省契约名 xlsx-export.xlsx（绿门断言面）；WebMCP export_xlsx 的 filename
 * 参数经 safeFilename 清洗（单源 shared/download.ts）。
 */
import { safeFilename } from "@fde2e-tools/shared/download";

export const DEFAULT_EXPORT_NAME = "xlsx-export.xlsx";

export function resolveExportName(name: string | undefined): string {
  return safeFilename(name, DEFAULT_EXPORT_NAME, ".xlsx");
}
