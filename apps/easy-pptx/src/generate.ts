/*
 * .pptx 生成 —— apps/pptx/src/generate.ts
 *
 * pptxgenjs（MIT）动态 import：生成库只进独立 chunk（体积纪律）。
 * 16:9 版式；每页 title + bullets + notes（演讲者备注）；writeFile 触发浏览器
 * 本地下载（headless download 事件同路径）。
 */
import type { DeckSpec } from "./spec";

export async function generatePptx(spec: DeckSpec, filename: string): Promise<void> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  for (const s of spec.slides) {
    const slide = pptx.addSlide();
    slide.addText(s.title, {
      x: 0.6,
      y: 0.5,
      w: 8.8,
      h: 1.2,
      fontSize: 30,
      bold: true,
      color: "1A1A2E",
    });
    if (s.bullets.length > 0) {
      slide.addText(
        s.bullets.map((t) => ({ text: t, options: { bullet: true, breakLine: true } })),
        { x: 0.9, y: 2.0, w: 8.2, h: 4.2, fontSize: 18, color: "333333" },
      );
    }
    if (s.notes) slide.addNotes(s.notes);
  }
  await pptx.writeFile({ fileName: filename });
}
