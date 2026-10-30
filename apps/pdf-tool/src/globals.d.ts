/*
 * 全局 UMD 库类型 —— apps/pdf-tool/src/globals.d.ts
 *
 * marked / html2pdf 以 vendored UMD 形式经 index.html 普通 <script> 载入
 * （保持「全部 JS 本地内嵌、无外网依赖」契约），这里只声明本工具实际用到的
 * 最小表面。
 */
declare global {
  interface Window {
    /** vendored marked（UMD）：Markdown → HTML */
    marked: { parse: (src: string) => string };
    /** vendored html2pdf.js（UMD，含 html2canvas + jsPDF） */
    html2pdf: () => {
      set: (opt: Record<string, unknown>) => {
        from: (element: HTMLElement) => { save: () => Promise<void> };
      };
    };
  }
}

export {};
