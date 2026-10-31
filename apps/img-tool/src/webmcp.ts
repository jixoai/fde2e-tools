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
import { safeFilename } from "@fde2e-tools/shared/download";

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
        "参数与页面 URL 契约同名（src 支持 https/data: URL 与魔法值 sample；" +
        "颜色写裸 #rrggbb 形态——工具层永远用解码后形态；若按 URL 层习惯传了 %23 前缀也会自动纠正一层）。",
      inputSchema: schemaFromUrlParams(tool),
      annotations: { untrustedContentHint: true },
      async execute(input) {
        const qs = new URLSearchParams();
        for (const key of OVERLAY_PARAMS) {
          const v = input[key];
          if (v === undefined || v === null || String(v).length === 0) continue;
          let s = String(v);
          // F23 双重编码兜底：URL 层契约是 %23（地址栏 # 必须编码），但工具层
          // 永远写解码后形态——已发布调用方按旧文档传 %23 开头色值时自动剥一层
          if ((key === "color" || key === "bg") && /^%23/i.test(s)) s = "#" + s.slice(3);
          qs.set(key, s);
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
            error: "还没有底图：请通过 src 参数指定底图（支持魔法值 sample）。",
            message: "还没有底图：请通过 src 参数指定底图（支持魔法值 sample）。",
          };
        }
        const snapshot = await waitForStatusChange();
        const canvas = document.getElementById("canvas-result") as HTMLCanvasElement | null;
        const base: Record<string, unknown> = {
          message: snapshot.message,
          width: canvas?.width ?? null,
          height: canvas?.height ?? null,
          url: window.location.href,
        };
        if (!snapshot.ok) return { ok: false, ...base, error: snapshot.message };
        return { ok: true, ...base };
      },
    },
    {
      name: "export_png",
      title: "导出 PNG",
      description:
        "触发页面「下载 PNG」：浏览器下载 img-tool-<宽>x<高>.png（可选 filename 自定义下载文件名，自动补 .png 扩展名；" +
        "画布受限时会被页面的 CORS 闸门拒绝并返回人话提示）。",
      inputSchema: {
        type: "object",
        properties: {
          filename: { type: "string", description: "可选下载文件名（缺省 img-tool-<宽>x<高>.png）" },
        },
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        const canvas = document.getElementById("canvas-result") as HTMLCanvasElement | null;
        if (!imgBridge.hasImage()) {
          return { ok: false, error: "还没有底图：先载入图片再导出。", message: "还没有底图：先载入图片再导出。" };
        }
        const custom = typeof input.filename === "string" && input.filename.trim() ? safeFilename(input.filename.trim(), "img-tool-export.png", ".png") : null;
        imgBridge.downloadName = custom;
        if (!clickById("download-btn")) throw new Error("页面未就绪（download-btn 缺失）");
        const snapshot = await waitForStatusChange();
        const base: Record<string, unknown> = { message: snapshot.message };
        if (!snapshot.ok) return { ok: false, ...base, error: snapshot.message };
        return {
          ok: true,
          ...base,
          filename: custom ?? (canvas ? `img-tool-${canvas.width}x${canvas.height}.png` : null),
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
