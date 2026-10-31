/*
 * Markdown 子集解析单源 —— apps/docx/src/md-parse.ts
 *
 * 同一份 AST 同时驱动预览渲染与 docx 模型构造（规格：解析单源，预览与产物
 * 不得各写一套解析）。子集范围：
 * - 标题：#/##/###（#### 及更深按普通段落）
 * - 段落：每个非空非结构行一个段落
 * - 列表：「- 」无序 /「1. 」有序（^\d+\.\s+）
 * - 表格：连续以 | 开头的行；|---| 分隔行跳过
 * - 行内：**粗** / *斜*（先粗后斜；***粗斜*** 未定义，按字面处理）
 * 全部错误人话化（#status 直接展示）。
 */

export interface Inline {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; inlines: Inline[] }
  | { kind: "paragraph"; inlines: Inline[] }
  | { kind: "bullet"; inlines: Inline[] }
  | { kind: "ordered"; inlines: Inline[] }
  | { kind: "table"; rows: Inline[][][] };

export interface DocStats {
  headings: number;
  paragraphs: number;
  bullets: number;
  ordered: number;
  tables: number;
}

/** 行内解析：**粗** / *斜*（交替正则，粗体优先匹配） */
export function parseInlines(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ text: m[1], bold: true });
    else out.push({ text: m[2], italic: true });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text: "" }];
}

function stripInlines(cells: string[]): Inline[][] {
  return cells.map((c) => parseInlines(c.trim()));
}

/** md 子集 → AST（行级扫描，表格按连续 | 行聚簇） */
export function parseMarkdownSub(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  const isTableRow = (l: string) => l.trimStart().startsWith("|");
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) {
      i += 1;
      continue;
    }
    // 表格：连续 | 行聚簇；--- 分隔行跳过
    if (isTableRow(line)) {
      const rows: Inline[][][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        const raw = lines[i].trim();
        const cells = raw
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());
        const isSeparator = cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));
        if (!isSeparator) rows.push(stripInlines(cells));
        i += 1;
      }
      if (rows.length === 0) throw new Error("表格结构错误：只有分隔行（|---|），没有数据行。");
      blocks.push({ kind: "table", rows });
      continue;
    }
    // 标题
    const h = /^(#{1,3})\s+(.*)$/.exec(t);
    if (h) {
      blocks.push({
        kind: "heading",
        level: h[1].length as 1 | 2 | 3,
        inlines: parseInlines(h[2]),
      });
      i += 1;
      continue;
    }
    // 列表
    if (/^-\s+/.test(t)) {
      blocks.push({ kind: "bullet", inlines: parseInlines(t.replace(/^-\s+/, "")) });
      i += 1;
      continue;
    }
    const ol = /^(\d+)\.\s+(.*)$/.exec(t);
    if (ol) {
      blocks.push({ kind: "ordered", inlines: parseInlines(ol[2]) });
      i += 1;
      continue;
    }
    // 段落：每个非空非结构行一个段落
    blocks.push({ kind: "paragraph", inlines: parseInlines(t) });
    i += 1;
  }
  if (blocks.length === 0) {
    throw new Error("输入为空：请先输入 Markdown、或点「载入示例」。");
  }
  return blocks;
}

export function docStats(blocks: Block[]): DocStats {
  const s: DocStats = { headings: 0, paragraphs: 0, bullets: 0, ordered: 0, tables: 0 };
  for (const b of blocks) {
    if (b.kind === "table") s.tables += 1;
    else if (b.kind === "heading") s.headings += 1;
    else if (b.kind === "paragraph") s.paragraphs += 1;
    else if (b.kind === "bullet") s.bullets += 1;
    else s.ordered += 1;
  }
  return s;
}

/** 文档统计摘要（状态行/WebMCP 返回值用） */
export function statsSummary(blocks: Block[]): string {
  const s = docStats(blocks);
  const parts: string[] = [];
  if (s.headings) parts.push(`${s.headings} 标题`);
  if (s.paragraphs) parts.push(`${s.paragraphs} 段落`);
  if (s.bullets || s.ordered) parts.push(`${s.bullets + s.ordered} 列表项`);
  if (s.tables) parts.push(`${s.tables} 表格`);
  return parts.join(" · ") || "空文档";
}
