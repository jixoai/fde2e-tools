/*
 * 下载文件名契约 —— apps/docx/src/export-name.ts
 *
 * 缺省契约名 docx-export.docx（绿门断言面）；WebMCP export_docx 的 filename
 * 参数经 safeFilename 清洗（单源 shared/download.ts）。
 */
import { safeFilename } from "@fde2e-tools/shared/download";

export const DEFAULT_EXPORT_NAME = "docx-export.docx";

export function resolveExportName(name: string | undefined): string {
  return safeFilename(name, DEFAULT_EXPORT_NAME, ".docx");
}
