/*
 * Canvas WebMCP —— apps/canvas/src/webmcp.ts
 *
 * 工具面（v1 MVP）：
 * - render_card：JSON spec → Satori；返回 renderId/尺寸/摘要，不回整段 SVG；
 * - inspect_layout：布局真值 + blocking/advisory 警告；
 * - export_svg：自包含 SVG（inlinePaths 为 A3b 可选，未实现时显式报错）；
 * - export_canvas_png：单图 PNG 下载（避免与 pptx 的 export_png 同名不同义）；
 * - list_fonts / list_recipes / list_styles：摘要列表。
 * 失败统一 {ok:false, error}，execute 永不 reject。
 */
import { registerWebMCPTools, type WebMCPToolDef } from "@fde2e-tools/shared/webmcp";
import { downloadBlob, safeFilename } from "@fde2e-tools/shared/download";
import { renderCanvas, svgToPng, type RenderResult } from "./render";
import { inspectCanvas, inspectToText } from "./inspect";
import { fontGlyphs, fontInfo, textToSvg } from "./font-client";
import { assetSummary, getAsset, importAsset, listAssets, type AssetType } from "./assets";
import { getRecipe, listRecipes, STYLES } from "./recipes";

interface CanvasState {
  renderId: string;
  result: RenderResult;
  /** 原始输入 spec（未归一/未解析 asset: 引用）——页面输入框显示这份，避免大段 data URL */
  input: unknown;
}

let state: CanvasState | null = null;
let counter = 0;
type RenderListener = (state: CanvasState | null) => void;
const renderListeners = new Set<RenderListener>();
type InspectListener = (warnings: Array<{ code: string; message: string }>) => void;
const inspectListeners = new Set<InspectListener>();

/** 页面预览订阅：WebMCP 渲染与人类按钮共用同一份 state（AI 出图后 UI 立即刷新）。 */
export function subscribeRender(fn: RenderListener): () => void {
  renderListeners.add(fn);
  fn(state);
  return () => renderListeners.delete(fn);
}

/** inspect 订阅：AI 调 inspect_layout 后，页面同步显示同批布局警告。 */
export function subscribeInspect(fn: InspectListener): () => void {
  inspectListeners.add(fn);
  return () => inspectListeners.delete(fn);
}

export function getLastRender(): RenderResult | null {
  return state?.result ?? null;
}

export async function renderSpec(rawSpec: unknown): Promise<{ renderId: string; result: RenderResult }> {
  const result = await renderCanvas(rawSpec);
  counter += 1;
  const renderId = `r${counter}`;
  state = { renderId, result, input: rawSpec };
  for (const fn of renderListeners) fn(state);
  return { renderId, result };
}

function current(renderId?: string): RenderResult {
  if (!state) throw new Error("还没有渲染结果：先调用 render_card");
  if (renderId && renderId !== state.renderId) throw new Error(`renderId 不匹配（当前 ${state.renderId}）`);
  return state.result;
}

function fail(e: unknown): { ok: false; error: string; message: string } {
  const msg = e instanceof Error && e.message ? e.message : String(e);
  return { ok: false, error: msg, message: msg };
}

function err(message: string): { ok: false; error: string; message: string } {
  return { ok: false, error: message, message };
}

const FONTS = [
  { family: "Noto Sans SC", weights: [400, 700], source: "builtin", license: "OFL-1.1" },
];

function buildTools(): WebMCPToolDef[] {
  return [
    {
      name: "render_card",
      title: "渲染画布",
      description:
        "按 JSON spec 用 Satori 渲染固定尺寸画布。spec={width,height,background?,root}；root 是 React element 形状，children 必须在 props.children。" +
        "返回 renderId/尺寸/摘要/警告，不返回整段 SVG；需要 SVG 用 export_svg。",
      inputSchema: {
        type: "object",
        properties: {
          spec: { type: "object", description: "Canvas spec（width/height/root）" },
        },
        required: ["spec"],
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        try {
          const { renderId, result } = await renderSpec(input.spec);
          return {
            ok: true,
            renderId,
            width: result.spec.width,
            height: result.spec.height,
            summary: {
              nodes: result.nodes.length,
              warnings: result.warnings.length,
              bytes: new TextEncoder().encode(result.svg).length,
            },
            warnings: result.warnings,
          };
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "inspect_layout",
      title: "读取布局真值",
      description:
        "返回当前渲染的节点 rect/type/text 与 blocking/advisory 警告（off_canvas/overflow/contrast）。" +
        "可选 ids 过滤、format=json|text。根节点/画布框不做 off_canvas 误报。",
      inputSchema: {
        type: "object",
        properties: {
          renderId: { type: "string", description: "可选：必须匹配最近一次 render_card" },
          ids: { type: "array", items: { type: "string" }, description: "可选：只看这些节点 id" },
          format: { type: "string", enum: ["json", "text"], description: "缺省 json" },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute(input) {
        try {
          const result = current(typeof input.renderId === "string" ? input.renderId : undefined);
          const ids = Array.isArray(input.ids) ? input.ids.map(String) : undefined;
          const inspected = inspectCanvas(result, { ids, format: input.format === "text" ? "text" : "json" });
          for (const fn of inspectListeners) fn(inspected.warnings ?? []);
          if (input.format === "text") return { ok: true, text: inspectToText(inspected) };
          return { ok: true, ...inspected };
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "export_svg",
      title: "导出 SVG",
      description:
        "返回当前渲染的自包含 SVG（图片 data URL、文字默认 path、无外部 href）。inlinePaths 为 A3b 可选增强，v1 未实现时显式返回 ok:false。",
      inputSchema: {
        type: "object",
        properties: {
          renderId: { type: "string", description: "可选：必须匹配最近一次 render_card" },
          inlinePaths: { type: "boolean", description: "可选：把嵌套 SVG image 后处理回 path（v1 未实现）" },
        },
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        try {
          const result = current(typeof input.renderId === "string" ? input.renderId : undefined);
          if (input.inlinePaths === true) {
            return err("inlinePaths 未实现（v1 可选增强 A3b）；请用默认嵌套 SVG image");
          }
          const bytes = new TextEncoder().encode(result.svg).length;
          if (bytes > 256 * 1024) {
            return err(`SVG 超过 256KB 预算（${bytes} bytes）`);
          }
          return { ok: true, svg: result.svg, bytes };
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "export_canvas_png",
      title: "导出 PNG",
      description:
        "把当前渲染栅格化为单张 PNG 并触发浏览器下载（缺省 canvas-export.png）。可选 scale(≤4)/background/filename。" +
        "返回文件名/尺寸/字节数；不返回 base64。",
      inputSchema: {
        type: "object",
        properties: {
          renderId: { type: "string", description: "可选：必须匹配最近一次 render_card" },
          scale: { type: "number", description: "可选：1–4，缺省 1" },
          background: { type: "string", description: "可选：CSS 颜色；缺省透明" },
          filename: { type: "string", description: "可选：下载文件名（缺省 canvas-export.png）" },
        },
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        try {
          const result = current(typeof input.renderId === "string" ? input.renderId : undefined);
          const scale = typeof input.scale === "number" ? input.scale : 1;
          const png = await svgToPng(result.svg, result.spec, {
            scale,
            background: typeof input.background === "string" ? input.background : undefined,
          });
          const filename = safeFilename(
            typeof input.filename === "string" ? input.filename : undefined,
            "canvas-export.png",
            ".png",
          );
          downloadBlob(new Blob([png.bytes], { type: "image/png" }), filename);
          return { ok: true, filename, width: png.width, height: png.height, bytes: png.bytes.length };
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "list_fonts",
      title: "列出内置字体",
      description: "返回内置字体摘要（family/weights/license），不返回字体字节。",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      async execute() {
        return { ok: true, fonts: FONTS };
      },
    },
    {
      name: "list_recipes",
      title: "列出配方",
      description: "返回内置配方摘要（id/name/tags/ratio/requires），不返回完整 spec。",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      async execute() {
        return { ok: true, recipes: listRecipes().map(({ spec: _spec, ...rest }) => rest) };
      },
    },
    {
      name: "get_recipe",
      title: "读取配方",
      description: "按 id 返回完整 recipe（含可直接渲染的 spec）；可用 render_card 渲染或覆盖文案/素材。",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", description: "recipe id（见 list_recipes）" } },
        required: ["id"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      async execute(input) {
        const id = String(input.id ?? "");
        const recipe = getRecipe(id);
        if (!recipe) return err(`recipe 不存在：${id}`);
        return { ok: true, ...recipe };
      },
    },
    {
      name: "list_assets",
      title: "列出素材",
      description: "返回内置/已导入素材摘要（id/type/name/tags/style/license/dimensions），不返回 dataUrl。",
      inputSchema: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["background", "shape", "font"], description: "可选类型" },
          style: { type: "string", description: "可选风格" },
          q: { type: "string", description: "可选关键词" },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      async execute(input) {
        const type = input.type === "background" || input.type === "shape" || input.type === "font" ? (input.type as AssetType) : undefined;
        const assets = listAssets({
          type,
          style: typeof input.style === "string" ? input.style : undefined,
          q: typeof input.q === "string" ? input.q : undefined,
        });
        return { ok: true, assets: assets.map(assetSummary) };
      },
    },
    {
      name: "get_asset",
      title: "读取素材",
      description:
        "按 id 返回素材；默认返回 dataUrl/fontUrl 供 spec 使用。summaryOnly=true 时只返回摘要。" +
        "spec 里可用 img.src=\"asset:<id>\" 引用素材，避免把大段 dataUrl 塞进对话。",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "素材 id" },
          summaryOnly: { type: "boolean", description: "只返回摘要" },
        },
        required: ["id"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute(input) {
        const id = String(input.id ?? "");
        const asset = getAsset(id);
        if (!asset) return err(`素材不存在：${id}`);
        return { ok: true, asset: input.summaryOnly === true ? assetSummary(asset) : asset };
      },
    },
    {
      name: "import_asset",
      title: "导入素材",
      description:
        "导入外部图片/SVG/字体：校验 https/私网/CORS/MIME；图片按 maxWidth/maxHeight 压缩；SVG 清洗脚本/事件/外部 url()；字体只解析不转存。" +
        "返回 assetId 与摘要；spec 里用 img.src=\"asset:<id>\" 引用。",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "素材 URL" },
          type: { type: "string", enum: ["image", "svg", "font"], description: "素材类型" },
          name: { type: "string", description: "可选显示名" },
          maxWidth: { type: "number", description: "图片最大宽（缺省 1600）" },
          maxHeight: { type: "number", description: "图片最大高（缺省 1600）" },
        },
        required: ["url", "type"],
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        try {
          const url = String(input.url ?? "");
          const type = input.type;
          if (!url) return err("url 必填");
          if (type !== "image" && type !== "svg" && type !== "font") {
            return err("type 必须是 image/svg/font");
          }
          const asset = await importAsset({
            url,
            type,
            name: typeof input.name === "string" ? input.name : undefined,
            maxWidth: typeof input.maxWidth === "number" ? input.maxWidth : undefined,
            maxHeight: typeof input.maxHeight === "number" ? input.maxHeight : undefined,
          });
          return { ok: true, assetId: asset.id, asset: assetSummary(asset) };
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "list_styles",
      title: "列出风格",
      description: "返回风格 → 字体/标签的摘要映射。",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      async execute() {
        return { ok: true, styles: STYLES };
      },
    },
    {
      name: "font_info",
      title: "字体信息",
      description:
        "解析字体 URL（TTF/OTF/WOFF/WOFF2），返回 family/weight/glyph 数/unitsPerEm/axes/字符集大小/颜色字形/来源。" +
        "字体 URL 只允许 https（本地 dev 允许 localhost）；CORS 失败会返回上传素材库建议。",
      inputSchema: {
        type: "object",
        properties: { url: { type: "string", description: "字体文件 URL" } },
        required: ["url"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute(input) {
        try {
          const url = String(input.url ?? "");
          if (!url) return err("url 必填");
          const info = await fontInfo(url);
          return { ok: true, ...info };
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "text_to_svg",
      title: "文本转 SVG path",
      description:
        "用指定字体把文本转成 SVG path（fontkit 排版/换行/字距）。返回 svg、可直接放进 Canvas spec 的 node（type=svg）、行盒与警告。" +
        "适合 Satori 不支持的字体、变量字体、彩色字体、逐字特效或标题/logo。",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "字体文件 URL" },
          text: { type: "string", description: "文本（支持真实换行）" },
          fontSize: { type: "number", description: "字号 px（缺省 64）" },
          lineHeight: { type: "number", description: "行高倍数（缺省 1.5）" },
          maxWidth: { type: "number", description: "可选最大行宽 px" },
          align: { type: "string", enum: ["left", "center", "right"], description: "对齐（缺省 left）" },
          letterSpacing: { type: "number", description: "字距 px（缺省 0）" },
          fill: { type: "string", description: "填充色（缺省 #ffffff）" },
          stroke: { type: "string", description: "可选描边色" },
          strokeWidth: { type: "number", description: "描边宽度（缺省 1）" },
          features: { type: "array", items: { type: "string" }, description: "OpenType features（如 liga/kern）" },
          axes: { type: "object", description: "变量字体轴（如 {wght:700}）" },
        },
        required: ["url", "text", "fontSize"],
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        try {
          const url = String(input.url ?? "");
          const text = String(input.text ?? "");
          const fontSize = typeof input.fontSize === "number" ? input.fontSize : 64;
          if (!url) return err("url 必填");
          const result = await textToSvg({
            url,
            text,
            fontSize,
            lineHeight: typeof input.lineHeight === "number" ? input.lineHeight : undefined,
            maxWidth: typeof input.maxWidth === "number" ? input.maxWidth : undefined,
            align: input.align === "center" || input.align === "right" ? input.align : "left",
            letterSpacing: typeof input.letterSpacing === "number" ? input.letterSpacing : undefined,
            fill: typeof input.fill === "string" ? input.fill : undefined,
            stroke: typeof input.stroke === "string" ? input.stroke : undefined,
            strokeWidth: typeof input.strokeWidth === "number" ? input.strokeWidth : undefined,
            features: Array.isArray(input.features) ? input.features.map(String) : undefined,
            axes:
              input.axes && typeof input.axes === "object"
                ? (input.axes as Record<string, number>)
                : undefined,
          });
          return { ok: true, ...result };
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "font_glyphs",
      title: "字体字形 path",
      description: "返回指定字符的单字形 path/advance/bbox（icon font、装饰字形、印章）。",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "字体文件 URL" },
          chars: { type: "string", description: "要取字形的字符（建议 ≤64 个）" },
        },
        required: ["url", "chars"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute(input) {
        try {
          const url = String(input.url ?? "");
          const chars = String(input.chars ?? "");
          if (!url || !chars) return err("url 与 chars 必填");
          const result = await fontGlyphs(url, Array.from(chars).slice(0, 64).join(""));
          return { ok: true, ...result };
        } catch (e) {
          return fail(e);
        }
      },
    },
  ];
}

let started = false;

export function registerAppTools(): Promise<unknown> {
  if (started) return Promise.resolve(null);
  started = true;
  return registerWebMCPTools(buildTools()).then((r) => {
    if (!r.supported) return r;
    if (r.failures.length) console.warn("[canvas] WebMCP 注册失败项:", r.failures);
    return r;
  });
}
