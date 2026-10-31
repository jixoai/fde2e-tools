/*
 * TipTap 编辑器主机 —— apps/docx/src/editor.ts
 *
 * 职责：dynamic import TipTap（core/starter-kit/table ≈150KB gzip 级独立 chunk，
 * 体积纪律）→ 在文档页容器上建编辑器（单例，StrictMode 双跑安全）→ 就绪标记。
 * 真相源＝TipTap JSON（getJSON）；AI 经 WebMCP 命令驱动（与内核直调，无 DOM 桥）。
 */
import { markdownToDoc } from "./md-lite";

/* ---------- TipTap Editor 的结构化最小面（类型留在 chunk 内不进主包） ---------- */

export interface FacadeEditor {
  commands: {
    setContent(content: unknown, emitUpdate?: boolean): boolean;
    insertContentAt(position: number | "end", value: unknown): boolean;
    focus(position?: string | number): boolean;
    toggleBold(): boolean;
    toggleItalic(): boolean;
    toggleHeading(level: 1 | 2 | 3): boolean;
    toggleBulletList(): boolean;
    toggleOrderedList(): boolean;
    toggleBlockquote(): boolean;
    toggleCodeBlock(): boolean;
    insertTable(opts: { rows: number; cols: number; withHeaderRow?: boolean }): boolean;
    undo(): boolean;
    redo(): boolean;
  };
  getJSON(): { type: string; content?: unknown[] };
  getHTML(): string;
  getText(opts?: Record<string, unknown>): string;
  isEmpty: boolean;
  /** ProseMirror 文档末位光标点（insertContentAt 追加用） */
  state: { doc: { content: { size: number } } };
}

export type StatusSink = (msg: string, kind: "ok" | "error" | "warn") => void;

let editorPromise: Promise<FacadeEditor> | null = null;
let editor: FacadeEditor | null = null;

/** 示例文档（首载与 ?sample= 共用；md 子集单源解析） */
export function sampleMarkdown(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `# FDE2E 专业文档编辑器

这是一份**示例文档**，用来展示编辑器与导出桥的能力边界（*斜体*与 \`代码\` 也支持）。

## 一、能力清单

- WYSIWYG 富文本编辑（标题/段落/列表/表格/粗斜体）
- TipTap JSON → docx 库导出真 .docx（MIT 桥，本机完成）
- mammoth 导入 .docx 继续编辑（双向桥）
- WebMCP 语义算子：set_content / append_markdown / insert_table / insert_heading

## 二、季度数据

| 指标 | Q3 | 环比 |
| --- | --- | --- |
| 营收 | 1.2 亿 | +42% |
| 新客户 | 1,280 家 | +17% |

## 三、备注

1. 导出文件名契约：docx-export.docx
2. 示例载入日期：${today}
3. AI 可经 WebMCP 全程驱动，无需触碰页面控件。`;
}

/** 启动编辑器（单例）；onReady 在编辑器可交互时回调 */
export function bootEditor(container: HTMLElement, onStatus: StatusSink): Promise<FacadeEditor> {
  if (editorPromise) return editorPromise;
  editorPromise = (async () => {
    onStatus("正在加载编辑器内核（TipTap）…", "ok");
    const mod = await import("./tiptap-boot");
    editor = await mod.mountTiptap(container, markdownToDoc(sampleMarkdown()));
    onStatus("编辑器就绪：可直接编辑，AI 可经 WebMCP 语义算子驱动。", "ok");
    return editor;
  })();
  return editorPromise;
}

export function getEditor(): FacadeEditor | null {
  return editor;
}

/** 工具统一入口：等就绪（TipTap 快，2s 上限兜底）后执行；超时显式 ok:false */
export async function withEditor<T>(fn: (ed: FacadeEditor) => Promise<T> | T): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  const deadline = Date.now() + 15000;
  for (;;) {
    if (editor) break;
    if (Date.now() > deadline) return { ok: false, error: "编辑器尚未就绪（内核加载中），写命令已拒绝——请稍后重试" };
    await new Promise((r) => setTimeout(r, 100));
  }
  try {
    return { ok: true, value: await fn(editor) };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.message ? e.message : String(e) };
  }
}

/** 编辑器状态核验（绿门「WebMCP 写入→编辑器状态核验」用） */
export function editorState(): { ready: boolean; chars: number; text: string } {
  if (!editor) return { ready: false, chars: 0, text: "" };
  const text = editor.getText();
  return { ready: true, chars: text.length, text };
}

/** sample 重载（页面按钮与 ?sample= 共用） */
export function loadSampleDoc(onStatus: StatusSink): boolean {
  if (!editor) return false;
  editor.commands.setContent(markdownToDoc(sampleMarkdown()));
  onStatus("示例文档已载入：可直接编辑，或点「导出 .docx」下载。", "ok");
  return true;
}
