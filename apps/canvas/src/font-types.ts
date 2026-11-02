/*
 * 字体管线共享类型 —— apps/canvas/src/font-types.ts
 * Worker 与主线程共用；不依赖 DOM。
 */

export interface FontInfo {
  family: string;
  subfamily: string;
  postscriptName: string;
  unitsPerEm: number;
  numGlyphs: number;
  ascent: number;
  descent: number;
  lineGap: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  axes: Record<string, { min: number; max: number; default: number }>;
  characterSetSize: number;
  features: string[];
  hasColorGlyphs: boolean;
  source: string;
}

export interface GlyphBox {
  char: string;
  path: string;
  advance: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

export interface TextLine {
  text: string;
  width: number;
  height: number;
  baseline: number;
  glyphs: number;
}

export interface TextToSvgResult {
  svg: string;
  node: {
    type: "svg";
    props: {
      width: number;
      height: number;
      viewBox: string;
      children: Array<{ type: "path"; props: Record<string, unknown> }>;
    };
  };
  width: number;
  height: number;
  lines: TextLine[];
  warnings: Array<{ code: string; message: string }>;
}

export type FontWorkerRequest =
  | { id: number; op: "font_info"; url: string }
  | {
      id: number;
      op: "text_to_svg";
      url: string;
      text: string;
      fontSize: number;
      lineHeight?: number;
      maxWidth?: number;
      align?: "left" | "center" | "right";
      letterSpacing?: number;
      fill?: string;
      stroke?: string;
      strokeWidth?: number;
      features?: string[] | Record<string, boolean>;
      axes?: Record<string, number>;
    }
  | { id: number; op: "font_glyphs"; url: string; chars: string };

export type FontWorkerResponse =
  | { id: number; ok: true; result: FontInfo | TextToSvgResult | { glyphs: GlyphBox[] } }
  | { id: number; ok: false; error: string };
