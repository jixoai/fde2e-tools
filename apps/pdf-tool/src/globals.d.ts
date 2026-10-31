/*
 * 全局 UMD 库类型 —— apps/pdf-tool/src/globals.d.ts
 *
 * marked 以 vendored UMD 形式经 index.html 普通 <script> 载入（保持「全部 JS
 * 本地内嵌、无外网依赖」契约），这里只声明本工具实际用到的最小表面。
 * html2pdf 不再走 window 直调——export-pdf-png 起改经 shared/export-kit 的
 * openHtml2pdfWorker()（带 worker 容器归一化，修复克隆漂移空白产物）。
 */
declare global {
  interface Window {
    /** vendored marked（UMD）：Markdown → HTML */
    marked: { parse: (src: string) => string };
  }
}

export {};
