/**
 * 二进制嗅探测试 —— NUL 直判、控制字符阈值、多字节文本不误伤、空文件放行。
 */
import { describe, expect, it } from 'vitest';
import { looksBinary } from './sniff';

const bytes = (s: string) => new TextEncoder().encode(s);
const bytesRaw = (...nums: number[]) => new Uint8Array(nums);

describe('looksBinary', () => {
  it('含 NUL 字节 → 二进制（不渲染乱码的安全闸）', () => {
    expect(looksBinary(bytesRaw(0x68, 0x00, 0x69))).toBe(true);
  });

  it('纯 ASCII 文本 → 文本', () => {
    expect(looksBinary(bytes('hello world\nsecond line\r\n\ttabbed'))).toBe(false);
  });

  it('UTF-8 中文（多字节 ≥0x80）→ 文本', () => {
    expect(looksBinary(bytes('# 标题\n\n中文内容，含标点。'))).toBe(false);
  });

  it('控制字符占比超阈值 → 二进制', () => {
    const sample = bytesRaw(...Array.from({ length: 100 }, (_, i) => (i % 4 === 0 ? 0x01 : 0x41)));
    expect(looksBinary(sample)).toBe(true);
  });

  it('少量控制字符（制表/换行/回车/换页白名单）不误伤', () => {
    const sample = bytesRaw(...Array.from({ length: 100 }, (_, i) => (i % 16 === 0 ? 0x09 : 0x41)));
    expect(looksBinary(sample)).toBe(false);
  });

  it('0x7F DEL 计入控制字符', () => {
    const sample = bytesRaw(...Array.from({ length: 100 }, (_, i) => (i % 5 === 0 ? 0x7f : 0x41)));
    expect(looksBinary(sample)).toBe(true);
  });

  it('空文件 → 文本（不误伤空 txt）', () => {
    expect(looksBinary(new Uint8Array(0))).toBe(false);
  });

  it('只采样头部窗口（大文件头部即判）', () => {
    const head = bytesRaw(...Array.from({ length: 64 }, () => 0x00));
    const tail = bytes('text'.repeat(1000));
    expect(looksBinary(new Uint8Array([...head, ...tail]))).toBe(true);
  });

  it('PNG 魔数（含 0x00 + 控制字节）→ 二进制', () => {
    expect(looksBinary(bytesRaw(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00))).toBe(true);
  });
});
