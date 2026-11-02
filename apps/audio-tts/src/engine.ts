/**
 * TTS 引擎装载 —— apps/audio-tts/src/engine.ts（tasks 2.2）
 *
 * sherpa-onnx WASM（vendor 于 ./vendor/sherpa/）＋ Kokoro v1.1-zh int8：
 *  - 模型文件经 ensureModelCached（@fde2e-tools/audio-engine downloader，sha 门）
 *    进 Cache API → fetch 取字节 → FS.writeFile 写 MEMFS → createOfflineTts；
 *  - kokoro case 8 配置＝lexicon 前端（espeak-ng 零依赖，GPL 红线）；
 *  - generateWithConfig 走增量回调（samples 需 slice() 复制出 worker——sherpa
 *    官方 demo 丢 samples 的坑，research §8.2 已记录）。
 *
 * PO② 实测（M 系 WASM 单线程）：RTF≈3.0——单句合成非实时，长文必须句切流式
 * （tasks 2.3，本文件只提供单句原语与引擎生命周期）。
 */
import { KOKORO_V1_1_ZH_INT8, type ModelManifest } from "@fde2e-tools/audio-engine/manifest";
import { ensureModelCached } from "@fde2e-tools/audio-engine/downloader";
import { cachedGet } from "@fde2e-tools/audio-engine/cache";
import { requestPersistence } from "@fde2e-tools/audio-engine/cache";

/** sherpa 包装层（vendor 的 sherpa-onnx-tts.js 经 script 注入后挂 globalThis） */
interface SherpaOfflineTts {
  handle: unknown;
  numSpeakers: number;
  sampleRate: number;
  lang: string;
  generate(cfg: { text: string; sid: number; speed: number }): { samples: Float32Array; sampleRate: number };
  generateWithConfig(
    text: string,
    genConfig: {
      sid: number;
      speed: number;
      callback?: (samples: Float32Array, n: number, progress: number) => number;
    },
  ): { samples: Float32Array; sampleRate: number };
  free(): void;
}

interface SherpaModule {
  FS: {
    writeFile(path: string, data: Uint8Array): void;
    stat(path: string): { size: number };
    unlink(path: string): void;
  };
  ccall: unknown;
  setValue: unknown;
  getValue: unknown;
  lengthBytesUTF8(s: string): number;
  stringToUTF8(s: string, ptr: number, len: number): void;
  UTF8ToString(p: number): string;
  HEAPU8: Uint8Array;
  HEAPU32: Uint32Array;
  HEAPF32: Float32Array;
  _malloc(n: number): number;
  _free(p: number): void;
  _SherpaOnnxCreateOfflineTts(ptr: number): unknown;
  _SherpaOnnxOfflineTtsSampleRate(h: unknown): number;
  _SherpaOnnxOfflineTtsNumSpeakers(h: unknown): number;
}

declare global {
  interface Window {
    createOfflineTts?: (Module: SherpaModule, config: unknown) => SherpaOfflineTts;
  }
}

const VENDOR = "/vendor/sherpa";

async function loadScript(src: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`脚本加载失败: ${src}`));
    document.head.appendChild(s);
  });
}

/** sherpa wasm 装载（一次；Module 全局单例语义——官方 wrapper 直接消费 window.Module） */
async function ensureWasmModule(): Promise<SherpaModule> {
  if ((window as unknown as { Module?: SherpaModule }).Module) {
    return (window as unknown as { Module: SherpaModule }).Module;
  }
  const ready = new Promise<void>((resolve) => {
    (window as unknown as { Module: Record<string, unknown> }).Module = {
      locateFile: (p: string) => `${VENDOR}/${p}`,
      print: (t: string) => console.log("[sherpa]", t),
      printErr: (t: string) => console.error("[sherpa:err]", t),
      onRuntimeInitialized: () => resolve(),
    };
  });
  await loadScript(`${VENDOR}/sherpa-onnx-wasm-main-tts.js`);
  await ready;
  return (window as unknown as { Module: SherpaModule }).Module;
}

export type EnginePhase =
  | { phase: "idle" }
  | { phase: "loading"; detail: string; pct: number }
  | { phase: "ready"; speakers: number; sampleRate: number }
  | { phase: "error"; message: string };

/** 引擎句柄（页生命周期单例） */
export interface TtsEngine {
  tts: SherpaOfflineTts;
  manifest: ModelManifest;
}

let enginePromise: Promise<TtsEngine> | null = null;

/** 引擎装载（幂等）：模型缓存→MEMFS→createOfflineTts。onPhase 供 UI 状态行。 */
export function ensureEngine(
  onPhase?: (p: EnginePhase) => void,
): Promise<TtsEngine> {
  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    try {
      onPhase?.({ phase: "loading", detail: "请求持久化存储", pct: 2 });
      await requestPersistence();

      const m = KOKORO_V1_1_ZH_INT8;
      const total = m.files.length;
      let done = 0;
      onPhase?.({ phase: "loading", detail: "确保模型缓存（sha 门校验）", pct: 5 });
      await ensureModelCached(m, (p) => {
        if (p.phase === "done") done++;
        onPhase?.({
          phase: "loading",
          detail: `模型文件 ${done}/${total}（${p.file}）`,
          pct: 5 + Math.round((done / total) * 55),
        });
      });

      onPhase?.({ phase: "loading", detail: "装载 sherpa WASM", pct: 65 });
      const Module = await ensureWasmModule();

      onPhase?.({ phase: "loading", detail: "模型写入运行时文件系统", pct: 75 });
      for (const f of m.files) {
        const key = m.sources.find((s) => s.id === "selfhost")!.urlTemplate.replace("{path}", f.path);
        const resp = await cachedGet(key);
        if (!resp) throw new Error(`缓存缺文件（异常态）: ${f.path}`);
        const bytes = new Uint8Array(await resp.arrayBuffer());
        // MEMFS 路径＝自托管路径（./model.int8.onnx 相对 cwd 根）
        Module.FS.writeFile(f.path, bytes);
      }

      onPhase?.({ phase: "loading", detail: "创建合成器（Kokoro v1.1-zh int8）", pct: 90 });
      if (!window.createOfflineTts) {
        await loadScript(`${VENDOR}/sherpa-onnx-tts.js`);
      }
      if (!window.createOfflineTts) throw new Error("createOfflineTts 未挂载（包装层加载失败）");

      const config = {
        offlineTtsModelConfig: {
          offlineTtsKokoroModelConfig: {
            model: `./${m.root}/model.int8.onnx`.replace(`./${m.root}/`, "./"),
            voices: "./voices.bin",
            tokens: "./tokens.txt",
            dataDir: "", // v2.0.0 起弃用——lexicon 是前端（GPL-free）
            lexicon: "./lexicon-us-en.txt,./lexicon-zh.txt",
            lang: "",
            lengthScale: 1.0,
          },
          numThreads: 1,
          debug: 0,
          provider: "cpu",
        },
        ruleFsts: "./date-zh.fst,./number-zh.fst,./phone-zh.fst",
        maxNumSentences: 1,
      };
      const tts = window.createOfflineTts(Module, config);
      const speakers = tts.numSpeakers;
      const sampleRate = tts.sampleRate;
      onPhase?.({ phase: "ready", speakers, sampleRate });
      return { tts, manifest: m };
    } catch (e) {
      enginePromise = null; // 允许重试
      const message = e instanceof Error ? e.message : String(e);
      onPhase?.({ phase: "error", message });
      throw e;
    }
  })();
  return enginePromise;
}

/** 单句合成原语（tasks 2.3 的句切调度在此之上） */
export function synthesize(
  engine: TtsEngine,
  text: string,
  sid: number,
  speed: number,
  onChunk?: (samples: Float32Array, progress: number) => void,
): { samples: Float32Array; sampleRate: number } {
  const out = engine.tts.generateWithConfig(text, {
    sid,
    speed,
    callback: onChunk
      ? (samples, _n, progress) => {
          // 增量回调 samples 是 wasm heap 视图——必须复制（官方 demo 丢 samples 坑）
          onChunk?.(samples.slice(), progress);
          return 1; // 1＝继续生成；0＝取消
        }
      : undefined,
  });
  return out;
}
