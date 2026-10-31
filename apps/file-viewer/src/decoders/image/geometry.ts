/**
 * 图片几何纯函数 —— src/decoders/image/geometry.ts
 *
 * 与 React 解耦，供解码器与单测共用。坐标系约定：
 * - 容器中心为原点，图片中心位于 (x, y)（px，未旋转前坐标系）；
 * - 图片按 scale 等比缩放后绕自身中心旋转 rotate（度）。
 */

export interface Size {
  w: number;
  h: number;
}

export interface Transform {
  scale: number;
  x: number;
  y: number;
  rotate: number;
}

export const IDENTITY: Transform = { scale: 1, x: 0, y: 0, rotate: 0 };

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** 是否为 90°/270°（宽高互换的旋转）。 */
export function isQuarterTurn(rotate: number): boolean {
  const quarter = ((rotate % 360) + 360) % 360;
  return quarter === 90 || quarter === 270;
}

/** 旋转后的显示尺寸（AABB：90°/270° 交换宽高）。 */
export function displaySize(natural: Size, scale: number, rotate: number): Size {
  const swap = isQuarterTurn(rotate);
  return {
    w: (swap ? natural.h : natural.w) * scale,
    h: (swap ? natural.w : natural.h) * scale,
  };
}

/**
 * 适配缩放：等比缩放到完整放入容器，且不放大小图（上限 1:1）。
 * 旋转 90°/270° 时按交换后的宽高计算。
 */
export function fitScale(natural: Size, container: Size, rotate = 0): number {
  if (!(natural.w > 0 && natural.h > 0 && container.w > 0 && container.h > 0)) return 1;
  const swap = isQuarterTurn(rotate);
  const srcW = swap ? natural.h : natural.w;
  const srcH = swap ? natural.w : natural.h;
  return Math.min(container.w / srcW, container.h / srcH, 1);
}

/**
 * 平移边界：图片必须始终覆盖视窗中心点。
 * 以容器中心为原点，图片中心位移上限 = 显示尺寸的一半
 * （拖到尽头时图片的左/上缘贴住中心，或右/下缘贴住中心）。
 */
export function panBounds(natural: Size, scale: number, rotate: number): { maxX: number; maxY: number } {
  const size = displaySize(natural, scale, rotate);
  return { maxX: size.w / 2, maxY: size.h / 2 };
}

/** 把位移夹进边界（保持 scale/rotate 不变）。 */
export function clampPan(t: Transform, natural: Size): Transform {
  if (!(natural.w > 0 && natural.h > 0)) return t;
  const { maxX, maxY } = panBounds(natural, t.scale, t.rotate);
  return { ...t, x: clamp(t.x, -maxX, maxX), y: clamp(t.y, -maxY, maxY) };
}

/**
 * 以容器内某点为锚缩放（point 为相对容器中心的坐标）：
 * 缩放前后该点下压着的图片内容保持不动。
 */
export function zoomAnchor(
  t: Transform,
  point: { x: number; y: number },
  factor: number,
  minScale: number,
  maxScale: number,
  natural: Size,
): Transform {
  const scale = clamp(t.scale * factor, minScale, maxScale);
  const k = scale / t.scale;
  return clampPan(
    {
      ...t,
      scale,
      x: (1 - k) * (point.x - t.x),
      y: (1 - k) * (point.y - t.y),
    },
    natural,
  );
}

/** 以容器中心为锚缩放（按钮缩放）。 */
export function zoomCenter(
  t: Transform,
  factor: number,
  minScale: number,
  maxScale: number,
  natural: Size,
): Transform {
  return zoomAnchor(t, { x: 0, y: 0 }, factor, minScale, maxScale, natural);
}
