/**
 * 导出 formatter —— apps/audio-stt/src/export-formats.ts（tasks 3.4）
 *
 * 自写 ≤120 行（spec 红线：不引三方库）；边界处理参照 Verbatim export.rs
 * （MIT，形态翻译）：0.2s 最短 cue / 空段过滤 / `-->` 转义 / end null 回退。
 * 导出文件名契约 `<站id>-<格式>.<ext>` 由调用方（App/downloadBlob）承担。
 */
import type { TranscriptDoc, TranscriptSegment } from "./transcript";

/** 秒 → HH:MM:SS,mmm（SRT 逗号毫秒） */
function srtTime(t: number): string {
  const clamped = Math.max(0, t);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const ms = Math.round((clamped - Math.floor(clamped)) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

/** 秒 → HH:MM:SS.mmm（VTT 点毫秒） */
function vttTime(t: number): string {
  return srtTime(t).replace(",", ".");
}

const MIN_CUE = 0.2; // 最短 cue 时长（秒）

/** 有效段（空文本/负时长过滤；end null 回退 start+2s） */
function validSegments(doc: TranscriptDoc): TranscriptSegment[] {
  return doc.segments.filter((s) => s.text.trim().length > 0);
}

function cueEnd(s: TranscriptSegment): number {
  const end = s.end ?? s.start + 2;
  return Math.max(end, s.start + MIN_CUE);
}

export function toSrt(doc: TranscriptDoc): string {
  const lines: string[] = [];
  let n = 1;
  for (const s of validSegments(doc)) {
    const end = cueEnd(s);
    lines.push(String(n++));
    lines.push(`${srtTime(s.start)} --> ${srtTime(end)}`);
    // cue 文本内 --> 转义（SRT 无官方转义——以全角连字符替换避免解析歧义）
    lines.push(s.text.replace(/-->/g, "→"));
    lines.push("");
  }
  return lines.join("\n");
}

export function toVtt(doc: TranscriptDoc): string {
  const lines: string[] = ["WEBVTT", ""];
  for (const s of validSegments(doc)) {
    const end = cueEnd(s);
    lines.push(`${vttTime(s.start)} --> ${vttTime(end)}`);
    lines.push(s.text.replace(/-->/g, "→"));
    lines.push("");
  }
  return lines.join("\n");
}

export function toTxt(doc: TranscriptDoc): string {
  return validSegments(doc)
    .map((s) => s.text)
    .join("\n");
}

export function toJson(doc: TranscriptDoc): string {
  // 可回放还原段表：词级 end null 保持 null（JSON 语义不丢失）
  return JSON.stringify(doc, null, 2);
}
