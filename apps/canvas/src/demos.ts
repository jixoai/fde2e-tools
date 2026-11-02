/*
 * Canvas Demo 目录 —— apps/canvas/src/demos.ts
 *
 * ≥12 个可直接 render_card 的 demo，分 basic / advanced / preprocess 三级：
 * - 覆盖 Shader 背景、图标、图片、字体（内置 Satori + 外部 text_to_svg）、
 *   shader 链式、多素材组合与 preprocess 四资产组合；
 * - demo 是可信内容，但仍走 normalizeSpec 校验（单测逐一断言）；
 * - 所有 preprocess demo 的 `pre:` 引用只指向自己的 preprocess map（不造假 id）；
 * - listDemos 只回摘要（explain 前 200 字），getDemo 回完整 spec。
 *
 * 本文件保持零运行时依赖（Node 单测可直接 import）。
 */
import type { CanvasSpec } from "./spec";

export type DemoLevel = "basic" | "advanced" | "preprocess";

export interface Demo {
  id: string;
  title: string;
  level: DemoLevel;
  features: string[];
  explain: string;
  spec: unknown;
}

/** 与 font-catalog 的 Inter 条目同源（@fontsource jsDelivr 直链，CORS `*`）。 */
export const INTER_FONT_URL =
  "https://cdn.jsdelivr.net/npm/@fontsource/inter@5.1.0/files/inter-latin-400-normal.woff2";

type AnyNode = Record<string, unknown>;

function img(id: string, src: string, style: Record<string, unknown>): AnyNode {
  return { type: "img", props: { id, src, style } };
}

function text(id: string, content: string, style: Record<string, unknown>): AnyNode {
  return { type: "div", props: { id, style, children: content } };
}

function box(id: string, style: Record<string, unknown>, children: AnyNode[]): AnyNode {
  return { type: "div", props: { id, style, children } };
}

function root(children: AnyNode[], style: Record<string, unknown> = {}): AnyNode {
  return {
    type: "div",
    props: {
      id: "root",
      style: {
        width: "100%",
        height: "100%",
        position: "relative",
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
        fontFamily: "Noto Sans SC",
        ...style,
      },
      children,
    },
  };
}

function fullBleed(id: string, src: string, extra: Record<string, unknown> = {}): AnyNode {
  return img(id, src, { position: "absolute", left: 0, top: 0, width: "100%", height: "100%", ...extra });
}

const DEMO_LIST: Demo[] = [
  {
    id: "shader-title",
    title: "Shader 背景 + 标题",
    level: "basic",
    features: ["preprocess", "shader", "typography"],
    explain:
      "最小 preprocess 示例：只声明一个 shader 背景（mesh-sunset），root 里用 pre:bg 全幅铺底，再叠 Satori 文字。适合先学会「声明素材 → pre:<key> 引用」的两步法。",
    spec: {
      width: 1080,
      height: 1440,
      background: "#0b1020",
      preprocess: {
        bg: { type: "shader", preset: "mesh-sunset", width: 1080, height: 1440 },
      },
      root: root(
        [
          fullBleed("bg", "pre:bg"),
          box("content", { position: "relative", display: "flex", flexDirection: "column", gap: 24, padding: 96 }, [
            text("eyebrow", "FDE2E · CANVAS", {
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: 4,
              color: "#ffffffcc",
            }),
            text("title", "把素材\n写进 spec", {
              fontSize: 108,
              fontWeight: 700,
              lineHeight: 1.12,
              color: "#ffffff",
            }),
            text("subtitle", "pre:bg → Shader 背景 · 声明式预处理", {
              fontSize: 34,
              color: "#ffffffaa",
            }),
          ]),
        ],
        { justifyContent: "center", padding: 0, color: "#ffffff" },
      ),
    },
  },
  {
    id: "shader-icon-title",
    title: "Shader + 图标 + 标题（三素材）",
    level: "advanced",
    features: ["preprocess", "shader", "icon", "typography"],
    explain:
      "三素材同图：mesh-aurora 背景 + Tabler sparkles 图标（换白色、96px）+ Satori 标题。图标经 preprocess.icon 生成 shape 资产，spec 里用 pre:logo 引用，不需要把 data URL 塞进对话。",
    spec: {
      width: 1080,
      height: 1440,
      background: "#04121f",
      preprocess: {
        bg: { type: "shader", preset: "mesh-aurora", width: 1080, height: 1440 },
        logo: { type: "icon", library: "tabler", name: "sparkles", color: "#ffffff", size: 96 },
      },
      root: root(
        [
          fullBleed("bg", "pre:bg"),
          box(
            "content",
            {
              position: "relative",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 28,
              height: "100%",
              padding: 80,
            },
            [
              img("logo", "pre:logo", { width: 96, height: 96 }),
              text("title", "Aurora", { fontSize: 132, fontWeight: 700, color: "#ffffff" }),
              text("subtitle", "shader + icon + text", { fontSize: 36, color: "#bfe2ff" }),
            ],
          ),
        ],
        { color: "#ffffff" },
      ),
    },
  },
  {
    id: "shader-image-foreground",
    title: "Shader 背景 + 图片前景（双素材）",
    level: "advanced",
    features: ["preprocess", "shader", "image", "composition"],
    explain:
      "双素材：mesh-sunset 全幅背景 + 一张图片前景（这里用内置素材 bg-warm-sunset 走 image.assetId，避免外网依赖）。前景图片带圆角与描边，验证两张素材同时可见、互不覆盖。",
    spec: {
      width: 1080,
      height: 1440,
      background: "#0b1020",
      preprocess: {
        bg: { type: "shader", preset: "mesh-sunset", width: 1080, height: 1440 },
        photo: { type: "image", assetId: "bg-warm-sunset" },
      },
      root: root(
        [
          fullBleed("bg", "pre:bg"),
          box(
            "content",
            {
              position: "relative",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              height: "100%",
              padding: 80,
            },
            [
              text("title", "Foreground", { fontSize: 96, fontWeight: 700, color: "#ffffff" }),
              img("photo", "pre:photo", {
                width: 720,
                height: 480,
                borderRadius: 32,
                border: "6px solid #ffffff55",
              }),
            ],
          ),
        ],
        { color: "#ffffff" },
      ),
    },
  },
  {
    id: "mesh-glass-card",
    title: "Mesh → Glass 链式背景 + 玻璃卡",
    level: "advanced",
    features: ["preprocess", "shader", "chain", "glass-card"],
    explain:
      "shader 条目的 chain 直接写 1–4 步：mesh-sunset 生成渐变，glass-prism 消费上一步输出做玻璃棱镜。root 用 pre:bg 铺底，再叠半透明玻璃卡片（纯样式，不需要额外素材）。",
    spec: {
      width: 1080,
      height: 1440,
      background: "#0b1020",
      preprocess: {
        bg: {
          type: "shader",
          preset: "mesh-sunset",
          chain: [{ preset: "mesh-sunset" }, { preset: "glass-prism" }],
          width: 1080,
          height: 1440,
          format: "jpeg",
          quality: 0.92,
        },
      },
      root: root(
        [
          fullBleed("bg", "pre:bg"),
          box(
            "card-wrap",
            {
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              padding: 90,
            },
            [
              box(
                "card",
                {
                  display: "flex",
                  flexDirection: "column",
                  gap: 20,
                  width: "100%",
                  padding: 56,
                  borderRadius: 32,
                  backgroundColor: "#ffffff1f",
                  border: "2px solid #ffffff55",
                },
                [
                  text("badge", "GLASS / CHAIN", { fontSize: 24, letterSpacing: 3, color: "#ffffffcc" }),
                  text("title", "链式背景", { fontSize: 96, fontWeight: 700, color: "#ffffff" }),
                  text("desc", "mesh-sunset → glass-prism", { fontSize: 32, color: "#ffffffbb" }),
                ],
              ),
            ],
          ),
        ],
        { color: "#ffffff" },
      ),
    },
  },
  {
    id: "image-paper-text",
    title: "图片 → Paper 背景 + 文字 + 徽章",
    level: "advanced",
    features: ["preprocess", "shader", "image", "backgroundImage"],
    explain:
      "图片→纸纹：image 条目先取内置图片，paper-default shader 以 source:\"base\" 消费它做纸纹压印；root 用 style.backgroundImage=\"url(pre:paper)\" 铺底（验证 backgroundImage 的 pre: 解析），再叠文字与徽章。",
    spec: {
      width: 1080,
      height: 1440,
      preprocess: {
        base: { type: "image", assetId: "bg-warm-sunset" },
        paper: { type: "shader", preset: "paper-default", source: "base", width: 1080, height: 1440 },
      },
      root: root(
        [
          box(
            "content",
            {
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              height: "100%",
              padding: 96,
            },
            [
              text("badge", "PAPER / 02", {
                display: "flex",
                alignSelf: "flex-start",
                padding: "12px 24px",
                borderRadius: 999,
                backgroundColor: "#ffffffd9",
                color: "#7a3b5e",
                fontSize: 26,
                fontWeight: 700,
              }),
              text("title", "纸上的\n温度", {
                fontSize: 116,
                fontWeight: 700,
                lineHeight: 1.08,
                color: "#2a1f1a",
              }),
              text("footer", "image → paper-default → text", { fontSize: 30, color: "#4a3b32" }),
            ],
          ),
        ],
        { backgroundImage: "url(pre:paper)", color: "#2a1f1a" },
      ),
    },
  },
  {
    id: "font-showcase",
    title: "字体展示：内置中文 + 外部英文",
    level: "advanced",
    features: ["font", "text_to_svg", "satori", "typography"],
    explain:
      "内置 Noto Sans SC 由 Satori 直接排版（无需网络）；英文标题用 text 预处理走 font_info/text_to_svg 转 path（Inter，jsDelivr 直链）。两类字体在同一张 Canvas 共存，展示「Satori 原生 vs 外部字体转 path」的边界。",
    spec: {
      width: 1080,
      height: 1440,
      background: "#f7f4ee",
      preprocess: {
        en: {
          type: "text",
          text: "Canvas",
          font: "inter",
          fontUrl: INTER_FONT_URL,
          fontSize: 160,
          lineHeight: 1.1,
          color: "#111827",
        },
      },
      root: root(
        [
          text("label", "FONT SHOWCASE", { fontSize: 24, letterSpacing: 4, color: "#8a7f6d" }),
          text("title-zh", "字体展示", { fontSize: 120, fontWeight: 700, lineHeight: 1.1, color: "#111827" }),
          img("en", "pre:en", { width: 680, height: 176 }),
          text("desc", "内置 Noto Sans SC（Satori） + Inter（text_to_svg）", {
            fontSize: 30,
            color: "#6b6257",
          }),
        ],
        { justifyContent: "space-between", padding: 96, color: "#111827" },
      ),
    },
  },
  {
    id: "icon-grid",
    title: "六族图标网格",
    level: "advanced",
    features: ["preprocess", "icon", "grid", "six-families"],
    explain:
      "从 Lucide / Tabler / Heroicons / Bootstrap / Font Awesome / Material 六族各取一个图标（preprocess.icon），换同一种深色后排成网格。说明支持的是六族同源 SVG，不是 react-icons 组件运行时。",
    spec: {
      width: 1080,
      height: 1440,
      background: "#ffffff",
      preprocess: {
        i1: { type: "icon", library: "lucide", name: "star", color: "#111827", size: 72 },
        i2: { type: "icon", library: "tabler", name: "rocket", color: "#111827", size: 72 },
        i3: { type: "icon", library: "heroicons", name: "heart", color: "#111827", size: 72 },
        i4: { type: "icon", library: "bootstrap", name: "camera", color: "#111827", size: 72 },
        i5: { type: "icon", library: "fontawesome", name: "bolt", color: "#111827", size: 72 },
        i6: { type: "icon", library: "material", name: "music", color: "#111827", size: 72 },
      },
      root: root(
        [
          text("title", "六族图标", { fontSize: 88, fontWeight: 700, color: "#111827" }),
          box(
            "grid",
            { display: "flex", flexWrap: "wrap", gap: 24, marginTop: 40 },
            [
              ["i1", "Lucide"],
              ["i2", "Tabler"],
              ["i3", "Heroicons"],
              ["i4", "Bootstrap"],
              ["i5", "Font Awesome"],
              ["i6", "Material"],
            ].map(([key, label]) =>
              box(
                `cell-${key}`,
                {
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 14,
                  width: 300,
                  height: 220,
                  borderRadius: 24,
                  backgroundColor: "#f4f4f5",
                },
                [img(key, `pre:${key}`, { width: 72, height: 72 }), text(`label-${key}`, label, { fontSize: 24, color: "#3f3f46" })],
              ),
            ),
          ),
        ],
        { padding: 80, color: "#111827" },
      ),
    },
  },
  {
    id: "preprocess-four-assets",
    title: "预处理四资产组合（bg/logo/title/photo）",
    level: "preprocess",
    features: ["preprocess", "shader", "icon", "text", "image", "multi-asset"],
    explain:
      "preprocess 一次声明四个资产：bg（shader）、logo（图标）、title（外部字体转 path）、photo（图片）；root 用 pre:bg / pre:logo / pre:title / pre:photo 引用。render_card 返回的 preprocess 摘要会列出 count/keys/assetIds，便于核对。",
    spec: {
      width: 1080,
      height: 1440,
      background: "#0b1020",
      preprocess: {
        bg: { type: "shader", preset: "mesh-sunset", width: 1080, height: 1440 },
        logo: { type: "icon", library: "lucide", name: "sparkles", color: "#ffffff", size: 96 },
        title: {
          type: "text",
          text: "FDE2E",
          font: "inter",
          fontUrl: INTER_FONT_URL,
          fontSize: 120,
          lineHeight: 1.1,
          color: "#ffffff",
        },
        photo: { type: "image", assetId: "bg-warm-sunset" },
      },
      root: root(
        [
          fullBleed("bg", "pre:bg"),
          box(
            "content",
            {
              position: "relative",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              height: "100%",
              padding: 80,
            },
            [
              box("head", { display: "flex", alignItems: "center", gap: 24 }, [
                img("logo", "pre:logo", { width: 96, height: 96 }),
                img("title", "pre:title", { width: 560, height: 170 }),
              ]),
              img("photo", "pre:photo", {
                width: 560,
                height: 360,
                borderRadius: 28,
                border: "4px solid #ffffff55",
              }),
            ],
          ),
        ],
        { color: "#ffffff" },
      ),
    },
  },
  {
    id: "preprocess-chain-bg",
    title: "预处理链式：bg → glass",
    level: "preprocess",
    features: ["preprocess", "shader", "chain", "source"],
    explain:
      "两个 shader 条目：bg 生成 mesh-sunset，glass 用 source:\"bg\" 消费前一 key 的输出做 glass-prism。声明顺序即执行顺序；source 只能指向更早的条目，否则 E_PREPROCESS_ORDER。root 用 backgroundImage url(pre:glass) 铺底。",
    spec: {
      width: 1080,
      height: 1440,
      background: "#0b1020",
      preprocess: {
        bg: { type: "shader", preset: "mesh-sunset", width: 1080, height: 1440 },
        glass: { type: "shader", preset: "glass-prism", source: "bg", width: 1080, height: 1440 },
      },
      root: root(
        [
          box(
            "content",
            {
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              padding: 96,
            },
            [
              text("badge", "CHAIN / preprocess", { fontSize: 26, letterSpacing: 3, color: "#ffffffcc" }),
              text("title", "bg → glass", { fontSize: 112, fontWeight: 700, color: "#ffffff" }),
              text("desc", "source 指向更早的 pre key", { fontSize: 32, color: "#ffffffbb" }),
            ],
          ),
        ],
        { backgroundImage: "url(pre:glass)", color: "#ffffff" },
      ),
    },
  },
  {
    id: "preprocess-external-font",
    title: "预处理外部字体文本",
    level: "preprocess",
    features: ["preprocess", "text", "text_to_svg", "font"],
    explain:
      "text 条目用 fontUrl 指定 Inter（也可写 font:\"inter\" 让目录解析），text_to_svg 把文本转成 SVG path 后注册为 shape 资产。适合 Satori 不支持的字体/标题/logo；字体授权由使用方确认，工具只记录来源。",
    spec: {
      width: 1080,
      height: 1440,
      background: "#f7f4ee",
      preprocess: {
        title: {
          type: "text",
          text: "Canvas",
          font: "inter",
          fontUrl: INTER_FONT_URL,
          fontSize: 170,
          lineHeight: 1.1,
          color: "#111827",
        },
        zh: {
          type: "text",
          text: "外部字体",
          font: "noto-sans-sc",
          fontSize: 88,
          lineHeight: 1.2,
          color: "#7a3b5e",
        },
      },
      root: root(
        [
          img("title", "pre:title", { width: 760, height: 190 }),
          img("zh", "pre:zh", { width: 420, height: 110 }),
          text("desc", "fontUrl → fontkit → text_to_svg → pre:<key>", { fontSize: 28, color: "#6b6257" }),
        ],
        { justifyContent: "center", gap: 32, padding: 96, color: "#111827" },
      ),
    },
  },
  {
    id: "preprocess-icon-color",
    title: "预处理图标：换色 + 尺寸",
    level: "preprocess",
    features: ["preprocess", "icon", "color", "size"],
    explain:
      "icon 条目直接声明 library/name/color/size：同一族图标换色与尺寸只需改 color/size，get_icon 也会返回同样的 shape 资产。这里用 Tabler rocket + 金色 160px，配 mesh 背景。",
    spec: {
      width: 1080,
      height: 1440,
      background: "#0b1020",
      preprocess: {
        bg: { type: "shader", preset: "mesh-aurora", width: 1080, height: 1440 },
        rocket: { type: "icon", library: "tabler", name: "rocket", color: "#f5b301", size: 160 },
      },
      root: root(
        [
          fullBleed("bg", "pre:bg"),
          box(
            "content",
            {
              position: "relative",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              gap: 32,
            },
            [
              img("rocket", "pre:rocket", { width: 160, height: 160 }),
              text("title", "换色 · 换尺寸", { fontSize: 76, fontWeight: 700, color: "#ffffff" }),
              text("desc", "#f5b301 · 160px", { fontSize: 30, color: "#f5b301" }),
            ],
          ),
        ],
        { color: "#ffffff" },
      ),
    },
  },
  {
    id: "preprocess-image-badge",
    title: "预处理图片 + 徽章",
    level: "preprocess",
    features: ["preprocess", "image", "icon", "badge"],
    explain:
      "image 条目把内置纸感网格作为全幅底图，再叠一个 check 图标徽章与标题。图片与图标都由 preprocess 产出，spec 只写 pre:photo / pre:badge。",
    spec: {
      width: 1080,
      height: 1440,
      background: "#f7f4ee",
      preprocess: {
        photo: { type: "image", assetId: "bg-paper-grid" },
        badge: { type: "icon", library: "lucide", name: "check", color: "#16a34a", size: 72 },
      },
      root: root(
        [
          fullBleed("photo", "pre:photo"),
          box(
            "content",
            {
              position: "relative",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              gap: 28,
              padding: 96,
            },
            [
              img("badge", "pre:badge", { width: 72, height: 72 }),
              text("title", "已完成", { fontSize: 104, fontWeight: 700, color: "#111827" }),
              text("desc", "image + icon → pre:<key>", { fontSize: 32, color: "#4b5563" }),
            ],
          ),
        ],
        { color: "#111827" },
      ),
    },
  },
  {
    id: "preprocess-error-example",
    title: "预处理错误示例（只讲解，规范本身有效）",
    level: "preprocess",
    features: ["preprocess", "errors", "validation"],
    explain:
      "本 demo 的 spec 本身有效（一个 mesh 背景），下方是**会被拒绝**的反例：未知 key（pre:nope）、source 引用后声明的 key（E_PREPROCESS_ORDER）、外部 URL（image.url 非 https 或私网）、超 8 条目、text 超 2000 字、图标不存在（E_ICON_NOT_FOUND）、shader source 缺失（E_SHADER_SOURCE_REQUIRED）。错误统一 E_PREPROCESS_* + key，不产生半张图。",
    spec: {
      width: 1080,
      height: 1440,
      background: "#0b1020",
      preprocess: {
        bg: { type: "shader", preset: "mesh-aurora", width: 1080, height: 1440 },
      },
      root: root(
        [
          fullBleed("bg", "pre:bg"),
          box(
            "content",
            {
              position: "relative",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              gap: 20,
            },
            [
              text("title", "错误示例看 explain", { fontSize: 70, fontWeight: 700, color: "#ffffff" }),
              text("desc", "见 get_demo 的 explain 字段", { fontSize: 30, color: "#bfe2ff" }),
            ],
          ),
        ],
        { color: "#ffffff" },
      ),
    },
  },
];

export const DEMOS: Demo[] = DEMO_LIST;

export interface DemoSummary {
  id: string;
  title: string;
  level: DemoLevel;
  features: string[];
  explain: string;
}

export function demoSummary(demo: Demo): DemoSummary {
  return {
    id: demo.id,
    title: demo.title,
    level: demo.level,
    features: demo.features,
    explain: demo.explain.slice(0, 200),
  };
}

export function listDemos(filter: { level?: string; q?: string } = {}): Demo[] {
  const q = filter.q?.trim().toLowerCase();
  return DEMOS.filter((d) => {
    if (filter.level && d.level !== filter.level) return false;
    if (q) {
      const hay = `${d.id} ${d.title} ${d.level} ${d.features.join(" ")} ${d.explain}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function getDemo(id: string): Demo | null {
  return DEMOS.find((d) => d.id === id) ?? null;
}

/** 供单测使用：demo spec 的 preprocess key 集（非 preprocess demo 返回空集）。 */
export function demoPreprocessKeys(demo: Demo): string[] {
  const spec = demo.spec as CanvasSpec;
  return spec.preprocess ? Object.keys(spec.preprocess) : [];
}
