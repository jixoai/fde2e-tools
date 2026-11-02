/*
 * Canvas 素材库 —— apps/canvas/src/assets.ts
 *
 * 内置素材（背景/形状）全部同源 SVG data URL；用户素材经 import_asset 导入：
 * - 图片：CORS/协议/私网校验 → createImageBitmap → 缩放/压缩 → data URL；
 * - SVG：DOMPurify 清洗 + 外部 url()/@import 拒绝；
 * - 字体：委托 font_info，不转存。
 * provenance 只记录，不阻断。
 */
import DOMPurify from "dompurify";
import notoSansScWoff2 from "../../../packages/shared/assets/fonts/NotoSansSC-Regular.subset.woff2?url";
import { validateFetchableUrl } from "./spec";
import { fontInfo } from "./font-client";

export type AssetType = "background" | "shape" | "font";

export interface Asset {
  id: string;
  type: AssetType;
  name: string;
  tags: string[];
  style: string;
  license: string;
  source: string;
  width?: number;
  height?: number;
  dataUrl?: string;
  fontUrl?: string;
  family?: string;
  weights?: number[];
  bytes?: number;
}

function svgDataUrl(svg: string): string {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

const BUILTIN: Asset[] = [
  {
    id: "bg-deep-space",
    type: "background",
    name: "深空光晕",
    tags: ["科技", "深色", "光晕", "渐变"],
    style: "tech",
    license: "CC0",
    source: "builtin",
    width: 1080,
    height: 1440,
    dataUrl: svgDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440" viewBox="0 0 1080 1440"><defs><radialGradient id="a" cx="20%" cy="10%" r="80%"><stop offset="0" stop-color="#1b3a7a"/><stop offset="1" stop-color="#0b1020"/></radialGradient><radialGradient id="b" cx="80%" cy="85%" r="70%"><stop offset="0" stop-color="#2f6bff" stop-opacity=".55"/><stop offset="1" stop-color="#0b1020" stop-opacity="0"/></radialGradient></defs><rect width="1080" height="1440" fill="url(#a)"/><rect width="1080" height="1440" fill="url(#b)"/></svg>`,
    ),
  },
  {
    id: "bg-paper-grid",
    type: "background",
    name: "纸感网格",
    tags: ["极简", "浅色", "网格", "纸感"],
    style: "minimal",
    license: "CC0",
    source: "builtin",
    width: 1080,
    height: 1080,
    dataUrl: svgDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080"><rect width="1080" height="1080" fill="#f7f4ee"/><g stroke="#d9d2c5" stroke-width="1" opacity=".6">${Array.from({ length: 27 }, (_, i) => `<line x1="${i * 40}" y1="0" x2="${i * 40}" y2="1080"/>`).join("")}${Array.from({ length: 27 }, (_, i) => `<line x1="0" y1="${i * 40}" x2="1080" y2="${i * 40}"/>`).join("")}</g></svg>`,
    ),
  },
  {
    id: "bg-warm-sunset",
    type: "background",
    name: "暖色日落",
    tags: ["手绘", "暖色", "渐变", "柔和"],
    style: "handdrawn",
    license: "CC0",
    source: "builtin",
    width: 1080,
    height: 1440,
    dataUrl: svgDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440" viewBox="0 0 1080 1440"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd7a8"/><stop offset=".55" stop-color="#ff9a76"/><stop offset="1" stop-color="#7a3b5e"/></linearGradient></defs><rect width="1080" height="1440" fill="url(#g)"/><circle cx="780" cy="360" r="150" fill="#fff2cf" opacity=".9"/></svg>`,
    ),
  },
  {
    id: "shape-check",
    type: "shape",
    name: "对勾圆",
    tags: ["图标", "对勾", "圆"],
    style: "tech",
    license: "CC0",
    source: "builtin",
    width: 120,
    height: 120,
    dataUrl: svgDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><circle cx="60" cy="60" r="50" fill="#2f6bff"/><path d="M35 60 L55 80 L90 40" stroke="#fff" stroke-width="8" fill="none"/></svg>`,
    ),
  },
  {
    id: "shape-arrow",
    type: "shape",
    name: "手绘箭头",
    tags: ["手绘", "箭头", "装饰"],
    style: "handdrawn",
    license: "CC0",
    source: "builtin",
    width: 180,
    height: 120,
    dataUrl: svgDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="120" viewBox="0 0 180 120"><path d="M10 80 Q 70 10 150 55" stroke="#1f2937" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M150 55 L125 45 M150 55 L138 80" stroke="#1f2937" stroke-width="6" fill="none" stroke-linecap="round"/></svg>`,
    ),
  },
];

/* ---------------- 开箱背景/形状扩展（canvas-tool-v1 C1/G4） ----------------
 * 全部为同源 SVG data URL（零外链、零网络）；按风格打标签，供 list_assets 过滤。
 * 保持小体积：渐变/网格/点阵/条纹/光晕由 SVG 原语生成，不引入位图。 */
function linearBackground(
  id: string,
  name: string,
  style: string,
  tags: string[],
  from: string,
  to: string,
  extra = "",
): Asset {
  return {
    id,
    type: "background",
    name,
    tags: [style, ...tags],
    style,
    license: "CC0",
    source: "builtin",
    width: 1080,
    height: 1440,
    dataUrl: svgDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440" viewBox="0 0 1080 1440"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="1080" height="1440" fill="url(#g)"/>${extra}</svg>`,
    ),
  };
}

function radialBackground(
  id: string,
  name: string,
  style: string,
  tags: string[],
  inner: string,
  outer: string,
  cx = "50%",
  cy = "35%",
): Asset {
  return {
    id,
    type: "background",
    name,
    tags: [style, ...tags],
    style,
    license: "CC0",
    source: "builtin",
    width: 1080,
    height: 1440,
    dataUrl: svgDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440" viewBox="0 0 1080 1440"><defs><radialGradient id="g" cx="${cx}" cy="${cy}" r="80%"><stop offset="0" stop-color="${inner}"/><stop offset="1" stop-color="${outer}"/></radialGradient></defs><rect width="1080" height="1440" fill="url(#g)"/></svg>`,
    ),
  };
}

function dotsBackground(id: string, name: string, style: string, tags: string[], bg: string, dot: string): Asset {
  return {
    id,
    type: "background",
    name,
    tags: [style, ...tags],
    style,
    license: "CC0",
    source: "builtin",
    width: 1080,
    height: 1440,
    dataUrl: svgDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440" viewBox="0 0 1080 1440"><defs><pattern id="d" width="36" height="36" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r="2.5" fill="${dot}"/></pattern></defs><rect width="1080" height="1440" fill="${bg}"/><rect width="1080" height="1440" fill="url(#d)" opacity=".65"/></svg>`,
    ),
  };
}

function stripeBackground(id: string, name: string, style: string, tags: string[], bg: string, stripe: string): Asset {
  return {
    id,
    type: "background",
    name,
    tags: [style, ...tags],
    style,
    license: "CC0",
    source: "builtin",
    width: 1080,
    height: 1440,
    dataUrl: svgDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440" viewBox="0 0 1080 1440"><defs><pattern id="s" width="64" height="64" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="32" height="64" fill="${stripe}"/></pattern></defs><rect width="1080" height="1440" fill="${bg}"/><rect width="1080" height="1440" fill="url(#s)" opacity=".5"/></svg>`,
    ),
  };
}

function shape(id: string, name: string, tags: string[], path: string, width = 120, height = 120, fill = "#2f6bff"): Asset {
  return {
    id,
    type: "shape",
    name,
    tags,
    style: "tech",
    license: "CC0",
    source: "builtin",
    width,
    height,
    dataUrl: svgDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><path d="${path}" fill="${fill}"/></svg>`,
    ),
  };
}

const EXTRA_BACKGROUNDS: Asset[] = [
  linearBackground("bg-aurora", "极光渐变", "tech", ["深色", "渐变", "光晕"], "#071a2b", "#0f3d5c", '<circle cx="850" cy="260" r="260" fill="#2de2c8" opacity=".18"/><circle cx="200" cy="1180" r="320" fill="#7b61ff" opacity=".2"/>'),
  linearBackground("bg-ocean", "深海蓝", "minimal", ["蓝", "渐变", "冷静"], "#eaf4ff", "#b8d8f5"),
  linearBackground("bg-forest", "森林绿", "handdrawn", ["绿", "自然", "柔和"], "#e8f2e5", "#a8c8a0"),
  linearBackground("bg-sunset-soft", "柔光日落", "handdrawn", ["暖色", "渐变", "柔和"], "#fff1dc", "#f6b8a8"),
  linearBackground("bg-mono", "黑白极简", "minimal", ["黑白", "极简", "高级"], "#fafafa", "#d4d4d8"),
  linearBackground("bg-cyber", "赛博紫", "tech", ["紫", "深色", "霓虹"], "#160a2e", "#3b0f6b", '<rect x="0" y="1100" width="1080" height="2" fill="#ff4fd8" opacity=".6"/>'),
  linearBackground("bg-pastel", "奶油粉", "handdrawn", ["粉", "浅色", "可爱"], "#fff7f2", "#ffd9e2"),
  linearBackground("bg-ink", "水墨灰", "retro", ["灰", "国潮", "留白"], "#f4f1ea", "#cfc8ba"),
  linearBackground("bg-glass", "玻璃蓝", "tech", ["蓝", "玻璃", "浅色"], "#eef6ff", "#c9e2ff", '<rect x="80" y="120" width="920" height="1200" rx="48" fill="#ffffff" opacity=".18"/>'),
  dotsBackground("bg-dots-mono", "点阵纸", "minimal", ["点阵", "浅色", "网格"], "#faf9f6", "#b9b2a6"),
  stripeBackground("bg-stripes-blue", "蓝条纹", "retro", ["条纹", "蓝", "复古"], "#eef4ff", "#bcd3ff"),
  radialBackground("bg-glow-warm", "暖光晕", "handdrawn", ["光晕", "暖色", "柔和"], "#fff3cf", "#f6c3a8"),
];

const EXTRA_SHAPES: Asset[] = [
  shape("shape-star", "五角星", ["图标", "星", "装饰"], "M60 8 L73 44 L112 44 L81 66 L92 104 L60 81 L28 104 L39 66 L8 44 L47 44 Z", 120, 120, "#f5b301"),
  shape("shape-heart", "爱心", ["图标", "心", "情感"], "M60 104 C20 76 10 54 10 38 C10 22 24 10 38 10 C48 10 56 16 60 24 C64 16 72 10 82 10 C96 10 110 22 110 38 C110 54 100 76 60 104 Z", 120, 120, "#ef476f"),
  shape("shape-bolt", "闪电", ["图标", "能量", "科技"], "M68 4 L18 68 L54 68 L44 116 L102 46 L64 46 Z", 120, 120, "#ffd166"),
  shape("shape-play", "播放", ["图标", "媒体", "按钮"], "M30 16 L104 60 L30 104 Z", 120, 120, "#06d6a0"),
  shape("shape-quote", "引号", ["图标", "引用", "文字"], "M18 78 C18 46 38 26 66 22 L70 38 C54 42 44 52 42 66 L66 66 L66 100 L18 100 Z M72 78 C72 46 92 26 120 22 L124 38 C108 42 98 52 96 66 L120 66 L120 100 L72 100 Z", 140, 120, "#118ab2"),
  shape("shape-badge", "徽章圆", ["图标", "徽章", "圆形"], "M60 6 A54 54 0 1 1 59.9 6 Z", 120, 120, "#7b61ff"),
  shape("shape-line", "分隔线", ["装饰", "线", "极简"], "M0 8 H240 V16 H0 Z", 240, 24, "#94a3b8"),
  shape("shape-arrow-right", "右箭头", ["图标", "箭头", "方向"], "M10 50 H80 V20 L120 60 L80 100 V70 H10 Z", 130, 120, "#2f6bff"),
  shape("shape-ring", "圆环", ["装饰", "圆", "几何"], "M60 8 A52 52 0 1 1 59.9 8 Z M60 28 A32 32 0 1 0 60.1 28 Z", 120, 120, "#0ea5e9"),
  shape("shape-square", "方框", ["装饰", "方形", "几何"], "M12 12 H108 V108 H12 Z", 120, 120, "#111827"),
];

const EXTRA_FONTS: Asset[] = [
  {
    id: "font-noto-sans-sc",
    type: "font",
    name: "Noto Sans SC（常用字 WOFF2 子集）",
    tags: ["中文", "无衬线", "常用字", "OFL"],
    style: "minimal",
    license: "OFL-1.1",
    source: "builtin",
    family: "Noto Sans SC",
    weights: [400, 700],
    fontUrl: notoSansScWoff2,
  },
];

BUILTIN.push(...EXTRA_BACKGROUNDS, ...EXTRA_SHAPES, ...EXTRA_FONTS);

const imported = new Map<string, Asset>();
let seq = 0;

export function listAssets(opts: { type?: AssetType; style?: string; q?: string } = {}): Asset[] {
  const q = opts.q?.trim().toLowerCase();
  const all = [...BUILTIN, ...imported.values()];
  return all.filter((a) => {
    if (opts.type && a.type !== opts.type) return false;
    if (opts.style && a.style !== opts.style) return false;
    if (q && !`${a.id} ${a.name} ${a.tags.join(" ")} ${a.style}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export function getAsset(id: string): Asset | null {
  return imported.get(id) ?? BUILTIN.find((a) => a.id === id) ?? null;
}

export function assetSummary(a: Asset): Omit<Asset, "dataUrl" | "fontUrl"> {
  const { dataUrl: _dataUrl, fontUrl: _fontUrl, ...rest } = a;
  return rest;
}

function bytesOfDataUrl(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return 0;
  const b64 = dataUrl.slice(comma + 1);
  return Math.round((b64.length * 3) / 4);
}

function assertSafeSvg(text: string): void {
  if (/@import/i.test(text)) throw new Error("SVG 不允许 @import");
  const bad = text.match(/url\(\s*['"]?(https?:|\/\/)/i);
  if (bad) throw new Error("SVG 不允许外部 url()");
  if (/(?:xlink:)?href\s*=\s*["']\s*(?:https?:)?\/\//i.test(text)) throw new Error("SVG 不允许外部 href");
  if (/<script[\s>]/i.test(text)) throw new Error("SVG 不允许 script");
  if (/\son[a-z]+\s*=/i.test(text)) throw new Error("SVG 不允许事件属性");
}

async function importImage(url: string, name: string | undefined, maxWidth: number, maxHeight: number): Promise<Asset> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`图片加载失败（HTTP ${res.status}）`);
  const blob = await res.blob();
  if (!blob.type.startsWith("image/")) throw new Error(`不是图片（${blob.type || "unknown"}）`);
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d 不可用");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const keepPng = blob.type === "image/png" || blob.type === "image/webp";
  const dataUrl = keepPng ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.85);
  const id = `img-${++seq}`;
  return {
    id,
    type: "background",
    name: name || id,
    tags: ["imported", "image"],
    style: "imported",
    license: "user",
    source: url,
    width: w,
    height: h,
    dataUrl,
    bytes: bytesOfDataUrl(dataUrl),
  };
}

async function importSvg(url: string, name: string | undefined): Promise<Asset> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SVG 加载失败（HTTP ${res.status}）`);
  const text = await res.text();
  assertSafeSvg(text);
  const clean = DOMPurify.sanitize(text, { USE_PROFILES: { svg: true, svgFilters: true } });
  assertSafeSvg(clean);
  const id = `svg-${++seq}`;
  const dataUrl = svgDataUrl(clean);
  return {
    id,
    type: "shape",
    name: name || id,
    tags: ["imported", "svg"],
    style: "imported",
    license: "user",
    source: url,
    dataUrl,
    bytes: bytesOfDataUrl(dataUrl),
  };
}

export async function importAsset(req: {
  url: string;
  type: "image" | "svg" | "font";
  name?: string;
  maxWidth?: number;
  maxHeight?: number;
}): Promise<Asset> {
  validateFetchableUrl(req.url, "import_asset.url");
  if (req.type === "font") {
    const info = await fontInfo(req.url);
    const id = `font-${++seq}`;
    const asset: Asset = {
      id,
      type: "font",
      name: req.name || info.family,
      tags: ["imported", "font"],
      style: "imported",
      license: "user",
      source: req.url,
      fontUrl: req.url,
      family: info.family,
      weights: [400, 700],
    };
    imported.set(id, asset);
    return asset;
  }
  const asset =
    req.type === "svg"
      ? await importSvg(req.url, req.name)
      : await importImage(
          req.url,
          req.name,
          Math.min(4096, Math.max(16, req.maxWidth ?? 1600)),
          Math.min(4096, Math.max(16, req.maxHeight ?? 1600)),
        );
  imported.set(asset.id, asset);
  return asset;
}
