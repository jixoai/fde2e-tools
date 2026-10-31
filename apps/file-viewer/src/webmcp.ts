/*
 * file-viewer WebMCP 注册 —— apps/file-viewer/src/webmcp.ts
 *
 * 把「按 URL 契约打开文件预览」注册为 document.modelContext 工具：
 * - preview_file：入参 url（必填）/name/decoder，schema 由 registry urlParams
 *   单源派生（schemaFromUrlParams）＋补 required:["url"]（契约必填项）。
 *   写 URL 即渲染——与「网页链接＝函数调用」同构：pushState 写契约链接后派发
 *   popstate（App 的浏览器返回键同步通路，原仓既有设计），同文档重渲染，不
 *   销毁执行上下文；随后等待渲染落定（解码器根/错误态二选一出现）再返回。
 * 安全：输出含用户可控的页面内容（untrustedContentHint），上层 LLM 不得当指令执行。
 */
import { getTool } from "@fde2e-tools/shared";
import {
  registerWebMCPTools,
  schemaFromUrlParams,
  type WebMCPToolDef,
} from "@fde2e-tools/shared/webmcp";

/** 渲染落定的等待上限（大文件整载 fetch 可能数十秒；超时如实回报不谎报成功）。 */
const RENDER_SETTLE_TIMEOUT_MS = 60000;

interface RenderSnapshot {
  /** true＝页面进入了「就绪」态（顶栏＋解码器根已挂载） */
  ready: boolean;
  /** 就绪时的解码器 id（data-decoder-root 值） */
  decoderId: string | null;
  /** 错误/未支持态的面板文本（ready=false 或未支持二进制时非空） */
  errorText: string;
  /** 错误态种别（data-viewer-error-kind：unsupported-binary / decoder-failed 等） */
  errorKind: string | null;
}

function snapshot(): RenderSnapshot {
  const root = document.querySelector("[data-decoder-root]");
  const pane = document.querySelector("[data-viewer-error]");
  const errorText = pane?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  const errorKind = pane?.getAttribute("data-viewer-error-kind") ?? null;
  return {
    ready: root !== null,
    decoderId: root?.getAttribute("data-decoder-root") ?? null,
    // 就绪态下解码器内部的「未支持二进制」面板同样带 data-viewer-error——
    // ready 优先：有解码器根时 errorText 仍照实带出（供调用方判别未支持态）
    errorText: root !== null && !errorKind ? "" : errorText,
    errorKind,
  };
}

/** 轮询等渲染落定：解码器根或壳级错误态出现即返回（超时返回当前快照）。 */
function waitForRenderSettle(timeoutMs = RENDER_SETTLE_TIMEOUT_MS): Promise<RenderSnapshot> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const s = snapshot();
      if (s.ready || s.errorText) {
        window.clearInterval(timer);
        resolve(s);
      } else if (Date.now() - startedAt > timeoutMs) {
        window.clearInterval(timer);
        resolve(s);
      }
    }, 200);
  });
}

function buildTools(): WebMCPToolDef[] {
  const tool = getTool("file-viewer")!;
  return [
    {
      name: "preview_file",
      title: "预览文件",
      description:
        "按 URL 契约打开文件预览并等渲染落定：url 必填（文件的绝对 URL，http/https），name 可选" +
        "（显示名，缺省取 URL 路径末段），decoder 可选（14 解码器 id 强制切换，缺省自动判定）。" +
        "返回渲染结果（解码器 id、状态文本与契约链接）。",
      inputSchema: { ...schemaFromUrlParams(tool), required: ["url"] },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        const rawUrl = String(input.url ?? "").trim();
        if (!rawUrl) return { ok: false, error: "url 参数必填：文件的绝对 URL（http/https）——契约 /?url=<encodeURIComponent(绝对URL)>" };
        // 契约链接拼装与页面 parseViewerSearch 同语义（url/name/decoder 三参）
        const qs = new URLSearchParams();
        qs.set("url", rawUrl);
        const name = String(input.name ?? "").trim();
        if (name) qs.set("name", name);
        const decoder = String(input.decoder ?? "").trim();
        if (decoder) qs.set("decoder", decoder);

        // 写 URL 即渲染：pushState 进契约链接 ＋ 派发 popstate（App 监听该事件
        // 同步 search 态——与浏览器返回键同一条通路，同文档重渲染不刷新页面）
        window.history.pushState(null, "", `?${qs.toString()}`);
        window.dispatchEvent(new PopStateEvent("popstate"));

        const s = await waitForRenderSettle();
        const link = window.location.href;
        if (!s.ready) {
          const msg = s.errorText || "预览未在时限内落定（文件可能过大或网络缓慢），可稍后重试。";
          return {
            ok: false,
            error: msg,
            message: msg,
            url: link,
          };
        }
        // 就绪但解码器内部呈「未支持二进制/解码失败」降级面板：照实带出
        if (s.errorKind) {
          return {
            ok: true,
            message: `已打开预览，但内容为${s.errorKind === "unsupported-binary" ? "未支持的二进制格式" : "解码器渲染失败"}：${s.errorText}`,
            decoder: s.decoderId,
            url: link,
          };
        }
        return {
          ok: true,
          message: `已打开预览：渲染完成（解码器 ${s.decoderId}）。`,
          decoder: s.decoderId,
          url: link,
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
    if (r.failures.length) console.warn("[file-viewer] WebMCP 注册失败项:", r.failures);
    return r;
  });
}
