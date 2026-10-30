/**
 * 解码器注册表判定矩阵测试 —— forced > 扩展名 > mime > text 兜底。
 */
import { describe, expect, it } from 'vitest';
import { DECODERS, extOf, normalizeMime, resolveDecoder, shouldStreamDirect } from './registry';

describe('extOf', () => {
  it('常规扩展名（小写归一）', () => {
    expect(extOf('报告.MD')).toBe('md');
    expect(extOf('a/b/c.tar.gz')).toBe('gz');
  });

  it('无扩展名/点开头/结尾点 → 空串', () => {
    expect(extOf('README')).toBe('');
    expect(extOf('.gitignore')).toBe('');
    expect(extOf('file.')).toBe('');
  });

  it('路径分隔符取末段', () => {
    expect(extOf('C:\\data\\photo.PNG')).toBe('png');
  });
});

describe('normalizeMime', () => {
  it('剥参数 + trim + 小写', () => {
    expect(normalizeMime('Text/HTML; Charset=UTF-8')).toBe('text/html');
    expect(normalizeMime(undefined)).toBe('');
    expect(normalizeMime('')).toBe('');
  });
});

describe('resolveDecoder 判定矩阵', () => {
  it('forced 最高优先：csv 文件强制 text → text 解码器', () => {
    expect(resolveDecoder('x.csv', 'text/csv', 'text').id).toBe('text');
  });

  it('forced 对未知 id 忽略（回自动判定，不报错）', () => {
    expect(resolveDecoder('x.csv', 'text/csv', 'no-such-decoder').id).toBe('csv');
  });

  it('扩展名判定：各注册解码器逐类抽查', () => {
    const cases: Array<[string, string]> = [
      ['photo.png', 'image'],
      ['photo.JPG', 'image'],
      ['icon.svg', 'svg'],
      ['clip.mp4', 'video'],
      ['song.flac', 'audio'],
      ['doc.pdf', 'pdf'],
      ['notes.md', 'markdown'],
      ['data.json', 'json'],
      ['table.csv', 'csv'],
      ['page.html', 'html'],
      ['报告.docx', 'docx'],
      ['表.xlsx', 'xlsx'],
      ['deck.pptx', 'pptx'],
      ['打包.zip', 'zip'],
      ['log.txt', 'text'],
      ['app.ts', 'text'], // 代码类无专门解码器 → 兜底文本（shiki 按扩展名高亮）
    ];
    for (const [filename, expected] of cases) {
      expect(resolveDecoder(filename, '', undefined).id, filename).toBe(expected);
    }
  });

  it('mime 判定：无扩展名文件按 Content-Type 兜底', () => {
    expect(resolveDecoder('file', 'application/pdf', undefined).id).toBe('pdf');
    expect(resolveDecoder('file', 'image/webp', undefined).id).toBe('image');
    expect(resolveDecoder('file', 'video/mp4; codecs=avc1', undefined).id).toBe('video');
    expect(resolveDecoder('file', 'application/json', undefined).id).toBe('json');
    expect(resolveDecoder('file', 'text/csv', undefined).id).toBe('csv');
    expect(resolveDecoder('file', 'text/html', undefined).id).toBe('html');
  });

  it('mime 通配不截走精确件：无扩展名 svg（image/svg+xml）→ svg 而非 image', () => {
    expect(resolveDecoder('file', 'image/svg+xml', undefined).id).toBe('svg');
  });

  it('扩展名优先于 mime：.md 文件即使被误发 text/plain 也走 markdown', () => {
    expect(resolveDecoder('README.md', 'text/plain', undefined).id).toBe('markdown');
  });

  it('兜底：无扩展名 + 无 mime / 完全未知 → text', () => {
    expect(resolveDecoder('noext', '', undefined).id).toBe('text');
    expect(resolveDecoder('noext', 'application/octet-stream', undefined).id).toBe('text');
    expect(resolveDecoder('noext', 'weird/thing', undefined).id).toBe('text');
    expect(resolveDecoder('', '', undefined).id).toBe('text');
  });

  it('BOM 场景：omni 落盘 csv 带 mime 参数（charset）不影响判定', () => {
    expect(resolveDecoder('export.csv', 'text/csv; charset=utf-8', undefined).id).toBe('csv');
  });

  it('注册表完整性：id 唯一、都有 exts、都有 label、兜底 id 在册', () => {
    const ids = DECODERS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of DECODERS) {
      expect(d.label.length, d.id).toBeGreaterThan(0);
    }
    expect(resolveDecoder('whatever.bin', '', undefined).id).toBe('text');
  });

  it('shouldStreamDirect：视频/音频直连流式（大媒体不整载 fetch）', () => {
    expect(shouldStreamDirect('e2e视频.mp4')).toBe(true);
    expect(shouldStreamDirect('song.FLAC')).toBe(true);
    expect(shouldStreamDirect('clip.webm', undefined)).toBe(true);
    // forced 解码器优先：扩展名不是媒体但强制视频 → 仍直连
    expect(shouldStreamDirect('noext', 'video')).toBe(true);
    // 非媒体类一律整载 fetch
    expect(shouldStreamDirect('doc.pdf')).toBe(false);
    expect(shouldStreamDirect('demo.mp4', 'pdf')).toBe(false);
    expect(shouldStreamDirect('noext', undefined)).toBe(false);
    expect(shouldStreamDirect('notes.md')).toBe(false);
  });
});
