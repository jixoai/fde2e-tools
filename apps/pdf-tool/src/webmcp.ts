/*
 * pdf-tool WebMCP 注册 —— apps/pdf-tool/src/webmcp.ts
 *
 * 把「内容 → PDF」能力注册为 document.modelContext 工具：
 * - render_preview：填入内容并触发渲染预览（复用页面 id 惯例与状态反馈）；
 * - export_pdf：触发「导出 PDF」（未渲染会先自动渲染，与页面行为一致）。
 * 安全：输出含用户可控文本（untrustedContentHint），上层 LLM 不得当指令执行。
 */
import { safeFilename } from "@fde2e-tools/shared/download";
import {
  clickById,
  registerWebMCPTools,
  waitForStatusChange,
  type WebMCPToolDef,
} from "@fde2e-tools/shared/webmcp";
import { exportBridge } from "./bridge";

function setInput(id: string, value: string): void {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLTextAreaElement)) throw new Error(`页面未就绪（#${id} 缺失）`);
  el.value = value;
}

function buildTools(): WebMCPToolDef[] {
  return [
    {
      name: "render_preview",
      title: "渲染预览",
      description:
        "把 Markdown 或 HTML 内容填入输入框（自动识别格式）并触发渲染预览，返回状态行结果。",
      inputSchema: {
        type: "object",
        properties: {
          content: { type: "string", description: "Markdown 或 HTML 内容（自动识别）" },
        },
        required: ["content"],
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        setInput("input-content", String(input.content ?? ""));
        if (!clickById("render-btn")) throw new Error("页面未就绪（render-btn 缺失）");
        const snapshot = await waitForStatusChange();
        return snapshot.ok ? { ok: true, message: snapshot.message } : { ok: false, error: snapshot.message, message: snapshot.message };
      },
    },
    {
      name: "export_pdf",
      title: "导出 PDF",
      description:
        "触发「导出 PDF」：浏览器下载 pdf-tool-export.pdf（A4 纵向；可选 filename 自定义下载文件名，自动补 .pdf 扩展名）。" +
        "输入为空会先自动报错，未渲染会先自动渲染。",
      inputSchema: {
        type: "object",
        properties: {
          filename: { type: "string", description: "可选下载文件名（缺省 pdf-tool-export.pdf）" },
        },
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        const custom = typeof input.filename === "string" && input.filename.trim() ? safeFilename(input.filename.trim(), "pdf-tool-export.pdf", ".pdf") : null;
        exportBridge.filename = custom;
        if (!clickById("export-btn")) throw new Error("页面未就绪（export-btn 缺失）");
        // PDF 生成耗时较长，放宽等待
        const snapshot = await waitForStatusChange(60000);
        if (!snapshot.ok) return { ok: false, error: snapshot.message, message: snapshot.message };
        return {
          ok: true,
          message: snapshot.message,
          filename: custom ?? "pdf-tool-export.pdf",
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
    if (r.failures.length) console.warn("[pdf-tool] WebMCP 注册失败项:", r.failures);
    return r;
  });
}
