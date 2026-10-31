/*
 * Markdown 子集 → TipTap JSON —— apps/docx/src/md-lite.ts
 *
 * 解析单源（规格：预览/编辑/导出同一份解析）：append_markdown 与
 * set_content(format=markdown) 共用本转换。子集范围（与 easy-docx 生成线同族，
 * 面向文档编辑场景）：
 * - 标题：#/##/###（#### 及更深按普通段落）
 * - 段落：每个非空非结构行一个段落
 * - 列表：「- 」无序 /「1. 」有序（^\d+\.\s+），连续行聚组
 * - 表格：连续以 | 开头的行；|---| 分隔行跳过；单元格去首尾 | 后按 | 切分
 * - 行内：**粗** / *斜*（粗体优先匹配；代码 `x` 映射 code mark）
 * 全部输出 TipTap JSON 节点（editor.commands.setContent / insertContentAt 直用）。
 */

export interface TiptapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
  marks?: TiptapMark[];
}

/** 行内解析：**粗** / *斜* / `代码`（交替正则，粗体优先，代码次之） */
export function parseInlines(text: string): TiptapNode[] {
  const out: TiptapNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const pushText = (t: string) => {
    if (t) out.push({ type: "text", text: t });
  };
  while ((m = re.exec(text))) {
    pushText(text.slice(last, m.index));
    if (m[1] !== undefined) out.push({ type: "text", text: m[1], marks: [{ type: "bold" }] });
    else if (m[2] !== undefined) out.push({ type: "text", text: m[2], marks: [{ type: "italic" }] });
    else if (m[3] !== undefined) out.push({ type: "text", text: m[3], marks: [{ type: "code" }] });
    last = m.index + m[0].length;
  }
  pushText(text.slice(last));
  return out.length ? out : [{ type: "text", text: "" }];
}

const isTableDelimiter = (line: string): boolean =>
  /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes("-");

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function paragraph(text: string): TiptapNode {
  return { type: "paragraph", content: parseInlines(text) };
}

/** md 子集全文 → TipTap 文档节点数组 */
export function markdownToNodes(md: string): TiptapNode[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const nodes: TiptapNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      i++;
      continue;
    }
    // 标题
    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      nodes.push({
        type: "heading",
        attrs: { level: heading[1].length },
        content: parseInlines(heading[2]),
      });
      i++;
      continue;
    }
    // 表格（连续 | 行）
    if (trimmed.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const raw = lines[i].trim();
        if (!isTableDelimiter(raw)) rows.push(splitRow(raw));
        i++;
      }
      if (rows.length) {
        const [head, ...body] = rows;
        const tableRows: TiptapNode[] = [
          {
            type: "tableRow",
            content: head.map((c) => ({
              type: "tableHeader",
              content: [paragraph(c)],
            })),
          },
          ...body.map((r) => ({
            type: "tableRow",
            content: r.map((c) => ({
              type: "tableCell",
              content: [paragraph(c)],
            })),
          })),
        ];
        nodes.push({ type: "table", content: tableRows });
      }
      continue;
    }
    // 无序列表（连续 - 行）
    if (/^[-*+]\s+/.test(trimmed)) {
      const items: TiptapNode[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        items.push({
          type: "listItem",
          content: [paragraph(lines[i].trim().replace(/^[-*+]\s+/, ""))],
        });
        i++;
      }
      nodes.push({ type: "bulletList", content: items });
      continue;
    }
    // 有序列表（连续 1. 行）
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: TiptapNode[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push({
          type: "listItem",
          content: [paragraph(lines[i].trim().replace(/^\d+\.\s+/, ""))],
        });
        i++;
      }
      nodes.push({ type: "orderedList", content: items });
      continue;
    }
    // 引用（连续 > 行）
    if (trimmed.startsWith(">")) {
      const items: TiptapNode[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        items.push(paragraph(lines[i].trim().replace(/^>\s?/, "")));
        i++;
      }
      nodes.push({ type: "blockquote", content: items });
      continue;
    }
    // 段落
    nodes.push(paragraph(trimmed));
    i++;
  }
  return nodes.length ? nodes : [paragraph("")];
}

export function markdownToDoc(md: string): TiptapNode {
  return { type: "doc", content: markdownToNodes(md) };
}

/** 文档统计（工具返回值与人话摘要共用） */
export function docStats(doc: TiptapNode): { headings: number; paragraphs: number; bullets: number; ordered: number; tables: number; chars: number } {
  let headings = 0;
  let paragraphs = 0;
  let bullets = 0;
  let ordered = 0;
  let tables = 0;
  let chars = 0;
  const walk = (n: TiptapNode): void => {
    if (n.type === "heading") headings++;
    else if (n.type === "paragraph") paragraphs++;
    else if (n.type === "bulletList") bullets++;
    else if (n.type === "orderedList") ordered++;
    else if (n.type === "table") tables++;
    if (n.text) chars += n.text.length;
    n.content?.forEach(walk);
  };
  doc.content?.forEach(walk);
  return { headings, paragraphs, bullets, ordered, tables, chars };
}
