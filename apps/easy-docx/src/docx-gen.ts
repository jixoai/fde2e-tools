/*
 * .docx 生成 —— apps/docx/src/docx-gen.ts
 *
 * docx 库（MIT）动态 import：生成库只进独立 chunk（体积纪律）。AST（md-parse
 * 单源）→ OOXML 模型 → Packer.toBlob → <a download> 本地下载。
 * 有序列表用 numbering 配置（DECIMAL %1.）；无序用内置 bullet；表格 100% 宽。
 */
import type { Block, Inline } from "./md-parse";

export async function generateDocx(blocks: Block[], filename: string): Promise<void> {
  const docx = await import("docx");
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    AlignmentType,
    LevelFormat,
    Table,
    TableCell,
    TableRow,
    WidthType,
  } = docx;

  const runsOf = (inlines: Inline[]): InstanceType<typeof TextRun>[] =>
    inlines.map(
      (i) => new TextRun({ text: i.text, bold: i.bold ?? undefined, italics: i.italic ?? undefined }),
    );

  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [];
  for (const b of blocks) {
    switch (b.kind) {
      case "heading":
        children.push(
          new Paragraph({
            children: runsOf(b.inlines),
            heading:
              b.level === 1
                ? HeadingLevel.HEADING_1
                : b.level === 2
                  ? HeadingLevel.HEADING_2
                  : HeadingLevel.HEADING_3,
          }),
        );
        break;
      case "paragraph":
        children.push(new Paragraph({ children: runsOf(b.inlines) }));
        break;
      case "bullet":
        children.push(new Paragraph({ children: runsOf(b.inlines), bullet: { level: 0 } }));
        break;
      case "ordered":
        children.push(
          new Paragraph({ children: runsOf(b.inlines), numbering: { reference: "ordered-list", level: 0 } }),
        );
        break;
      case "table":
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: b.rows.map(
              (cells) =>
                new TableRow({
                  children: cells.map(
                    (inlines) =>
                      new TableCell({ children: [new Paragraph({ children: runsOf(inlines) })] }),
                  ),
                }),
            ),
          }),
        );
        break;
    }
  }

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "ordered-list",
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [{ children }],
  });

  const blob = await Packer.toBlob(doc);
  const { downloadBlob } = await import("@fde2e-tools/shared/download");
  downloadBlob(blob, filename);
}
