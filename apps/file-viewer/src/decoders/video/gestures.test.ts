/**
 * 视频手势纯函数单测 —— 连击步长/区域判定/方向分类/亮度与 seek 映射
 */
import { describe, expect, it } from 'vitest';
import {
  MULTI_CLICK_MS,
  applySeekStep,
  brightnessForDrag,
  classifyDrag,
  formatSeekDelta,
  isClickChain,
  seekIncrementForCount,
  seekRegion,
  seekStepForCount,
  seekTargetForDrag,
} from './gestures';

describe('seekStepForCount（连击递增）', () => {
  it('第 2 击 10s，第 3 击 20s，第 4 击 30s', () => {
    expect(seekStepForCount(2)).toBe(10);
    expect(seekStepForCount(3)).toBe(20);
    expect(seekStepForCount(4)).toBe(30);
    expect(seekStepForCount(5)).toBe(40);
  });

  it('上限 60s，单击不产生 seek', () => {
    expect(seekStepForCount(6)).toBe(50);
    expect(seekStepForCount(7)).toBe(60);
    expect(seekStepForCount(8)).toBe(60);
    expect(seekStepForCount(99)).toBe(60);
    expect(seekStepForCount(1)).toBe(0);
    expect(seekStepForCount(0)).toBe(0);
    expect(seekStepForCount(Number.NaN)).toBe(0);
  });
});

describe('seekIncrementForCount（每击增量）', () => {
  it('第 2 击起每击 +10s，封顶后增量归 0', () => {
    expect(seekIncrementForCount(1)).toBe(0);
    expect(seekIncrementForCount(2)).toBe(10);
    expect(seekIncrementForCount(3)).toBe(10);
    expect(seekIncrementForCount(4)).toBe(10);
    expect(seekIncrementForCount(6)).toBe(10);
    expect(seekIncrementForCount(7)).toBe(10);
    expect(seekIncrementForCount(8)).toBe(0);
    expect(seekIncrementForCount(9)).toBe(0);
  });

  it('累计值与增量自洽：Σ增量 = 累计步长', () => {
    let sum = 0;
    for (let count = 2; count <= 9; count += 1) {
      sum += seekIncrementForCount(count);
      expect(sum).toBe(seekStepForCount(count));
    }
  });
});

describe('seekRegion（左/中/右各 1/3）', () => {
  const width = 900;
  it('按相对位置划分区域', () => {
    expect(seekRegion(0, width)).toBe('left');
    expect(seekRegion(299, width)).toBe('left');
    expect(seekRegion(300, width)).toBe('center');
    expect(seekRegion(599, width)).toBe('center');
    expect(seekRegion(600, width)).toBe('right');
    expect(seekRegion(900, width)).toBe('right');
  });

  it('宽度非法时回退 center', () => {
    expect(seekRegion(10, 0)).toBe('center');
    expect(seekRegion(10, -5)).toBe('center');
  });
});

describe('isClickChain（连击判定）', () => {
  const base = { at: 1000, x: 200, y: 100, region: 'left' as const };

  it('同区域、间隔与位移都在阈值内 → 连续连击', () => {
    expect(isClickChain(base, { at: 1000 + MULTI_CLICK_MS - 10, x: 220, y: 110, region: 'left' })).toBe(true);
    expect(isClickChain(base, { at: 1300, x: 200, y: 100, region: 'left' })).toBe(false);
  });

  it('超时/超距/换区域都断链', () => {
    expect(isClickChain(base, { at: 1000 + MULTI_CLICK_MS + 1, x: 200, y: 100, region: 'left' })).toBe(false);
    expect(isClickChain(base, { at: 1100, x: 231, y: 100, region: 'left' })).toBe(false);
    expect(isClickChain(base, { at: 1100, x: 200, y: 100, region: 'right' })).toBe(false);
    expect(isClickChain(null, base)).toBe(false);
  });
});

describe('classifyDrag（方向阈值）', () => {
  it('垂直主导且越过阈值 → 亮度', () => {
    expect(classifyDrag(0, 20)).toBe('brightness');
    expect(classifyDrag(5, -13)).toBe('brightness');
  });

  it('水平主导且越过阈值 → seek', () => {
    expect(classifyDrag(30, 5)).toBe('seek');
    expect(classifyDrag(-30, 20)).toBe('seek');
  });

  it('阈值内或方向不明确 → null（保持 pending）', () => {
    expect(classifyDrag(10, 10)).toBeNull();
    expect(classifyDrag(23, 5)).toBeNull();
    expect(classifyDrag(3, 11)).toBeNull();
  });
});

describe('brightnessForDrag', () => {
  it('上滑变亮、下滑变暗（全高约 1.0 幅度）', () => {
    expect(brightnessForDrag(1, -0.5 * 600, 600)).toBeCloseTo(1.5);
    expect(brightnessForDrag(1, 0.3 * 600, 600)).toBeCloseTo(0.7);
  });

  it('夹在 [0.3, 1.6]', () => {
    expect(brightnessForDrag(1, -10000, 600)).toBeCloseTo(1.6);
    expect(brightnessForDrag(1, 10000, 600)).toBeCloseTo(0.3);
    expect(brightnessForDrag(1.5, -10000, 600)).toBeCloseTo(1.6);
  });

  it('高度非法时不崩，返回基准值（夹边界）', () => {
    expect(brightnessForDrag(1.2, 50, 0)).toBeCloseTo(1.2);
    expect(brightnessForDrag(5, 50, 0)).toBeCloseTo(1.6);
  });
});

describe('seekTargetForDrag / applySeekStep', () => {
  it('1px = 200ms，clamp 到 [0, duration]', () => {
    expect(seekTargetForDrag(10, 50, 100)).toBeCloseTo(20);
    expect(seekTargetForDrag(10, -100, 100)).toBeCloseTo(0);
    expect(seekTargetForDrag(95, 100, 100)).toBeCloseTo(100);
  });

  it('duration 未知（Infinity/0）时以当前位置为上限', () => {
    expect(seekTargetForDrag(30, 1000, Number.POSITIVE_INFINITY)).toBeCloseTo(230);
    expect(seekTargetForDrag(30, -10000, 0)).toBeCloseTo(0);
  });

  it('步进叠加同样 clamp', () => {
    expect(applySeekStep(50, 10, 100)).toBe(60);
    expect(applySeekStep(2, -10, 100)).toBe(0);
    expect(applySeekStep(95, 30, 100)).toBe(100);
  });
});

describe('formatSeekDelta', () => {
  it('正负号与整数秒', () => {
    expect(formatSeekDelta(10)).toBe('+10s');
    expect(formatSeekDelta(-20)).toBe('-20s');
    expect(formatSeekDelta(10.4)).toBe('+10s');
  });
});
