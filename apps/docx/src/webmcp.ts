/*
 * docx 编辑器 WebMCP 注册 —— apps/docx/src/webmcp.ts
 *
 * 工具直接调用编辑器内核（TipTap commands + getJSON），不经页面 DOM 桥：
 * - set_content：整篇替换（format=html|markdown|json）；
 * - append_markdown / insert_heading / insert_table：文末语义追加；
 * - export_docx / import_docx：真 .docx 双向桥（docx@9 / mammoth）。
 * 编辑器未就绪一律显式 ok:false（禁静默失败）；输出含用户可控内容
 * （untrustedContentHint 纪律）。
 */
import { downloadBlob } from "@fde2e-tools/shared/download";
import { registerWebMCPTools, type WebMCPToolDef } from "@fde2e-tools/shared/webmcp";
import { editorState, getEditor, withEditor, type FacadeEditor } from "./editor";
import { docxBytesToHtml, docJsonToDocxBytes } from "./docx-bridge";
import { exportDocLongPng, exportDocPdf } from "./export";
import { resolveExportName } from "./export-name";
import { docStats, markdownToNodes, type TiptapNode } from "./md-lite";

const DOC_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/* ---------- 基础助手 ---------- */

function statsOf(ed: FacadeEditor): Record<string, unknown> {
  const st = docStats(ed.getJSON() as never);
  const chars = ed.getText().length;
  return { ...st, chars };
}

/** 文末插入（节点数组）；state.doc.content.size 是文档末位光标点 */
function appendNodes(ed: FacadeEditor, nodes: TiptapNode[]): boolean {
  return ed.commands.insertContentAt(ed.state.doc.content.size, nodes);
}

/* ---------- 工具面 ---------- */

function buildTools(): WebMCPToolDef[] {
  return [
    {
      name: "set_content",
      title: "整篇替换文档",
      description:
        "整篇替换文档内容。format=html（缺省，语义 HTML：h1-h3/p/ul/ol/table/strong/em）| markdown（子集：#/##/###、- 列表、1. 列表、| 表格、**粗** *斜* `代码`、> 引用）| json（TipTap JSON）。返回文档统计（标题/段落/列表/表格/字符数）。",
      inputSchema: {
        type: "object",
        properties: {
          content: { type: "string", description: "文档内容（按 format 解析）" },
          format: { type: "string", enum: ["html", "markdown", "json"], description: "缺省 html" },
        },
        required: ["content"],
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        const content = String(input.content ?? "");
        if (!content.trim()) return { ok: false, error: "content 为空——请提供文档内容，或用 loadSample 按钮载入示例" };
        const format = input.format === "markdown" || input.format === "json" ? input.format : "html";
        const res = await withEditor((ed) => {
          if (format === "markdown") {
            ed.commands.setContent({ type: "doc", content: markdownToNodes(content) });
          } else if (format === "json") {
            let doc: unknown;
            try {
              doc = JSON.parse(content);
            } catch {
              throw new Error("format=json 时 content 必须是合法 JSON（TipTap 文档形如 {type:\"doc\",content:[…]}）");
            }
            const d = doc as { type?: string };
            if (d?.type !== "doc") throw new Error('TipTap JSON 顶层必须是 {"type":"doc",…}');
            ed.commands.setContent(doc);
          } else {
            ed.commands.setContent(content);
          }
          return statsOf(ed);
        });
        return res.ok ? { ok: true, format, ...(res.value as Record<string, unknown>) } : res;
      },
    },
    {
      name: "append_markdown",
      title: "追加 Markdown",
      description:
        "向文末追加 Markdown 子集（#/##/### 标题、- 列表、1. 列表、| 表格、**粗** *斜* `代码`、> 引用）——细粒度逐段构建文档。返回追加后统计。",
      inputSchema: {
        type: "object",
        properties: {
          markdown: { type: "string", description: "Markdown 子集片段" },
        },
        required: ["markdown"],
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        const md = String(input.markdown ?? "");
        if (!md.trim()) return { ok: false, error: "markdown 为空" };
        const res = await withEditor((ed) => {
          const ok = appendNodes(ed, markdownToNodes(md));
          if (!ok) throw new Error("插入失败（编辑器拒绝该片段）");
          return statsOf(ed);
        });
        return res.ok ? { ok: true, ...(res.value as Record<string, unknown>) } : res;
      },
    },
    {
      name: "insert_heading",
      title: "插入标题",
      description: "在文末插入标题（text + level 1-3，缺省 2）。返回追加后统计。",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "标题文本" },
          level: { type: "number", enum: [1, 2, 3], description: "标题级别（缺省 2）" },
        },
        required: ["text"],
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        const text = String(input.text ?? "").trim();
        if (!text) return { ok: false, error: "text 为空" };
        const level = (input.level === 1 || input.level === 3 ? input.level : 2) as 1 | 2 | 3;
        const res = await withEditor((ed) => {
          const ok = ed.commands.insertContentAt(ed.state.doc.content.size, {
            type: "heading",
            attrs: { level },
            content: [{ type: "text", text }],
          });
          if (!ok) throw new Error("插入失败（编辑器拒绝该节点）");
          return { heading: { text, level }, ...statsOf(ed) };
        });
        return res.ok ? { ok: true, ...(res.value as Record<string, unknown>) } : res;
      },
    },
    {
      name: "insert_table",
      title: "插入表格",
      description:
        "在文末插入表格：rows×cols（≥1），header（缺省 true）＝首行表头样式；data 是按行分组的一维字符串数组（data[row*cols+col]，可省略＝空表）。返回追加后统计。",
      inputSchema: {
        type: "object",
        properties: {
          rows: { type: "number", description: "行数（含表头行，≥1）" },
          cols: { type: "number", description: "列数（≥1）" },
          header: { type: "boolean", description: "首行是否表头（缺省 true）" },
          data: { type: "array", description: "按行分组的单元格文本（一维，长度 rows*cols，行优先；可省略）", items: { type: "string" } },
        },
        required: ["rows", "cols"],
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        const rows = Math.floor(Number(input.rows));
        const cols = Math.floor(Number(input.cols));
        if (!(rows >= 1 && rows <= 200) || !(cols >= 1 && cols <= 30)) {
          return { ok: false, error: "rows/cols 需在 1~200 / 1~30 内" };
        }
        const header = input.header !== false;
        const data = Array.isArray(input.data) ? (input.data as unknown[]).map((c) => (c === null || c === undefined ? "" : String(c))) : [];
        const res = await withEditor((ed) => {
          const cell = (text: string): TiptapNode => ({
            type: "paragraph",
            content: text ? [{ type: "text", text }] : undefined,
          });
          const bodyRows: TiptapNode[] = [];
          for (let r = 0; r < rows; r++) {
            const cells: TiptapNode[] = [];
            for (let c = 0; c < cols; c++) {
              const text = data[r * cols + c] ?? "";
              cells.push(text && header && r === 0 ? { type: "tableHeader", content: [cell(text)] } : { type: "tableCell", content: [cell(text)] });
            }
            bodyRows.push({ type: "tableRow", content: cells });
          }
          const ok = ed.commands.insertContentAt(ed.state.doc.content.size, {
            type: "table",
            content: bodyRows,
          });
          if (!ok) throw new Error("插入失败（编辑器拒绝该表格）");
          return { table: { rows, cols, header }, ...statsOf(ed) };
        });
        return res.ok ? { ok: true, ...(res.value as Record<string, unknown>) } : res;
      },
    },
    {
      name: "export_docx",
      title: "导出 .docx",
      description:
        "导出当前文档为真 .docx 下载（docx 库桥：标题/段落/粗斜/列表/表格保留；缺省文件名 docx-export.docx）。返回文件名契约与块数统计。",
      inputSchema: {
        type: "object",
        properties: {
          filename: { type: "string", description: "可选下载文件名（缺省 docx-export.docx）" },
        },
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        const filename = resolveExportName(typeof input.filename === "string" ? input.filename : undefined);
        const res = await withEditor(async (ed) => {
          const { bytes, stats } = await docJsonToDocxBytes(ed.getJSON() as { type: string; content?: TiptapNode[] });
          downloadBlob(new Blob([bytes as unknown as BlobPart], { type: DOC_MIME }), filename);
          return { filename, ...stats };
        });
        return res.ok ? { ok: true, ...(res.value as Record<string, unknown>) } : res;
      },
    },
    {
      name: "import_docx",
      title: "导入 .docx",
      description:
        "导入 .docx 文件（base64 编码）为可编辑文档（mammoth 桥：标题/段落/列表/表格/粗斜语义转换），替换当前文档。返回导入后统计。",
      inputSchema: {
        type: "object",
        properties: {
          base64: { type: "string", description: ".docx 文件内容的 base64 编码" },
          filename: { type: "string", description: "可选：来源文件名（仅用于状态展示）" },
        },
        required: ["base64"],
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        const b64 = String(input.base64 ?? "").replace(/\s+/g, "");
        let bytes: ArrayBuffer;
        try {
          const bin = atob(b64);
          bytes = new Uint8Array(Array.from(bin, (ch) => ch.charCodeAt(0))).buffer;
        } catch {
          return { ok: false, error: "base64 解码失败：请提供 .docx 文件内容的 base64 编码" };
        }
        const res = await withEditor(async (ed) => {
          const html = await docxBytesToHtml(bytes);
          if (!html.trim()) throw new Error("该 .docx 未解析出任何正文内容（可能为空文档或加密文档）");
          ed.commands.setContent(html);
          return { via: "mammoth", ...statsOf(ed) };
        });
        return res.ok ? { ok: true, ...(res.value as Record<string, unknown>) } : res;
      },
    },
    {
      name: "export_pdf",
      title: "导出 PDF",
      description:
        "把整篇文档导出为矢量 PDF 下载（缺省 docx-export.pdf；真实文本层可搜索可复制；" +
        "A4 纵向多页，标题分级/列表缩进/表格边框与表头底色/页脚页码）。" +
        "编辑器未就绪或文档为空时返回 ok:false。返回文件名契约与页数。",
      inputSchema: {
        type: "object",
        properties: {
          filename: { type: "string", description: "可选下载文件名（缺省 docx-export.pdf）" },
        },
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        return await exportDocPdf(typeof input.filename === "string" ? input.filename : undefined);
      },
    },
    {
      name: "export_png",
      title: "导出长图 PNG",
      description:
        "把整篇文档导出为一张长图 PNG 下载（缺省 docx-long.png；超 16384px 会截断并在产物与返回值标注）。",
      inputSchema: {
        type: "object",
        properties: {
          filename: { type: "string", description: "可选下载文件名（缺省 docx-long.png）" },
        },
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        return await exportDocLongPng(typeof input.filename === "string" ? input.filename : undefined);
      },
    },
  ];
}

/* ---------- 测试缝（绿门「编辑器状态核验」专用，非 WebMCP 工具面） ---------- */

interface OfficeTestHooks {
  /** 编辑器是否就绪 */
  isReady: () => boolean;
  /** 当前文档纯文本（状态核验：WebMCP 写入后断言落文） */
  text: () => string;
}

declare global {
  interface Window {
    __officeTest?: OfficeTestHooks;
  }
}

function attachTestHooks(): void {
  window.__officeTest = {
    isReady: () => !!getEditor(),
    text: () => editorState().text,
  };
}

let started = false;

/** 幂等注册（StrictMode 双跑安全）＋测试缝挂载 */
export function registerAppTools(): Promise<unknown> {
  if (started) return Promise.resolve(null);
  started = true;
  attachTestHooks();
  return registerWebMCPTools(buildTools()).then((r) => {
    if (!r.supported) return r;
    if (r.failures.length) console.warn("[docx-editor] WebMCP 注册失败项:", r.failures);
    return r;
  });
}

/** 供 App 的「文件导入」按钮复用（人机同路径）；分块 base64 防大文件爆栈 */
export async function importFromBytes(bytes: ArrayBuffer, name?: string): Promise<{ ok: boolean; error?: string; chars?: number }> {
  const u8 = new Uint8Array(bytes);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    bin += String.fromCharCode(...u8.subarray(i, i + CHUNK));
  }
  const tool = buildTools().find((t) => t.name === "import_docx")!;
  const out = (await tool.execute({ base64: btoa(bin), filename: name }, { signal: new AbortController().signal })) as { ok: boolean; error?: string; chars?: number };
  return out;
}
