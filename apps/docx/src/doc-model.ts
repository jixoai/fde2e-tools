/*
 * 文档导出模型 —— apps/docx/src/doc-model.ts
 *
 * openspec: export-pdf-png（v2 视觉验收返工）。TipTap JSON（getJSON 真相源）→
 * 与渲染无关的块模型，两条导出通道共用：
 * - 矢量 PDF（jsPDF 直接绘制，真实文本层）
 * - 长图 HTML（结构化渲染，彻底避开「克隆编辑器 DOM」带来的 P1 版式缺陷：
 *   列表圆点上浮 / 内联代码背景漂移 / 表头加粗不统一 / 容器边框白条）
 *
 * 边界：图片/脚注/页眉页脚不在 TipTap StarterKit+Table 能力面内（与 .docx 桥
 * 同界），未知节点按段落文本兜底（不丢字）。
 */
import type { TiptapMark, TiptapNode } from "./md-lite";

export interface InlineRun {
  text: string;
  bold: boolean;
  italic: boolean;
  code: boolean;
}

export interface HeadingBlock {
  kind: "heading";
  level: 1 | 2 | 3;
  runs: InlineRun[];
}

export interface ParagraphBlock {
  kind: "paragraph";
  runs: InlineRun[];
}

export interface ListItemBlock {
  kind: "list-item";
  ordered: boolean;
  level: number;
  /** 有序列表序号（从 1 起；无序时 0） */
  index: number;
  runs: InlineRun[];
}

export interface TableBlock {
  kind: "table";
  /** 每行单元格的纯文本（含表头行标记） */
  rows: Array<{ header: boolean; cells: string[] }>;
}

export interface QuoteBlock {
  kind: "quote";
  runs: InlineRun[];
}

export interface CodeBlock {
  kind: "code";
  text: string;
}

export interface RuleBlock {
  kind: "rule";
}

export type DocBlock = HeadingBlock | ParagraphBlock | ListItemBlock | TableBlock | QuoteBlock | CodeBlock | RuleBlock;

function hasMark(marks: TiptapMark[] | undefined, type: string): boolean {
  return !!marks?.some((m) => m.type === type);
}

/** 行内节点 → 样式化 runs（hardBreak 记作空格；未知 inline 取 text 兜底） */
export function inlineRuns(content: TiptapNode[] | undefined): InlineRun[] {
  const runs: InlineRun[] = [];
  const push = (text: string, bold = false, italic = false, code = false) => {
    if (!text) return;
    const last = runs[runs.length - 1];
    if (last && last.bold === bold && last.italic === italic && last.code === code) last.text += text;
    else runs.push({ text, bold, italic, code });
  };
  for (const node of content ?? []) {
    if (node.type === "text") {
      push(node.text ?? "", hasMark(node.marks, "bold"), hasMark(node.marks, "italic"), hasMark(node.marks, "code"));
    } else if (node.type === "hardBreak") {
      push(" ");
    } else if (node.type === "codeBlock" || node.type === "paragraph") {
      // 嵌套兜底
      for (const run of inlineRuns(node.content)) push(run.text, run.bold, run.italic, run.code);
    }
  }
  return runs;
}

/** 行内 runs → 纯文本（表格单元格/代码块用） */
export function runsToText(runs: InlineRun[]): string {
  return runs.map((r) => r.text).join("");
}

/** 单元格里所有段落拼成一行（表格语义） */
function cellText(cell: TiptapNode): string {
  return (cell.content ?? [])
    .map((b) => (b.type === "paragraph" ? runsToText(inlineRuns(b.content)) : runsToText(inlineRuns([b]))))
    .join(" ")
    .trim();
}

function listItemsFrom(listNode: TiptapNode, level: number, out: DocBlock[]): void {
  const ordered = listNode.type === "orderedList";
  let index = 0;
  for (const item of listNode.content ?? []) {
    if (item.type !== "listItem") continue;
    index += 1;
    // 一项可含多个段落与嵌套列表：段落各自成行，嵌套列表 level+1
    let emitted = false;
    for (const child of item.content ?? []) {
      if (child.type === "paragraph") {
        const runs = inlineRuns(child.content);
        if (runsToText(runs).trim() === "") continue;
        out.push({ kind: "list-item", ordered, level, index: emitted ? 0 : index, runs });
        emitted = true;
      } else if (child.type === "bulletList" || child.type === "orderedList") {
        listItemsFrom(child, level + 1, out);
      } else if (child.type === "heading" || child.type === "blockquote" || child.type === "codeBlock") {
        out.push(...blocksFromNode(child));
      }
    }
  }
}

function blocksFromNode(node: TiptapNode): DocBlock[] {
  switch (node.type) {
    case "heading": {
      const level = Math.min(3, Math.max(1, Number(node.attrs?.level ?? 1))) as 1 | 2 | 3;
      return [{ kind: "heading", level, runs: inlineRuns(node.content) }];
    }
    case "paragraph":
      return [{ kind: "paragraph", runs: inlineRuns(node.content) }];
    case "bulletList":
    case "orderedList": {
      const out: DocBlock[] = [];
      listItemsFrom(node, 0, out);
      return out;
    }
    case "table": {
      const rows: TableBlock["rows"] = [];
      for (const row of node.content ?? []) {
        if (row.type !== "tableRow") continue;
        const cells: string[] = [];
        let header = false;
        for (const cell of row.content ?? []) {
          if (cell.type === "tableHeader") header = true;
          cells.push(cellText(cell));
        }
        rows.push({ header, cells });
      }
      return rows.length ? [{ kind: "table", rows }] : [];
    }
    case "blockquote": {
      const runs: InlineRun[] = [];
      for (const child of node.content ?? []) {
        if (child.type === "paragraph") runs.push(...inlineRuns(child.content), { text: " ", bold: false, italic: false, code: false });
        else runs.push(...inlineRuns([child]));
      }
      return runs.length ? [{ kind: "quote", runs }] : [];
    }
    case "codeBlock":
      return [{ kind: "code", text: runsToText(inlineRuns(node.content)) }];
    case "horizontalRule":
      return [{ kind: "rule" }];
    default: {
      // 未知节点兜底：有文本就当段落，有子节点就递归
      if (node.text) return [{ kind: "paragraph", runs: [{ text: node.text, bold: false, italic: false, code: false }] }];
      if (node.content?.length) return node.content.flatMap((c) => blocksFromNode(c));
      return [];
    }
  }
}

/** TipTap 文档 JSON → 块模型 */
export function docBlocksFromJson(doc: { type: string; content?: unknown[] }): DocBlock[] {
  const nodes = (doc.content ?? []) as TiptapNode[];
  return nodes.flatMap((n) => blocksFromNode(n));
}
