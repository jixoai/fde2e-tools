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

/** 下载文件名长度上限（超长截 base 保留扩展名——防选择导出 tag 撑爆文件名） */
const FILENAME_MAX = 180;

/**
 * 选择性导出文件名（openspec: selective-export）：在缺省契约名的扩展名前插入
 * 选择 tag——pptx-export-p2-3.pdf / xlsx-export-表1-表2.pdf；超长按上限截断
 * （保留扩展名）。tag 由调用方保证不含路径分隔符（页码 tag 全 ASCII，表名 tag
 * 走本函数截断；最终交付名仍建议过一次 safeFilename）。
 */
export function withSelectionTag(defaultName: string, tag: string): string {
  const dot = defaultName.lastIndexOf(".");
  if (dot <= 0) return defaultName;
  const stem = defaultName.slice(0, dot);
  const ext = defaultName.slice(dot);
  const out = `${stem}-${tag}${ext}`;
  if (out.length <= FILENAME_MAX) return out;
  const keep = FILENAME_MAX - ext.length - 1;
  return `${stem.slice(0, Math.max(1, keep))}-${tag.slice(0, Math.max(1, keep - stem.length))}${ext}`;
}

/**
 * 下载文件名合成（F8 优先级契约，全站单源）：**自定义 filename 为主、选择 tag
 * 追加其上**——`<自定义stem>-<tag>.<ext>`；无自定义＝`<缺省契约名插 tag>`；
 * 两者都无＝缺省契约名。tag 走 withSelectionTag（超长截断），最终名过
 * safeFilename 清洗（表名 tag 可能含非法字符）。
 */
export function resolveDownloadName(opts: { defaultName: string; filename?: string; tag?: string | null; ext: string }): string {
  const custom = opts.filename?.trim();
  const base = safeFilename(custom || undefined, opts.defaultName, opts.ext);
  if (!opts.tag) return base;
  return safeFilename(withSelectionTag(base, opts.tag), opts.defaultName, opts.ext);
}
