/**
 * STT 引擎装载 —— apps/audio-stt/src/engine.ts（tasks 3.1/3.2）
 *
 * 双轨（spec「引擎双轨与设备分层」）：
 *  - transformers.js（默认档）：whisper-base q8 WASM 兜底；自托管源＝
 *    env.remoteHost 指同源（POC ③ 已证 localModelPath 不认 http URL）；
 *  - sherpa（中文优先档）：SenseVoice int8，fetch→MEMFS（POC ①② 已证）。
 *
 * 分片防御（#1739）：长音频按 CHUNK_SEC 切片，每 REBUILD_EVERY 片重建 pipeline
 * （GPU 泄漏防御；WASM 路径同样按片推进）。
 */
import { WHISPER_BASE_Q8, SENSEVOICE_SMALL_INT8, type ModelManifest } from "@fde2e-tools/audio-engine/manifest";
import { ensureModelCached, cachedGet } from "@fde2e-tools/audio-engine/downloader";
import type { TranscriptDoc, TranscriptSegment } from "./transcript";

const SHERPA = "/vendor/sherpa";
// ORT wasm 走 npm 包内 dist（vite 处理 URL——wasm 拷 dist 是上游标准形态）

export type SttModelId = "whisper-base-q8" | "sensevoice-small-int8";

export interface SttModelInfo {
  id: SttModelId;
  name: string;
  engine: TranscriptDoc["engine"];
  manifest: ModelManifest;
}

export const STT_MODELS: SttModelInfo[] = [
  { id: "whisper-base-q8", name: "Whisper Base q8（多语兜底 77MB）", engine: "transformers", manifest: WHISPER_BASE_Q8 },
  { id: "sensevoice-small-int8", name: "SenseVoice Small int8（中文优先 228MB）", engine: "sherpa", manifest: SENSEVOICE_SMALL_INT8 },
];

export function modelById(id: SttModelId): SttModelInfo {
  const m = STT_MODELS.find((x) => x.id === id);
  if (!m) throw new Error(`未知模型 ${id}`);
  return m;
}

export type EnginePhase =
  | { phase: "idle" }
  | { phase: "loading"; detail: string; pct: number }
  | { phase: "ready" }
  | { phase: "error"; message: string };

async function loadScript(src: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`脚本加载失败: ${src}`));
    document.head.appendChild(s);
  });
}

/* ── transformers.js（whisper）── */

interface TjsAsr {
  (audio: Float32Array | string, opts?: Record<string, unknown>): Promise<{ text: string; chunks?: Array<{ text: string; timestamp: [number, number | null] }> }>;
}

interface TjsModule {
  pipeline(task: string, model: string, opts: Record<string, unknown>): Promise<TjsAsr>;
  env: {
    allowLocalModels: boolean;
    allowRemoteModels: boolean;
    remoteHost: string;
    remotePathTemplate: string;
    useBrowserCache: boolean;
    backends: { onnx: { wasm: { wasmPaths: string } } };
  };
}


declare global {
  interface Window {
    __sttTjs?: TjsModule;
    __sttWhisper?: Record<string, TjsAsr>; // key=modelId
    Module?: unknown;
    createOnlineRecognizer?: (Module: unknown, config: unknown) => unknown;
    OfflineRecognizer?: new (config: unknown, Module: unknown) => SherpaOfflineAsr;
  }
}

async function ensureTjs(): Promise<TjsModule> {
  if (window.__sttTjs) return window.__sttTjs;
  const tjs = await import("@huggingface/transformers");
  // 自托管同源语义（POC ③）：remoteHost 指本源；服务器 mirror 同构 HF 路径
  const env = tjs.env as TjsModule["env"];
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.remoteHost = `${location.origin}/model/`;
  env.remotePathTemplate = "{model}/resolve/{revision}/";
  env.useBrowserCache = true;
  window.__sttTjs = tjs as unknown as TjsModule;
  return tjs as unknown as TjsModule;
}

/** whisper 装载（幂等 per modelId）；ensureModelCached 先行（sha 门） */
async function ensureWhisper(
  info: SttModelInfo,
  onPhase: (p: EnginePhase) => void,
): Promise<TjsAsr> {
  window.__sttWhisper ??= {};
  const cached = window.__sttWhisper[info.id];
  if (cached) return cached;

  const m = info.manifest;
  const total = m.files.length;
  let done = 0;
  onPhase({ phase: "loading", detail: "确保模型缓存（sha 门校验）", pct: 5 });
  await ensureModelCached(m, (p) => {
    if (p.phase === "done") done++;
    onPhase({ phase: "loading", detail: `模型文件 ${done}/${total}`, pct: 5 + Math.round((done / total) * 50) });
  });

  onPhase({ phase: "loading", detail: "装载 transformers.js", pct: 60 });
  const tjs = await ensureTjs();
  onPhase({ phase: "loading", detail: `创建 pipeline（${info.id}）`, pct: 80 });
  const asr = await tjs.pipeline("automatic-speech-recognition", m.upstreamId, {
    dtype: "q8",
    progress_callback: null,
    local_files_only: false,
  });
  window.__sttWhisper[info.id] = asr;
  return asr;
}

/* ── sherpa（SenseVoice）── */

interface SherpaOfflineAsr {
  createStream(): { acceptWaveform(sr: number, samples: Float32Array): void };
  decode(stream: unknown): void;
  getResult(stream: unknown): string | Record<string, unknown>;
}

async function ensureSherpa(
  info: SttModelInfo,
  onPhase: (p: EnginePhase) => void,
): Promise<SherpaOfflineAsr> {
  if (window.OfflineRecognizer) {
    // 复用已挂 Module（幂等）；Recognizer 每次重建轻量
    return buildSherpaRecognizer(info, onPhase);
  }
  const ready = new Promise<void>((resolve) => {
    (window as unknown as { Module: Record<string, unknown> }).Module = {
      locateFile: (p: string) => `${SHERPA}/${p}`,
      print: (t: string) => console.log("[sherpa]", t),
      printErr: (t: string) => console.error("[sherpa:err]", t),
      onRuntimeInitialized: () => resolve(),
    };
  });
  onPhase({ phase: "loading", detail: "确保模型缓存（sha 门校验）", pct: 5 });
  const m = info.manifest;
  const total = m.files.length;
  let done = 0;
  await ensureModelCached(m, (p) => {
    if (p.phase === "done") done++;
    onPhase({ phase: "loading", detail: `模型文件 ${done}/${total}`, pct: 5 + Math.round((done / total) * 50) });
  });
  onPhase({ phase: "loading", detail: "装载 sherpa WASM", pct: 60 });
  await loadScript(`${SHERPA}/sherpa-onnx-wasm-main-asr.js`);
  await ready;
  const Module = (window as unknown as { Module: { FS: { writeFile: (p: string, d: Uint8Array) => void } } }).Module;
  onPhase({ phase: "loading", detail: "模型写入运行时文件系统", pct: 75 });
  for (const f of m.files) {
    const key = m.sources.find((s) => s.id === "selfhost")!.urlTemplate.replace("{path}", f.path);
    const resp = await cachedGet(key);
    if (!resp) throw new Error(`缓存缺文件（异常态）: ${f.path}`);
    Module.FS.writeFile(f.path, new Uint8Array(await resp.arrayBuffer()));
  }
  onPhase({ phase: "loading", detail: "创建识别器（SenseVoice int8）", pct: 90 });
  await loadScript(`${SHERPA}/sherpa-onnx-asr.js`);
  return buildSherpaRecognizer(info, onPhase);
}

async function buildSherpaRecognizer(_info: SttModelInfo, onPhase: (p: EnginePhase) => void): Promise<SherpaOfflineAsr> {
  const Module = (window as unknown as { Module: unknown }).Module;
  if (!window.OfflineRecognizer) {
    await loadScript(`${SHERPA}/sherpa-onnx-asr.js`);
  }
  if (!window.OfflineRecognizer) throw new Error("OfflineRecognizer 未挂载（包装层加载失败）");
  onPhase({ phase: "loading", detail: "创建识别器", pct: 92 });
  return new window.OfflineRecognizer(
    {
      modelConfig: {
        senseVoice: {
          model: "./model.int8.onnx",
          language: "", // 空＝auto
          useInverseTextNormalization: 1,
        },
        tokens: "./tokens.txt",
        numThreads: 1,
        debug: 0,
        provider: "cpu",
      },
      decodingMethod: "greedy_search",
    },
    Module,
  );
}

/* ── 音频解码与分片 ── */

const TARGET_SR = 16000; // whisper 与 SenseVoice 同采样率
const CHUNK_SEC = 30; // 分片转写（#1739 长音频防御）
const REBUILD_EVERY = 6; // 每 N 片重建 pipeline（GPU 泄漏防御）

/** 文件 → 16kHz Float32 PCM（decodeAudioData 重采样由 AudioContext 承担） */
export async function decodeToPcm(file: File | Blob): Promise<Float32Array> {
  const ctx = new AudioContext({ sampleRate: TARGET_SR });
  try {
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    // 混单声道
    if (buf.numberOfChannels === 1) return buf.getChannelData(0);
    const out = new Float32Array(buf.length);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) out[i] += d[i] / buf.numberOfChannels;
    }
    return out;
  } finally {
    void ctx.close();
  }
}

/** 支持格式白名单（spec：不支持列白名单明示；decodeAudioData 实际矩阵更宽，白名单＝承诺面） */
export const SUPPORTED_EXT = ["wav", "mp3", "m4a", "aac", "ogg", "opus", "flac", "webm", "mp4", "mov"];
export function isSupportedFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return SUPPORTED_EXT.includes(ext);
}

/** 幻觉抑制参照常量（OpenAI whisper 口径；spec 3.1） */
export const HALLUCINATION = { repeatThreshold: 2.4, logprob: -1.0, compression: 0.6 };

/** 输出重复率检测：同一行文本在输出中反复出现＝幻觉特征 */
export function looksLikeHallucination(segments: TranscriptSegment[]): boolean {
  const texts = segments.map((s) => s.text.trim()).filter(Boolean);
  if (texts.length < 4) return false;
  const counts = new Map<string, number>();
  for (const t of texts) counts.set(t, (counts.get(t) ?? 0) + 1);
  const top = [...counts.values()].sort((a, b) => b - a)[0] ?? 0;
  return top / texts.length > 0.5 && texts.length >= 6; // 过半重复才判
}

/* ── 转写主链 ── */

export interface TranscribeResult {
  doc: TranscriptDoc;
  hallucinationWarning: boolean;
}

/** 文件转写主链（分片＋重建＋进度回调） */
export async function transcribe(
  file: File | Blob,
  modelId: SttModelId,
  onPhase: (p: EnginePhase) => void,
  onPartial?: (doc: TranscriptDoc) => void,
  cancelRef?: { cancelled: boolean },
): Promise<TranscribeResult> {
  const info = modelById(modelId);
  onPhase({ phase: "loading", detail: "解码音频（16kHz 单声道）", pct: 0 });
  const pcm = await decodeToPcm(file);
  const duration = pcm.length / TARGET_SR;

  if (info.engine === "transformers") {
    return transcribeWhisper(info, pcm, duration, onPhase, onPartial, cancelRef);
  }
  return transcribeSenseVoice(info, pcm, duration, onPhase, onPartial, cancelRef);
}

async function transcribeWhisper(
  info: SttModelInfo,
  pcm: Float32Array,
  duration: number,
  onPhase: (p: EnginePhase) => void,
  onPartial?: (doc: TranscriptDoc) => void,
  cancelRef?: { cancelled: boolean },
): Promise<TranscribeResult> {
  let asr = await ensureWhisper(info, onPhase);
  const segments: TranscriptSegment[] = [];
  const nChunks = Math.ceil(pcm.length / (CHUNK_SEC * TARGET_SR));
  for (let c = 0; c < nChunks; c++) {
    if (cancelRef?.cancelled) throw new Error("已取消");
    const slice = pcm.subarray(c * CHUNK_SEC * TARGET_SR, (c + 1) * CHUNK_SEC * TARGET_SR);
    if (slice.length < TARGET_SR * 0.2) break; // <0.2s 尾片跳过
    onPhase({ phase: "loading", detail: `转写分片 ${c + 1}/${nChunks}`, pct: 10 + Math.round((c / nChunks) * 80) });
    // 每 REBUILD_EVERY 片重建（#1739 GPU 泄漏防御；重载成本≈首载 pipeline 缓存命中）
    if (c > 0 && c % REBUILD_EVERY === 0) {
      window.__sttWhisper![info.id] = undefined as unknown as TjsAsr;
      delete window.__sttWhisper![info.id];
      asr = await ensureWhisper(info, onPhase);
    }
    const out = await asr(slice, {
      return_timestamps: true,
      chunk_length_s: CHUNK_SEC,
      stride_length_s: 5,
      language: "chinese",
      task: "transcribe",
    });
    const offset = c * CHUNK_SEC;
    if (out.chunks?.length) {
      for (const chunk of out.chunks) {
        const [start, end] = chunk.timestamp;
        if (start === null) continue;
        segments.push({
          id: segments.length,
          text: chunk.text.trim(),
          start: offset + start,
          end: end === null ? null : offset + end,
        });
      }
    } else if (out.text.trim()) {
      segments.push({ id: segments.length, text: out.text.trim(), start: offset, end: offset + slice.length / TARGET_SR });
    }
    onPartial?.({
      segments: [...segments],
      language: "zh",
      engine: "transformers",
      model: info.id,
      duration,
      createdAt: Date.now(),
    });
  }
  onPhase({ phase: "ready" });
  const doc: TranscriptDoc = { segments, language: "zh", engine: "transformers", model: info.id, duration, createdAt: Date.now() };
  return { doc, hallucinationWarning: looksLikeHallucination(segments) };
}

async function transcribeSenseVoice(
  info: SttModelInfo,
  pcm: Float32Array,
  duration: number,
  onPhase: (p: EnginePhase) => void,
  onPartial?: (doc: TranscriptDoc) => void,
  cancelRef?: { cancelled: boolean },
): Promise<TranscribeResult> {
  const rec = await ensureSherpa(info, onPhase);
  const segments: TranscriptSegment[] = [];
  const nChunks = Math.ceil(pcm.length / (CHUNK_SEC * TARGET_SR));
  for (let c = 0; c < nChunks; c++) {
    if (cancelRef?.cancelled) throw new Error("已取消");
    const slice = pcm.subarray(c * CHUNK_SEC * TARGET_SR, (c + 1) * CHUNK_SEC * TARGET_SR);
    if (slice.length < TARGET_SR * 0.2) break;
    onPhase({ phase: "loading", detail: `转写分片 ${c + 1}/${nChunks}`, pct: 10 + Math.round((c / nChunks) * 80) });
    const stream = rec.createStream();
    stream.acceptWaveform(TARGET_SR, slice);
    rec.decode(stream);
    const raw = rec.getResult(stream);
    const parsed = typeof raw === "string" ? (JSON.parse(raw) as { text?: string }) : raw;
    const text = String(parsed.text ?? "").replace(/<\|[^|]*\|>/g, "").trim(); // SenseVoice 标签清理
    if (text) {
      segments.push({ id: segments.length, text, start: c * CHUNK_SEC, end: c * CHUNK_SEC + slice.length / TARGET_SR });
    }
    onPartial?.({
      segments: [...segments],
      language: "zh",
      engine: "sherpa",
      model: info.id,
      duration,
      createdAt: Date.now(),
    });
  }
  onPhase({ phase: "ready" });
  const doc: TranscriptDoc = { segments, language: "zh", engine: "sherpa", model: info.id, duration, createdAt: Date.now() };
  return { doc, hallucinationWarning: looksLikeHallucination(segments) };
}
