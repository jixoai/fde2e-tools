/*
 * Canvas spec 预处理引擎 —— apps/canvas/src/preprocess.ts
 *
 * 渲染前把 `preprocess` 映射（shader/icon/image/text）异步生成/加载为资产，
 * 节点用 `pre:<key>` 引用。复用既有组件，不引入新的渲染引擎：
 * - shader → shaders/chain.ts 的 runShaderJob（含 chain/source 链）
 * - icon   → icons/catalog.ts 的 getIcon（内置六族目录）
 * - image  → assets.ts 的 importAsset / 已有资产
 * - text   → font-client.ts 的 fontInfo/textToSvg（外部字体转 path）
 *
 * 失败统一 `E_PREPROCESS_*`（带 key），不产生半张图。
 */
import { getAsset, importAsset, registerGeneratedAsset, svgDataUrl, type Asset } from "./assets";
import { ShaderError, getShaderPreset, validPresetIds } from "./shaders/presets";
import { runShaderJob, type ShaderOp } from "./shaders/chain";
import { getIcon } from "./icons/catalog";
import { textToSvg } from "./font-client";
import { getFontCatalogEntry } from "./font-catalog";
import {
  MAX_PREPROCESS_TOTAL_BYTES,
  type CanvasSpec,
  type PreprocessEntry,
  type PreprocessMap,
  type PreprocessShaderEntry,
  type PreprocessIconEntry,
  type PreprocessImageEntry,
  type PreprocessTextEntry,
} from "./spec";

export class PreprocessError extends Error {
  readonly code: string;
  readonly key: string;
  constructor(code: string, message: string, key: string) {
    super(message);
    this.name = "PreprocessError";
    this.code = code;
    this.key = key;
  }
}

export interface PreprocessSummary {
  count: number;
  keys: string[];
  assetIds: Record<string, string>;
  warnings: string[];
  bytes: number;
}

const EMPTY: PreprocessSummary = { count: 0, keys: [], assetIds: {}, warnings: [], bytes: 0 };

function fail(code: string, message: string, key: string): PreprocessError {
  return new PreprocessError(code, message, key);
}

function wrap(e: unknown, key: string, type: PreprocessEntry["type"]): PreprocessError {
  if (e instanceof PreprocessError) return e;
  const msg = e instanceof Error && e.message ? e.message : String(e);
  const code =
    type === "icon"
      ? "E_PREPROCESS_ICON"
      : type === "image"
        ? "E_PREPROCESS_IMAGE"
        : type === "text"
          ? "E_PREPROCESS_TEXT"
          : "E_PREPROCESS_SHADER";
  return new PreprocessError(code, `preprocess.${key}: ${msg}`, key);
}

async function runShader(key: string, entry: PreprocessShaderEntry, spec: CanvasSpec, assetIds: Record<string, string>): Promise<Asset> {
  const preset = getShaderPreset(entry.preset);
  if (!preset) {
    throw new ShaderError(
      "E_SHADER_UNKNOWN_PRESET",
      `未知预设：${entry.preset || "(空)"}；可用预设：${validPresetIds().join(", ")}`,
    );
  }
  const resolveSource = (ref: string | undefined): string | undefined => {
    if (!ref) return undefined;
    if (ref.startsWith("asset:")) return ref;
    const id = assetIds[ref];
    if (!id) {
      throw fail("E_PREPROCESS_ORDER", `preprocess.${key}.source 引用的 pre key「${ref}」尚未解析`, key);
    }
    return `asset:${id}`;
  };

  const chain: ShaderOp[] = entry.chain
    ? entry.chain.map((step) => ({
        preset: step.preset,
        ...(step.params ? { params: step.params } : {}),
        ...(step.source ? { source: resolveSource(step.source)! } : {}),
      }))
    : [
        {
          preset: preset.id,
          ...(entry.params ? { params: entry.params } : {}),
          ...(entry.source ? { source: resolveSource(entry.source)! } : {}),
        },
      ];

  const result = await runShaderJob({
    width: entry.width ?? spec.width,
    height: entry.height ?? spec.height,
    chain,
    format: entry.format,
    quality: entry.quality,
  });
  const presetChain = chain.map((op) => op.preset);
  return registerGeneratedAsset({
    dataUrl: result.dataUrl,
    width: result.width,
    height: result.height,
    type: "background",
    chain: presetChain,
    source: `preprocess:shader:${presetChain.join(">")}`,
    name: `preprocess ${key}`,
    tags: ["preprocess", "shader", key],
  });
}

async function runIcon(key: string, entry: PreprocessIconEntry): Promise<Asset> {
  if (entry.url) {
    return importAsset({ url: entry.url, type: "svg", name: `preprocess ${key}` });
  }
  const result = getIcon({
    library: entry.library,
    name: entry.name,
    color: entry.color,
    size: entry.size,
    strokeWidth: entry.strokeWidth,
  });
  const asset = getAsset(result.assetId);
  if (!asset) throw fail("E_PREPROCESS_ICON", `图标资产注册失败：${result.assetId}`, key);
  return asset;
}

async function runImage(key: string, entry: PreprocessImageEntry): Promise<Asset> {
  if (entry.assetId) {
    const asset = getAsset(entry.assetId);
    if (!asset?.dataUrl) {
      throw fail("E_PREPROCESS_IMAGE", `素材不存在或不是图片：asset:${entry.assetId}（先 list_assets）`, key);
    }
    return asset;
  }
  return importAsset({
    url: entry.url!,
    type: "image",
    name: `preprocess ${key}`,
    maxWidth: entry.width,
    maxHeight: entry.height,
  });
}

async function runText(key: string, entry: PreprocessTextEntry, warnings: string[]): Promise<Asset> {
  let fontUrl = entry.fontUrl;
  let fontLabel = "custom";
  let license = "user";

  if (!fontUrl) {
    const fontId = entry.font ?? "noto-sans-sc";
    const catalogEntry = getFontCatalogEntry(fontId);
    if (catalogEntry?.url) {
      fontUrl = catalogEntry.url;
      fontLabel = catalogEntry.id;
      license = catalogEntry.license;
    } else if (fontId === "noto-sans-sc") {
      const builtin = getAsset("font-noto-sans-sc");
      if (!builtin?.fontUrl) throw fail("E_PREPROCESS_TEXT", "内置 Noto Sans SC 字体资产缺失", key);
      fontUrl = new URL(builtin.fontUrl, location.href).href;
      fontLabel = "noto-sans-sc";
      license = builtin.license;
    } else {
      throw fail(
        "E_PREPROCESS_TEXT",
        `字体目录条目 ${fontId} 没有可直接加载的 URL；请提供 fontUrl，或换用有 url 的字体`,
        key,
      );
    }
  }

  const result = await textToSvg({
    url: fontUrl,
    text: entry.text,
    fontSize: entry.fontSize ?? 64,
    lineHeight: entry.lineHeight,
    maxWidth: entry.maxWidth,
    align: entry.align,
    fill: entry.color ?? "#000000",
    axes: entry.weight !== undefined ? { wght: entry.weight } : undefined,
  });
  for (const w of result.warnings) warnings.push(`preprocess.${key}: ${w.message}`);

  return registerGeneratedAsset({
    dataUrl: svgDataUrl(result.svg),
    width: result.width,
    height: result.height,
    type: "shape",
    source: `text:${fontLabel}`,
    name: `preprocess ${key}`,
    tags: ["preprocess", "text", fontLabel],
    license,
  });
}

async function runEntry(
  key: string,
  entry: PreprocessEntry,
  spec: CanvasSpec,
  assetIds: Record<string, string>,
  warnings: string[],
): Promise<Asset> {
  switch (entry.type) {
    case "shader":
      return runShader(key, entry, spec, assetIds);
    case "icon":
      return runIcon(key, entry);
    case "image":
      return runImage(key, entry);
    case "text":
      return runText(key, entry, warnings);
  }
}

/**
 * 按对象插入顺序串行解析 preprocess；返回 key → assetId 映射。
 * 任何条目失败立即抛 PreprocessError（不产生半张图）。
 */
export async function resolvePreprocess(spec: CanvasSpec): Promise<PreprocessSummary> {
  const map: PreprocessMap | undefined = spec.preprocess;
  if (!map) return { ...EMPTY, assetIds: {} };
  const keys = Object.keys(map);
  if (keys.length === 0) return { ...EMPTY, assetIds: {} };

  const assetIds: Record<string, string> = {};
  const warnings: string[] = [];
  let bytes = 0;

  for (const key of keys) {
    const entry = map[key];
    let asset: Asset;
    try {
      asset = await runEntry(key, entry, spec, assetIds, warnings);
    } catch (e) {
      throw wrap(e, key, entry.type);
    }
    assetIds[key] = asset.id;
    bytes += asset.bytes ?? 0;
    if (bytes > MAX_PREPROCESS_TOTAL_BYTES) {
      throw fail(
        "E_PREPROCESS_BUDGET",
        `preprocess 产物总字节 ${bytes} 超过上限 ${MAX_PREPROCESS_TOTAL_BYTES}（减少条目/尺寸/改用 JPEG）`,
        key,
      );
    }
  }

  return { count: keys.length, keys, assetIds, warnings, bytes };
}
