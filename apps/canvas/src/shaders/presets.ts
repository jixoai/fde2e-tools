/*
 * Canvas Paper Shaders 预设 —— apps/canvas/src/shaders/presets.ts
 *
 * 纯数据 + 严格校验（无 DOM 依赖，可被 Node 侧单测直接 import）：
 * - 预设默认值照抄 @paper-design/shaders-react@0.0.82 的官方 preset
 *   （mesh Sunset / Sea、glass Default、paper Default）；
 * - 参数白名单（overridable）、数值 clamp、枚举校验；
 * - 颜色严格解析（#rgb/#rgba/#rrggbb/#rrggbbaa/rgb()/rgba()/hsl()/hsla()），
 *   非法颜色显式 E_SHADER_BAD_PARAM，绝不依赖官方 getShaderColorFromString
 *   的灰色 fallback。
 */
export type ShaderKind = "mesh" | "glass" | "paper";
export type ShaderFormat = "png" | "jpeg" | "webp";
/** 0..1 的 RGBA（与 Paper Shaders 的 vec4 uniform 同形） */
export type Rgba = [number, number, number, number];

export class ShaderError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ShaderError";
    this.code = code;
  }
}

export interface ShaderSize {
  width: number;
  height: number;
}

export type ParamKind = "number" | "integer" | "color" | "colors" | "boolean" | "enum";

export interface ParamSpec {
  kind: ParamKind;
  min?: number;
  max?: number;
  values?: readonly string[];
}

export interface ShaderPreset {
  id: string;
  name: string;
  kind: ShaderKind;
  tags: string[];
  needsImage: boolean;
  recommendedSize: ShaderSize;
  /** 参数默认值（颜色为字符串；校验后输出 RGBA 数组） */
  defaults: Record<string, unknown>;
  /** 参数白名单（agent 的 params 只允许覆盖这些键） */
  overridable: string[];
  paramSpecs: Record<string, ParamSpec>;
}

export interface ShaderPresetSummary {
  id: string;
  name: string;
  tags: string[];
  needsImage: boolean;
  recommendedSize: ShaderSize;
  overridable: string[];
}

export interface ValidatedShaderParams {
  values: Record<string, unknown>;
  warnings: string[];
}

const NUMBER_01: ParamSpec = { kind: "number", min: 0, max: 1 };
const COLOR: ParamSpec = { kind: "color" };

const MESH_SPECS: Record<string, ParamSpec> = {
  colors: { kind: "colors", min: 1, max: 10 },
  positions: { kind: "number", min: 0, max: 100 },
  waveX: NUMBER_01,
  waveXShift: NUMBER_01,
  waveY: NUMBER_01,
  waveYShift: NUMBER_01,
  mixing: NUMBER_01,
  grainMixer: NUMBER_01,
  grainOverlay: NUMBER_01,
};

const GLASS_SPECS: Record<string, ParamSpec> = {
  colorBack: COLOR,
  colorShadow: COLOR,
  colorHighlight: COLOR,
  shadows: NUMBER_01,
  size: NUMBER_01,
  angle: { kind: "number", min: 0, max: 180 },
  distortionShape: {
    kind: "enum",
    values: ["prism", "lens", "contour", "cascade", "flat"],
  },
  highlights: NUMBER_01,
  shape: {
    kind: "enum",
    values: ["lines", "linesIrregular", "wave", "zigzag", "pattern"],
  },
  distortion: NUMBER_01,
  shift: { kind: "number", min: -1, max: 1 },
  blur: NUMBER_01,
  edges: NUMBER_01,
  stretch: NUMBER_01,
  marginLeft: NUMBER_01,
  marginRight: NUMBER_01,
  marginTop: NUMBER_01,
  marginBottom: NUMBER_01,
  grainMixer: NUMBER_01,
  grainOverlay: NUMBER_01,
};

const PAPER_SPECS: Record<string, ParamSpec> = {
  colorBack: COLOR,
  colorPaper: COLOR,
  colorShadow: COLOR,
  blending: NUMBER_01,
  distortion: { kind: "number", min: -1, max: 1 },
  clip: { kind: "boolean" },
  angle: { kind: "number", min: 0, max: 360 },
  seed: { kind: "number", min: 0, max: 1000 },
  roughness: NUMBER_01,
  roughnessSize: NUMBER_01,
  roughnessRows: NUMBER_01,
  fiber: NUMBER_01,
  fiberSize: NUMBER_01,
  folds: NUMBER_01,
  foldSizeX: NUMBER_01,
  foldSizeY: NUMBER_01,
  foldOffsetX: NUMBER_01,
  foldOffsetY: NUMBER_01,
  wrinkles: NUMBER_01,
  wrinkleSize: NUMBER_01,
  crumples: NUMBER_01,
  crumpleCount: { kind: "integer", min: 2, max: 15 },
  drops: NUMBER_01,
};

function preset(input: {
  id: string;
  name: string;
  kind: ShaderKind;
  tags: string[];
  needsImage: boolean;
  defaults: Record<string, unknown>;
  paramSpecs: Record<string, ParamSpec>;
  recommendedSize?: ShaderSize;
}): ShaderPreset {
  return {
    id: input.id,
    name: input.name,
    kind: input.kind,
    tags: input.tags,
    needsImage: input.needsImage,
    recommendedSize: input.recommendedSize ?? { width: 1080, height: 1440 },
    defaults: input.defaults,
    overridable: Object.keys(input.defaults),
    paramSpecs: input.paramSpecs,
  };
}

export const SHADER_PRESETS: ShaderPreset[] = [
  preset({
    id: "mesh-sunset",
    name: "Mesh Sunset",
    kind: "mesh",
    tags: ["mesh", "gradient", "warm", "background", "sunset"],
    needsImage: false,
    defaults: {
      colors: ["#264653", "#9c2b2b", "#f4a261", "#ffffff"],
      positions: 0,
      waveX: 0.6,
      waveXShift: 0.7,
      waveY: 0.7,
      waveYShift: 0.7,
      mixing: 0.5,
      grainMixer: 0,
      grainOverlay: 0,
    },
    paramSpecs: MESH_SPECS,
  }),
  preset({
    id: "mesh-aurora",
    name: "Mesh Aurora",
    kind: "mesh",
    tags: ["mesh", "gradient", "cool", "aurora", "background"],
    needsImage: false,
    defaults: {
      colors: ["#013b65", "#03738c", "#a3d3ff", "#f2faef"],
      positions: 0,
      waveX: 0.53,
      waveXShift: 0,
      waveY: 0.95,
      waveYShift: 0.64,
      mixing: 0.5,
      grainMixer: 0,
      grainOverlay: 0,
    },
    paramSpecs: MESH_SPECS,
  }),
  preset({
    id: "glass-prism",
    name: "Glass Prism",
    kind: "glass",
    tags: ["glass", "prism", "filter", "texture", "image"],
    needsImage: true,
    defaults: {
      colorBack: "#00000000",
      colorShadow: "#000000",
      colorHighlight: "#ffffff",
      shadows: 0.25,
      size: 0.5,
      angle: 0,
      distortionShape: "prism",
      highlights: 0.1,
      shape: "lines",
      distortion: 0.5,
      shift: 0,
      blur: 0,
      edges: 0.25,
      stretch: 0,
      marginLeft: 0,
      marginRight: 0,
      marginTop: 0,
      marginBottom: 0,
      grainMixer: 0,
      grainOverlay: 0,
    },
    paramSpecs: GLASS_SPECS,
  }),
  preset({
    id: "paper-default",
    name: "Paper Texture",
    kind: "paper",
    tags: ["paper", "texture", "filter", "image"],
    needsImage: true,
    defaults: {
      colorBack: "#d3d2ab",
      colorPaper: "#ffffff",
      colorShadow: "#cccccc",
      blending: 1,
      distortion: 0.75,
      clip: false,
      angle: 300,
      seed: 4,
      roughness: 0.4,
      roughnessSize: 0.5,
      roughnessRows: 0,
      fiber: 0.4,
      fiberSize: 0.5,
      folds: 0.5,
      foldSizeX: 1,
      foldSizeY: 1,
      foldOffsetX: 0,
      foldOffsetY: 0,
      wrinkles: 1,
      wrinkleSize: 0.65,
      crumples: 0,
      crumpleCount: 6,
      drops: 0.4,
    },
    paramSpecs: PAPER_SPECS,
  }),
];

export function getShaderPreset(id: string): ShaderPreset | null {
  return SHADER_PRESETS.find((p) => p.id === id) ?? null;
}

export function listShaderPresets(filter: { tag?: string; needsImage?: boolean } = {}): ShaderPreset[] {
  const tag = filter.tag?.trim().toLowerCase();
  return SHADER_PRESETS.filter((p) => {
    if (filter.needsImage !== undefined && p.needsImage !== filter.needsImage) return false;
    if (tag) {
      const hay = `${p.id} ${p.name} ${p.kind} ${p.tags.join(" ")}`.toLowerCase();
      if (!hay.includes(tag)) return false;
    }
    return true;
  });
}

export function presetSummary(p: ShaderPreset): ShaderPresetSummary {
  return {
    id: p.id,
    name: p.name,
    tags: p.tags,
    needsImage: p.needsImage,
    recommendedSize: p.recommendedSize,
    overridable: p.overridable,
  };
}

export function validPresetIds(): string[] {
  return SHADER_PRESETS.map((p) => p.id);
}

/* ---------------- 严格颜色解析 ---------------- */

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_RE =
  /^rgba?\(\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*([0-9]+(?:\.[0-9]+)?)\s*(?:,\s*([0-9]+(?:\.[0-9]+)?)\s*)?\)$/i;
const HSL_RE =
  /^hsla?\(\s*([0-9]+(?:\.[0-9]+)?)(?:deg)?\s*,\s*([0-9]+(?:\.[0-9]+)?)%\s*,\s*([0-9]+(?:\.[0-9]+)?)%\s*(?:,\s*([0-9]+(?:\.[0-9]+)?)\s*)?\)$/i;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function hueToRgb(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hh = (((h % 360) + 360) % 360) / 360;
  return [hueToRgb(p, q, hh + 1 / 3), hueToRgb(p, q, hh), hueToRgb(p, q, hh - 1 / 3)];
}

/** 严格解析颜色；返回 0..1 的 RGBA，非法返回 null。 */
export function parseColorStrict(value: unknown): Rgba | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;

  if (HEX_RE.test(text)) {
    let hex = text.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = hex
        .split("")
        .map((c) => c + c)
        .join("");
    }
    if (hex.length === 6) hex += "ff";
    if (hex.length !== 8) return null;
    return [
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255,
      parseInt(hex.slice(6, 8), 16) / 255,
    ];
  }

  const rgb = RGB_RE.exec(text);
  if (rgb) {
    const r = Number(rgb[1]);
    const g = Number(rgb[2]);
    const b = Number(rgb[3]);
    const a = rgb[4] === undefined ? 1 : Number(rgb[4]);
    if ([r, g, b].some((n) => n < 0 || n > 255) || a < 0 || a > 1) return null;
    return [r / 255, g / 255, b / 255, a];
  }

  const hsl = HSL_RE.exec(text);
  if (hsl) {
    const h = Number(hsl[1]);
    const s = Number(hsl[2]);
    const l = Number(hsl[3]);
    const a = hsl[4] === undefined ? 1 : Number(hsl[4]);
    if (h < 0 || h > 360 || s < 0 || s > 100 || l < 0 || l > 100 || a < 0 || a > 1) return null;
    const [r, g, b] = hslToRgb(h, s / 100, l / 100);
    return [clamp(r, 0, 1), clamp(g, 0, 1), clamp(b, 0, 1), a];
  }

  return null;
}

function badParam(message: string): ShaderError {
  return new ShaderError("E_SHADER_BAD_PARAM", message);
}

function coerceParam(key: string, spec: ParamSpec, raw: unknown, warnings: string[]): unknown {
  switch (spec.kind) {
    case "number":
    case "integer": {
      if (typeof raw !== "number" || !Number.isFinite(raw)) {
        throw badParam(`参数 ${key} 必须是数字（收到 ${JSON.stringify(raw)}）`);
      }
      const rounded = spec.kind === "integer" ? Math.round(raw) : raw;
      const min = spec.min ?? -Infinity;
      const max = spec.max ?? Infinity;
      const value = clamp(rounded, min, max);
      if (value !== rounded) {
        warnings.push(`参数 ${key} 超出范围 [${min}, ${max}]，已夹紧为 ${value}`);
      }
      return value;
    }
    case "boolean": {
      if (typeof raw !== "boolean") throw badParam(`参数 ${key} 必须是布尔值（收到 ${JSON.stringify(raw)}）`);
      return raw;
    }
    case "enum": {
      if (typeof raw !== "string" || !spec.values?.includes(raw)) {
        throw badParam(`参数 ${key} 只允许 ${spec.values?.join("/")}（收到 ${JSON.stringify(raw)}）`);
      }
      return raw;
    }
    case "color": {
      const parsed = parseColorStrict(raw);
      if (!parsed) {
        throw badParam(
          `参数 ${key} 不是合法颜色（支持 #rgb/#rrggbb/#rrggbbaa/rgb()/rgba()/hsl()/hsla()，收到 ${JSON.stringify(raw)}）`,
        );
      }
      return parsed;
    }
    case "colors": {
      if (!Array.isArray(raw) || raw.length === 0) {
        throw badParam(`参数 ${key} 必须是颜色数组（1–${spec.max ?? 10} 项）`);
      }
      const max = spec.max ?? 10;
      const items = raw.slice(0, max);
      if (raw.length > max) warnings.push(`参数 ${key} 最多 ${max} 项，已截断（原 ${raw.length} 项）`);
      return items.map((item, i) => {
        const parsed = parseColorStrict(item);
        if (!parsed) {
          throw badParam(
            `参数 ${key}[${i}] 不是合法颜色（支持 #rgb/#rrggbb/#rrggbbaa/rgb()/rgba()/hsl()/hsla()，收到 ${JSON.stringify(item)}）`,
          );
        }
        return parsed;
      });
    }
  }
}

/**
 * 校验 agent 传入的 params：
 * - 白名单外的键忽略并 warning；
 * - 数值 clamp 并 warning；
 * - 颜色/枚举/布尔非法直接 E_SHADER_BAD_PARAM。
 */
export function validateShaderParams(preset: ShaderPreset, raw: unknown): ValidatedShaderParams {
  const values: Record<string, unknown> = {};
  const warnings: string[] = [];
  // 默认值也走同一套 coerce（颜色字符串 → RGBA、枚举/数值归一）
  for (const [key, value] of Object.entries(preset.defaults)) {
    const spec = preset.paramSpecs[key];
    if (!spec) continue;
    values[key] = coerceParam(key, spec, value, []);
  }
  if (raw === undefined || raw === null) return { values, warnings };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw badParam("params 必须是对象");
  }
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const spec = preset.paramSpecs[key];
    if (!spec) {
      warnings.push(`参数 ${key} 不在 ${preset.id} 的可覆盖白名单内，已忽略`);
      continue;
    }
    values[key] = coerceParam(key, spec, value, warnings);
  }
  return { values, warnings };
}

/** 维度校验（16–4096 的整数）；非法抛 E_SHADER_BAD_PARAM。 */
export function validateDimension(value: unknown, name: string, fallback?: number): number {
  if (value === undefined || value === null) {
    if (fallback !== undefined) return fallback;
    throw badParam(`${name} 必填`);
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw badParam(`${name} 必须是数字（收到 ${JSON.stringify(value)}）`);
  }
  const n = Math.round(value);
  if (n < 16 || n > 4096) {
    throw badParam(`${name} 必须是 16–4096 的整数（收到 ${value}）`);
  }
  return n;
}
