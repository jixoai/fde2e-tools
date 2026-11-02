/*
 * Canvas inspect —— apps/canvas/src/inspect.ts
 *
 * 从 Satori onNodeDetected 的布局树生成可读真值：
 * - 每个节点的 id/type/rect/text；
 * - blocking：非根节点出画布、nowrap 文本高置信溢出；
 * - advisory：对比度近似、设计 lint。
 * 根节点/画布框不参与 off_canvas（Satori 根盒含 padding，会误报）。
 */
import type { LayoutNode, RenderResult } from "./render";
import type { CanvasSpec, SpecWarning } from "./spec";

export interface InspectNode {
  id: string;
  type: string;
  text?: string;
  rect: { x: number; y: number; w: number; h: number };
  warnings: SpecWarning[];
}

export interface InspectResult {
  canvas: { w: number; h: number };
  nodes: InspectNode[];
  warnings: SpecWarning[];
  truncated?: boolean;
}

const MAX_INSPECT_NODES = 300;
const OVERFLOW_CONFIDENCE_PX = 4;

let measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (measureCtx) return measureCtx;
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  measureCtx = c.getContext("2d");
  return measureCtx;
}

function styleOf(node: LayoutNode): Record<string, unknown> {
  const s = node.props?.style;
  return s && typeof s === "object" ? (s as Record<string, unknown>) : {};
}

function measureTextWidth(text: string, style: Record<string, unknown>): number | null {
  const ctx = getMeasureCtx();
  if (!ctx) return null;
  const size = typeof style.fontSize === "number" ? style.fontSize : 16;
  const weight = typeof style.fontWeight === "number" ? style.fontWeight : 400;
  const family = typeof style.fontFamily === "string" ? style.fontFamily : "Noto Sans SC";
  ctx.font = `${weight} ${size}px "${family}", sans-serif`;
  return ctx.measureText(text).width;
}

function parseColor(value: unknown): { r: number; g: number; b: number; a: number } | null {
  if (typeof value !== "string") return null;
  if (/gradient|url\(/i.test(value)) return null;
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 1;
  c.height = 1;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = "#000";
  ctx.fillStyle = value;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
}

function luminance(c: { r: number; g: number; b: number }): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

function contrastRatio(fg: { r: number; g: number; b: number }, bg: { r: number; g: number; b: number }): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function blend(fg: { r: number; g: number; b: number; a: number }, bg: { r: number; g: number; b: number }): { r: number; g: number; b: number } {
  return {
    r: Math.round(fg.r * fg.a + bg.r * (1 - fg.a)),
    g: Math.round(fg.g * fg.a + bg.g * (1 - fg.a)),
    b: Math.round(fg.b * fg.a + bg.b * (1 - fg.a)),
  };
}

function inspectNode(node: LayoutNode, spec: CanvasSpec, rootId: string): SpecWarning[] {
  const warnings: SpecWarning[] = [];
  const id = typeof node.props?.id === "string" ? node.props.id : "node";
  const style = styleOf(node);
  const isRoot = id === rootId;
  const right = node.left + node.width;
  const bottom = node.top + node.height;
  if (!isRoot && (node.left < -1 || node.top < -1 || right > spec.width + 1 || bottom > spec.height + 1)) {
    warnings.push({
      code: "off_canvas",
      message: `节点 ${id} 超出画布（${Math.round(node.left)},${Math.round(node.top)} ${Math.round(node.width)}×${Math.round(node.height)}；画布 ${spec.width}×${spec.height}）`,
      nodeId: id,
    });
  }
  const text = node.textContent?.trim();
  if (text && style.whiteSpace === "nowrap") {
    const measured = measureTextWidth(text, style);
    if (measured !== null && measured > node.width + OVERFLOW_CONFIDENCE_PX) {
      warnings.push({
        code: "overflow",
        message: `节点 ${id} 的 nowrap 文本宽度 ${Math.round(measured)}px > 可用 ${Math.round(node.width)}px`,
        nodeId: id,
      });
    }
  }
  if (text) {
    // 只在节点自身显式给出文字色 + 背景色（或根节点用 spec.background）时计算；
    // 继承色需要祖先链，MVP 先返回 unknown，避免误报。
    const explicitColor = typeof style.color === "string";
    const explicitBg = typeof style.backgroundColor === "string";
    if (explicitColor && (explicitBg || isRoot)) {
      const fg = parseColor(style.color);
      const bgRaw = explicitBg ? style.backgroundColor : spec.background ?? "#ffffff";
      const bg = parseColor(bgRaw);
      if (fg && bg) {
        const fgSolid = blend(fg, bg);
        const ratio = contrastRatio(fgSolid, bg);
        if (ratio < 4.5) {
          warnings.push({
            code: "contrast",
            message: `节点 ${id} 文字对比度 ${ratio.toFixed(2)}:1 < 4.5:1（近似值）`,
            nodeId: id,
          });
        }
      }
    }
  }
  return warnings;
}

export function inspectCanvas(result: RenderResult, opts: { ids?: string[]; format?: "json" | "text" } = {}): InspectResult {
  const rootId = typeof result.spec.root.props.id === "string" ? result.spec.root.props.id : "root";
  const idFilter = opts.ids && opts.ids.length > 0 ? new Set(opts.ids) : null;
  const nodes: InspectNode[] = [];
  let truncated = false;
  for (const node of result.nodes) {
    const id = typeof node.props?.id === "string" ? node.props.id : "node";
    if (idFilter && !idFilter.has(id)) continue;
    if (nodes.length >= MAX_INSPECT_NODES) {
      truncated = true;
      break;
    }
    nodes.push({
      id,
      type: node.type,
      text: node.textContent?.trim() || undefined,
      rect: { x: node.left, y: node.top, w: node.width, h: node.height },
      warnings: inspectNode(node, result.spec, rootId),
    });
  }
  const warnings = [...result.warnings, ...nodes.flatMap((n) => n.warnings)];
  return {
    canvas: { w: result.spec.width, h: result.spec.height },
    nodes,
    warnings,
    ...(truncated ? { truncated } : {}),
  };
}

export function inspectToText(result: InspectResult): string {
  const lines = [`canvas ${result.canvas.w}×${result.canvas.h}`];
  for (const n of result.nodes) {
    const rect = `${Math.round(n.rect.x)},${Math.round(n.rect.y)} ${Math.round(n.rect.w)}×${Math.round(n.rect.h)}`;
    const text = n.text ? ` "${n.text.slice(0, 60)}"` : "";
    lines.push(`${n.id} [${n.type}] ${rect}${text}`);
  }
  if (result.warnings.length) {
    lines.push("warnings:");
    for (const w of result.warnings) lines.push(`- [${w.code}] ${w.message}`);
  }
  return lines.join("\n");
}
