/*
 * Canvas spec —— apps/canvas/src/spec.ts
 *
 * 规范格式＝Satori 可直接消费的 React element 形状：
 *   { width, height, background?, root: { type, props: { id?, style?, children? } } }
 *
 * 关键约束（见 openspec canvas-tool-v1）：
 * - children 必须在 props.children（Satori 只认这个位置）；
 * - svg 子树允许 path/circle/rect/defs/... 白名单，svg 外未知类型拒绝；
 * - style 做属性/值/URL 白名单；外部 url()/私网地址/非法颜色拒绝；
 * - 尺寸/深度/节点数有上限，防止恶意 spec 卡死页面。
 */

export interface SpecNode {
  type: string;
  props: {
    id?: string;
    style?: Record<string, unknown>;
    children?: string | Array<SpecNode | string>;
    [key: string]: unknown;
  };
}

export interface CanvasSpec {
  width: number;
  height: number;
  background?: string;
  /**
   * 渲染前素材预处理映射（插入顺序）：shader/icon/image/text → 资产，
   * 节点用 `pre:<key>` 引用（见 preprocess.ts）。形状在 normalizeSpec 阶段校验。
   */
  preprocess?: PreprocessMap;
  root: SpecNode;
}

export interface SpecWarning {
  code: string;
  message: string;
  nodeId?: string;
}

export class SpecError extends Error {
  readonly code: string;
  /** 预处理相关错误的条目 key（E_PREPROCESS_*） */
  readonly key?: string;
  constructor(code: string, message: string, key?: string) {
    super(message);
    this.name = "SpecError";
    this.code = code;
    if (key !== undefined) this.key = key;
  }
}

const NODE_TYPES = new Set(["div", "span", "p", "img", "svg"]);
const SVG_CHILD_TYPES = new Set([
  "path",
  "circle",
  "rect",
  "line",
  "polyline",
  "polygon",
  "ellipse",
  "g",
  "defs",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "mask",
  "text",
  "tspan",
  "image",
  "use",
]);

const DENY_STYLE_KEYS = new Set([
  "writingMode",
  "columns",
  "fontStretch",
  "cursor",
  "content",
  "animation",
  "animationName",
  "transition",
  "willChange",
]);

const COLOR_KEYS = new Set([
  "color",
  "backgroundColor",
  "borderColor",
  "borderTopColor",
  "borderRightColor",
  "borderBottomColor",
  "borderLeftColor",
  "outlineColor",
  "fill",
  "stroke",
  "stopColor",
]);

const MAX_WIDTH = 8192;
const MAX_HEIGHT = 8192;
const MAX_NODES = 2000;
const MAX_DEPTH = 32;
const MAX_SPEC_BYTES = 256 * 1024;

const PRIVATE_HOST_RE =
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0$|\[?::1\]?$|\[?fc[0-9a-f]{2}:|\[?fe[89ab][0-9a-f]:)/i;

function assertNumber(n: unknown, name: string, min: number, max: number): number {
  if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max) {
    throw new SpecError("E_SPEC_SIZE", `${name} 必须是 ${min}–${max} 之间的数字（收到 ${JSON.stringify(n)}）`);
  }
  return Math.round(n);
}

function checkUrlString(value: string, where: string): void {
  if (value.includes("@import")) {
    throw new SpecError("E_SPEC_URL", `${where} 不允许 @import`);
  }
  const matches = value.match(/url\(([^)]*)\)/g);
  if (!matches) return;
  for (const raw of matches) {
    const inner = raw.slice(4, -1).trim().replace(/^['"]|['"]$/g, "");
    if (inner.startsWith("#") || inner.startsWith("%23")) continue; // 同文档 id 引用（URL 编码形态）
    if (inner.startsWith("data:")) continue; // 内联资源
    if (PRE_REF_TOKEN_RE.test(inner)) continue; // pre:<key> / asset:<id>（渲染前解析为 data URL）
    throw new SpecError("E_SPEC_URL", `${where} 的 url() 只允许 data:、同文档 #id、pre:<key> 或 asset:<id>（收到 ${inner.slice(0, 80)}）`);
  }
}

function checkFetchableUrl(value: string, where: string): void {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new SpecError("E_SPEC_URL", `${where} 不是合法 URL`);
  }
  const isLocalDev = u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  if (u.protocol !== "https:" && !isLocalDev) {
    throw new SpecError("E_SPEC_URL", `${where} 只允许 https:（本地 dev 允许 localhost）`);
  }
  if (!isLocalDev && PRIVATE_HOST_RE.test(u.hostname)) {
    throw new SpecError("E_SPEC_URL", `${where} 不允许字面私网/链路本地地址（${u.hostname}）`);
  }
}

function validateStyle(style: Record<string, unknown> | undefined, id: string): void {
  if (!style) return;
  for (const [key, value] of Object.entries(style)) {
    if (DENY_STYLE_KEYS.has(key)) {
      throw new SpecError("E_SPEC_STYLE", `节点 ${id} 的样式 ${key} 不在 Satori 支持面内`);
    }
    if (typeof value === "string") {
      checkUrlString(value, `节点 ${id} 的 ${key}`);
      if (COLOR_KEYS.has(key) && typeof CSS !== "undefined" && !CSS.supports("color", value)) {
        throw new SpecError("E_SPEC_STYLE", `节点 ${id} 的 ${key} 不是合法颜色（收到 ${value}）`);
      }
    }
  }
}

/** SVG 子树的 props 属性检查（canvas-tool-v1 安全修复）：
 *  - `href`/`xlink:href`/`src` 只允许同文档 `#id`、`data:` 或 `asset:<id>`；
 *  - 任意字符串里的 `url(...)` 仍走 checkUrlString（只允许 data:/#id）；
 *  - `xmlns*` 是命名空间声明，不是外链，放行。 */
function validateSvgProps(props: Record<string, unknown>, id: string): void {
  for (const [key, value] of Object.entries(props)) {
    if (key === "children" || key.startsWith("xmlns")) continue;
    if (typeof value !== "string") continue;
    checkUrlString(value, `SVG 节点 ${id} 的 ${key}`);
    if (/^(?:https?:)?\/\//i.test(value.trim())) {
      throw new SpecError("E_SPEC_URL", `SVG 节点 ${id} 的 ${key} 不允许外部 URL（只允许 #id / data: / asset:）`);
    }
    if ((key === "href" || key === "xlink:href" || key === "src")
      && !(value.startsWith("#") || value.startsWith("data:") || value.startsWith("asset:") || /^pre:[A-Za-z0-9_-]{1,32}$/.test(value))) {
      throw new SpecError("E_SPEC_URL", `SVG 节点 ${id} 的 ${key} 只允许 #id / data: / asset: / pre:`);
    }
  }
}

/* ---------------- preprocess 映射（canvas-preprocess-v2） ----------------
 * 声明式素材预处理：{key: {type:"shader"|"icon"|"image"|"text", ...}}。
 * 这里只做结构/安全/预算校验；真正生成由 preprocess.ts 异步完成。
 * 关键不变量：
 * - 键最多 8 个、非纯数字（保证对象插入顺序可依赖）；
 * - shader.source 只能指向「已声明且更早」的 pre key，或 asset:<id>；
 * - 所有外部 URL 走与 spec 相同的 https/私网校验，pre: 不能绕过；
 * - text ≤2000 字、icon size 16–512、尺寸复用 16–4096。 */

export type PreprocessType = "shader" | "icon" | "image" | "text";
export type PreprocessShaderFormat = "png" | "jpeg" | "webp";

export interface PreprocessShaderStep {
  preset: string;
  params?: Record<string, unknown>;
  source?: string;
}

export interface PreprocessShaderEntry {
  type: "shader";
  preset: string;
  params?: Record<string, unknown>;
  width?: number;
  height?: number;
  format?: PreprocessShaderFormat;
  quality?: number;
  source?: string;
  chain?: PreprocessShaderStep[];
}

export interface PreprocessIconEntry {
  type: "icon";
  url?: string;
  library?: string;
  name?: string;
  color?: string;
  size?: number;
  strokeWidth?: number;
}

export interface PreprocessImageEntry {
  type: "image";
  url?: string;
  assetId?: string;
  width?: number;
  height?: number;
}

export interface PreprocessTextEntry {
  type: "text";
  text: string;
  font?: string;
  fontUrl?: string;
  fontSize?: number;
  lineHeight?: number;
  maxWidth?: number;
  align?: "left" | "center" | "right";
  color?: string;
  weight?: number;
}

export type PreprocessEntry =
  | PreprocessShaderEntry
  | PreprocessIconEntry
  | PreprocessImageEntry
  | PreprocessTextEntry;

export type PreprocessMap = Record<string, PreprocessEntry>;

export const MAX_PREPROCESS_ENTRIES = 8;
export const MAX_PREPROCESS_TEXT = 2000;
export const MAX_PREPROCESS_ICON_SIZE = 512;
export const MIN_PREPROCESS_ICON_SIZE = 16;
export const MAX_PREPROCESS_TOTAL_BYTES = 24 * 1024 * 1024;
export const MAX_PREPROCESS_DIMENSION = 4096;
export const MIN_PREPROCESS_DIMENSION = 16;

const PREPROCESS_TYPES = new Set<PreprocessType>(["shader", "icon", "image", "text"]);
const PRE_KEY_RE = /^[A-Za-z0-9_-]{1,32}$/;
const ASSET_ID_RE = /^asset:[A-Za-z0-9_-]{1,64}$/;
const BARE_KEY_RE = /^[A-Za-z0-9_-]{1,32}$/;

function preErr(code: string, message: string, key: string): SpecError {
  return new SpecError(code, message, key);
}

function preNumber(value: unknown, name: string, min: number, max: number, key: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw preErr("E_PREPROCESS_LIMIT", `preprocess.${key}.${name} 必须是 ${min}–${max} 的数字`, key);
  }
  const n = Math.round(value);
  if (n < min || n > max) {
    throw preErr("E_PREPROCESS_LIMIT", `preprocess.${key}.${name} 必须是 ${min}–${max}（收到 ${value}）`, key);
  }
  return n;
}

function preColor(value: string, name: string, key: string): string {
  if (/["<>]/.test(value)) throw preErr("E_PREPROCESS_LIMIT", `preprocess.${key}.${name} 不是合法颜色`, key);
  if (typeof CSS !== "undefined" && !CSS.supports("color", value)) {
    throw preErr("E_PREPROCESS_LIMIT", `preprocess.${key}.${name} 不是合法颜色（收到 ${value}）`, key);
  }
  return value;
}

/** 复用 spec 的 https/私网 URL 校验，但错误码归一为 E_PREPROCESS_URL + key。 */
function preFetchableUrl(value: string, name: string, key: string): string {
  try {
    checkFetchableUrl(value, `preprocess.${key}.${name}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw preErr("E_PREPROCESS_URL", msg, key);
  }
  return value;
}

/** shader.source 形态校验：asset:<id> / pre:<key> / 裸 key；禁 URL。 */
function preSourceRef(value: unknown, name: string, key: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw preErr("E_PREPROCESS_SHADER", `preprocess.${key}.${name} 必须是非空字符串`, key);
  }
  const ref = value.trim();
  if (ref.includes("://") || ref.startsWith("data:") || ref.startsWith("http")) {
    throw preErr("E_PREPROCESS_URL", `preprocess.${key}.${name} 不允许外部/内联 URL，只能用 pre key 或 asset:<id>`, key);
  }
  if (ref.startsWith("asset:")) {
    if (!ASSET_ID_RE.test(ref)) throw preErr("E_PREPROCESS_SHADER", `preprocess.${key}.${name} 的 asset 引用非法`, key);
    return ref;
  }
  const bare = ref.startsWith("pre:") ? ref.slice(4) : ref;
  if (!BARE_KEY_RE.test(bare)) throw preErr("E_PREPROCESS_SHADER", `preprocess.${key}.${name} 的 pre 引用非法`, key);
  return bare;
}

function preObject(value: unknown, name: string, key: string): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw preErr("E_PREPROCESS_LIMIT", `preprocess.${key}.${name} 必须是对象`, key);
  }
  return value as Record<string, unknown>;
}

function validatePreprocessEntry(key: string, raw: unknown): PreprocessEntry {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw preErr("E_PREPROCESS_TYPE", `preprocess.${key} 必须是对象`, key);
  }
  const entry = raw as Record<string, unknown>;
  const type = entry.type;
  if (typeof type !== "string" || !PREPROCESS_TYPES.has(type as PreprocessType)) {
    throw preErr(
      "E_PREPROCESS_TYPE",
      `preprocess.${key}.type 只允许 shader/icon/image/text（收到 ${JSON.stringify(type)}）`,
      key,
    );
  }

  if (type === "shader") {
    if (typeof entry.preset !== "string" || !entry.preset.trim()) {
      throw preErr("E_PREPROCESS_SHADER", `preprocess.${key}.preset 必填`, key);
    }
    const out: PreprocessShaderEntry = { type: "shader", preset: entry.preset.trim() };
    const params = preObject(entry.params, "params", key);
    if (params) out.params = params;
    if (entry.width !== undefined) out.width = preNumber(entry.width, "width", MIN_PREPROCESS_DIMENSION, MAX_PREPROCESS_DIMENSION, key);
    if (entry.height !== undefined) out.height = preNumber(entry.height, "height", MIN_PREPROCESS_DIMENSION, MAX_PREPROCESS_DIMENSION, key);
    if (entry.format !== undefined) {
      if (entry.format !== "png" && entry.format !== "jpeg" && entry.format !== "webp") {
        throw preErr("E_PREPROCESS_SHADER", `preprocess.${key}.format 只允许 png/jpeg/webp`, key);
      }
      out.format = entry.format;
    }
    if (entry.quality !== undefined) {
      if (typeof entry.quality !== "number" || !Number.isFinite(entry.quality) || entry.quality < 0.1 || entry.quality > 1) {
        throw preErr("E_PREPROCESS_LIMIT", `preprocess.${key}.quality 必须是 0.1–1`, key);
      }
      out.quality = entry.quality;
    }
    const source = preSourceRef(entry.source, "source", key);
    if (source !== undefined) out.source = source;
    if (entry.chain !== undefined) {
      if (!Array.isArray(entry.chain) || entry.chain.length < 1 || entry.chain.length > 4) {
        throw preErr("E_PREPROCESS_SHADER", `preprocess.${key}.chain 必须是 1–4 步的数组`, key);
      }
      out.chain = entry.chain.map((step, i) => {
        if (!step || typeof step !== "object" || Array.isArray(step)) {
          throw preErr("E_PREPROCESS_SHADER", `preprocess.${key}.chain[${i}] 必须是对象`, key);
        }
        const s = step as Record<string, unknown>;
        if (typeof s.preset !== "string" || !s.preset.trim()) {
          throw preErr("E_PREPROCESS_SHADER", `preprocess.${key}.chain[${i}].preset 必填`, key);
        }
        const item: PreprocessShaderStep = { preset: s.preset.trim() };
        const stepParams = preObject(s.params, `chain[${i}].params`, key);
        if (stepParams) item.params = stepParams;
        const stepSource = preSourceRef(s.source, `chain[${i}].source`, key);
        if (stepSource !== undefined) item.source = stepSource;
        return item;
      });
    }
    return out;
  }

  if (type === "icon") {
    const out: PreprocessIconEntry = { type: "icon" };
    const hasUrl = entry.url !== undefined;
    if (hasUrl) {
      if (typeof entry.url !== "string" || !entry.url.trim()) {
        throw preErr("E_PREPROCESS_ICON", `preprocess.${key}.url 必须是非空字符串`, key);
      }
      preFetchableUrl(entry.url.trim(), "url", key);
      out.url = entry.url.trim();
    } else {
      if (typeof entry.library !== "string" || !entry.library.trim()) {
        throw preErr("E_PREPROCESS_ICON", `preprocess.${key} 需要 library+name 或 url`, key);
      }
      if (typeof entry.name !== "string" || !entry.name.trim()) {
        throw preErr("E_PREPROCESS_ICON", `preprocess.${key}.name 必填`, key);
      }
      out.library = entry.library.trim();
      out.name = entry.name.trim();
    }
    if (entry.color !== undefined) {
      if (typeof entry.color !== "string" || !entry.color.trim()) {
        throw preErr("E_PREPROCESS_ICON", `preprocess.${key}.color 必须是非空颜色字符串`, key);
      }
      out.color = preColor(entry.color.trim(), "color", key);
    }
    if (entry.size !== undefined) {
      out.size = preNumber(entry.size, "size", MIN_PREPROCESS_ICON_SIZE, MAX_PREPROCESS_ICON_SIZE, key);
    }
    if (entry.strokeWidth !== undefined) {
      if (typeof entry.strokeWidth !== "number" || !Number.isFinite(entry.strokeWidth) || entry.strokeWidth < 0 || entry.strokeWidth > 40) {
        throw preErr("E_PREPROCESS_LIMIT", `preprocess.${key}.strokeWidth 必须是 0–40`, key);
      }
      out.strokeWidth = entry.strokeWidth;
    }
    return out;
  }

  if (type === "image") {
    const out: PreprocessImageEntry = { type: "image" };
    const hasUrl = entry.url !== undefined;
    const hasAsset = entry.assetId !== undefined;
    if (hasUrl === hasAsset) {
      throw preErr("E_PREPROCESS_IMAGE", `preprocess.${key} 需要 url 或 assetId（二选一）`, key);
    }
    if (hasUrl) {
      if (typeof entry.url !== "string" || !entry.url.trim()) {
        throw preErr("E_PREPROCESS_IMAGE", `preprocess.${key}.url 必须是非空字符串`, key);
      }
      preFetchableUrl(entry.url.trim(), "url", key);
      out.url = entry.url.trim();
    } else {
      if (typeof entry.assetId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(entry.assetId.trim())) {
        throw preErr("E_PREPROCESS_IMAGE", `preprocess.${key}.assetId 非法`, key);
      }
      out.assetId = entry.assetId.trim();
    }
    if (entry.width !== undefined) out.width = preNumber(entry.width, "width", MIN_PREPROCESS_DIMENSION, MAX_PREPROCESS_DIMENSION, key);
    if (entry.height !== undefined) out.height = preNumber(entry.height, "height", MIN_PREPROCESS_DIMENSION, MAX_PREPROCESS_DIMENSION, key);
    return out;
  }

  // text
  if (typeof entry.text !== "string" || !entry.text) {
    throw preErr("E_PREPROCESS_TEXT", `preprocess.${key}.text 必填`, key);
  }
  if (entry.text.length > MAX_PREPROCESS_TEXT) {
    throw preErr("E_PREPROCESS_LIMIT", `preprocess.${key}.text 超过 ${MAX_PREPROCESS_TEXT} 字（${entry.text.length}）`, key);
  }
  const out: PreprocessTextEntry = { type: "text", text: entry.text };
  if (entry.font !== undefined) {
    if (typeof entry.font !== "string" || !entry.font.trim()) {
      throw preErr("E_PREPROCESS_TEXT", `preprocess.${key}.font 必须是非空字符串`, key);
    }
    out.font = entry.font.trim();
  }
  if (entry.fontUrl !== undefined) {
    if (typeof entry.fontUrl !== "string" || !entry.fontUrl.trim()) {
      throw preErr("E_PREPROCESS_TEXT", `preprocess.${key}.fontUrl 必须是非空字符串`, key);
    }
    preFetchableUrl(entry.fontUrl.trim(), "fontUrl", key);
    out.fontUrl = entry.fontUrl.trim();
  }
  if (entry.fontSize !== undefined) {
    if (typeof entry.fontSize !== "number" || !Number.isFinite(entry.fontSize) || entry.fontSize < 1 || entry.fontSize > 512) {
      throw preErr("E_PREPROCESS_LIMIT", `preprocess.${key}.fontSize 必须是 1–512`, key);
    }
    out.fontSize = entry.fontSize;
  }
  if (entry.lineHeight !== undefined) {
    if (typeof entry.lineHeight !== "number" || !Number.isFinite(entry.lineHeight) || entry.lineHeight < 0.5 || entry.lineHeight > 4) {
      throw preErr("E_PREPROCESS_LIMIT", `preprocess.${key}.lineHeight 必须是 0.5–4`, key);
    }
    out.lineHeight = entry.lineHeight;
  }
  if (entry.maxWidth !== undefined) {
    out.maxWidth = preNumber(entry.maxWidth, "maxWidth", 1, MAX_PREPROCESS_DIMENSION, key);
  }
  if (entry.align !== undefined) {
    if (entry.align !== "left" && entry.align !== "center" && entry.align !== "right") {
      throw preErr("E_PREPROCESS_TEXT", `preprocess.${key}.align 只允许 left/center/right`, key);
    }
    out.align = entry.align;
  }
  if (entry.color !== undefined) {
    if (typeof entry.color !== "string" || !entry.color.trim()) {
      throw preErr("E_PREPROCESS_TEXT", `preprocess.${key}.color 必须是非空颜色字符串`, key);
    }
    out.color = preColor(entry.color.trim(), "color", key);
  }
  if (entry.weight !== undefined) {
    if (typeof entry.weight !== "number" || !Number.isFinite(entry.weight) || entry.weight < 100 || entry.weight > 900) {
      throw preErr("E_PREPROCESS_LIMIT", `preprocess.${key}.weight 必须是 100–900`, key);
    }
    out.weight = entry.weight;
  }
  return out;
}

/**
 * 校验并归一 `preprocess` 映射。返回 undefined 表示未声明。
 * 顺序不变量在此一次性验证（spec 阶段可测，不等到渲染）。
 */
export function validatePreprocessMap(raw: unknown): PreprocessMap | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new SpecError("E_PREPROCESS", "spec.preprocess 必须是对象映射");
  }
  const input = raw as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.length > MAX_PREPROCESS_ENTRIES) {
    throw new SpecError(
      "E_PREPROCESS_LIMIT",
      `spec.preprocess 最多 ${MAX_PREPROCESS_ENTRIES} 个条目（收到 ${keys.length}）`,
    );
  }
  const out: PreprocessMap = {};
  for (const key of keys) {
    if (!PRE_KEY_RE.test(key) || /^\d+$/.test(key)) {
      throw preErr(
        "E_PREPROCESS_KEY",
        `preprocess key 只允许 1–32 位字母/数字/_/- 且不能是纯数字（收到 ${JSON.stringify(key)}）`,
        key,
      );
    }
    out[key] = validatePreprocessEntry(key, input[key]);
  }

  // 顺序/类型校验：shader.source 必须指向更早声明的 shader/image 条目（或 asset:<id>）
  const indexOf = new Map(keys.map((k, i) => [k, i]));
  const checkRef = (owner: string, ref: string | undefined, where: string) => {
    if (!ref || ref.startsWith("asset:")) return;
    const idx = indexOf.get(ref);
    if (idx === undefined) {
      throw preErr(
        "E_PREPROCESS_ORDER",
        `preprocess.${owner}.${where} 引用了未声明的 pre key「${ref}」（只能引用更早的条目或 asset:<id>）`,
        owner,
      );
    }
    if (idx >= indexOf.get(owner)!) {
      throw preErr(
        "E_PREPROCESS_ORDER",
        `preprocess.${owner}.${where} 引用的「${ref}」必须声明在 ${owner} 之前`,
        owner,
      );
    }
    const refType = out[ref].type;
    if (refType !== "shader" && refType !== "image") {
      throw preErr(
        "E_PREPROCESS_ORDER",
        `preprocess.${owner}.${where} 的 source 只能是 shader/image 产物（「${ref}」是 ${refType}）`,
        owner,
      );
    }
  };
  for (const key of keys) {
    const entry = out[key];
    if (entry.type !== "shader") continue;
    checkRef(key, entry.source, "source");
    entry.chain?.forEach((step, i) => checkRef(key, step.source, `chain[${i}].source`));
  }
  return out;
}

/** pre:<key> / asset:<id> 引用（供 url() 与 img.src 放行） */
const PRE_REF_TOKEN_RE = /^(?:pre:[A-Za-z0-9_-]{1,32}|asset:[A-Za-z0-9_-]{1,64})$/;
const PRE_URL_TOKEN_RE = /url\(\s*['"]?pre:([A-Za-z0-9_-]{1,32})['"]?\s*\)/g;

/** 校验节点里所有 pre:<key> 引用都指向已声明的 preprocess 条目（渲染前失败）。 */
function validatePreRefs(node: SpecNode, keys: Set<string>): void {
  const check = (value: string, where: string): void => {
    if (!value.startsWith("pre:")) return;
    const key = value.slice("pre:".length);
    if (!keys.has(key)) {
      throw new SpecError(
        "E_PREPROCESS_ORDER",
        `${where} 引用了未声明的 pre key「${key}」（pre:${key}）；先在 spec.preprocess 声明`,
        key,
      );
    }
  };
  if (typeof node.props.src === "string") check(node.props.src, `节点 ${node.props.id} 的 src`);
  for (const key of ["href", "xlink:href"]) {
    if (typeof node.props[key] === "string") check(node.props[key] as string, `节点 ${node.props.id} 的 ${key}`);
  }
  if (node.props.style && typeof node.props.style === "object") {
    for (const [styleKey, value] of Object.entries(node.props.style as Record<string, unknown>)) {
      if (typeof value !== "string") continue;
      for (const match of value.matchAll(PRE_URL_TOKEN_RE)) {
        check(`pre:${match[1]}`, `节点 ${node.props.id} 的 ${styleKey}`);
      }
    }
  }
  const children = node.props.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      if (typeof child !== "string") validatePreRefs(child, keys);
    }
  }
}

function normalizeChildren(
  raw: unknown,
  parentId: string,
  depth: number,
  state: { count: number; warnings: SpecWarning[]; insideSvg: boolean },
): Array<SpecNode | string> {
  if (raw === undefined || raw === null) return [];
  if (typeof raw === "string" || typeof raw === "number") return [String(raw)];
  if (!Array.isArray(raw)) {
    throw new SpecError("E_SPEC_CHILDREN", `节点 ${parentId} 的 children 必须是数组或字符串`);
  }
  return raw.map((child) => normalizeNode(child, parentId, depth + 1, state));
}

function normalizeNode(
  raw: unknown,
  parentId: string,
  depth: number,
  state: { count: number; warnings: SpecWarning[]; insideSvg: boolean },
): SpecNode {
  if (depth > MAX_DEPTH) throw new SpecError("E_SPEC_DEPTH", `节点嵌套超过 ${MAX_DEPTH} 层`);
  if (typeof raw === "string" || typeof raw === "number") {
    return { type: "span", props: { children: [String(raw)] } };
  }
  if (!raw || typeof raw !== "object") {
    throw new SpecError("E_SPEC_NODE", `节点 ${parentId} 的子项不是对象`);
  }
  const input = raw as { type?: unknown; props?: unknown; children?: unknown };
  if (typeof input.type !== "string") {
    throw new SpecError("E_SPEC_NODE", `节点 ${parentId} 的子项缺少 type`);
  }
  const type = input.type;
  if (!state.insideSvg && !NODE_TYPES.has(type)) {
    throw new SpecError("E_SPEC_NODE", `不支持的节点类型 ${type}（svg 外只允许 div/span/p/img/svg）`);
  }
  if (state.insideSvg && !SVG_CHILD_TYPES.has(type)) {
    throw new SpecError("E_SPEC_NODE", `不支持的 SVG 子节点类型 ${type}`);
  }
  state.count += 1;
  if (state.count > MAX_NODES) throw new SpecError("E_SPEC_SIZE", `节点数超过 ${MAX_NODES}`);

  const propsIn = (input.props && typeof input.props === "object" ? input.props : {}) as Record<string, unknown>;
  const props: Record<string, unknown> = { ...propsIn };
  if (input.children !== undefined) {
    // 兼容旧写法：把顶层 children 归一进 props.children（Satori 只认这个位置）
    if (props.children !== undefined) {
      throw new SpecError("E_SPEC_CHILDREN", `节点 ${parentId} 同时存在顶层 children 与 props.children`);
    }
    props.children = input.children;
    state.warnings.push({
      code: "children_normalized",
      message: "顶层 children 已自动归一进 props.children（Satori 只认 props.children）",
    });
  }
  if (typeof props.id !== "string" || props.id.length === 0) {
    props.id = `node-${state.count}`;
  }
  const id = String(props.id);
  if (props.style !== undefined && (typeof props.style !== "object" || props.style === null || Array.isArray(props.style))) {
    throw new SpecError("E_SPEC_STYLE", `节点 ${id} 的 style 必须是对象`);
  }
  const style = props.style as Record<string, unknown> | undefined;
  validateStyle(style, id);
  if (state.insideSvg || type === "svg") validateSvgProps(propsIn, id);

  if (type === "img") {
    const src = props.src;
    if (
      typeof src !== "string" ||
      !(
        src.startsWith("data:image/") ||
        src.startsWith("asset:") ||
        /^pre:[A-Za-z0-9_-]{1,32}$/.test(src)
      )
    ) {
      throw new SpecError(
        "E_SPEC_IMG",
        `节点 ${id} 的 img.src 必须是 data:image/...、asset:<id> 或 pre:<key>（外部图片请先 import_asset）`,
      );
    }
    if (src.startsWith("data:")) checkUrlString(src, `节点 ${id} 的 img.src`);
  }

  const childState = { ...state, insideSvg: state.insideSvg || type === "svg" };
  const children = normalizeChildren(props.children, id, depth, childState);
  if (children.length > 0) props.children = children;
  else delete props.children;

  return { type, props: props as SpecNode["props"] };
}

export function normalizeSpec(raw: unknown): { spec: CanvasSpec; warnings: SpecWarning[] } {
  if (!raw || typeof raw !== "object") throw new SpecError("E_SPEC", "spec 必须是对象");
  const input = raw as Partial<CanvasSpec> & { root?: unknown };
  const width = assertNumber(input.width, "width", 16, MAX_WIDTH);
  const height = assertNumber(input.height, "height", 16, MAX_HEIGHT);
  if (!input.root || typeof input.root !== "object") throw new SpecError("E_SPEC", "spec.root 必须是对象");
  const bytes = new TextEncoder().encode(JSON.stringify(raw)).length;
  if (bytes > MAX_SPEC_BYTES) throw new SpecError("E_SPEC_SIZE", `spec 超过 ${MAX_SPEC_BYTES} 字节`);

  const preprocess = validatePreprocessMap(input.preprocess);

  const state = { count: 0, warnings: [] as SpecWarning[], insideSvg: false };
  const root = normalizeNode(input.root, "root", 0, state);
  root.props.id = typeof root.props.id === "string" && root.props.id ? root.props.id : "root";
  const style = { ...(root.props.style as Record<string, unknown> | undefined) };
  style.width = style.width ?? "100%";
  style.height = style.height ?? "100%";
  style.boxSizing = style.boxSizing ?? "border-box";
  style.display = style.display ?? "flex";
  style.flexDirection = style.flexDirection ?? "column";
  if (input.background && style.backgroundColor === undefined) style.backgroundColor = input.background;
  root.props.style = style;

  validatePreRefs(root, new Set(preprocess ? Object.keys(preprocess) : []));

  return {
    spec: {
      width,
      height,
      background: input.background,
      ...(preprocess ? { preprocess } : {}),
      root,
    },
    warnings: state.warnings,
  };
}

export function validateFetchableUrl(value: string, where: string): void {
  checkFetchableUrl(value, where);
}
