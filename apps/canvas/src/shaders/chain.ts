/*
 * Canvas Paper Shaders 链式执行 —— apps/canvas/src/shaders/chain.ts
 *
 * 一次 job 可串联 1–4 步：生成（mesh）→ 玻璃/纸纹（glass/paper）→ 再加工。
 * 规则（design §5）：
 * - op.source 显式 → 用它；否则 needsImage 且非第一步 → 上一步输出；
 * - needsImage=false 且传了 source → 忽略并 warning；
 * - needsImage=true 且无 source → E_SHADER_SOURCE_REQUIRED；
 * - 每步都按 job.width×job.height 重绘（链式不掉分辨率）；
 * - 串行队列；每步记录 {preset, ms}；
 * - 中间步骤 PNG（保 alpha），最终默认 JPEG q0.92；
 * - 输入只接受 asset:<id> / data:image/(png|jpeg|webp)。
 */
import { getAsset } from "../assets";
import {
  ShaderError,
  getShaderPreset,
  listShaderPresets,
  validPresetIds,
  validateDimension,
  validateShaderParams,
  type ShaderFormat,
  type ShaderKind,
} from "./presets";
import { loadImage, rasterize, type RasterizeResult } from "./render";

export const MAX_CHAIN_STEPS = 4;
export const MAX_ASSET_BYTES = 6 * 1024 * 1024;

const DATA_IMAGE_RE = /^data:image\/(?:png|jpeg|webp);base64,/i;

export interface ShaderOp {
  preset: string;
  params?: Record<string, unknown>;
  /** 'asset:<id>' | 'data:image/(png|jpeg|webp)'；缺省=上一步输出 */
  source?: string;
}

export interface ShaderJob {
  width: number;
  height: number;
  chain: ShaderOp[];
  format?: ShaderFormat;
  quality?: number;
  name?: string;
  tags?: string[];
}

export interface ShaderStepResult {
  preset: string;
  ms: number;
}

export interface ShaderChainResult {
  dataUrl: string;
  width: number;
  height: number;
  format: ShaderFormat;
  bytes: number;
  steps: ShaderStepResult[];
  warnings: string[];
}

export function normalizeFormat(value: unknown, fallback: ShaderFormat = "jpeg"): ShaderFormat {
  if (value === undefined || value === null) return fallback;
  if (value === "png" || value === "jpeg" || value === "webp") return value;
  throw new ShaderError("E_SHADER_BAD_PARAM", `format 只允许 png/jpeg/webp（收到 ${JSON.stringify(value)}）`);
}

export function normalizeQuality(value: unknown): number {
  if (value === undefined || value === null) return 0.92;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ShaderError("E_SHADER_BAD_PARAM", `quality 必须是 0.1–1 的数字（收到 ${JSON.stringify(value)}）`);
  }
  return Math.min(1, Math.max(0.1, value));
}

function unknownPreset(id: string): ShaderError {
  return new ShaderError(
    "E_SHADER_UNKNOWN_PRESET",
    `未知预设：${id || "(空)"}；可用预设：${validPresetIds().join(", ")}`,
  );
}

/** 把 source 字符串解析为可安全解码的 data URL（只允许 asset:<id> / data:image/...）。 */
export function resolveShaderSource(source: string): string {
  if (source.startsWith("asset:")) {
    const id = source.slice("asset:".length);
    const asset = getAsset(id);
    if (!asset?.dataUrl) {
      throw new ShaderError(
        "E_SHADER_SOURCE_REQUIRED",
        `source 素材不存在或不是图片：asset:${id}（先用 list_assets/get_asset 确认）`,
      );
    }
    return asset.dataUrl;
  }
  if (DATA_IMAGE_RE.test(source)) return source;
  throw new ShaderError(
    "E_SHADER_SOURCE_UNSAFE",
    "source 只允许 asset:<id> 或 data:image/(png|jpeg|webp)；禁止 http(s)://、blob:、file: 等外部地址",
  );
}

/* ---------------- 串行队列（避免 WebGL context 泄漏/并发抖动） ---------------- */

let queueTail: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queueTail.then(task, task);
  queueTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

interface PlannedStep {
  presetId: string;
  kind: ShaderKind;
  needsImage: boolean;
  values: Record<string, unknown>;
  sourceDataUrl?: string;
  explicitImage?: HTMLImageElement;
}

/**
 * 校验并执行链式 job。
 * 校验（preset/params/size/chain/source scheme）全部在渲染前完成；显式 source
 * 的图片也预先 decode，非法输入不会留下半张图。
 */
export async function runShaderJob(job: ShaderJob): Promise<ShaderChainResult> {
  const width = validateDimension(job.width, "width");
  const height = validateDimension(job.height, "height");
  if (!Array.isArray(job.chain) || job.chain.length < 1 || job.chain.length > MAX_CHAIN_STEPS) {
    throw new ShaderError(
      "E_SHADER_BAD_PARAM",
      `chain 必须是 1–${MAX_CHAIN_STEPS} 步的数组（收到 ${Array.isArray(job.chain) ? job.chain.length : JSON.stringify(job.chain)}）`,
    );
  }
  const format = normalizeFormat(job.format);
  const quality = normalizeQuality(job.quality);
  const warnings: string[] = [];

  const planned: PlannedStep[] = job.chain.map((op, index) => {
    if (!op || typeof op !== "object" || Array.isArray(op)) {
      throw new ShaderError("E_SHADER_BAD_PARAM", `chain[${index}] 必须是 {preset, params?, source?} 对象`);
    }
    const presetId = typeof op.preset === "string" ? op.preset : "";
    const preset = getShaderPreset(presetId);
    if (!preset) throw unknownPreset(presetId);

    const validated = validateShaderParams(preset, op.params);
    for (const warning of validated.warnings) warnings.push(`${preset.id}: ${warning}`);

    let sourceDataUrl: string | undefined;
    if (typeof op.source === "string" && op.source.trim()) {
      if (preset.needsImage) {
        sourceDataUrl = resolveShaderSource(op.source.trim());
      } else {
        warnings.push(`${preset.id} 不消费图片，已忽略 source`);
      }
    } else if (preset.needsImage && index === 0) {
      throw new ShaderError(
        "E_SHADER_SOURCE_REQUIRED",
        `预设 ${preset.id} 需要图片输入：请提供 source（asset:<id> 或 data:image/...），或先用生成型预设（${listShaderPresets({ needsImage: false })
          .map((p) => p.id)
          .join("/")}）`,
      );
    }

    return {
      presetId: preset.id,
      kind: preset.kind,
      needsImage: preset.needsImage,
      values: validated.values,
      ...(sourceDataUrl ? { sourceDataUrl } : {}),
    };
  });

  // 预 decode 显式 source：非法图片在渲染前失败（不留半张图）
  for (const step of planned) {
    if (step.sourceDataUrl) step.explicitImage = await loadImage(step.sourceDataUrl);
  }

  return enqueue(async () => {
    let previousDataUrl: string | null = null;
    let final: RasterizeResult | null = null;
    const steps: ShaderStepResult[] = [];

    for (let i = 0; i < planned.length; i++) {
      const step = planned[i];
      const isLast = i === planned.length - 1;
      const stepFormat: ShaderFormat = isLast ? format : "png";

      let image = step.explicitImage;
      if (step.needsImage && !image) {
        if (!previousDataUrl) {
          throw new ShaderError(
            "E_SHADER_SOURCE_REQUIRED",
            `预设 ${step.presetId} 需要图片输入，但上一步没有输出`,
          );
        }
        image = await loadImage(previousDataUrl);
      }

      const started = performance.now();
      const result = await rasterize({
        shader: step.kind,
        uniforms: step.values,
        width,
        height,
        format: stepFormat,
        quality,
        ...(image ? { image } : {}),
      });
      steps.push({ preset: step.presetId, ms: Math.round(performance.now() - started) });
      previousDataUrl = result.dataUrl;
      if (isLast) final = result;
    }

    if (!final) {
      throw new ShaderError("E_SHADER_BAD_PARAM", "chain 没有产生输出");
    }
    if (final.bytes > MAX_ASSET_BYTES) {
      throw new ShaderError(
        "E_SHADER_TOO_LARGE",
        `输出 ${final.bytes} bytes 超过上限 ${MAX_ASSET_BYTES} bytes；请降低尺寸或改用 JPEG/WebP`,
      );
    }
    return {
      dataUrl: final.dataUrl,
      width,
      height,
      format,
      bytes: final.bytes,
      steps,
      warnings,
    };
  });
}
