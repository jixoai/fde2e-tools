/*
 * 字体 Worker —— apps/canvas/src/font-worker.ts
 *
 * fontkit 在 Worker 里解析/排版，主线程只收元数据与 path。
 * 安全：字体 URL 只允许 https（本地 dev 允许 localhost），拒绝字面私网地址；
 * 字体是不可信输入，解析失败只返回错误，不影响页面。
 */
import { create as createFont } from "fontkit";
import linebreak from "linebreak";
import svgpath from "svgpath";
import type {
  FontInfo,
  FontWorkerRequest,
  FontWorkerResponse,
  GlyphBox,
  TextLine,
  TextToSvgResult,
} from "./font-types";

type AnyFont = any;
type AnyGlyph = any;
type AnyRun = any;

const fontCache = new Map<string, Promise<AnyFont>>();

const PRIVATE_HOST_RE =
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0$|\[?::1\]?$|\[?fc[0-9a-f]{2}:|\[?fe[89ab][0-9a-f]:)/i;

function validateFontUrl(value: string): URL {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new Error("字体 URL 不是合法 URL");
  }
  const isLocalDev = u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  if (u.protocol !== "https:" && !isLocalDev) {
    throw new Error("字体 URL 只允许 https:（本地 dev 允许 localhost）");
  }
  if (!isLocalDev && PRIVATE_HOST_RE.test(u.hostname)) {
    throw new Error(`字体 URL 不允许字面私网/链路本地地址（${u.hostname}）`);
  }
  return u;
}

async function loadFont(url: string): Promise<AnyFont> {
  validateFontUrl(url);
  let p = fontCache.get(url);
  if (!p) {
    p = (async () => {
      let res: Response;
      try {
        res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      } catch (e) {
        if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
          throw new Error("字体加载超时：请确认 URL 可直连，或上传素材库后用 /uploads URL");
        }
        // fetch 网络层 TypeError 是 CORS 拒绝/不可达的典型形态
        throw new Error("字体跨源加载失败（CORS/网络）：请上传素材库后用 /uploads 回源 URL");
      }
      if (!res.ok) {
        throw new Error(`字体加载失败（HTTP ${res.status}）：请确认 URL 可直连，或上传素材库后用 /uploads URL`);
      }
      const buf = await res.arrayBuffer();
      if (buf.byteLength === 0) throw new Error("字体文件为空");
      if (buf.byteLength > 30 * 1024 * 1024) throw new Error("字体文件超过 30MB 上限");
      return createFont(new Uint8Array(buf));
    })().catch((e) => {
      fontCache.delete(url);
      throw e;
    });
    fontCache.set(url, p);
  }
  return p;
}

function fontInfo(font: AnyFont, source: string): FontInfo {
  const axes: FontInfo["axes"] = {};
  const rawAxes = font.variationAxes ?? {};
  for (const [name, axis] of Object.entries(rawAxes as Record<string, any>)) {
    axes[name] = { min: axis.min, max: axis.max, default: axis.default };
  }
  return {
    family: String(font.familyName ?? ""),
    subfamily: String(font.subfamilyName ?? ""),
    postscriptName: String(font.postscriptName ?? ""),
    unitsPerEm: font.unitsPerEm,
    numGlyphs: font.numGlyphs,
    ascent: font.ascent,
    descent: font.descent,
    lineGap: font.lineGap ?? 0,
    bbox: {
      minX: font.bbox?.minX ?? 0,
      minY: font.bbox?.minY ?? 0,
      maxX: font.bbox?.maxX ?? 0,
      maxY: font.bbox?.maxY ?? 0,
    },
    axes,
    characterSetSize: Array.isArray(font.characterSet) ? font.characterSet.length : 0,
    features: Array.isArray(font.availableFeatures) ? font.availableFeatures : [],
    hasColorGlyphs: Boolean(font.COLR || font.CPAL || font.sbix),
    source,
  };
}

function withVariation(font: AnyFont, axes?: Record<string, number>): AnyFont {
  if (!axes || Object.keys(axes).length === 0) return font;
  if (!font.variationAxes || Object.keys(font.variationAxes).length === 0) return font;
  try {
    return font.getVariation(axes);
  } catch {
    return font;
  }
}

function measure(font: AnyFont, text: string, fontSize: number, features?: string[] | Record<string, boolean>, letterSpacing = 0): number {
  if (!text) return 0;
  const run: AnyRun = font.layout(text, features);
  const scale = fontSize / font.unitsPerEm;
  let width = 0;
  run.positions.forEach((p: any) => {
    width += p.xAdvance * scale + letterSpacing;
  });
  return width - (run.positions.length > 0 ? letterSpacing : 0);
}

function wrapParagraph(
  font: AnyFont,
  paragraph: string,
  fontSize: number,
  maxWidth: number | undefined,
  features: string[] | Record<string, boolean> | undefined,
  letterSpacing: number,
  warnings: Array<{ code: string; message: string }>,
): string[] {
  if (!paragraph) return [""];
  if (!maxWidth || maxWidth <= 0) return [paragraph];
  if (measure(font, paragraph, fontSize, features, letterSpacing) <= maxWidth) return [paragraph];

  const breaker = new (linebreak as any)(paragraph);
  const breaks = new Set<number>();
  let bk: { position: number } | null = null;
  while ((bk = breaker.nextBreak())) breaks.add(bk.position);
  breaks.add(paragraph.length);
  const out: string[] = [];
  let start = 0;
  let lastBreak = 0;
  for (let i = 1; i <= paragraph.length; i++) {
    const candidate = paragraph.slice(start, i);
    if (measure(font, candidate, fontSize, features, letterSpacing) > maxWidth && i > start + 1) {
      const cut = lastBreak > start ? lastBreak : i - 1;
      out.push(paragraph.slice(start, cut));
      start = cut;
      lastBreak = start;
      i = start;
      continue;
    }
    if (breaks.has(i)) lastBreak = i;
  }
  if (start < paragraph.length) out.push(paragraph.slice(start));
  if (out.length === 0) out.push(paragraph);
  // 单字符超过 maxWidth：保留但不静默裁切，给 warning
  for (const line of out) {
    if (line.length === 1 && measure(font, line, fontSize, features, letterSpacing) > maxWidth) {
      warnings.push({ code: "overflow_char", message: `单字符 "${line}" 超过 maxWidth，已保留` });
    }
  }
  return out;
}

function textToSvg(
  font: AnyFont,
  req: Extract<FontWorkerRequest, { op: "text_to_svg" }>,
): TextToSvgResult {
  const fontSize = Math.max(1, req.fontSize);
  const lineHeight = Math.max(0.5, req.lineHeight ?? 1.5);
  const align = req.align ?? "left";
  const fill = req.fill ?? "#ffffff";
  const letterSpacing = req.letterSpacing ?? 0;
  const scale = fontSize / font.unitsPerEm;
  const lineHeightPx = fontSize * lineHeight;
  const ascentPx = font.ascent * scale;
  const descentPx = Math.abs(font.descent) * scale;
  const warnings: Array<{ code: string; message: string }> = [];
  const paragraphs = String(req.text ?? "").split(/\r?\n/);
  const linesText: string[] = [];
  for (const p of paragraphs) {
    linesText.push(...wrapParagraph(font, p, fontSize, req.maxWidth, req.features, letterSpacing, warnings));
  }
  if (linesText.length === 0) linesText.push("");

  const paths: Array<{ type: "path"; props: Record<string, unknown> }> = [];
  const lines: TextLine[] = [];
  let maxLineWidth = 0;
  linesText.forEach((line, lineIndex) => {
    const run: AnyRun = font.layout(line, req.features);
    let width = 0;
    run.positions.forEach((p: any) => {
      width += p.xAdvance * scale + letterSpacing;
    });
    if (run.positions.length > 0) width -= letterSpacing;
    maxLineWidth = Math.max(maxLineWidth, width);
    const baseline = lineIndex * lineHeightPx + (lineHeightPx - (ascentPx + descentPx)) / 2 + ascentPx;
    let x = align === "center" ? -width / 2 : align === "right" ? -width : 0;
    let glyphCount = 0;
    run.glyphs.forEach((glyph: AnyGlyph, i: number) => {
      const pos = run.positions[i];
      if (glyph.id === 0) {
        warnings.push({ code: "missing_glyph", message: `字体缺少字形：${String.fromCodePoint(...(glyph.codePoints ?? [0]))}` });
      }
      const d = glyph.path?.toSVG?.() ?? "";
      if (d) {
        const transformed = svgpath(d)
          .scale(scale, -scale)
          .translate(x + (pos.xOffset ?? 0) * scale, baseline - (pos.yOffset ?? 0) * scale)
          .round(2)
          .toString();
        const props: Record<string, unknown> = { d: transformed, fill };
        if (req.stroke) {
          props.fill = "none";
          props.stroke = req.stroke;
          props.strokeWidth = req.strokeWidth ?? 1;
        }
        paths.push({ type: "path", props });
        glyphCount += 1;
      }
      x += (pos.xAdvance ?? 0) * scale + letterSpacing;
    });
    lines.push({ text: line, width, height: lineHeightPx, baseline, glyphs: glyphCount });
  });

  const width = Math.max(1, Math.ceil(req.maxWidth ?? maxLineWidth));
  const height = Math.max(1, Math.ceil(lineHeightPx * lines.length));
  const offsetX = align === "center" ? width / 2 : align === "right" ? width : 0;
  if (offsetX !== 0) {
    for (const p of paths) {
      const d = String(p.props.d ?? "");
      p.props.d = svgpath(d).translate(offsetX, 0).round(2).toString();
    }
  }
  const viewBox = `0 0 ${width} ${height}`;
  const pathMarkup = paths
    .map((p) => {
      const attrs = Object.entries(p.props)
        .map(([k, v]) => `${k}="${String(v).replace(/"/g, "&quot;")}"`)
        .join(" ");
      return `<path ${attrs}/>`;
    })
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}">${pathMarkup}</svg>`;
  return {
    svg,
    node: { type: "svg", props: { width, height, viewBox, children: paths } },
    width,
    height,
    lines,
    warnings,
  };
}

function glyphs(font: AnyFont, chars: string): { glyphs: GlyphBox[] } {
  const out: GlyphBox[] = [];
  for (const ch of Array.from(chars)) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    const glyph: AnyGlyph = font.glyphForCodePoint(cp);
    out.push({
      char: ch,
      path: glyph.path?.toSVG?.() ?? "",
      advance: glyph.advanceWidth,
      bbox: glyph.bbox
        ? { minX: glyph.bbox.minX, minY: glyph.bbox.minY, maxX: glyph.bbox.maxX, maxY: glyph.bbox.maxY }
        : null,
    });
  }
  return { glyphs: out };
}

self.onmessage = async (ev: MessageEvent<FontWorkerRequest>) => {
  const req = ev.data;
  try {
    if (req.op === "font_info") {
      const font = await loadFont(req.url);
      const res: FontWorkerResponse = { id: req.id, ok: true, result: fontInfo(font, req.url) };
      self.postMessage(res);
      return;
    }
    if (req.op === "text_to_svg") {
      const font = withVariation(await loadFont(req.url), req.axes);
      const res: FontWorkerResponse = { id: req.id, ok: true, result: textToSvg(font, req) };
      self.postMessage(res);
      return;
    }
    if (req.op === "font_glyphs") {
      const font = await loadFont(req.url);
      const res: FontWorkerResponse = { id: req.id, ok: true, result: glyphs(font, req.chars) };
      self.postMessage(res);
      return;
    }
    const res: FontWorkerResponse = { id: (req as { id: number }).id, ok: false, error: "未知字体操作" };
    self.postMessage(res);
  } catch (e) {
    const res: FontWorkerResponse = {
      id: req.id,
      ok: false,
      error: e instanceof Error && e.message ? e.message : String(e),
    };
    self.postMessage(res);
  }
};
