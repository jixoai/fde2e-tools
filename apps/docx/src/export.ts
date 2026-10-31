/*
 * 展示级导出 —— apps/docx/src/export.ts
 *
 * openspec: export-pdf-png（v2 视觉验收返工）。TipTap JSON 真相源 → 块模型
 * （doc-model.ts）→ 两条通道：
 * - export_pdf＝**矢量 PDF**（jsPDF 直接绘制，真实文本层）。标题分级
 *   （h1 22pt / h2 17pt / h3 14pt 加粗）、正文 11pt / 行高 1.6、列表按层级缩进
 *   ＋圆点（基线对齐，矢量绘制天然无「上浮」）、表格边框＋表头底色、
 *   页边距 ≥15mm、页脚「第 N 页 / 共 M 页」。
 * - export_png＝**结构化 HTML 长图**（由块模型渲染，不再克隆编辑器 DOM——
 *   v1 克隆带出容器边框/白条、圆点与内联代码背景错位（P1 判词）；模型渲染把
 *   圆点行用 flex 基线与正文对齐、内联代码 chip 用 inline-block 自带行盒、
 *   表头统一加粗＋浅底色、行高收敛 1.6、无容器边框）。
 * 两条通道共用「缺字显式替身」：字体子集外的字符画 ? 并在返回值 notice 里
 * 如实计数（不静默丢字）。
 */
import { downloadBlob, safeFilename } from "@fde2e-tools/shared/download";
import { mountOffscreen, renderNodeToPng, withColorGuard } from "@fde2e-tools/shared/export-kit";
import { VectorPdf, tokenizeText } from "@fde2e-tools/shared/pdf-vector";
import { docBlocksFromJson, runsToText, type DocBlock, type InlineRun } from "./doc-model";
import { getEditor } from "./editor";

export const DEFAULT_PDF_NAME = "docx-export.pdf";
export const DEFAULT_PNG_NAME = "docx-long.png";

function resolvePdfName(name: string | undefined): string {
  return safeFilename(name, DEFAULT_PDF_NAME, ".pdf");
}

function resolvePngName(name: string | undefined): string {
  return safeFilename(name, DEFAULT_PNG_NAME, ".png");
}

export interface ExportOk {
  ok: true;
  filename: string;
  /** 长图＝像素宽高；矢量 PDF＝页面尺寸（mm） */
  width: number;
  height: number;
  pages?: number;
  /** 实际导出的节标题清单（selective-export；缺省＝整篇） */
  selected?: string[];
  truncated?: boolean;
  notice?: string;
}

export type ExportResult = ExportOk | { ok: false; error: string };

/* ============================================================
 * 一、矢量 PDF（jsPDF 直接绘制）
 * ============================================================ */

const MARGIN_X = 20;
const MARGIN_TOP = 18;
const MARGIN_BOTTOM = 20;
const CONTENT_W = 210 - MARGIN_X * 2; // 170mm
const BODY_SIZE = 11;
const BODY_LH = 1.6;
const TABLE_SIZE = 10;

const HEADING_PT: Record<1 | 2 | 3, number> = { 1: 22, 2: 17, 3: 14 };
const HEADING_BEFORE: Record<1 | 2 | 3, number> = { 1: 6, 2: 5, 3: 4 };
const HEADING_AFTER: Record<1 | 2 | 3, number> = { 1: 3.2, 2: 2.8, 3: 2.4 };

interface StyledToken {
  text: string;
  bold: boolean;
  code: boolean;
}

/** runs → 带样式的可断行 token（CJK 逐字/拉丁按词/空格独立） */
function styledTokens(runs: InlineRun[]): StyledToken[] {
  const out: StyledToken[] = [];
  for (const run of runs) {
    for (const token of tokenizeText(run.text)) {
      if (token === " ") {
        out.push({ text: " ", bold: run.bold, code: run.code });
      } else {
        out.push({ text: token, bold: run.bold, code: run.code });
      }
    }
  }
  return out;
}

interface LineOfTokens {
  tokens: StyledToken[];
  width: number;
}

/** 贪心断行（行首禁则：标点黏回上一行） */
function layoutTokens(pdf: VectorPdf, tokens: StyledToken[], maxWidth: number, size: number): LineOfTokens[] {
  const lines: LineOfTokens[] = [];
  let cur: StyledToken[] = [];
  let curW = 0;
  const measure = (t: StyledToken): number => pdf.measure(t.text, size, t.bold);
  const push = () => {
    // 去掉行尾空格
    while (cur.length && cur[cur.length - 1].text === " ") {
      curW -= measure(cur[cur.length - 1]);
      cur.pop();
    }
    lines.push({ tokens: cur, width: curW });
    cur = [];
    curW = 0;
  };
  const NO_START = "，。、；：！？）》」』】〕｝”’…—·,.;:!?)]}%";
  for (const token of tokens) {
    const w = measure(token);
    if (token.text === " ") {
      if (!cur.length) continue;
      cur.push(token);
      curW += w;
      continue;
    }
    if (curW + w <= maxWidth) {
      cur.push(token);
      curW += w;
      continue;
    }
    if (cur.length) {
      if (token.text.length === 1 && NO_START.includes(token.text)) {
        cur.push(token);
        curW += w;
        continue;
      }
      push();
    }
    if (w <= maxWidth) {
      cur.push(token);
      curW = w;
      continue;
    }
    // 超长拉丁词按字符硬切：切满一段即落一行，余下继续
    let chunk = "";
    let chunkW = 0;
    for (const ch of token.text) {
      const piece: StyledToken = { text: ch, bold: token.bold, code: token.code };
      const cw = pdf.measure(piece.text, size, token.bold);
      if (chunk && chunkW + cw > maxWidth) {
        lines.push({ tokens: [{ text: chunk, bold: token.bold, code: token.code }], width: chunkW });
        chunk = ch;
        chunkW = cw;
      } else {
        chunk += ch;
        chunkW += cw;
      }
    }
    if (chunk) {
      cur = [{ text: chunk, bold: token.bold, code: token.code }];
      curW = chunkW;
    }
  }
  if (cur.length) push();
  return lines;
}

/** 单行 runs 绘制（内联代码带浅底 chip） */
function drawTokenLine(
  pdf: VectorPdf,
  line: LineOfTokens,
  x: number,
  baseline: number,
  opts: { size: number; color: string; codeColor: string },
): void {
  let cx = x;
  for (const token of line.tokens) {
    const w = pdf.measure(token.text, opts.size, token.bold);
    if (token.code && token.text.trim()) {
      pdf.fillRect(cx - 0.4, baseline - opts.size * (25.4 / 72) * 0.78, w + 0.8, opts.size * (25.4 / 72) * 1.02, "#eef1f5");
    }
    pdf.drawText(token.text, cx, baseline, {
      size: opts.size,
      bold: token.bold,
      color: token.code ? opts.codeColor : opts.color,
    });
    cx += w;
  }
}

class DocPdfLayout {
  pdf: VectorPdf;
  y = MARGIN_TOP;
  missingNotice?: string;

  constructor(pdf: VectorPdf) {
    this.pdf = pdf;
  }

  private get bottom(): number {
    return this.pdf.heightMm - MARGIN_BOTTOM;
  }

  atPageTop(): boolean {
    return this.y <= MARGIN_TOP + 0.01;
  }

  ensure(spaceMm: number): void {
    if (this.y + spaceMm > this.bottom && !this.atPageTop()) {
      this.pdf.addPage();
      this.y = MARGIN_TOP;
    }
  }

  /* ---------- 通用段落 ---------- */

  drawRuns(
    runs: InlineRun[],
    opts: { size: number; lineHeight: number; color?: string; indent?: number; marker?: string; markerBold?: boolean },
  ): void {
    const indent = opts.indent ?? 0;
    const markerW = opts.marker ? 6 : 0;
    const x = MARGIN_X + indent + markerW;
    const maxW = CONTENT_W - indent - markerW;
    const tokens = styledTokens(runs);
    if (!tokens.length) {
      this.y += opts.size * opts.lineHeight * (25.4 / 72);
      return;
    }
    const lines = layoutTokens(this.pdf, tokens, maxW, opts.size);
    const lh = opts.size * opts.lineHeight * (25.4 / 72);
    let first = true;
    for (const line of lines) {
      if (this.y + lh > this.bottom) {
        this.pdf.addPage();
        this.y = MARGIN_TOP;
      }
      const baseline = this.y + VectorPdf.baselineOffset(opts.size);
      if (first && opts.marker) {
        this.pdf.drawText(opts.marker, MARGIN_X + indent + markerW - 3.2, baseline, {
          size: opts.size,
          bold: opts.markerBold ?? false,
          color: opts.color ?? "#1f2937",
          align: "right",
          boxWidth: 3.2,
        });
      }
      drawTokenLine(this.pdf, line, x, baseline, {
        size: opts.size,
        color: opts.color ?? "#1f2937",
        codeColor: "#6d28d9",
      });
      this.y += lh;
      first = false;
    }
  }

  /* ---------- 块 ---------- */

  drawHeading(block: Extract<DocBlock, { kind: "heading" }>): void {
    const size = HEADING_PT[block.level];
    const lh = size * 1.35 * (25.4 / 72);
    if (!this.atPageTop()) this.y += HEADING_BEFORE[block.level];
    // 标题与后两行同页（避免孤行标题压页脚）
    this.ensure(lh * 2 + HEADING_AFTER[block.level]);
    const lines = layoutTokens(this.pdf, styledTokens(block.runs), CONTENT_W, size);
    for (const line of lines) {
      if (this.y + lh > this.bottom) {
        this.pdf.addPage();
        this.y = MARGIN_TOP;
      }
      drawTokenLine(this.pdf, line, MARGIN_X, this.y + VectorPdf.baselineOffset(size), {
        size,
        color: "#111827",
        codeColor: "#6d28d9",
      });
      this.y += lh;
    }
    if (block.level === 1) {
      this.pdf.line(MARGIN_X, this.y + 1.2, MARGIN_X + CONTENT_W, this.y + 1.2, "#dfe5ee", 0.35);
      this.y += 1.2;
    }
    this.y += HEADING_AFTER[block.level];
  }

  drawParagraph(block: Extract<DocBlock, { kind: "paragraph" }>): void {
    this.drawRuns(block.runs, { size: BODY_SIZE, lineHeight: BODY_LH });
    this.y += 3;
  }

  drawListItem(block: Extract<DocBlock, { kind: "list-item" }>): void {
    const indent = 3 + block.level * 6;
    const marker = block.ordered && block.index > 0 ? `${block.index}.` : block.level % 2 === 0 ? "•" : "◦";
    this.drawRuns(block.runs, {
      size: BODY_SIZE,
      lineHeight: BODY_LH,
      indent,
      marker,
    });
    this.y += 1.6;
  }

  drawQuote(block: Extract<DocBlock, { kind: "quote" }>): void {
    const startY = this.y;
    this.drawRuns(block.runs, { size: BODY_SIZE, lineHeight: BODY_LH, color: "#4b5563", indent: 6 });
    this.pdf.fillRect(MARGIN_X + 2.6, startY + 0.4, 0.9, Math.max(4, this.y - startY - 0.8), "#c7d2e0");
    this.y += 3;
  }

  drawCode(block: Extract<DocBlock, { kind: "code" }>): void {
    const size = 9.5;
    const lh = size * 1.5 * (25.4 / 72);
    const lines = this.pdf.wrap(block.text || " ", CONTENT_W - 8, size, false);
    const pad = 2.6;
    const band = (h: number) => this.pdf.fillRect(MARGIN_X, this.y, CONTENT_W, h, "#f3f4f6");
    this.ensure(Math.min(lines.length, 3) * lh + pad * 2);
    band(pad);
    this.y += pad;
    for (const line of lines) {
      if (this.y + lh + pad > this.bottom) {
        this.pdf.addPage();
        this.y = MARGIN_TOP;
        band(pad);
        this.y += pad;
      }
      band(lh);
      this.pdf.drawText(line, MARGIN_X + 3, this.y + VectorPdf.baselineOffset(size), { size, color: "#374151" });
      this.y += lh;
    }
    band(pad);
    this.y += pad + 4;
  }

  drawRule(): void {
    this.ensure(6);
    this.pdf.line(MARGIN_X, this.y + 2, MARGIN_X + CONTENT_W, this.y + 2, "#d1d5db", 0.4);
    this.y += 6;
  }

  drawTable(block: Extract<DocBlock, { kind: "table" }>): void {
    const cols = Math.max(...block.rows.map((r) => r.cells.length));
    if (!cols) return;
    const colW = CONTENT_W / cols;
    const padX = 2.2;
    const padY = 1.8;
    const lh = TABLE_SIZE * 1.4 * (25.4 / 72);
    const headerRow = block.rows.find((r) => r.header);
    const bodyRows = block.rows.filter((r) => r !== headerRow);

    const drawRow = (row: { header: boolean; cells: string[] }): void => {
      const linesPerCell = Array.from({ length: cols }, (_, c) =>
        this.pdf.wrap(row.cells[c] ?? "", colW - padX * 2, TABLE_SIZE, row.header),
      );
      const lineCount = Math.max(1, ...linesPerCell.map((l) => l.length));
      const rowH = lineCount * lh + padY * 2;
      if (this.y + rowH > this.bottom) {
        this.pdf.addPage();
        this.y = MARGIN_TOP;
        if (headerRow) drawRow(headerRow);
      }
      if (row.header) this.pdf.fillRect(MARGIN_X, this.y, CONTENT_W, rowH, "#eef2f7");
      let x = MARGIN_X;
      for (let c = 0; c < cols; c++) {
        let ty = this.y + padY;
        for (const line of linesPerCell[c]) {
          this.pdf.drawText(line, x + padX, ty + VectorPdf.baselineOffset(TABLE_SIZE), {
            size: TABLE_SIZE,
            bold: row.header,
            color: row.header ? "#334155" : "#1f2937",
          });
          ty += lh;
        }
        x += colW;
      }
      this.pdf.strokeRect(MARGIN_X, this.y, CONTENT_W, rowH, "#c9d2df", 0.18);
      for (let c = 1; c < cols; c++) {
        this.pdf.line(MARGIN_X + colW * c, this.y, MARGIN_X + colW * c, this.y + rowH, "#c9d2df", 0.15);
      }
      this.y += rowH;
    };

    this.ensure(14);
    if (headerRow) drawRow(headerRow);
    for (const row of bodyRows) drawRow(row);
    this.y += 4;
  }
}

async function renderDocPdf(blocks: DocBlock[], title: string): Promise<{ blob: Blob; pages: number; width: number; height: number; missing: number }> {
  const pdf = await VectorPdf.create({ format: "a4", orientation: "portrait", title });
  const layout = new DocPdfLayout(pdf);
  for (const block of blocks) {
    switch (block.kind) {
      case "heading":
        layout.drawHeading(block);
        break;
      case "paragraph":
        layout.drawParagraph(block);
        break;
      case "list-item":
        layout.drawListItem(block);
        break;
      case "quote":
        layout.drawQuote(block);
        break;
      case "code":
        layout.drawCode(block);
        break;
      case "rule":
        layout.drawRule();
        break;
      case "table":
        layout.drawTable(block);
        break;
    }
  }
  pdf.stampFooters((page, total) => `第 ${page} 页 / 共 ${total} 页`);
  return { blob: pdf.toBlob(), pages: pdf.pages, width: pdf.widthMm, height: pdf.heightMm, missing: pdf.missingChars };
}

/* ============================================================
 * 二、长图 PNG（块模型 → 结构化 HTML，不再克隆编辑器 DOM）
 * ============================================================ */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function runsHtml(runs: InlineRun[]): string {
  return runs
    .map((run) => {
      let html = escapeHtml(run.text);
      if (run.code) html = `<code class="code">${html}</code>`;
      if (run.bold) html = `<strong>${html}</strong>`;
      if (run.italic) html = `<em>${html}</em>`;
      return html;
    })
    .join("");
}

const EXPORT_CSS = `
.dx-export {
  box-sizing: border-box;
  background: #ffffff;
  color: #1f2937;
  padding: 64px 76px 72px;
  font-family: ui-sans-serif, system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  font-size: 15px;
  line-height: 1.6;
  letter-spacing: 0.01em;
}
.dx-export > *:first-child { margin-top: 0; }
.dx-export h1 { font-size: 30px; line-height: 1.35; font-weight: 700; margin: 26px 0 16px; color: #111827; }
.dx-export h2 { font-size: 23px; line-height: 1.4; font-weight: 700; margin: 24px 0 12px; color: #111827; }
.dx-export h3 { font-size: 18px; line-height: 1.45; font-weight: 700; margin: 20px 0 10px; color: #111827; }
.dx-export p { margin: 0 0 14px; }
.dx-export .li { display: flex; align-items: flex-start; margin: 0 0 6px; }
.dx-export .li .dot { flex: 0 0 18px; padding-right: 8px; text-align: right; line-height: 1.6; color: #4b5563; }
.dx-export .li .txt { flex: 1 1 auto; min-width: 0; }
.dx-export .quote { border-left: 3px solid #c7d2e0; padding: 2px 0 2px 14px; margin: 12px 0 16px; color: #4b5563; }
.dx-export .code { display: inline-block; line-height: 1.35; padding: 1px 6px; margin: 0 1px; border-radius: 4px; background: #eef1f5; color: #6d28d9; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.88em; }
.dx-export .codeblock { background: #f3f4f6; border-radius: 6px; padding: 12px 16px; margin: 12px 0 16px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; line-height: 1.55; white-space: pre-wrap; color: #374151; }
.dx-export table { border-collapse: collapse; width: 100%; margin: 12px 0 18px; }
.dx-export th, .dx-export td { border: 1px solid #d1d5db; padding: 8px 12px; text-align: left; vertical-align: top; font-size: 14px; }
.dx-export th { background: #eef2f7; font-weight: 700; color: #334155; }
.dx-export .rule { border: 0; border-top: 1px solid #d1d5db; margin: 18px 0; }
`;

export function blocksToHtml(blocks: DocBlock[], title: string): string {
  const body = blocks
    .map((block) => {
      switch (block.kind) {
        case "heading": {
          const tag = `h${block.level}`;
          return `<${tag}>${runsHtml(block.runs)}</${tag}>`;
        }
        case "paragraph":
          return `<p>${runsHtml(block.runs)}</p>`;
        case "list-item": {
          const marker = block.ordered && block.index > 0 ? `${block.index}.` : "•";
          const indent = block.level * 26;
          return `<div class="li" style="margin-left:${indent}px"><span class="dot">${marker}</span><span class="txt">${runsHtml(block.runs)}</span></div>`;
        }
        case "quote":
          return `<div class="quote"><p>${runsHtml(block.runs)}</p></div>`;
        case "code":
          return `<div class="codeblock">${escapeHtml(block.text)}</div>`;
        case "rule":
          return `<hr class="rule" />`;
        case "table": {
          const headerRow = block.rows.find((r) => r.header);
          const bodyRows = block.rows.filter((r) => r !== headerRow);
          const head = headerRow
            ? `<thead><tr>${headerRow.cells.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>`
            : "";
          const rows = bodyRows.map((r) => `<tr>${r.cells.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("");
          return `<table>${head}<tbody>${rows}</tbody></table>`;
        }
      }
    })
    .join("\n");
  return `<div class="dx-export"><style>${EXPORT_CSS}</style>${blocks.some((b) => b.kind === "heading" && b.level === 1) ? "" : `<h1>${escapeHtml(title)}</h1>`}${body}</div>`;
}

/* ============================================================
 * 三、选择性导出（openspec: selective-export）
 * ============================================================ */

/**
 * 按标题选节：取该标题（任意层级）至下一个同级或更高级标题之间的内容
 * （含标题本身；文档末尾无更高标题则取到结尾）。标题不存在＝人话报错并列出
 * 全部可用标题。
 */
export function selectDocSection(
  blocks: DocBlock[],
  section: string,
): { blocks: DocBlock[]; selected: string[]; error?: string } {
  const headings = blocks.filter((b): b is Extract<DocBlock, { kind: "heading" }> => b.kind === "heading");
  const wanted = section.trim();
  const target = headings.find((h) => runsToText(h.runs).trim() === wanted);
  if (!target) {
    const available = headings.map((h) => `${"#".repeat(h.level)} ${runsToText(h.runs).trim()}`);
    return {
      blocks: [],
      selected: [],
      error: `未找到标题「${wanted}」——可用标题：${available.length ? available.join("；") : "（文档没有任何标题）"}`,
    };
  }
  const start = blocks.indexOf(target);
  let end = blocks.length;
  for (let i = start + 1; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind === "heading" && b.level <= target.level) {
      end = i;
      break;
    }
  }
  return { blocks: blocks.slice(start, end), selected: [wanted] };
}

/* ============================================================
 * 四、对外入口（人机同路径）
 * ============================================================ */

function currentBlocks(): { blocks: DocBlock[]; title: string } | { error: string } {
  const ed = getEditor();
  if (!ed) return { error: "编辑器尚未就绪（内核加载中），请稍后重试" };
  if (ed.isEmpty) return { error: "文档为空——请先输入内容或点「载入示例」" };
  const blocks = docBlocksFromJson(ed.getJSON() as { type: string; content?: unknown[] });
  const firstHeading = blocks.find((b): b is Extract<DocBlock, { kind: "heading" }> => b.kind === "heading" && b.level === 1);
  const title = firstHeading ? runsToText(firstHeading.runs).trim() : "文档导出";
  return { blocks, title: title || "文档导出" };
}

/** export_pdf：块模型 → 矢量 PDF（真实文本层；可选 section 按标题选节） */
export async function exportDocPdf(filename?: string, section?: string): Promise<ExportResult> {
  const name = resolvePdfName(filename);
  try {
    const model = currentBlocks();
    if ("error" in model) return { ok: false, error: model.error };
    let blocks = model.blocks;
    let selected: string[] = ["整篇"];
    if (section !== undefined && section !== null && section !== "") {
      const picked = selectDocSection(blocks, section);
      if (picked.error) return { ok: false, error: picked.error };
      blocks = picked.blocks;
      selected = picked.selected;
    }
    const out = await renderDocPdf(blocks, model.title);
    downloadBlob(out.blob, name);
    return {
      ok: true,
      filename: name,
      width: out.width,
      height: out.height,
      pages: out.pages,
      selected,
      notice: out.missing > 0 ? `${out.missing} 个字符不在内置字体覆盖范围，已以 ? 代替` : undefined,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.message ? e.message : String(e) };
  }
}

/** export_png：块模型 → 结构化 HTML → 长图（可选 section 按标题选节） */
export async function exportDocLongPng(filename?: string, section?: string): Promise<ExportResult> {
  const name = resolvePngName(filename);
  try {
    const model = currentBlocks();
    if ("error" in model) return { ok: false, error: model.error };
    let blocks = model.blocks;
    let selected: string[] = ["整篇"];
    if (section !== undefined && section !== null && section !== "") {
      const picked = selectDocSection(blocks, section);
      if (picked.error) return { ok: false, error: picked.error };
      blocks = picked.blocks;
      selected = picked.selected;
    }
    const node = document.createElement("div");
    node.innerHTML = blocksToHtml(blocks, model.title);
    const unmount = mountOffscreen(node, 900);
    try {
      const png = await withColorGuard(() => renderNodeToPng(node, { width: 900, scale: 2 }), node);
      downloadBlob(png.blob, name);
      return { ok: true, filename: name, width: png.width, height: png.height, selected, truncated: png.truncated, notice: png.notice };
    } finally {
      unmount();
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.message ? e.message : String(e) };
  }
}
