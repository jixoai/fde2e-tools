/**
 * URL 契约解析 —— src/lib/viewer-url.ts
 *
 * 死契约（omni 服务端 302 与素材库 iframe 都按它接，勿动）：
 * - `/?url=<encodeURIComponent(绝对URL)>` 必填；
 * - 可选 `&name=<显示名>`（缺省取路径末段）；
 * - 可选 `&decoder=<id>` 强制解码器（未知 id 视为无效，回自动判定）；
 * - 「在新窗口打开原始内容」＝ `<url>?raw`（url 已带 query 则 `&raw`）。
 *
 * 无壳面契约（file-viewer-frameless）：
 * - `&frameless=1|true`：隐藏一切 viewer 注入的 chrome，只留内容本体；
 * - `&size=WxH`：内容盒严格尺寸（CSS px，1–8192 整数）；非法/缺省＝视口；
 * - `&background=<css color>`：无壳背景色（缺省透明）。
 * - 三个参数只在 frameless 下生效；非 frameless 全忽略（零行为变化）。
 */

/** 无壳尺寸（CSS px，1–8192 整数）。 */
export interface FramelessSize {
  width: number;
  height: number;
}

/** 无壳选项（frameless=false 时 size/background 恒为 undefined——全忽略）。 */
export interface FramelessOptions {
  frameless: boolean;
  size?: FramelessSize;
  background?: string;
}

export interface ViewerTarget extends FramelessOptions {
  /** 文件原始 URL（http/https 绝对地址） */
  url: string;
  /** 显示名（缺省从 URL 路径末段取） */
  name: string;
  /** 强制解码器 id（未指定/无效时为 undefined，走自动判定） */
  forcedDecoder?: string;
}

export type ViewerTargetResult = ViewerTarget | { error: string };

/** size 允许的最大边长（CSS px）——防离谱值撑爆截图/显存。 */
const SIZE_MAX = 8192;
/** background 最大长度（CSS 颜色串；超长视为非法，静默忽略）。 */
const BACKGROUND_MAX_LENGTH = 200;

/** `WxH` 解析：仅接受 1–8192 的十进制整数；非法返回 undefined（静默回退视口）。 */
export function parseFramelessSize(raw: string | null | undefined): FramelessSize | undefined {
  const value = (raw ?? '').trim();
  if (!value) return undefined;
  const match = /^(\d+)\s*[xX]\s*(\d+)$/.exec(value);
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height)) return undefined;
  if (width < 1 || height < 1 || width > SIZE_MAX || height > SIZE_MAX) return undefined;
  return { width, height };
}

/** 尺寸 → 契约串（`WxH`；供 WebMCP 回执与断言使用）。 */
export function formatFramelessSize(size: FramelessSize | undefined): string | null {
  return size ? `${size.width}x${size.height}` : null;
}

/**
 * 解析无壳三参（与完整契约解析共用同一 search 串）。
 * 非法 size 静默回退（预览可用优先，绝不因此报契约错误）；background 超长忽略。
 */
export function parseFramelessOptions(search: string): FramelessOptions {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return { frameless: false };
  }
  const flag = (params.get('frameless') ?? '').trim().toLowerCase();
  const frameless = flag === '1' || flag === 'true';
  if (!frameless) return { frameless: false };
  const size = parseFramelessSize(params.get('size'));
  const rawBackground = (params.get('background') ?? '').trim();
  const background =
    rawBackground && rawBackground.length <= BACKGROUND_MAX_LENGTH ? rawBackground : undefined;
  return { frameless, size, background };
}

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
  return { url: parsed.href, name, forcedDecoder, ...parseFramelessOptions(search) };
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
