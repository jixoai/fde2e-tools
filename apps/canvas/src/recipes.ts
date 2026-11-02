/*
 * Canvas 配方 —— apps/canvas/src/recipes.ts
 * 可信内容：每个 recipe 是一份可直接渲染的 spec；AI 可用 get_recipe 取用后覆盖文案/素材。
 */
import type { CanvasSpec } from "./spec";
import { getAsset } from "./assets";

export interface Recipe {
  id: string;
  name: string;
  tags: string[];
  style: string;
  ratio: string;
  requires: string[];
  spec: CanvasSpec;
}

function backgroundLayer(id: string) {
  const asset = getAsset(id);
  if (!asset?.dataUrl) return null;
  return {
    type: "img",
    props: {
      id: `bg-${id}`,
      src: `asset:${id}`,
      style: { position: "absolute", left: 0, top: 0, width: "100%", height: "100%" },
    },
  };
}

const tech = (() => {
  const bg = backgroundLayer("bg-deep-space");
  return {
    id: "poster-tech-3x4",
    name: "科技感海报 3:4",
    tags: ["科技", "海报", "3:4", "深色"],
    style: "tech",
    ratio: "3:4",
    requires: [],
    spec: {
      width: 1080,
      height: 1440,
      background: "#0b1020",
      root: {
        type: "div",
        props: {
          id: "root",
          style: {
            width: "100%",
            height: "100%",
            padding: 80,
            boxSizing: "border-box",
            position: "relative",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            backgroundColor: "#0b1020",
            color: "#ffffff",
            fontFamily: "Noto Sans SC",
          },
          children: [
            ...(bg ? [bg] : []),
            {
              type: "div",
              props: {
                id: "content",
                style: { position: "relative", display: "flex", flexDirection: "column", gap: 28 },
                children: [
                  {
                    type: "div",
                    props: {
                      id: "badge",
                      style: {
                        display: "flex",
                        alignSelf: "flex-start",
                        padding: "12px 22px",
                        borderRadius: 999,
                        backgroundColor: "#16233a",
                        color: "#8fb4ff",
                        fontSize: 24,
                        fontWeight: 700,
                      },
                      children: "FDE2E · CANVAS",
                    },
                  },
                  {
                    type: "div",
                    props: {
                      id: "title",
                      style: { fontSize: 104, fontWeight: 700, lineHeight: 1.12 },
                      children: "用 JSON\n排版",
                    },
                  },
                  {
                    type: "div",
                    props: {
                      id: "subtitle",
                      style: { fontSize: 38, fontWeight: 400, color: "#9fb3d1" },
                      children: "Satori 确定性出图 · SVG / PNG",
                    },
                  },
                ],
              },
            },
            {
              type: "div",
              props: {
                id: "footer",
                style: { position: "relative", display: "flex", justifyContent: "space-between", alignItems: "flex-end" },
                children: [
                  {
                    type: "div",
                    props: { id: "meta", style: { fontSize: 24, color: "#6f86a8" }, children: "2026 · FDE2E" },
                  },
                ],
              },
            },
          ],
        },
      },
    },
  } satisfies Recipe;
})();

const minimal = (() => {
  const shape = getAsset("shape-check");
  return {
    id: "card-minimal-1x1",
    name: "极简方卡 1:1",
    tags: ["极简", "方卡", "1:1", "浅色"],
    style: "minimal",
    ratio: "1:1",
    requires: [],
    spec: {
      width: 1080,
      height: 1080,
      background: "#f7f4ee",
      root: {
        type: "div",
        props: {
          id: "root",
          style: {
            width: "100%",
            height: "100%",
            padding: 96,
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            backgroundColor: "#f7f4ee",
            color: "#1f2937",
            fontFamily: "Noto Sans SC",
          },
          children: [
            {
              type: "div",
              props: {
                id: "eyebrow",
                style: { fontSize: 26, fontWeight: 700, letterSpacing: 4, color: "#8a7f6d" },
                children: "MINIMAL / 01",
              },
            },
            {
              type: "div",
              props: {
                id: "title",
                style: { fontSize: 120, fontWeight: 700, lineHeight: 1.05 },
                children: "少即是多",
              },
            },
            {
              type: "div",
              props: {
                id: "footer",
                style: { display: "flex", alignItems: "flex-end", justifyContent: "space-between" },
                children: [
                  {
                    type: "div",
                    props: { id: "meta", style: { fontSize: 26, color: "#8a7f6d" }, children: "FDE2E · CANVAS" },
                  },
                  ...(shape?.dataUrl
                    ? [
                        {
                          type: "img",
                          props: { id: "accent", src: "asset:shape-check", style: { width: 96, height: 96 } },
                        },
                      ]
                    : []),
                ],
              },
            },
          ],
        },
      },
    },
  } satisfies Recipe;
})();

/* ---------------- 开箱配方扩展（canvas-tool-v1 C1/C4） ----------------
 * 同一可信布局 × 不同背景/强调色/文案；AI 取用后可覆盖文案与素材。 */
function makePoster(
  id: string,
  name: string,
  style: string,
  tags: string[],
  bgId: string,
  shapeId: string,
  title: string,
  subtitle: string,
  width = 1080,
  height = 1440,
): Recipe {
  const bg = backgroundLayer(bgId);
  const accent = getAsset(shapeId);
  return {
    id,
    name,
    tags: [style, ...tags],
    style,
    ratio: width === height ? "1:1" : width > height ? "4:3" : "3:4",
    requires: [],
    spec: {
      width,
      height,
      background: "#0b1020",
      root: {
        type: "div",
        props: {
          id: "root",
          style: {
            width: "100%",
            height: "100%",
            padding: 84,
            boxSizing: "border-box",
            position: "relative",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            color: "#111827",
            fontFamily: "Noto Sans SC",
          },
          children: [
            ...(bg ? [bg] : []),
            {
              type: "div",
              props: {
                id: "content",
                style: { position: "relative", display: "flex", flexDirection: "column", gap: 24 },
                children: [
                  {
                    type: "div",
                    props: {
                      id: "eyebrow",
                      style: { display: "flex", fontSize: 24, fontWeight: 700, letterSpacing: 3, color: "#475569" },
                      children: "FDE2E · CANVAS",
                    },
                  },
                  {
                    type: "div",
                    props: { id: "title", style: { fontSize: 108, fontWeight: 700, lineHeight: 1.1 }, children: title },
                  },
                  {
                    type: "div",
                    props: { id: "subtitle", style: { fontSize: 36, color: "#475569" }, children: subtitle },
                  },
                ],
              },
            },
            {
              type: "div",
              props: {
                id: "footer",
                style: { position: "relative", display: "flex", alignItems: "flex-end", justifyContent: "space-between" },
                children: [
                  { type: "div", props: { id: "meta", style: { fontSize: 24, color: "#64748b" }, children: "2026 · FDE2E" } },
                  ...(accent?.dataUrl
                    ? [{ type: "img", props: { id: "accent", src: `asset:${shapeId}`, style: { width: 88, height: 88 } } }]
                    : []),
                ],
              },
            },
          ],
        },
      },
    },
  } satisfies Recipe;
}

const variants: Recipe[] = [
  makePoster("poster-ocean-3x4", "深海海报 3:4", "minimal", ["蓝", "海报", "3:4"], "bg-ocean", "shape-ring", "向深海\n要答案", "确定性排版 · 可测量布局"),
  makePoster("poster-forest-3x4", "森林海报 3:4", "handdrawn", ["绿", "自然", "3:4"], "bg-forest", "shape-heart", "回到\n自然", "手绘感的温度"),
  makePoster("poster-sunset-3x4", "柔光日落 3:4", "handdrawn", ["暖色", "日落", "3:4"], "bg-sunset-soft", "shape-star", "把光\n留在今天", "柔和的收束"),
  makePoster("poster-mono-3x4", "黑白海报 3:4", "minimal", ["黑白", "极简", "3:4"], "bg-mono", "shape-square", "少即是多", "留白也是内容"),
  makePoster("poster-cyber-3x4", "赛博海报 3:4", "tech", ["紫", "霓虹", "3:4"], "bg-cyber", "shape-bolt", "能量\n加载中", "SYSTEM ONLINE"),
  makePoster("poster-pastel-1x1", "奶油方卡 1:1", "handdrawn", ["粉", "方卡", "1:1"], "bg-pastel", "shape-quote", "今天也要\n好好说话", "soft & warm", 1080, 1080),
  makePoster("poster-ink-3x4", "水墨海报 3:4", "retro", ["国潮", "留白", "3:4"], "bg-ink", "shape-line", "留白\n见天地", "东方美学的呼吸"),
  makePoster("poster-glass-3x4", "玻璃海报 3:4", "tech", ["玻璃", "蓝", "3:4"], "bg-glass", "shape-play", "看得见的\n秩序", "glass / grid / light"),
];

export const RECIPES: Recipe[] = [tech, minimal, ...variants];

export function listRecipes(opts: { style?: string; q?: string } = {}): Recipe[] {
  const q = opts.q?.trim().toLowerCase();
  return RECIPES.filter((r) => {
    if (opts.style && r.style !== opts.style) return false;
    if (q && !`${r.id} ${r.name} ${r.tags.join(" ")} ${r.style}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export function getRecipe(id: string): Recipe | null {
  return RECIPES.find((r) => r.id === id) ?? null;
}

export const STYLES = [
  { id: "tech", name: "科技", fonts: ["Noto Sans SC"], tags: ["深色", "光晕", "渐变"], recipes: ["poster-tech-3x4", "poster-cyber-3x4", "poster-glass-3x4"] },
  { id: "minimal", name: "极简", fonts: ["Noto Sans SC"], tags: ["留白", "大字", "浅色"], recipes: ["card-minimal-1x1", "poster-ocean-3x4", "poster-mono-3x4"] },
  { id: "handdrawn", name: "手绘", fonts: ["Noto Sans SC"], tags: ["暖色", "柔和", "自然"], recipes: ["poster-forest-3x4", "poster-sunset-3x4", "poster-pastel-1x1"] },
  { id: "retro", name: "复古/国潮", fonts: ["Noto Sans SC"], tags: ["留白", "水墨", "条纹"], recipes: ["poster-ink-3x4"] },
];
