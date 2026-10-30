/**
 * 二进制嗅探 —— src/lib/sniff.ts
 *
 * 文本解码器兜底路径的安全闸：fetch 回来的字节若本质是二进制（NUL 出现，
 * 或控制字符占比超阈值），绝不喂给 TextDecoder 渲染乱码——改呈「未支持格式
 * ＋下载」态。
 *
 * 判定规则（对 sampleSize 采样窗口）：
 * - 任意 NUL 字节 → 二进制（文本中不该有 0x00；UTF-16 文本也因此被判二进制，
 *   属预期——本站编码切换清单不含 UTF-16）；
 * - 控制字符占比 > 6% → 二进制（控制字符排除制表/换行/回车/换页四个文本常态；
 *   0x7F DEL 计入）；
 * - ≥0x80 的字节不算控制字符（UTF-8/GBK/Big5 等多字节文本的合法续字节）。
 */

const CONTROL_WHITELIST = new Set([0x09, 0x0a, 0x0c, 0x0d]); // \t \n \f \r

export function looksBinary(bytes: Uint8Array, sampleSize = 8192, ratioThreshold = 0.06): boolean {
  const n = Math.min(bytes.length, sampleSize);
  if (n === 0) return false; // 空文件按文本对待（渲染为空内容，不误伤）
  let control = 0;
  for (let i = 0; i < n; i += 1) {
    const b = bytes[i];
    if (b === 0) return true;
    if (CONTROL_WHITELIST.has(b)) continue;
    if (b < 0x20 || b === 0x7f) control += 1;
  }
  return control / n > ratioThreshold;
}
