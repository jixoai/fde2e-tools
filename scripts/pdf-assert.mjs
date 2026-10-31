/*
 * PDF 绿门断言助手 —— scripts/pdf-assert.mjs
 *
 * openspec: export-pdf-png（v2 视觉验收返工）。三条硬断言：
 * 1. 文本层非空（pdftotext 实测，矢量 PDF 的反证——v1 位图 PDF 提取全空）；
 * 2. 编辑器 UI 特征词不得出现在 xlsx 产物文本里（Start/Formulas/Arial 等，
 *    防「截编辑器 DOM」路径复发）；
 * 3. 版面利用率（pdftoppm 光栅化 → 非白像素占比阈值，防「空洞版式」）。
 *
 * 依赖本机 poppler（pdftotext / pdftoppm，brew install poppler）；缺失时给出
 * 明确人话错误而不是静默跳过。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "fde2e-pdf-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function withTempDirAsync(fn) {
  const dir = mkdtempSync(join(tmpdir(), "fde2e-pdf-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function run(cmd, args, label) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    throw new Error(`${label}：${cmd} 执行失败（poppler 未安装？brew install poppler）——${e.message}`);
  }
}

/** PDF 文本层（pdftotext -layout -enc UTF-8）；返回字符串（可为空） */
export function pdfTextLayer(bytes, label) {
  return withTempDir((dir) => {
    const file = join(dir, "in.pdf");
    writeFileSync(file, bytes);
    return run("pdftotext", ["-layout", "-enc", "UTF-8", file, "-"], label);
  });
}

/**
 * 逐词外接框（pdftotext -bbox；页内 pt 坐标，y 向下增长）。
 * 布局几何断言用（trim 契约「空行占位」的行距证据——矢量 PDF 产物级验证）。
 */
export function pdfWordBoxes(bytes, label) {
  return withTempDir((dir) => {
    const file = join(dir, "in.pdf");
    writeFileSync(file, bytes);
    const html = run("pdftotext", ["-bbox", "-enc", "UTF-8", file, "-"], label);
    const words = [];
    for (const m of html.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)) {
      words.push({ xMin: +m[1], yMin: +m[2], xMax: +m[3], yMax: +m[4], text: m[5] });
    }
    if (!words.length) throw new Error(`${label} -bbox 无词框（pdftotext 输出形态变化？）`);
    return words;
  });
}

/** 文本层断言：非空＋中文在場＋关键词齐＋（可选）UI 特征词缺席 */
export function assertPdfText(bytes, label, opts = {}) {
  const text = pdfTextLayer(bytes, label);
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) throw new Error(`${label} 文本层为空（位图 PDF 复发？pdftotext 无可提取文本）`);
  if (opts.requireChinese && !/[\u4e00-\u9fff]/.test(text)) {
    throw new Error(`${label} 文本层无中文（中文字体未嵌入/ToUnicode 缺失）`);
  }
  for (const kw of opts.keywords ?? []) {
    if (!text.includes(kw)) throw new Error(`${label} 文本层缺关键词「${kw}」（实际前 120 字：${compact.slice(0, 120)}）`);
  }
  for (const word of opts.forbidden ?? []) {
    if (text.includes(word)) throw new Error(`${label} 文本层含编辑器 UI 特征词「${word}」（导出路径又把 UI 画进去了）`);
  }
  return text;
}

/**
 * 第 pageNo 页光栅化后的非白像素占比（pdftoppm 60dpi → 页面内 canvas 解码）。
 * 阈值用于「版面空洞」证伪（pptx 16:9 页 ≥3%）。
 */
export async function pdfPageInkRatio(page, bytes, label, pageNo) {
  return withTempDirAsync(async (dir) => {
    const file = join(dir, "in.pdf");
    writeFileSync(file, bytes);
    const prefix = join(dir, "page");
    run("pdftoppm", ["-r", "60", "-png", "-f", String(pageNo), "-l", String(pageNo), file, prefix], label);
    const png = readdirSync(dir).find((n) => n.startsWith("page") && n.endsWith(".png"));
    if (!png) throw new Error(`${label} 第 ${pageNo} 页光栅化失败（pdftoppm 无产物）`);
    const b64 = readFileSync(join(dir, png)).toString("base64");
    const r = await page.evaluate(async (b64) => {
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = () => rej(new Error("PNG 解码失败"));
        img.src = "data:image/png;base64," + b64;
      });
      const c = document.createElement("canvas");
      const k = Math.min(1, 1200 / img.width, 1200 / img.height);
      c.width = Math.max(1, Math.round(img.width * k));
      c.height = Math.max(1, Math.round(img.height * k));
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let nw = 0;
      let n = 0;
      for (let i = 0; i < d.length; i += 8) {
        n++;
        if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) nw++;
      }
      return { ratio: nw / n, w: img.width, h: img.height };
    }, b64);
    return r;
  });
}
