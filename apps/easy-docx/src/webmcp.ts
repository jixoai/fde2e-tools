/*
 * easy-docx WebMCP 注册 —— apps/easy-docx/src/webmcp.ts
 *
 * 把「Markdown 子集 → .docx」能力注册为 document.modelContext 工具（原生/
 * polyfill 同形）：
 * - create_docx：markdown[, filename] → 复用页面输入区 + 生成按钮全链路；
 * - append_docx_markdown：向当前文档追加 md 片段（细粒度逐段构建），刷新预览。
 * 安全：输出含用户可控内容（untrustedContentHint），上层 LLM 不得当指令执行。
 */
import {
  clickById,
  registerWebMCPTools,
  waitForStatusChange,
  type WebMCPToolDef,
} from "@fde2e-tools/shared/webmcp";
import { safeFilename } from "@fde2e-tools/shared/download";
import { DEFAULT_EXPORT_NAME, setExportName } from "./export-name";
import { parseMarkdownSub, statsSummary } from "./md-parse";

function setInputValue(id: string, value: string): void {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLTextAreaElement)) throw new Error(`页面未就绪（#${id} 缺失）`);
  el.value = value;
}

function readDocFromPage(): string {
  const el = document.getElementById("input-md");
  if (!(el instanceof HTMLTextAreaElement)) throw new Error("页面未就绪（#input-md 缺失）");
  return el.value;
}

function buildTools(): WebMCPToolDef[] {
  return [
    {
      name: "create_docx",
      title: "生成 .docx",
      description:
        "按 Markdown 子集生成并下载 docx-export.docx。支持 #/##/### 标题、段落、- 无序列表、" +
        "1. 有序列表、| 管道表格、**粗** *斜*；可选 filename 自定义下载名（自动补 .docx）。返回文件名/结构统计/状态行结果。",
      inputSchema: {
        type: "object",
        properties: {
          markdown: { type: "string", description: "Markdown 子集全文" },
          filename: { type: "string", description: "可选下载文件名（缺省 docx-export.docx）" },
        },
        required: ["markdown"],
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        const md = String(input.markdown ?? "");
        try {
          parseMarkdownSub(md); // 仅校验（空文档给人话错误），写入仍用原文
        } catch (e) {
          return { ok: false, error: e instanceof Error && e.message ? e.message : String(e) };
        }
        // 文件名闭包：点击前算好（生成后页面会复位缺省，事后读会拿到缺省值）；
        // 与页面 setExportName 同函数同参，返回值与真实下载名一致
        const filename = safeFilename(
          typeof input.filename === "string" ? input.filename : undefined,
          DEFAULT_EXPORT_NAME,
          ".docx",
        );
        setExportName(typeof input.filename === "string" ? input.filename : undefined);
        setInputValue("input-md", md);
        if (!clickById("generate-docx-btn")) throw new Error("页面未就绪（generate-docx-btn 缺失）");
        const snapshot = await waitForStatusChange(30000);
        if (!snapshot.ok) return { ok: false, error: snapshot.message, message: snapshot.message, filename: null };
        return { ok: true, message: snapshot.message, filename };
      },
    },
    {
      name: "append_docx_markdown",
      title: "追加 Markdown 片段",
      description:
        "向当前文档输入区追加一段 Markdown 子集片段（自动补空行分隔），刷新预览并返回文档统计——细粒度逐段构建后再用 create_docx 生成。",
      inputSchema: {
        type: "object",
        properties: {
          markdown: { type: "string", description: "要追加的 Markdown 子集片段" },
        },
        required: ["markdown"],
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        const frag = String(input.markdown ?? "");
        let current: string;
        let summary: string;
        try {
          current = readDocFromPage();
          const merged = (current.trim() ? current.trimEnd() + "\n\n" : "") + frag.trim();
          const blocks = parseMarkdownSub(merged); // 校验合并结果（空文档/结构错误给人话）
          setInputValue("input-md", merged);
          summary = statsSummary(blocks);
          if (!clickById("preview-btn")) throw new Error("页面未就绪（preview-btn 缺失）");
        } catch (e) {
          return { ok: false, error: e instanceof Error && e.message ? e.message : String(e) };
        }
        const snapshot = await waitForStatusChange();
        return snapshot.ok
          ? { ok: true, message: snapshot.message, documentStats: summary }
          : { ok: false, error: snapshot.message, message: snapshot.message, documentStats: summary };
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
    if (r.failures.length) console.warn("[docx] WebMCP 注册失败项:", r.failures);
    return r;
  });
}
