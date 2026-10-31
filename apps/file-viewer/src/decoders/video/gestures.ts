/**
 * 视频手势纯函数 —— src/decoders/video/gestures.ts
 *
 * 与 React 解耦的判定/计算核心，供解码器与单测共用：
 * - 方向分类（上下=亮度 / 左右=进度）；
 * - 连击序列（同位置快速连击 → 快进/快退步长递增）；
 * - 亮度/进度映射与边界 clamp。
 */

/** 双击/连击区域（左 1/3 / 中 1/3 / 右 1/3）。 */
export type SeekRegion = 'left' | 'center' | 'right';

/** 手势模式：pending（未判定）/ brightness / seek / hold（长按 2x）。 */
export type GestureMode = 'pending' | 'brightness' | 'seek' | 'hold';

/** 双击起始步长（秒）。 */
export const SEEK_STEP_SECONDS = 10;
/** 连击步长上限（秒）。 */
export const SEEK_STEP_CAP_SECONDS = 60;
/** 按住滑动的灵敏度：1px = 200ms。 */
export const SEEK_SECONDS_PER_PIXEL = 0.2;
/** 亮度范围（CSS filter brightness）。 */
export const BRIGHTNESS_MIN = 0.3;
export const BRIGHTNESS_MAX = 1.6;
/** 长按进入 2x 的时长阈值（ms）。 */
export const LONG_PRESS_MS = 500;
/** 单击延迟判定窗口（ms）：等待潜在的第二击（与连击窗口一致，避免先切显隐再 seek）。 */
export const CLICK_DELAY_MS = 250;
/** 连击序列的最大间隔（ms）与最大位移（px）。 */
export const MULTI_CLICK_MS = 250;
export const MULTI_CLICK_DISTANCE_PX = 30;
/** 方向判定阈值（px）：垂直优先（亮度），水平进入 seek。 */
export const VERTICAL_THRESHOLD_PX = 12;
export const HORIZONTAL_THRESHOLD_PX = 24;
/** 长按期间允许的抖动（px）——超过则视为拖拽而非长按。 */
export const HOLD_TOLERANCE_PX = 8;

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * 连击累计步长（相对本次连击序列的起点）：第 2 击（一次双击）＝10s，
 * 第 3 击＝20s，第 4 击＝30s… 每多一击 +10s，上限 60s；单击返回 0。
 * 注意这是「累计值」——实际每次点击的增量见 seekIncrementForCount。
 */
export function seekStepForCount(count: number): number {
  if (!Number.isFinite(count) || count < 2) return 0;
  return Math.min(SEEK_STEP_CAP_SECONDS, SEEK_STEP_SECONDS + (Math.floor(count) - 2) * SEEK_STEP_SECONDS);
}

/** 单次连击相对上一击的增量（第 2 击起每击 +10s，封顶后 0）。 */
export function seekIncrementForCount(count: number): number {
  return seekStepForCount(count) - seekStepForCount(count - 1);
}

/** 依据横向像素位置判定区域（左/中/右各 1/3）。 */
export function seekRegion(x: number, width: number): SeekRegion {
  if (!(width > 0) || !Number.isFinite(x)) return 'center';
  const ratio = x / width;
  if (ratio < 1 / 3) return 'left';
  if (ratio >= 2 / 3) return 'right';
  return 'center';
}

/** 连击判定：同区域、间隔 ≤ 阈值、位移 ≤ 阈值。 */
export function isClickChain(
  prev: { at: number; x: number; y: number; region: SeekRegion } | null,
  next: { at: number; x: number; y: number; region: SeekRegion },
): boolean {
  if (!prev) return false;
  return (
    prev.region === next.region &&
    next.at - prev.at <= MULTI_CLICK_MS &&
    Math.hypot(next.x - prev.x, next.y - prev.y) <= MULTI_CLICK_DISTANCE_PX
  );
}

/**
 * 位移方向分类：垂直位移越过阈值且占主导 → 亮度；
 * 水平位移越过阈值且占主导 → 进度；否则 null（仍在 pending）。
 */
export function classifyDrag(
  dx: number,
  dy: number,
  verticalThreshold = VERTICAL_THRESHOLD_PX,
  horizontalThreshold = HORIZONTAL_THRESHOLD_PX,
): 'brightness' | 'seek' | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ay >= verticalThreshold && ay > ax) return 'brightness';
  if (ax >= horizontalThreshold && ax >= ay) return 'seek';
  return null;
}

/** 亮度：上滑变亮、下滑变暗（全高约 ±1.0），clamp 到 [0.3, 1.6]。 */
export function brightnessForDrag(base: number, dy: number, height: number): number {
  if (!(height > 0)) return clamp(base, BRIGHTNESS_MIN, BRIGHTNESS_MAX);
  return clamp(base - dy / height, BRIGHTNESS_MIN, BRIGHTNESS_MAX);
}

/**
 * 时长上限：已知正时长用 duration；未知（Infinity/0，如直播流）时不设上限，
 * 只保证非负（浏览器对未就绪媒体写 currentTime 会挂起为 seek，不会崩）。
 */
function durationCeiling(duration: number): number {
  return Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY;
}

/** 按住滑动 seek 目标时间：baseTime + dx × 0.2s，clamp 到 [0, duration]。 */
export function seekTargetForDrag(baseTime: number, dx: number, duration: number): number {
  const target = baseTime + dx * SEEK_SECONDS_PER_PIXEL;
  return clamp(target, 0, durationCeiling(duration));
}

/** 在当前位置叠加一次步进（双击/连击 seek），clamp 到 [0, duration]。 */
export function applySeekStep(current: number, delta: number, duration: number): number {
  return clamp(current + delta, 0, durationCeiling(duration));
}

/** 快进/快退浮层文案：+10s / -20s。 */
export function formatSeekDelta(delta: number): string {
  const sign = delta >= 0 ? '+' : '-';
  return `${sign}${Math.abs(Math.round(delta))}s`;
}
