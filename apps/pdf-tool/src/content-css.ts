/*
 * PDF 内容排版样式 —— apps/pdf-tool/src/content-css.ts
 *
 * 与原单文件版 CONTENT_CSS 逐字一致（仅 html2canvas 支持的常规 CSS）：
 * 预览 iframe 与导出区域共用。选择器都带 .pdf-content 前缀，注入主文档
 * 不影响工具页本身。
 */
export const CONTENT_CSS = [
  '.pdf-content{font-family:-apple-system,"PingFang SC","Segoe UI","Microsoft YaHei",sans-serif;',
  'font-size:14px;line-height:1.7;color:#1c2330;background:#ffffff;}',
  '.pdf-content h1,.pdf-content h2,.pdf-content h3{line-height:1.4;margin:1.2em 0 .5em;color:#111111;}',
  '.pdf-content h1{font-size:24px;border-bottom:2px solid #e3e7ee;padding-bottom:8px;}',
  '.pdf-content h2{font-size:19px;}',
  '.pdf-content h3{font-size:16px;}',
  '.pdf-content p{margin:.6em 0;}',
  '.pdf-content ul,.pdf-content ol{padding-left:1.6em;margin:.6em 0;}',
  '.pdf-content code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.9em;',
  'background:#f0f2f6;padding:2px 5px;border-radius:4px;}',
  '.pdf-content pre{background:#f0f2f6;padding:12px;border-radius:8px;white-space:pre-wrap;}',
  '.pdf-content pre code{background:none;padding:0;}',
  '.pdf-content blockquote{margin:.8em 0;padding:.4em 1em;border-left:4px solid #0f62d6;',
  'background:#f4f7fd;color:#3c4657;}',
  '.pdf-content table{border-collapse:collapse;width:100%;margin:.8em 0;}',
  '.pdf-content th,.pdf-content td{border:1px solid #cfd6e0;padding:7px 10px;text-align:left;}',
  '.pdf-content th{background:#eef2f8;font-weight:600;}',
  '.pdf-content img{max-width:100%;}',
  '.pdf-content hr{border:none;border-top:1px solid #d8dde5;margin:1.4em 0;}',
  '.pdf-content a{color:#0f62d6;}',
  '.pdf-content tr{page-break-inside:avoid;}',
].join("\n");
