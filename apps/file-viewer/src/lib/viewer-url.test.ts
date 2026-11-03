/**
 * URL 契约解析测试 —— 覆盖 url/name/decoder 三参与错误分支、?raw 拼接、参数回写，
 * 以及无壳三参（frameless/size/background）的解析与静默回退。
 */
import { describe, expect, it } from 'vitest';
import {
  applySearchParam,
  fileNameFromUrl,
  formatFramelessSize,
  parseFramelessOptions,
  parseFramelessSize,
  parseViewerSearch,
  withRaw,
} from './viewer-url';

describe('parseViewerSearch', () => {
  it('契约全参：url + name + decoder 都解析出来', () => {
    const url = encodeURIComponent('https://omni.fde2e.com/uploads/%E6%8A%A5%E5%91%8A.md');
    const t = parseViewerSearch(`?url=${url}&name=%E6%98%BE%E7%A4%BA%E5%90%8D&decoder=text`);
    expect(t).toEqual({
      url: 'https://omni.fde2e.com/uploads/%E6%8A%A5%E5%91%8A.md',
      name: '显示名',
      forcedDecoder: 'text',
      frameless: false,
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

describe('parseFramelessSize', () => {
  it('合法 WxH 解析为整数宽高', () => {
    expect(parseFramelessSize('1080x1440')).toEqual({ width: 1080, height: 1440 });
    expect(parseFramelessSize(' 800X600 ')).toEqual({ width: 800, height: 600 });
    expect(parseFramelessSize('1x1')).toEqual({ width: 1, height: 1 });
    expect(parseFramelessSize('8192x8192')).toEqual({ width: 8192, height: 8192 });
  });

  it('非法 size → undefined（静默回退视口）', () => {
    for (const bad of ['', '   ', 'abc', '1080', '1080x', 'x1440', '0x999', '99999x1', '1.5x2', '1080x1440x1', '-10x20']) {
      expect(parseFramelessSize(bad)).toBeUndefined();
    }
    expect(parseFramelessSize(null)).toBeUndefined();
    expect(parseFramelessSize(undefined)).toBeUndefined();
  });
});

describe('formatFramelessSize', () => {
  it('反向序列化契约串', () => {
    expect(formatFramelessSize({ width: 1080, height: 1440 })).toBe('1080x1440');
    expect(formatFramelessSize(undefined)).toBeNull();
  });
});

describe('parseFramelessOptions', () => {
  it('frameless=1/true 生效；size 与 background 透传', () => {
    expect(parseFramelessOptions('?frameless=1&size=1080x1440&background=%23ffffff')).toEqual({
      frameless: true,
      size: { width: 1080, height: 1440 },
      background: '#ffffff',
    });
    expect(parseFramelessOptions('?frameless=TRUE').frameless).toBe(true);
  });

  it('其他 frameless 值一律 false，size/background 全忽略', () => {
    for (const v of ['0', 'false', 'yes', '']) {
      expect(parseFramelessOptions(`?frameless=${v}&size=1080x1440&background=%23fff`)).toEqual({
        frameless: false,
      });
    }
    expect(parseFramelessOptions('')).toEqual({ frameless: false });
  });

  it('非法 size 静默回退（frameless 仍生效）', () => {
    expect(parseFramelessOptions('?frameless=1&size=abc')).toEqual({ frameless: true });
    expect(parseFramelessOptions('?frameless=1&size=0x99999')).toEqual({ frameless: true });
  });

  it('超长 background 忽略', () => {
    const long = 'a'.repeat(201);
    expect(parseFramelessOptions(`?frameless=1&background=${long}`)).toEqual({ frameless: true });
  });
});

describe('parseViewerSearch × frameless', () => {
  it('无壳参数合并进契约解析结果', () => {
    const url = encodeURIComponent('https://host/poster.svg');
    const t = parseViewerSearch(`?url=${url}&frameless=1&size=1080x1440&background=%23ffffff`);
    expect(t).toMatchObject({
      frameless: true,
      size: { width: 1080, height: 1440 },
      background: '#ffffff',
    });
  });

  it('非法 size 不影响预览可用（不报契约错误）', () => {
    const url = encodeURIComponent('https://host/poster.svg');
    const t = parseViewerSearch(`?url=${url}&frameless=1&size=abc`);
    expect('error' in t).toBe(false);
    if (!('error' in t)) expect(t.size).toBeUndefined();
  });

  it('非 frameless 时 size/background 全忽略', () => {
    const url = encodeURIComponent('https://host/poster.svg');
    const t = parseViewerSearch(`?url=${url}&size=1080x1440&background=%23fff`);
    if (!('error' in t)) {
      expect(t.frameless).toBe(false);
      expect(t.size).toBeUndefined();
      expect(t.background).toBeUndefined();
    }
  });
});
