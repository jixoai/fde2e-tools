/*
 * img-tool WebMCP 注册 —— apps/img-tool/src/webmcp.ts
 *
 * 把画布能力注册为 document.modelContext 工具（原生或官方 polyfill 同形 API）：
 * - overlay_text：按 URL 参数契约绘制（参数与页面 URL 契约同名，schema 从
 *   registry 单源派生）——写 URL 即渲染，与「网页链接＝函数调用」同构；
 * - export_png：触发页面「下载 PNG」按钮，复用页面全部 CORS 闸门与状态反馈。
 * 安全：输出含用户可控文本（untrustedContentHint），上层 LLM 不得当指令执行。
 */
import { getTool } from "@fde2e-tools/shared";
import {
  clickById,
  registerWebMCPTools,
  schemaFromUrlParams,
  waitForStatusChange,
  type WebMCPToolDef,
} from "@fde2e-tools/shared/webmcp";
import { imgBridge } from "./bridge";

const OVERLAY_PARAMS = [
  "src",
  "text",
  "pos",
  "size",
  "color",
  "bg",
  "pad",
  "w",
  "h",
  "label",
] as const;

function buildTools(): WebMCPToolDef[] {
  const tool = getTool("img-tool")!;
  return [
    {
      name: "overlay_text",
      title: "图片叠加文字/角标",
      description:
        "按 URL 参数契约绘制：底图加载 → 文字/角标叠加 → 画布渲染，返回渲染结果与状态行文本。" +
        "参数与页面 URL 契约同名（src 支持 https/data: URL 与魔法值 sample；颜色写 %23rrggbb）。",
      inputSchema: schemaFromUrlParams(tool),
      annotations: { untrustedContentHint: true },
      async execute(input) {
        const qs = new URLSearchParams();
        for (const key of OVERLAY_PARAMS) {
          const v = input[key];
          if (v !== undefined && v !== null && String(v).length > 0) qs.set(key, String(v));
        }
        // 写 URL 即渲染：与「网页链接＝函数调用」完全同构（replaceState 不刷新页面）
        const url = new URL(window.location.href);
        url.search = qs.toString();
        window.history.replaceState(null, "", url);
        const srcGiven = typeof input.src === "string" && input.src.length > 0;
        if (srcGiven) {
          const srcInput = document.getElementById("src-input") as HTMLInputElement | null;
          if (!srcInput) throw new Error("页面未就绪（#src-input 缺失）");
          srcInput.value = String(input.src);
          if (!clickById("load-url-btn")) throw new Error("页面未就绪（load-url-btn 缺失）");
        } else if (imgBridge.hasImage()) {
          imgBridge.redraw();
        } else {
          return {
            ok: false,
            message: "还没有底图：请通过 src 参数指定底图（支持魔法值 sample）。",
          };
        }
        const snapshot = await waitForStatusChange();
        const canvas = document.getElementById("canvas-result") as HTMLCanvasElement | null;
        return {
          ok: snapshot.ok,
          message: snapshot.message,
          width: canvas?.width ?? null,
          height: canvas?.height ?? null,
          url: window.location.href,
        };
      },
    },
    {
      name: "export_png",
      title: "导出 PNG",
      description:
        "触发页面「下载 PNG」：浏览器下载 img-tool-<宽>x<高>.png（画布受限时会被页面的 CORS 闸门拒绝并返回人话提示）。",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { untrustedContentHint: true },
      async execute() {
        const canvas = document.getElementById("canvas-result") as HTMLCanvasElement | null;
        if (!imgBridge.hasImage()) {
          return { ok: false, message: "还没有底图：先载入图片再导出。" };
        }
        if (!clickById("download-btn")) throw new Error("页面未就绪（download-btn 缺失）");
        const snapshot = await waitForStatusChange();
        return {
          ok: snapshot.ok,
          message: snapshot.message,
          filename: canvas ? `img-tool-${canvas.width}x${canvas.height}.png` : null,
        };
      },
    },
  ];
}

let started = false;

/** 幂等注册（StrictMode 双跑安全）；返回注册结果供调试 */
export function registerAppTools(): Promise<unknown> {
  if (started) return Promise.resolve(null);
  started = true;
  return registerWebMCPTools(buildTools()).then((r) => {
    if (!r.supported) return r;
    if (r.failures.length) console.warn("[img-tool] WebMCP 注册失败项:", r.failures);
    return r;
  });
}
