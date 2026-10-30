/**
 * 展示格式化 —— src/lib/format.ts
 * 大小/时长/百分比的人类可读形态（信息栏、徽标共用）。
 */

/** 字节数 → 人类可读（B/KB/MB/GB；≥10 取整数，<10 保留一位小数）。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 'B';
  for (const u of units) {
    value /= 1024;
    unit = u;
    if (value < 1024) break;
  }
  const text = value >= 10 ? Math.round(value).toString() : value.toFixed(1);
  return `${text} ${unit}`;
}

/** 秒 → mm:ss / h:mm:ss（音频、视频信息栏）。 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 比例（1 = 100%）→ 百分号文本（缩放信息栏）。 */
export function formatPercent(ratio: number): string {
  if (!Number.isFinite(ratio)) return '—';
  return `${Math.round(ratio * 100)}%`;
}
