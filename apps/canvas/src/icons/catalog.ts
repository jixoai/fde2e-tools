/*
 * 图标目录运行时 —— apps/canvas/src/icons/catalog.ts
 *
 * 只读 `catalog.generated.json`（构建期由 scripts/gen-icon-catalog.mjs 从
 * react-icons 六族生成），**运行时不打包 react-icons**。
 *
 * - 支持的是「同源 SVG 家族」，不是 React 组件运行时；
 * - getIcon 把 currentColor 换成请求颜色，按 viewBox 等比缩放到 size，
 *   注册为 type:"shape" 资产并返回 assetId（不向前端回大段 data URL）；
 * - 任意官方 SVG 仍走 import_asset({type:"svg"}) 兜底（清洗/外部 href 拒绝）。
 */
import catalogData from "./catalog.generated.json";
import { registerGeneratedAsset, svgDataUrl } from "../assets";

export type IconLibrary = "lucide" | "tabler" | "heroicons" | "bootstrap" | "fontawesome" | "material";

export interface IconEntry {
  id: string;
  library: IconLibrary;
  name: string;
  tags: string[];
  viewBox: string;
  innerSvg: string;
  license: string;
}

export interface IconSummary {
  id: string;
  library: IconLibrary;
  name: string;
  tags: string[];
  viewBox: string;
  license: string;
}

export class IconError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "IconError";
    this.code = code;
  }
}

export const ICON_LIBRARIES: Array<{ id: IconLibrary; label: string; license: string }> = [
  { id: "lucide", label: "Lucide", license: "ISC" },
  { id: "tabler", label: "Tabler Icons", license: "MIT" },
  { id: "heroicons", label: "Heroicons", license: "MIT" },
  { id: "bootstrap", label: "Bootstrap Icons", license: "MIT" },
  { id: "fontawesome", label: "Font Awesome Free", license: "CC BY 4.0 / OFL-1.1" },
  { id: "material", label: "Material Icons", license: "Apache-2.0" },
];

const CATALOG = catalogData as unknown as IconEntry[];
const BY_ID = new Map(CATALOG.map((icon) => [icon.id, icon]));
const LIBRARY_IDS = new Set<string>(ICON_LIBRARIES.map((l) => l.id));

export function iconLibraryLabel(id: string): string {
  return ICON_LIBRARIES.find((l) => l.id === id)?.label ?? id;
}

export function iconSummary(icon: IconEntry): IconSummary {
  return {
    id: icon.id,
    library: icon.library,
    name: icon.name,
    tags: icon.tags,
    viewBox: icon.viewBox,
    license: icon.license,
  };
}

export interface SearchIconsOptions {
  q?: string;
  library?: string;
  limit?: number;
}

export function searchIcons(opts: SearchIconsOptions = {}): IconSummary[] {
  const q = opts.q?.trim().toLowerCase();
  const library = opts.library?.trim().toLowerCase();
  if (library && !LIBRARY_IDS.has(library)) {
    throw new IconError(
      "E_ICON_LIBRARY",
      `未知图标库：${opts.library}；可用库：${ICON_LIBRARIES.map((l) => l.id).join(", ")}`,
    );
  }
  const rawLimit = Number(opts.limit);
  const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, Math.floor(rawLimit))) : 40;
  const out: IconSummary[] = [];
  for (const icon of CATALOG) {
    if (library && icon.library !== library) continue;
    if (q) {
      const hay = `${icon.id} ${icon.library} ${icon.name} ${icon.tags.join(" ")}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    out.push(iconSummary(icon));
    if (out.length >= limit) break;
  }
  return out;
}

export interface GetIconOptions {
  id?: string;
  library?: string;
  name?: string;
  color?: string;
  size?: number;
  strokeWidth?: number;
}

export interface GetIconResult {
  assetId: string;
  width: number;
  height: number;
  library: IconLibrary;
  name: string;
  viewBox: string;
  license: string;
}

function findIcon(opts: GetIconOptions): IconEntry {
  if (typeof opts.id === "string" && opts.id.trim()) {
    const icon = BY_ID.get(opts.id.trim());
    if (!icon) throw new IconError("E_ICON_NOT_FOUND", `图标不存在：${opts.id}（用 search_icons 查询）`);
    return icon;
  }
  const library = opts.library?.trim().toLowerCase();
  const name = opts.name?.trim().toLowerCase();
  if (!library || !name) {
    throw new IconError("E_ICON_NOT_FOUND", "需要 id，或同时提供 library 与 name");
  }
  if (!LIBRARY_IDS.has(library)) {
    throw new IconError(
      "E_ICON_LIBRARY",
      `未知图标库：${opts.library}；可用库：${ICON_LIBRARIES.map((l) => l.id).join(", ")}`,
    );
  }
  const icon = BY_ID.get(`${library}:${name}`);
  if (!icon) {
    throw new IconError(
      "E_ICON_NOT_FOUND",
      `图标不存在：${library}:${name}（用 search_icons({library:"${library}"}) 查询可用名称）`,
    );
  }
  return icon;
}

function normalizeColor(value: unknown): string {
  if (value === undefined || value === null) return "#000000";
  if (typeof value !== "string" || !value.trim()) {
    throw new IconError("E_ICON_COLOR", "color 必须是非空 CSS 颜色字符串");
  }
  const color = value.trim();
  if (/["<>]/.test(color)) throw new IconError("E_ICON_COLOR", "color 不能包含引号/尖括号");
  if (typeof CSS !== "undefined" && !CSS.supports("color", color)) {
    throw new IconError("E_ICON_COLOR", `不是合法 CSS 颜色：${color}`);
  }
  return color;
}

function normalizeSize(value: unknown): number {
  if (value === undefined || value === null) return 128;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new IconError("E_ICON_SIZE", "size 必须是 16–512 的数字");
  }
  const size = Math.round(value);
  if (size < 16 || size > 512) throw new IconError("E_ICON_SIZE", `size 必须是 16–512（收到 ${value}）`);
  return size;
}

function parseViewBox(viewBox: string): { width: number; height: number } {
  const parts = viewBox.trim().split(/[\s,]+/).map(Number);
  const w = parts[2] || 24;
  const h = parts[3] || 24;
  return { width: w, height: h };
}

/** 取图标并注册为 shape 资产。未知库/图标/颜色/尺寸抛 IconError（E_ICON_*）。 */
export function getIcon(opts: GetIconOptions): GetIconResult {
  const icon = findIcon(opts);
  const color = normalizeColor(opts.color);
  const size = normalizeSize(opts.size);
  const { width: vbW, height: vbH } = parseViewBox(icon.viewBox);
  const width = size;
  const height = Math.max(1, Math.round((size * vbH) / vbW));

  let inner = icon.innerSvg.replace(/currentColor/gi, color);
  if (opts.strokeWidth !== undefined) {
    const strokeWidth = Number(opts.strokeWidth);
    if (!Number.isFinite(strokeWidth) || strokeWidth < 0 || strokeWidth > 40) {
      throw new IconError("E_ICON_STROKE", `strokeWidth 必须是 0–40 的数字（收到 ${String(opts.strokeWidth)}）`);
    }
    inner = /stroke-width="/.test(inner)
      ? inner.replace(/stroke-width="[^"]*"/g, `stroke-width="${strokeWidth}"`)
      : `<g stroke-width="${strokeWidth}">${inner}</g>`;
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${icon.viewBox}" ` +
    `color="${color}">${inner}</svg>`;

  const asset = registerGeneratedAsset({
    dataUrl: svgDataUrl(svg),
    width,
    height,
    type: "shape",
    name: `${icon.library}/${icon.name}`,
    tags: ["icon", icon.library, icon.name, ...icon.tags],
    source: `icon:${icon.library}/${icon.name}`,
    license: icon.license,
    style: "icon",
  });

  return {
    assetId: asset.id,
    width,
    height,
    library: icon.library,
    name: icon.name,
    viewBox: icon.viewBox,
    license: icon.license,
  };
}

export function iconCount(): number {
  return CATALOG.length;
}
