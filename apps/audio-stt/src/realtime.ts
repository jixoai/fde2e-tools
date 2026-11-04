/**
 * 麦克风实时转写 —— apps/audio-stt/src/realtime.ts（tasks 3.3）
 *
 * AudioWorklet 采集 16kHz PCM（100ms 块）→ sherpa 流式引擎逐块 decode
 * （RTF 0.144 实测，快过实时 7 倍——真流式）→ 中间结果经 onPartial 递进；
 * Silero VAD 切句（sherpa VAD 面同 wasm 核）→ 句界落到 TranscriptDoc segments。
 */
import type { TranscriptDoc, TranscriptSegment } from "./transcript";

const SHERPA = "/vendor/sherpa";
const TARGET_SR = 16000;

interface SherpaOnline {
  createStream(): {
    acceptWaveform(sr: number, samples: Float32Array): void;
    inputFinished(): void;
  };
  isReady(stream: unknown): boolean;
  decode(stream: unknown): void;
  isEndpoint(stream: unknown): boolean;
  reset(stream: unknown): void;
  getResult(stream: unknown): string | { text?: string; json?: string };
}

async function loadScript(src: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`脚本加载失败: ${src}`));
    document.head.appendChild(s);
  });
}

async function ensureStreamingEngine(
  onPhase: (detail: string, pct: number) => void,
): Promise<SherpaOnline> {
  const w = window as unknown as {
    Module?: unknown;
    createOnlineRecognizer?: (Module: unknown, cfg: unknown) => SherpaOnline;
  };
  if (w.createOnlineRecognizer && w.Module) return w.createOnlineRecognizer(w.Module, streamingConfig());

  let ready: Promise<void>;
  if (!w.Module) {
    ready = new Promise<void>((resolve) => {
      (w as { Module: Record<string, unknown> }).Module = {
        locateFile: (p: string) => `${SHERPA}/${p}`,
        print: (t: string) => console.log("[sherpa]", t),
        printErr: (t: string) => console.error("[sherpa:err]", t),
        onRuntimeInitialized: () => resolve(),
      };
    });
  } else {
    ready = Promise.resolve();
  }
  onPhase("装载 sherpa WASM（流式核）", 10);
  await loadScript(`${SHERPA}/sherpa-onnx-wasm-main-asr.js`);
  await ready;
  const Module = w.Module as { FS: { writeFile: (p: string, d: Uint8Array) => void }; ccall: unknown };
  const { modelById } = await import("@fde2e-tools/audio-engine/manifest");
  const { ensureModelCached, cachedGet } = await import("@fde2e-tools/audio-engine/downloader");
  for (const modelId of ["zipformer-bilingual-streaming", "silero-vad"] as const) {
    const m = modelById(modelId);
    if (!m) throw new Error('manifest 缺模型: ' + modelId);
    onPhase(`确保缓存：${m.name}`, 20);
    await ensureModelCached(m, undefined);
    for (const f of m.files) {
      const key = m.sources.find((s) => s.id === "selfhost")!.urlTemplate.replace("{path}", f.path);
      const resp = await cachedGet(key);
      if (!resp) throw new Error(`缓存缺文件: ${f.path}`);
      Module.FS.writeFile(f.path, new Uint8Array(await resp.arrayBuffer()));
    }
  }
  onPhase("创建流式识别器", 90);
  await loadScript(`${SHERPA}/sherpa-onnx-asr.js`);
  if (!w.createOnlineRecognizer) throw new Error("createOnlineRecognizer 未挂载");
  return w.createOnlineRecognizer(w.Module, streamingConfig());
}

function streamingConfig(): unknown {
  return {
    modelConfig: {
      transducer: {
        encoder: "./encoder-epoch-99-avg-1.int8.onnx",
        decoder: "./decoder-epoch-99-avg-1.onnx",
        joiner: "./joiner-epoch-99-avg-1.int8.onnx",
      },
      tokens: "./tokens.txt",
      numThreads: 1,
      debug: 0,
      provider: "cpu",
    },
    decodingMethod: "greedy_search",
    enableEndpoint: 1,
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: 1.2,
    rule3MinUtteranceLength: 20,
  };
}

export interface RealtimeHandle {
  stop(): Promise<void>;
}

/** 启动麦克风实时转写；segments 经 onDoc 递进（canonical TranscriptDoc 单源投影） */
export async function startRealtime(
  onPhase: (detail: string, pct: number) => void,
  onDoc: (doc: TranscriptDoc) => void,
): Promise<RealtimeHandle> {
  const rec = await ensureStreamingEngine(onPhase);
  const audioCtx = new AudioContext({ sampleRate: TARGET_SR });
  await audioCtx.audioWorklet.addModule(new URL("./mic-worklet.js", import.meta.url));
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
  });
  const source = audioCtx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(audioCtx, "mic-capture");
  // Worklet 必须接入一条可被音频引擎持续拉取的输出图；只 source.connect(node)
  // 而无下游时 Chromium 会裁剪节点，真实麦克风已授权但永远没有 PCM 回调。
  // 零增益 sink 保持静音，避免把麦克风回放到扬声器形成啸叫。
  const sink = audioCtx.createGain();
  sink.gain.value = 0;
  source.connect(node);
  node.connect(sink).connect(audioCtx.destination);
  await audioCtx.resume();
  if (audioCtx.state !== "running") {
    source.disconnect();
    node.disconnect();
    sink.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    await audioCtx.close().catch(() => undefined);
    throw new Error(`音频上下文未启动（state=${audioCtx.state}）——请再次点击麦克风按钮`);
  }

  const segs: TranscriptSegment[] = [];
  let currentText = "";
  let ended = false;
  let hasDecoded = false;
  let segStart = 0;
  let clock = 0; // 已喂秒数

  const recStream = rec.createStream();
  node.port.onmessage = (e: MessageEvent<{ type: string; samples?: Float32Array }>) => {
    if (e.data.type !== "pcm" || ended) return;
    const samples = e.data.samples!;
    recStream.acceptWaveform(TARGET_SR, samples);
    clock += samples.length / TARGET_SR;
    while (rec.isReady(recStream)) {
      rec.decode(recStream);
      hasDecoded = true;
    }
    // Sherpa 浏览器 WASM 在第一次 decode 前调用 getResult 会抛
    // RuntimeError("null function")；POC 按秒读结果曾绕过该窗口。结果与
    // endpoint 投影必须以「至少一次 decode 已完成」为权威门。
    if (!hasDecoded) return;
    // 端点检测（句界）→ 落段
    if (rec.isEndpoint(recStream)) {
      const raw = rec.getResult(recStream);
      const parsed = typeof raw === "string" ? (JSON.parse(raw) as { text?: string }) : raw;
      const text = String(parsed.text ?? "").trim();
      // endpoint 的最终文本通常与上一帧 partial 相等；拿 currentText 去重会把
      // 整句清空。只与已落段比对，partial 相等仍须闭合成正式 segment。
      if (text && segs.at(-1)?.text !== text) {
        segs.push({ id: segs.length, text, start: segStart, end: clock });
      }
      currentText = "";
      segStart = clock;
      rec.reset(recStream);
    } else {
      const raw = rec.getResult(recStream);
      const parsed = typeof raw === "string" ? (JSON.parse(raw) as { text?: string }) : raw;
      currentText = String(parsed.text ?? "").trim();
    }
    onDoc({
      segments: [...segs, ...(currentText ? [{ id: segs.length, text: currentText, start: segStart, end: null }] : [])],
      language: "zh",
      engine: "sherpa",
      model: "zipformer-bilingual-streaming",
      duration: null,
      createdAt: Date.now(),
    });
  };

  return {
    async stop() {
      ended = true;
      node.port.postMessage({ type: "stop" });
      recStream.inputFinished();
      while (rec.isReady(recStream)) {
        rec.decode(recStream);
        hasDecoded = true;
      }
      if (hasDecoded) {
        const raw = rec.getResult(recStream);
        const parsed = typeof raw === "string" ? (JSON.parse(raw) as { text?: string }) : raw;
        const finalText = String(parsed.text ?? currentText).trim() || currentText;
        if (finalText && segs.at(-1)?.text !== finalText) {
          segs.push({ id: segs.length, text: finalText, start: segStart, end: clock });
        }
        currentText = "";
        onDoc({
          segments: [...segs],
          language: "zh",
          engine: "sherpa",
          model: "zipformer-bilingual-streaming",
          duration: clock,
          createdAt: Date.now(),
        });
      }
      source.disconnect();
      node.disconnect();
      sink.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      await audioCtx.close().catch(() => undefined);
    },
  };
}
