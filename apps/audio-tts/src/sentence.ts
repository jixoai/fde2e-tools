/**
 * 句切 —— apps/audio-tts/src/sentence.ts（tasks 2.3 前置）
 *
 * v1.1-zh 约束（spec TTS 长文本流式 Requirement）：每句 ≤80-100 音素
 * （>100 rushing、510 硬上限）。按中英终止标点切＋超长句逗号二次切；
 * 缩写/小数保护（Mr./3.14 不切）。稳定 ID＝句序（重生成场景 text hash 由
 * 上层缓存键承担，本层只管切分确定性）。
 */
export interface Sentence {
  id: number;
  text: string;
}

/** 中英终止标点（句级）与次级标点（超长句内切） */
const TERMINAL = /([。！？!?；;]|(?<=[a-z)])\.)/;
const SECONDARY = /([，,、：:])/;
/** 缩写/小数保护：单字母点（U.S.）与数字点（3.14）不切 */
const SAFE_DOT = /([A-Za-z]\.)|(\d\.)$/;

const MAX_CHARS = 60; // 中文≈60 字 ≈80-100 音素（保守档，实测句长可调）
const MIN_CHARS = 2;

/** 缩写保护下的标点切分 */
function splitBy(text: string, re: RegExp): string[] {
  const parts: string[] = [];
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    cur += text[i];
    if (re.test(cur)) {
      // SAFE_DOT：点结尾但属缩写/小数 → 不切
      if (cur.endsWith(".") && SAFE_DOT.test(cur)) continue;
      parts.push(cur);
      cur = "";
    }
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

/** 超长句二次切（逗号/顿号；仍超长则硬切） */
function splitLong(part: string, out: string[]): void {
  if (part.length <= MAX_CHARS) {
    out.push(part);
    return;
  }
  const secs = splitBy(part, SECONDARY);
  let buf = "";
  for (const sec of secs) {
    if ((buf + sec).length > MAX_CHARS && buf.trim()) {
      out.push(buf);
      buf = sec;
    } else {
      buf += sec;
    }
  }
  if (buf.trim()) {
    if (buf.length > MAX_CHARS * 1.5) {
      // 无标点长串硬切
      for (let i = 0; i < buf.length; i += MAX_CHARS) out.push(buf.slice(i, i + MAX_CHARS));
    } else out.push(buf);
  }
}

/** 文本 → 稳定 ID 句列（空白段过滤；结果确定性——同输入同输出） */
export function splitSentences(text: string): Sentence[] {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];
  const paras = normalized.split(/\n+/).filter((p) => p.trim());
  const raw: string[] = [];
  for (const p of paras) {
    const parts = splitBy(p, TERMINAL);
    for (const part of parts) splitLong(part, raw);
  }
  return raw
    .map((t) => t.trim())
    .filter((t) => t.length >= MIN_CHARS)
    .map((text, id) => ({ id, text }));
}
