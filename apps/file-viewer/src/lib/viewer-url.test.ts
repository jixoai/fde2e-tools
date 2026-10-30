/**
 * URL 契约解析测试 —— 覆盖 url/name/decoder 三参与错误分支、?raw 拼接、参数回写。
 */
import { describe, expect, it } from 'vitest';
import { applySearchParam, fileNameFromUrl, parseViewerSearch, withRaw } from './viewer-url';

describe('parseViewerSearch', () => {
  it('契约全参：url + name + decoder 都解析出来', () => {
    const url = encodeURIComponent('https://omni.fde2e.com/uploads/%E6%8A%A5%E5%91%8A.md');
    const t = parseViewerSearch(`?url=${url}&name=%E6%98%BE%E7%A4%BA%E5%90%8D&decoder=text`);
    expect(t).toEqual({
      url: 'https://omni.fde2e.com/uploads/%E6%8A%A5%E5%91%8A.md',
      name: '显示名',
      forcedDecoder: 'text',
    });
  });

  it('缺省 name：取路径末段并解码百分号编码', () => {
    const url = encodeURIComponent('https://omni.fde2e.com/uploads/%E6%96%87%E6%A1%A3%E4%B8%80.txt');
    const t = parseViewerSearch(`?url=${url}`);
    expect(t).toMatchObject({ name: '文档一.txt', forcedDecoder: undefined });
  });

  it('缺省 decoder：undefined（走自动判定）', () => {
    const url = encodeURIComponent('https://host/a/b.png');
    const t = parseViewerSearch(`?url=${url}`);
    expect('error' in t).toBe(false);
    if (!('error' in t)) expect(t.forcedDecoder).toBeUndefined();
  });

  it('缺 url → error（契约提示）', () => {
    expect(parseViewerSearch('?name=x')).toMatchObject({ error: expect.stringContaining('url') });
    expect(parseViewerSearch('')).toMatchObject({ error: expect.any(String) });
  });

  it('url 非绝对地址 → error', () => {
    const t = parseViewerSearch(`?url=${encodeURIComponent('/uploads/a.txt')}`);
    expect(t).toMatchObject({ error: expect.stringContaining('绝对 URL') });
  });

  it('url 非法百分号编码仍可解析（URL 构造容错）', () => {
    const t = parseViewerSearch('?url=https%3A%2F%2Fhost%2Fa%25zz.txt');
    expect('error' in t).toBe(false);
  });

  it('非 http(s) 协议 → error', () => {
    const t = parseViewerSearch(`?url=${encodeURIComponent('file:///etc/passwd')}`);
    expect(t).toMatchObject({ error: expect.stringContaining('http') });
  });

  it('decoder 空串视为未指定', () => {
    const url = encodeURIComponent('https://host/a.txt');
    const t = parseViewerSearch(`?url=${url}&decoder=`);
    if (!('error' in t)) expect(t.forcedDecoder).toBeUndefined();
  });
});

describe('fileNameFromUrl', () => {
  it('路径末段 + 百分号解码', () => {
    expect(fileNameFromUrl(new URL('https://h/a/%E4%B8%AD%E6%96%87.md'))).toBe('中文.md');
  });

  it('根路径退主机名', () => {
    expect(fileNameFromUrl(new URL('https://example.com/'))).toBe('example.com');
  });

  it('非法百分号编码回退原段不抛出', () => {
    expect(fileNameFromUrl(new URL('https://h/a/b%zz.txt'))).toBe('b%zz.txt');
  });

  it('query 与 hash 不参与取名', () => {
    expect(fileNameFromUrl(new URL('https://h/uploads/real.csv?token=abc'))).toBe('real.csv');
  });
});

describe('withRaw', () => {
  it('无 query 追加 ?raw', () => {
    expect(withRaw('https://h/uploads/a.txt')).toBe('https://h/uploads/a.txt?raw');
  });

  it('已有 query 追加 &raw', () => {
    expect(withRaw('https://h/uploads/a.txt?token=x')).toBe('https://h/uploads/a.txt?token=x&raw');
  });

  it('hash 保持在末尾', () => {
    expect(withRaw('https://h/a.txt#frag')).toBe('https://h/a.txt?raw#frag');
    expect(withRaw('https://h/a.txt?x=1#frag')).toBe('https://h/a.txt?x=1&raw#frag');
  });
});

describe('applySearchParam', () => {
  it('设置参数（保留前导 ?）', () => {
    expect(applySearchParam('?url=a', 'decoder', 'csv')).toBe('?url=a&decoder=csv');
  });

  it('覆盖既有参数', () => {
    expect(applySearchParam('?url=a&decoder=text', 'decoder', 'csv')).toBe('?url=a&decoder=csv');
  });

  it('null 移除参数', () => {
    expect(applySearchParam('?url=a&decoder=text', 'decoder', null)).toBe('?url=a');
  });

  it('全部参数移除后返回空串（无前导 ?）', () => {
    expect(applySearchParam('?decoder=text', 'decoder', null)).toBe('');
  });
});
