/*
 * 下载文件名契约 —— apps/easy-xlsx/src/export-name.ts
 *
 * 缺省契约名 easy-xlsx-export.xlsx（v2 F19：easy 线与专业线缺省名区分——站 id 前缀自证
 * 产物来源；绿门断言面。旧调用方需复现旧缺省名时显式传 filename:"xlsx-export.xlsx"）；WebMCP create_xlsx 的 filename
 * 参数经 safeFilename 清洗后临时覆盖，页面每次生成后复位缺省（单次生成语义）。
 */
import { safeFilename } from "@fde2e-tools/shared/download";

export const DEFAULT_EXPORT_NAME = "easy-xlsx-export.xlsx"; // v2 F19（旧名 xlsx-export.xlsx 显式 filename 可复现）

let current = DEFAULT_EXPORT_NAME;

export function getExportName(): string {
  return current;
}

export function setExportName(name: string | undefined): void {
  current = safeFilename(name, DEFAULT_EXPORT_NAME, ".xlsx");
}
