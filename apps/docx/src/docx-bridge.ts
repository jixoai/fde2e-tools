/*
 * .docx 双向桥 —— apps/docx/src/docx-bridge.ts
 *
 * TipTap JSON → docx@9（MIT）导出真 .docx；mammoth（BSD-2）导入 .docx →
 * HTML → setContent 逆向。digest 实调路线（/tmp/editor-research 反复验证）：
 * - 导出映射：heading/paragraph/bold/italic/code/bulletList/orderedList/
 *   table/blockquote/codeBlock；orderedList 每 list 一个 numbering 实例（编号
 *   不跨 list 续接）。
 * - 导入：mammoth.convertToHtml → HTML 语义结构（h1-h3/p/ul/ol/table/strong/em）
 *   → editor.commands.setContent(html)。
 * 本模块整块 dynamic import（docx+mammoth 独立 chunk，主包零携带）。
 * 边界：页眉页脚/脚注/目录/图片桥不含（对外承诺「基础文档往返保真」）。
 */
import type { ParagraphChild } from "docx";
import type { TiptapMark, TiptapNode } from "./md-lite";

type DocxModule = typeof import("docx");
type DocxParagraph = InstanceType<DocxModule["Paragraph"]>;
type DocxTable = InstanceType<DocxModule["Table"]>;
type DocxBlock = DocxParagraph | DocxTable;

/** 懒加载 docx / mammoth（独立 chunk） */
async function loadDocx(): Promise<DocxModule> {
  return (await import("docx")) as unknown as DocxModule;
}

async function loadMammoth(): Promise<typeof import("mammoth")> {
  return (await import("mammoth")) as unknown as typeof import("mammoth");
}

/* ---------- 导出：TipTap JSON → .docx ---------- */

function hasMark(marks: TiptapMark[] | undefined, type: string): boolean {
  return !!marks?.some((m) => m.type === type);
}

interface RunStyle {
  bold?: boolean;
  italics?: boolean;
  font?: string;
}

function runStyleOf(node: TiptapNode): RunStyle {
  const marks = node.marks;
  return {
    bold: hasMark(marks, "bold") || undefined,
    italics: hasMark(marks, "italic") || undefined,
    font: hasMark(marks, "code") ? "Courier New" : undefined,
  };
}

/** inline 节点数组 → TextRun 数组 */
function runsFromInline(docx: DocxModule, content: TiptapNode[] | undefined): ParagraphChild[] {
  const { TextRun } = docx;
  return (content ?? []).map((node) => new TextRun({ text: node.text ?? "", ...runStyleOf(node) }));
}

/** paragraph 节点（或含段落的 cell）→ docx Paragraph 数组 */
function paragraphsFromCell(docx: DocxModule, cell: TiptapNode): DocxParagraph[] {
  const { Paragraph } = docx;
  const blocks = cell.content ?? [];
  if (!blocks.length) return [new Paragraph({ children: [] })];
  return blocks.map((b) => (b.type === "paragraph" ? new Paragraph({ children: runsFromInline(docx, b.content) }) : new Paragraph({ children: runsFromInline(docx, []) })));
}

const HEADING_LEVELS: Record<number, string> = { 1: "Heading1", 2: "Heading2", 3: "Heading3" };

/** 递归把 TipTap 节点摊平成 docx 块数组（list/table 各产多块） */
function blocksFromNodes(docx: DocxModule, nodes: TiptapNode[], state: { numberingId: number; configs: unknown[] }): DocxBlock[] {
  const { Paragraph, TextRun, Table, TableRow, TableCell, WidthType } = docx;
  const out: DocxBlock[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "heading": {
        const level = Math.min(3, Math.max(1, Number(node.attrs?.level ?? 1))) as 1 | 2 | 3;
        out.push(new Paragraph({ heading: HEADING_LEVELS[level] as "Heading1" | "Heading2" | "Heading3", children: runsFromInline(docx, node.content) }));
        break;
      }
      case "paragraph":
        out.push(new Paragraph({ children: runsFromInline(docx, node.content) }));
        break;
      case "bulletList":
        for (const li of node.content ?? []) {
          for (const p of li.content ?? []) {
            out.push(new Paragraph({ bullet: { level: 0 }, children: runsFromInline(docx, p.content) }));
          }
        }
        break;
      case "orderedList": {
        state.numberingId += 1;
        const reference = `ordered-${state.numberingId}`;
        state.configs.push({
          reference,
          levels: [{ level: 0, format: "decimal", text: "%1.", alignment: "start" }],
        });
        for (const li of node.content ?? []) {
          for (const p of li.content ?? []) {
            out.push(new Paragraph({ numbering: { reference, level: 0 }, children: runsFromInline(docx, p.content) }));
          }
        }
        break;
      }
      case "table": {
        const rows = (node.content ?? []).map(
          (row) =>
            new TableRow({
              children: (row.content ?? []).map((cell) => new TableCell({ children: paragraphsFromCell(docx, cell) })),
            }),
        );
        out.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
        break;
      }
      case "blockquote":
        for (const p of node.content ?? []) {
          out.push(new Paragraph({ children: runsFromInline(docx, p.content), indent: { left: 720 } }));
        }
        break;
      case "codeBlock": {
        const text = (node.content ?? []).map((l) => (l.content ?? []).map((t) => t.text ?? "").join("")).join("\n");
        out.push(new Paragraph({ children: [new TextRun({ text, font: "Courier New" })] }));
        break;
      }
      default:
        out.push(new Paragraph({ children: runsFromInline(docx, node.content) }));
    }
  }
  return out;
}

export interface ExportStats {
  bytes: number;
  blocks: number;
}

/** TipTap JSON → 真 .docx 字节 */
export async function docJsonToDocxBytes(doc: { type: string; content?: TiptapNode[] }): Promise<{ bytes: Uint8Array; stats: ExportStats }> {
  const docx = await loadDocx();
  const state = { numberingId: 0, configs: [] as unknown[] };
  const children = blocksFromNodes(docx, doc.content ?? [], state);
  const { Document, Packer } = docx;
  const file = new Document({
    numbering: state.configs.length ? { config: state.configs as never } : undefined,
    sections: [{ children }],
  });
  const blob = await Packer.toBlob(file);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { bytes, stats: { bytes: bytes.length, blocks: children.length } };
}

/* ---------- 导入：.docx → HTML ---------- */

/** docx 字节 → HTML（mammoth 语义转换） */
export async function docxBytesToHtml(bytes: ArrayBuffer): Promise<string> {
  const mammoth = await loadMammoth();
  const result = await mammoth.convertToHtml({ arrayBuffer: bytes });
  return result.value;
}
