/**
 * TranscriptDoc —— apps/audio-stt/src/transcript.ts（tasks 3.4）
 *
 * canonical 单源（spec「转写产物＝带时间轴的 TranscriptDoc」）：秒制浮点
 * segments/words/language/engine/model——UI 段列表、导出面、WebMCP 返回值
 * 全部从它投影，禁第二份真值。
 */
export interface TranscriptWord {
  /** 词面 */
  text: string;
  /** 开始秒（浮点） */
  start: number;
  /** 结束秒；null＝未知（最后词回退语义） */
  end: number | null;
}

export interface TranscriptSegment {
  id: number;
  text: string;
  start: number;
  /** null＝未知（流式尾段） */
  end: number | null;
  words?: TranscriptWord[];
}

export interface TranscriptDoc {
  segments: TranscriptSegment[];
  language: string;
  engine: "transformers" | "sherpa";
  model: string;
  /** 音频总时长秒（null＝流式未定） */
  duration: number | null;
  createdAt: number;
}

export function emptyDoc(engine: TranscriptDoc["engine"], model: string): TranscriptDoc {
  return { segments: [], language: "", engine, model, duration: null, createdAt: Date.now() };
}

/** 词级回退：末词 end=null 时以段 end（或 start+1s）补——导出/高亮单一出口 */
export function wordEnd(w: TranscriptWord, segEnd: number | null): number {
  return w.end ?? segEnd ?? w.start + 1;
}
