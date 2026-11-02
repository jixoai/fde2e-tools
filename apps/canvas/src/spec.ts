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
  root: SpecNode;
}

export interface SpecWarning {
  code: string;
  message: string;
  nodeId?: string;
}

export class SpecError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SpecError";
    this.code = code;
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
    throw new SpecError("E_SPEC_URL", `${where} 的 url() 只允许 data: 或同文档 #id（收到 ${inner.slice(0, 80)}）`);
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
      && !(value.startsWith("#") || value.startsWith("data:") || value.startsWith("asset:"))) {
      throw new SpecError("E_SPEC_URL", `SVG 节点 ${id} 的 ${key} 只允许 #id / data: / asset:`);
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
    if (typeof src !== "string" || !(src.startsWith("data:image/") || src.startsWith("asset:"))) {
      throw new SpecError("E_SPEC_IMG", `节点 ${id} 的 img.src 必须是 data:image/... 或 asset:<id>（外部图片请先 import_asset）`);
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

  return { spec: { width, height, background: input.background, root }, warnings: state.warnings };
}

export function validateFetchableUrl(value: string, where: string): void {
  checkFetchableUrl(value, where);
}
