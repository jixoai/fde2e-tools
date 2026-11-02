/*
 * Canvas Paper Shaders 渲染核心 —— apps/canvas/src/shaders/render.ts
 *
 * 页面内离屏光栅化（WebGL2）：
 * - 挂载点必须是已布局的 HTMLElement（display:none/游离节点 → canvas 0×0），
 *   用 position:fixed; left:-100000px 的离屏 div；
 * - ShaderMount(speed=0, frame=0, minPixelRatio=1, maxPixelCount=W*H) 锁定
 *   精确 W×H 与 u_pixelRatio=1（不受设备像素比影响）；
 * - 等待 canvas 尺寸就绪 → setFrame(0) → toDataURL → dispose。
 */
import {
  ShaderMount,
  staticMeshGradientFragmentShader,
  flutedGlassFragmentShader,
  paperTextureFragmentShader,
  getShaderColorFromString,
  getShaderNoiseTexture,
  ShaderFitOptions,
  GlassDistortionShapes,
  GlassGridShapes,
  type ShaderMountUniforms,
} from "@paper-design/shaders";
import {
  ShaderError,
  type Rgba,
  type ShaderFormat,
  type ShaderKind,
} from "./presets";

export const MAX_SHADER_DIMENSION = 4096;

export interface RasterizeOptions {
  shader: ShaderKind;
  /** validateShaderParams 的输出（颜色已是 RGBA 数组） */
  uniforms: Record<string, unknown>;
  width: number;
  height: number;
  format: ShaderFormat;
  quality?: number;
  /** 已 decode 的输入图片（glass/paper 必需） */
  image?: HTMLImageElement;
  mipmaps?: string[];
}

export interface RasterizeResult {
  dataUrl: string;
  width: number;
  height: number;
  format: ShaderFormat;
  bytes: number;
}

let webgl2Probe: boolean | null = null;

/** WebGL2 预检（无 WebGL1/WebGPU/CPU 回退）。 */
export function webgl2Supported(): boolean {
  if (webgl2Probe !== null) return webgl2Probe;
  try {
    const canvas = document.createElement("canvas");
    webgl2Probe = Boolean(canvas.getContext("webgl2"));
  } catch {
    webgl2Probe = false;
  }
  return webgl2Probe;
}

/** 加载并 decode 图片（只接受已经落地的 data URL/同源 URL，调用方负责来源安全校验）。 */
export async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  try {
    await img.decode();
  } catch (e) {
    throw new ShaderError(
      "E_SHADER_IMAGE_DECODE",
      `图片解码失败：${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!img.complete || img.naturalWidth === 0) {
    throw new ShaderError("E_SHADER_IMAGE_DECODE", "图片解码失败：图片未完整加载");
  }
  return img;
}

let noiseTexturePromise: Promise<HTMLImageElement> | null = null;

async function loadNoiseTexture(): Promise<HTMLImageElement> {
  if (!noiseTexturePromise) {
    const source = getShaderNoiseTexture();
    if (!source?.src) {
      noiseTexturePromise = Promise.reject(
        new ShaderError("E_SHADER_IMAGE_DECODE", "PaperTexture 噪点纹理不可用"),
      );
    } else {
      noiseTexturePromise = loadImage(source.src).catch((e) => {
        noiseTexturePromise = null;
        throw e;
      });
    }
  }
  return noiseTexturePromise;
}

export function formatToMime(format: ShaderFormat): string {
  switch (format) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    default:
      return "image/jpeg";
  }
}

export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return 0;
  const meta = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  if (/;base64/i.test(meta)) {
    const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
  }
  return new TextEncoder().encode(decodeURIComponent(payload)).length;
}

function vec4(value: unknown): Rgba {
  if (Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === "number")) {
    return getShaderColorFromString(value as [number, number, number, number]);
  }
  // 理论上不会发生：validateShaderParams 已保证颜色是 RGBA。
  return getShaderColorFromString("#808080");
}

function fragmentShaderFor(kind: ShaderKind): string {
  switch (kind) {
    case "mesh":
      return staticMeshGradientFragmentShader;
    case "glass":
      return flutedGlassFragmentShader;
    case "paper":
      return paperTextureFragmentShader;
  }
}

const SIZING_UNIFORMS = {
  u_fit: ShaderFitOptions.cover,
  u_scale: 1,
  u_rotation: 0,
  u_originX: 0.5,
  u_originY: 0.5,
  u_offsetX: 0,
  u_offsetY: 0,
  u_worldWidth: 0,
  u_worldHeight: 0,
} as const;

async function buildUniforms(
  shader: ShaderKind,
  params: Record<string, unknown>,
  image: HTMLImageElement | undefined,
): Promise<ShaderMountUniforms> {
  if (shader === "mesh") {
    const colors = (params.colors as Rgba[] | undefined) ?? [];
    return {
      ...SIZING_UNIFORMS,
      u_colors: colors.map(vec4),
      u_colorsCount: colors.length,
      u_positions: params.positions,
      u_waveX: params.waveX,
      u_waveXShift: params.waveXShift,
      u_waveY: params.waveY,
      u_waveYShift: params.waveYShift,
      u_mixing: params.mixing,
      u_grainMixer: params.grainMixer,
      u_grainOverlay: params.grainOverlay,
    } as ShaderMountUniforms;
  }

  if (shader === "glass") {
    return {
      ...SIZING_UNIFORMS,
      ...(image ? { u_image: image } : {}),
      u_colorBack: vec4(params.colorBack),
      u_colorShadow: vec4(params.colorShadow),
      u_colorHighlight: vec4(params.colorHighlight),
      u_shadows: params.shadows,
      u_size: params.size,
      u_angle: params.angle,
      u_distortionShape:
        GlassDistortionShapes[(params.distortionShape as keyof typeof GlassDistortionShapes) ?? "prism"],
      u_highlights: params.highlights,
      u_shape: GlassGridShapes[(params.shape as keyof typeof GlassGridShapes) ?? "lines"],
      u_distortion: params.distortion,
      u_shift: params.shift,
      u_blur: params.blur,
      u_edges: params.edges,
      u_stretch: params.stretch,
      u_marginLeft: params.marginLeft,
      u_marginRight: params.marginRight,
      u_marginTop: params.marginTop,
      u_marginBottom: params.marginBottom,
      u_grainMixer: params.grainMixer,
      u_grainOverlay: params.grainOverlay,
    } as ShaderMountUniforms;
  }

  const noiseTexture = await loadNoiseTexture();
  return {
    ...SIZING_UNIFORMS,
    ...(image ? { u_image: image } : {}),
    u_isImage: Boolean(image),
    u_colorBack: vec4(params.colorBack),
    u_colorPaper: vec4(params.colorPaper),
    u_colorShadow: vec4(params.colorShadow),
    u_blending: params.blending,
    u_distortion: params.distortion,
    u_clip: params.clip,
    u_angle: params.angle,
    u_seed: params.seed,
    u_roughness: params.roughness,
    u_roughnessSize: params.roughnessSize,
    u_roughnessRows: params.roughnessRows,
    u_fiber: params.fiber,
    u_fiberSize: params.fiberSize,
    u_folds: params.folds,
    u_foldSizeX: params.foldSizeX,
    u_foldSizeY: params.foldSizeY,
    u_foldOffsetX: params.foldOffsetX,
    u_foldOffsetY: params.foldOffsetY,
    u_wrinkles: params.wrinkles,
    u_wrinkleSize: params.wrinkleSize,
    u_crumples: params.crumples,
    u_crumpleCount: params.crumpleCount,
    u_drops: params.drops,
    u_noiseTexture: noiseTexture,
  } as ShaderMountUniforms;
}

function waitForSize(canvas: HTMLCanvasElement, width: number, height: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let frames = 0;
    const tick = () => {
      if (canvas.width === width && canvas.height === height) {
        resolve();
        return;
      }
      frames += 1;
      if (frames >= 30) {
        reject(
          new ShaderError(
            "E_SHADER_SIZE_TIMEOUT",
            `Shader canvas 尺寸未就绪：期望 ${width}×${height}，实际 ${canvas.width}×${canvas.height}`,
          ),
        );
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}

/**
 * 单步光栅化。调用方负责保证 width/height 是 16–4096 的整数。
 * 失败抛 ShaderError（E_SHADER_NO_WEBGL2 / E_SHADER_SIZE_TIMEOUT / E_SHADER_IMAGE_DECODE）。
 */
export async function rasterize(opts: RasterizeOptions): Promise<RasterizeResult> {
  if (!webgl2Supported()) {
    throw new ShaderError(
      "E_SHADER_NO_WEBGL2",
      "当前浏览器不支持 WebGL2：无法生成 Paper Shaders 背景；请改用内置 SVG 背景",
    );
  }
  const { width, height, format, shader } = opts;
  const quality = format === "png" ? undefined : Math.min(1, Math.max(0.1, opts.quality ?? 0.92));
  const mipmaps = opts.mipmaps ?? (shader === "mesh" ? [] : ["u_image"]);

  const host = document.createElement("div");
  host.setAttribute("data-shader-host", "");
  host.style.cssText =
    `position:fixed;left:-100000px;top:0;width:${width}px;height:${height}px;` +
    "pointer-events:none;contain:strict;";
  const root = document.body ?? document.documentElement;
  root.appendChild(host);

  let mount: ShaderMount | null = null;
  try {
    const uniforms = await buildUniforms(shader, opts.uniforms, opts.image);
    mount = new ShaderMount(
      host,
      fragmentShaderFor(shader),
      uniforms,
      { preserveDrawingBuffer: true },
      0, // speed=0：不启动 rAF
      0, // frame=0：确定性起点
      1, // minPixelRatio=1
      width * height, // maxPixelCount → 任意 DPR 下恰 W×H、u_pixelRatio=1
      mipmaps,
    );
    await waitForSize(mount.canvasElement, width, height);
    mount.setFrame(0);
    const dataUrl = mount.canvasElement.toDataURL(formatToMime(format), quality);
    return {
      dataUrl,
      width,
      height,
      format,
      bytes: dataUrlBytes(dataUrl),
    };
  } finally {
    mount?.dispose();
    host.remove();
  }
}
