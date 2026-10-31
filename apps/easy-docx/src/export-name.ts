/*
 * 下载文件名契约 —— apps/docx/src/export-name.ts
 *
 * 缺省契约名 docx-export.docx（绿门断言面）；WebMCP create_docx 的 filename
 * 参数经 safeFilename 清洗后临时覆盖，页面每次生成后复位缺省（单次生成语义）。
 */
import { safeFilename } from "@fde2e-tools/shared/download";

export const DEFAULT_EXPORT_NAME = "docx-export.docx";

let current = DEFAULT_EXPORT_NAME;

export function getExportName(): string {
  return current;
}

export function setExportName(name: string | undefined): void {
  current = safeFilename(name, DEFAULT_EXPORT_NAME, ".docx");
}
