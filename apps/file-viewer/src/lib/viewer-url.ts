/**
 * URL 契约解析 —— src/lib/viewer-url.ts
 *
 * 死契约（omni 服务端 302 与素材库 iframe 都按它接，勿动）：
 * - `/?url=<encodeURIComponent(绝对URL)>` 必填；
 * - 可选 `&name=<显示名>`（缺省取路径末段）；
 * - 可选 `&decoder=<id>` 强制解码器（未知 id 视为无效，回自动判定）；
 * - 「在新窗口打开原始内容」＝ `<url>?raw`（url 已带 query 则 `&raw`）。
 */

export interface ViewerTarget {
  /** 文件原始 URL（http/https 绝对地址） */
  url: string;
  /** 显示名（缺省从 URL 路径末段取） */
  name: string;
  /** 强制解码器 id（未指定/无效时为 undefined，走自动判定） */
  forcedDecoder?: string;
}

export type ViewerTargetResult = ViewerTarget | { error: string };

/**
 * 解析 viewer 的 search 串（形如 `?url=...&name=...&decoder=...`）。
 * url 缺失/非法 → 返回 { error }（布局壳据此渲染契约提示错误态）。
 */
export function parseViewerSearch(search: string): ViewerTargetResult {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return { error: 'URL 参数无法解析' };
  }
  const rawUrl = (params.get('url') ?? '').trim();
  if (!rawUrl) return { error: '缺少 url 参数——契约：/?url=<encodeURIComponent(绝对URL)>' };
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { error: 'url 参数不是合法的绝对 URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { error: '仅支持 http(s) 协议的文件 URL' };
  }
  const name = (params.get('name') ?? '').trim() || fileNameFromUrl(parsed);
  const forcedDecoder = (params.get('decoder') ?? '').trim() || undefined;
  return { url: parsed.href, name, forcedDecoder };
}

/** 从已解析的 URL 取显示名：路径末段（解码百分号编码），无有效段则退主机名。 */
export function fileNameFromUrl(url: URL): string {
  const segments = url.pathname.split('/').filter(Boolean);
  const last = segments.at(-1);
  if (last === undefined) return url.hostname;
  try {
    return decodeURIComponent(last) || url.hostname;
  } catch {
    return last;
  }
}

/**
 * 原始内容地址：`<url>?raw`（url 已带 query 则 `&raw`；hash 段保持在末尾）。
 * 与 omni 服务端的 `?raw` 显式回原始字节契约对齐。
 */
export function withRaw(fileUrl: string): string {
  const hashIdx = fileUrl.indexOf('#');
  const base = hashIdx === -1 ? fileUrl : fileUrl.slice(0, hashIdx);
  const hash = hashIdx === -1 ? '' : fileUrl.slice(hashIdx);
  return `${base}${base.includes('?') ? '&raw' : '?raw'}${hash}`;
}

/**
 * 在 search 串上设置/移除单个参数并回写为 search 形态（带前导 `?`）。
 * value 为 null 时移除该参数（如 decoder 回「自动」）。
 */
export function applySearchParam(search: string, key: string, value: string | null): string {
  const params = new URLSearchParams(search);
  if (value === null || value === '') params.delete(key);
  else params.set(key, value);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}
