/*
 * 下载文件名契约 —— apps/pptx/src/export-name.ts
 *
 * 缺省契约名 pptx-export.pptx（绿门断言面）；WebMCP export_pptx 的 filename
 * 参数经 safeFilename 清洗（单源 shared/download.ts）。PPTist 的 exportPPTX
 * 以「演示标题」命名文件（title.pptx），导出前临时换名为去扩展名标题、完成后
 * 复位（胶水层实现，vendored 源码零改动）。
 */
import { safeFilename } from "@fde2e-tools/shared/download";

export const DEFAULT_EXPORT_NAME = "pptx-export.pptx";

/** 下载名（safeFilename 清洗）与 PPTist 标题名（去 .pptx 后缀）双形态 */
export function resolveExportName(name: string | undefined): string {
  return safeFilename(name, DEFAULT_EXPORT_NAME, ".pptx");
}

export function exportTitleOf(filename: string): string {
  return filename.replace(/\.pptx$/i, "");
}
