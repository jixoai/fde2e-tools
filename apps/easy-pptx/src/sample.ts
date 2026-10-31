/*
 * 内置示例幻灯 —— apps/pptx/src/sample.ts
 *
 * 示例含多页/bullets/备注——正是绿门反读断言的采样面（解 zip 核对 slide1.xml
 * 标题、bullet 页与 notesSlides）。JSON 文本运行时 stringify 生成，避免手写转义。
 */
import type { DeckSpec } from "./spec";

export const SAMPLE_DECK: DeckSpec = {
  slides: [
    {
      title: "FDE2E 办公三件套",
      bullets: ["表格生成 · xlsx 站", "文档生成 · docx 站", "幻灯生成 · pptx 站"],
      notes: "开场页：介绍三个纯客户端生成站。",
    },
    {
      title: "生成正解：轻量函数库",
      bullets: ["SheetJS 社区版（Apache-2.0）", "docx（MIT）", "pptxgenjs（MIT）"],
      notes: "选型 digest 结论：全 MIT/Apache，禁 AGPL 进生成链。",
    },
    {
      title: "谢谢观看",
      bullets: [],
    },
  ],
};

export function sampleDeckJson(): string {
  return JSON.stringify(SAMPLE_DECK, null, 2);
}
