/**
 * 预览尺寸门测试 —— 进高亮/进纯 pre 的边界（≤ 阈值含边界，超一个字符即降级）。
 */
import { describe, expect, it } from 'vitest';
import {
  MD_HIGHLIGHT_MAX_CHARS,
  MD_PLAINTEXT_MAX_CHARS,
  TEXT_HIGHLIGHT_MAX_CHARS,
  markdownPreviewPath,
  textPreviewPath,
} from './preview-gate';

describe('textPreviewPath', () => {
  it('空文件 → 高亮路径（小文件零降级）', () => {
    expect(textPreviewPath(0)).toBe('highlight');
  });

  it('边界：恰 64KB → 进高亮（≤ 阈值含边界）', () => {
    expect(textPreviewPath(TEXT_HIGHLIGHT_MAX_CHARS)).toBe('highlight');
  });

  it('边界：64KB + 1 字符 → 纯 pre（零 token 化快路径）', () => {
    expect(textPreviewPath(TEXT_HIGHLIGHT_MAX_CHARS + 1)).toBe('plain');
  });

  it('远超阈值 → 纯 pre', () => {
    expect(textPreviewPath(5_000_000)).toBe('plain');
  });
});

describe('markdownPreviewPath', () => {
  it('小文件 → 全管线（marked + 代码块高亮 + 消毒）', () => {
    expect(markdownPreviewPath(0)).toBe('full');
  });

  it('边界：恰 256KB → 仍全管线', () => {
    expect(markdownPreviewPath(MD_HIGHLIGHT_MAX_CHARS)).toBe('full');
  });

  it('边界：256KB + 1 字符 → 跳代码块高亮（保留 marked + 消毒）', () => {
    expect(markdownPreviewPath(MD_HIGHLIGHT_MAX_CHARS + 1)).toBe('no-highlight');
  });

  it('边界：恰 1MB → 仍保留 md 结构渲染（no-highlight）', () => {
    expect(markdownPreviewPath(MD_PLAINTEXT_MAX_CHARS)).toBe('no-highlight');
  });

  it('边界：1MB + 1 字符 → 纯文本 pre（结构解析也跳过）', () => {
    expect(markdownPreviewPath(MD_PLAINTEXT_MAX_CHARS + 1)).toBe('plain');
  });

  it('远超阈值 → 纯文本 pre', () => {
    expect(markdownPreviewPath(10_000_000)).toBe('plain');
  });
});
