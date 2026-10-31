/**
 * 图片几何纯函数单测 —— 适配缩放 / 旋转 AABB / 平移边界 / 锚点缩放
 */
import { describe, expect, it } from 'vitest';
import {
  IDENTITY,
  clampPan,
  displaySize,
  fitScale,
  isQuarterTurn,
  panBounds,
  zoomAnchor,
  zoomCenter,
} from './geometry';

const MIN = 0.05;
const MAX = 40;

describe('fitScale', () => {
  it('大图等比缩到完整放入容器（contain）', () => {
    // 1600×900 → 800×600：宽度受限 0.5，高度 0.667 → 取 0.5
    expect(fitScale({ w: 1600, h: 900 }, { w: 800, h: 600 })).toBeCloseTo(0.5);
    // 高图 800×1200 → 800×600：高度受限 0.5
    expect(fitScale({ w: 800, h: 1200 }, { w: 800, h: 600 })).toBeCloseTo(0.5);
  });

  it('小图不放大（上限 1:1）', () => {
    expect(fitScale({ w: 300, h: 200 }, { w: 800, h: 600 })).toBe(1);
  });

  it('容器尺寸为 0 时回退 1（旧实现 0 高度会算成 scale=0）', () => {
    expect(fitScale({ w: 1600, h: 900 }, { w: 0, h: 0 })).toBe(1);
    expect(fitScale({ w: 1600, h: 900 }, { w: 800, h: 0 })).toBe(1);
  });

  it('旋转 90° 按交换后的宽高适配', () => {
    // 1600×900 旋转后视觉尺寸 900×1600 → 800×600 容器：0.375
    expect(fitScale({ w: 1600, h: 900 }, { w: 800, h: 600 }, 90)).toBeCloseTo(0.375);
  });
});

describe('displaySize / isQuarterTurn', () => {
  it('90°/270° 交换宽高，0°/180° 不交换', () => {
    expect(isQuarterTurn(90)).toBe(true);
    expect(isQuarterTurn(270)).toBe(true);
    expect(isQuarterTurn(-90)).toBe(true);
    expect(isQuarterTurn(180)).toBe(false);
    expect(isQuarterTurn(0)).toBe(false);
    expect(displaySize({ w: 1000, h: 500 }, 0.5, 0)).toEqual({ w: 500, h: 250 });
    expect(displaySize({ w: 1000, h: 500 }, 0.5, 90)).toEqual({ w: 250, h: 500 });
  });
});

describe('panBounds / clampPan', () => {
  it('位移上限 = 显示尺寸的一半（图片始终覆盖中心点）', () => {
    expect(panBounds({ w: 1000, h: 500 }, 0.5, 0)).toEqual({ maxX: 250, maxY: 125 });
    expect(panBounds({ w: 1000, h: 500 }, 0.5, 90)).toEqual({ maxX: 125, maxY: 250 });
  });

  it('越界位移被夹回边界（拖到右下角时左/上缘贴住中心）', () => {
    const natural = { w: 1000, h: 500 };
    const clamped = clampPan({ scale: 0.5, x: 9999, y: -9999, rotate: 0 }, natural);
    expect(clamped.x).toBe(250);
    expect(clamped.y).toBe(-125);
  });

  it('边界内位移原样保留；尺寸未就绪时不动', () => {
    const t = { scale: 0.5, x: 10, y: -10, rotate: 0 };
    expect(clampPan(t, { w: 1000, h: 500 })).toEqual(t);
    expect(clampPan(t, { w: 0, h: 0 })).toEqual(t);
  });
});

describe('zoomAnchor / zoomCenter', () => {
  it('锚点缩放：光标下的内容点保持不动', () => {
    const t = { ...IDENTITY };
    // 右移 100px 处锚定，放大 2 倍 → 位移 -100，内容点不动
    const next = zoomAnchor(t, { x: 100, y: 0 }, 2, MIN, MAX, { w: 4000, h: 4000 });
    expect(next.scale).toBe(2);
    expect(next.x).toBeCloseTo(-100);
    expect(next.y).toBeCloseTo(0);
  });

  it('缩放后同样执行平移边界 clamp', () => {
    // 100×100 图、1:1 时边界 ±50；在 60px 处缩小 0.5 倍 → x=30 越界（新边界 25）
    const next = zoomAnchor(
      { scale: 1, x: 0, y: 0, rotate: 0 },
      { x: 60, y: 0 },
      0.5,
      MIN,
      MAX,
      { w: 100, h: 100 },
    );
    expect(next.scale).toBe(0.5);
    expect(next.x).toBe(25);
  });

  it('scale 被 min/max 夹住，且以容器中心为锚时位移按比例收敛', () => {
    const t = { scale: 10, x: 8, y: -4, rotate: 0 };
    const next = zoomCenter(t, 100, MIN, MAX, { w: 100000, h: 100000 });
    expect(next.scale).toBe(MAX);
    const k = MAX / 10;
    expect(next.x).toBeCloseTo((1 - k) * (0 - t.x));
    expect(next.y).toBeCloseTo((1 - k) * (0 - t.y));
  });
});
