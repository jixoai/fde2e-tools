/*
 * Canvas 渲染层 —— apps/canvas/src/render.ts
 *
 * Satori（standalone + layout.wasm）→ SVG；@resvg/resvg-wasm → PNG。
 * 字体：内置 Noto Sans SC Regular/Bold（同源 TTF），后续接 fontkit 用户字体。
 * 布局真值：onNodeDetected 直接给出 left/top/width/height/props/textContent。
 */
import { createElement, type ReactNode } from "react";
import satori, { init as initSatori } from "satori/standalone";
import layoutWasmUrl from "satori/layout.wasm?url";
import { initWasm as initResvgWasm, Resvg } from "@resvg/resvg-wasm";
import resvgWasmUrl from "@resvg/resvg-wasm/index_bg.wasm?url";
import notoRegularUrl from "../../../packages/shared/assets/fonts/NotoSansSC-Regular.ttf?url";
import notoBoldUrl from "../../../packages/shared/assets/fonts/NotoSansSC-Bold.ttf?url";
import { normalizeSpec, type CanvasSpec, type SpecNode, type SpecWarning } from "./spec";
import { getAsset } from "./assets";

export const DEFAULT_FONT_FAMILY = "Noto Sans SC";

export interface LayoutNode {
  left: number;
  top: number;
  width: number;
  height: number;
  type: string;
  key?: string | number;
  props: Record<string, unknown>;
  textContent?: string;
}

export interface RenderResult {
  spec: CanvasSpec;
  svg: string;
  nodes: LayoutNode[];
  warnings: SpecWarning[];
}

export interface PngResult {
  bytes: Uint8Array<ArrayBuffer>;
  width: number;
  height: number;
}

let satoriReady: Promise<void> | null = null;
let resvgReady: Promise<void> | null = null;
let fontsReady: Promise<Array<{ name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" }>> | null = null;

async function ensureSatori(): Promise<void> {
  if (!satoriReady) {
    satoriReady = initSatori(fetch(layoutWasmUrl)).catch((e) => {
      satoriReady = null;
      throw e;
    });
  }
  return satoriReady;
}

async function ensureResvg(): Promise<void> {
  if (!resvgReady) {
    resvgReady = initResvgWasm(fetch(resvgWasmUrl)).catch((e) => {
      resvgReady = null;
      throw e;
    });
  }
  return resvgReady;
}

async function fetchFont(url: string, weight: 400 | 700) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`内置字体加载失败（${res.status}）：${url}`);
  return { name: DEFAULT_FONT_FAMILY, data: await res.arrayBuffer(), weight, style: "normal" as const };
}

async function loadFonts() {
  if (!fontsReady) {
    fontsReady = Promise.all([fetchFont(notoRegularUrl, 400), fetchFont(notoBoldUrl, 700)]).catch((e) => {
      fontsReady = null;
      throw e;
    });
  }
  return fontsReady;
}

function resolveAssetRefs(node: SpecNode): void {
  if (node.type === "img" && typeof node.props.src === "string" && node.props.src.startsWith("asset:")) {
    const id = node.props.src.slice("asset:".length);
    const asset = getAsset(id);
    if (!asset?.dataUrl) {
      throw new Error(`asset:${id} 不存在或不是图片/SVG 素材（先 import_asset 或 list_assets）`);
    }
    node.props.src = asset.dataUrl;
  }
  const children = node.props.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      if (typeof child !== "string") resolveAssetRefs(child);
    }
  }
}

function toElement(node: SpecNode | string): ReactNode {
  if (typeof node === "string") return node;
  const props = { ...node.props } as Record<string, unknown>;
  const children = Array.isArray(props.children) ? (props.children as Array<SpecNode | string>) : [];
  delete props.children;
  return createElement(node.type, props, ...children.map(toElement));
}

export async function renderCanvas(rawSpec: unknown): Promise<RenderResult> {
  await ensureSatori();
  const { spec, warnings: specWarnings } = normalizeSpec(rawSpec);
  resolveAssetRefs(spec.root);
  const fonts = await loadFonts();
  const nodes: LayoutNode[] = [];
  const styleWarnings: SpecWarning[] = [];
  const svg = await satori(toElement(spec.root), {
    width: spec.width,
    height: spec.height,
    fonts,
    onNodeDetected: (node: LayoutNode) => {
      nodes.push({
        left: node.left,
        top: node.top,
        width: node.width,
        height: node.height,
        type: node.type,
        key: node.key,
        props: node.props ?? {},
        textContent: node.textContent,
      });
    },
    onStyleError: (e: Error) => {
      styleWarnings.push({ code: "style", message: e.message });
    },
  });
  return { spec, svg, nodes, warnings: [...specWarnings, ...styleWarnings] };
}

export async function svgToPng(
  svg: string,
  spec: CanvasSpec,
  opts: { scale?: number; background?: string } = {},
): Promise<PngResult> {
  await ensureResvg();
  const scale = Math.max(0.1, Math.min(4, opts.scale ?? 1));
  const width = Math.round(spec.width * scale);
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    background: opts.background ?? "rgba(0,0,0,0)",
  });
  try {
    const image = resvg.render();
    try {
      return { bytes: Uint8Array.from(image.asPng()), width: image.width, height: image.height };
    } finally {
      image.free();
    }
  } finally {
    resvg.free();
  }
}

export function svgDataUrl(svg: string): string {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}
