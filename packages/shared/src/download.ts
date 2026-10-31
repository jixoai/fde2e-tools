/*
 * 浏览器下载助手 —— packages/shared/src/download.ts
 *
 * 生成类工具站共用的「Blob → 本地下载」单一实现：
 * - downloadBlob：objectURL + <a download> 触发浏览器下载（headless 的
 *   playwright download 事件同路径可捕获）；
 * - safeFilename：清洗调用方给的文件名（去路径分隔/空字节、补扩展名、
 *   空值回退缺省契约名）——下载文件名是行为契约（绿门断言），清洗单源。
 */
export function downloadBlob(blob: Blob, filename: string): string {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 10s 后回收 objectURL（立即回收在 Firefox 会中断下载）
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  return filename;
}

/** 清洗下载文件名：去路径分隔与空字节；无扩展名自动补 ext；空值回退 fallback */
export function safeFilename(name: string | undefined, fallback: string, ext: string): string {
  const base = (name ?? "")
    .trim()
    .replace(/[\\/]/g, "")
    .replace(/\0/g, "");
  if (!base) return fallback;
  return base.toLowerCase().endsWith(ext.toLowerCase()) ? base : base + ext;
}
