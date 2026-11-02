/**
 * 模型下载集成层 —— packages/audio-engine/src/downloader.ts（tasks 1.3）
 *
 * 浏览器端消费 vendored smart-dl-core（IIFE，globalThis.FDE2ESmartDLCore）：
 *  - 源池三源（spec「模型分发路由」）：①自托管同源（primary+最终兜底）
 *    ②ModelScope 解析直链 ③HF 官方直链（海外可选）；
 *  - expectedSha256 全挂 manifest（禁 no-expected 出现在线上路径）；
 *  - 下载产物入 Cache API（cache.ts），transformers.js/sherpa 装载时先查缓存；
 *  - 实测约束（2026-11-02，research §6 回填）：ModelScope resolve 对 Range 回
 *    200 全量非 206——downloader 的 206 分片语义对 200-Range 源会卡死，因此
 *    小件（<4MiB）与 200-Range 探测命中的源走单请求直取路径（noRange 语义）。
 *
 * 本层不碰 UI：进度经 onProgress 回调给 app（shadcn 官方仪表件收编形态由
 * app 层组合，本仓组件红线＝官方一手源）。
 */
import type { ModelManifest, ModelFile, ModelSource } from "./manifest";

/* vendored IIFE 的结构化最小面（与主仓冻结 API 对齐；只取本层用到的） */
interface SmartDLSource {
  id: string;
  make: (u: string) => string;
}
interface SmartDLCore {
  CHUNK: number;
  Download: new (
    opts: {
      ghUrl: string;
      name?: string;
      size?: number;
      expectedSha256?: string | null;
      sources?: SmartDLSource[];
      appId?: string;
    },
    io: Record<string, unknown>,
  ) => {
    run(): Promise<"done" | "paused">;
    verifySha256(): Promise<{ status: "match" | "mismatch" | "no-expected" }>;
    assembleBytes(): Promise<Uint8Array>;
    onProgress: (cb: (st: { done: number; total: number; pct: number; bps: number }) => void) => void;
    doneBytes: number;
    total: number;
  };
  Source: new (id: string, make: (u: string) => string) => SmartDLSource;
  fmtBytes: (n: number) => string;
  /* IDB 块仓（冻结 API；DB 名内置 fde2e-smart-dl；键位 `${name}:${size}:${idx}`） */
  idbOpen(): Promise<unknown>;
  idbPut(db: unknown, key: string, blob: Blob): Promise<void>;
  idbGet(db: unknown, key: string): Promise<Blob | null>;
  idbClear(db: unknown, prefix: string): Promise<void>;
}

declare global {
  interface Window {
    FDE2ESmartDLCore?: SmartDLCore;
  }
}

/** 载入 vendored bundle（静态资源路径；app 构建时随 dist 分发） */
export async function loadSmartDLCore(src = "/vendor/smart-dl-core.js"): Promise<SmartDLCore> {
  if (window.FDE2ESmartDLCore) return window.FDE2ESmartDLCore;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`smart-dl-core 加载失败: ${src}`));
    document.head.appendChild(s);
  });
  if (!window.FDE2ESmartDLCore) throw new Error("smart-dl-core 已加载但 FDE2ESmartDLCore 未挂载");
  return window.FDE2ESmartDLCore;
}

/** 下载进度快照（app 层仪表件数据源） */
export interface DownloadProgress {
  file: string;
  done: number;
  total: number;
  pct: number;
  bps: number;
  phase: "probing" | "downloading" | "verifying" | "done" | "failed";
  sourceId?: string;
  error?: string;
}

export type ProgressCb = (p: DownloadProgress) => void;

/** 源可用性探针（Range 0-0）：206＝支持分片；200＝全量源（直取路径）；4xx/5xx＝跳源 */
async function probeSource(
  url: string,
): Promise<{ usable: boolean; rangeOk: boolean; status: number }> {
  try {
    const r = await fetch(url, { headers: { range: "bytes=0-0" }, signal: AbortSignal.timeout(15000) });
    if (r.status === 206) return { usable: true, rangeOk: true, status: 206 };
    if (r.ok) return { usable: true, rangeOk: false, status: r.status };
    return { usable: false, rangeOk: false, status: r.status };
  } catch {
    return { usable: false, rangeOk: false, status: 0 };
  }
}

function urlFor(_m: ModelManifest, s: ModelSource, f: ModelFile): string {
  if (s.id === "selfhost") return s.urlTemplate.replace("{path}", f.path);
  if (s.id === "modelscope") return s.urlTemplate.replace("{pathEnc}", encodeURIComponent(f.path)).replace("{path}", f.path);
  if (s.id === "hf") return s.urlTemplate.replace("{path}", f.path);
  throw new Error(`未知源 id: ${s.id}`);
}

const SMALL_FILE = 4 * 1024 * 1024; // 与 models-fetch.mjs 同一阈值（单 chunk 语义）

/**
 * 确保单文件在缓存中（sha 门 fail-closed）；返回缓存 URL 供引擎装载取用。
 * 自托管相对路径作为 Cache 键（同源语义）；跨源直取时以最终 URL 为键——
 * 引擎装载侧统一走 cacheKeyOf() 查缓存，不感知下载走哪条源。
 */
export async function ensureFileCached(
  m: ModelManifest,
  f: ModelFile,
  onProgress?: ProgressCb,
  coreLoader: () => Promise<SmartDLCore> = () => loadSmartDLCore(),
): Promise<string> {
  const { cachedGet, cachedPut } = await import("./cache");
  const selfhostSource = m.sources.find((s) => s.id === "selfhost");
  const cacheKey = selfhostSource ? selfhostSource.urlTemplate.replace("{path}", f.path) : f.path;

  const hit = await cachedGet(cacheKey);
  if (hit) {
    onProgress?.({ file: f.path, done: f.bytes, total: f.bytes, pct: 100, bps: 0, phase: "done" });
    return cacheKey;
  }

  let lastErr: Error | null = null;
  for (const s of m.sources) {
    const url = urlFor(m, s, f);
    const probe = await probeSource(url);
    if (!probe.usable) {
      lastErr = new Error(`源 ${s.id} 不可用（HTTP ${probe.status}）`);
      continue;
    }
    try {
      onProgress?.({ file: f.path, done: 0, total: f.bytes, pct: 0, bps: 0, phase: "probing", sourceId: s.id });

      // 直取路径：小文件，或源不支持 Range（200-Range 实测：ModelScope resolve）
      if (f.bytes < SMALL_FILE || !probe.rangeOk) {
        onProgress?.({ file: f.path, done: 0, total: f.bytes, pct: 0, bps: 0, phase: "downloading", sourceId: s.id });
        const resp = await fetch(url, { signal: AbortSignal.timeout(600000) });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const bytes = new Uint8Array(await resp.arrayBuffer());
        onProgress?.({ file: f.path, done: bytes.length, total: f.bytes, pct: 99, bps: 0, phase: "verifying", sourceId: s.id });
        const actual = await sha256Hex(bytes);
        if (actual !== f.sha256) throw new Error(`sha mismatch：${actual.slice(0, 12)}… ≠ ${f.sha256.slice(0, 12)}…`);
        await cachedPut(cacheKey, bytes, contentTypeOf(f.path));
        onProgress?.({ file: f.path, done: f.bytes, total: f.bytes, pct: 100, bps: 0, phase: "done", sourceId: s.id });
        return cacheKey;
      }

      // 分片路径：downloader-core（多源并发＋断点续传＋sha 三态门）
      const core = await coreLoader();
      const dl = new core.Download(
        {
          ghUrl: url,
          name: `${m.root}__${f.path.replace(/\//g, "__")}`,
          size: f.bytes,
          expectedSha256: f.sha256, // 禁 no-expected：manifest 全挂（spec 红线）
          sources: [new core.Source(s.id, (u) => u)],
          appId: `audio-model-${m.root}`,
        },
        {
          fetch: (u: string, init: RequestInit) => fetch(u, init),
          store: await idbChunkStore(), // 复用 bundle 内 IDB 块仓（断点续传语义）
          timer: {
            now: () => performance.now(),
            epoch: () => Date.now(),
            sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
          },
          abort: {
            any: (signals: AbortSignal[]) => AbortSignal.any(signals.filter(Boolean)),
            timeout: (ms: number) => AbortSignal.timeout(ms),
          },
          random: Math.random,
        },
      );
      dl.onProgress((st) => {
        onProgress?.({
          file: f.path,
          done: st.done,
          total: st.total,
          pct: st.pct,
          bps: st.bps,
          phase: "downloading",
          sourceId: s.id,
        });
      });
      const r = await dl.run();
      if (r !== "done") throw new Error(`run=${r}`);
      const v = await dl.verifySha256();
      if (v.status !== "match") throw new Error(`sha 校验 ${v.status}（fail-closed，已拒缓存）`);
      onProgress?.({ file: f.path, done: f.bytes, total: f.bytes, pct: 99, bps: 0, phase: "verifying", sourceId: s.id });
      const bytes = await dl.assembleBytes();
      await cachedPut(cacheKey, bytes, contentTypeOf(f.path));
      onProgress?.({ file: f.path, done: f.bytes, total: f.bytes, pct: 100, bps: 0, phase: "done", sourceId: s.id });
      return cacheKey;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  onProgress?.({
    file: f.path,
    done: 0,
    total: f.bytes,
    pct: 0,
    bps: 0,
    phase: "failed",
    error: lastErr?.message ?? "全源失败",
  });
  throw new Error(`模型文件 ${f.path} 全源失败：${lastErr?.message ?? "未知"}`);
}

/** 整模型确保在缓存（逐文件串行；顺序＝manifest files 顺序——大 onnx 在前无谓，按清单序即可） */
export async function ensureModelCached(
  m: ModelManifest,
  onProgress?: ProgressCb,
): Promise<string[]> {
  const keys: string[] = [];
  for (const f of m.files) {
    keys.push(await ensureFileCached(m, f, onProgress));
  }
  return keys;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function contentTypeOf(path: string): string {
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".txt")) return "text/plain";
  if (path.endsWith(".onnx") || path.endsWith(".bin")) return "application/octet-stream";
  return "application/octet-stream";
}

/**
 * IDB 块仓：vendored bundle 暴露 idbOpen/idbPut/idbGet/idbClear（冻结 API），
 * 本层按 engine.io.store 面组装（键位与 site 线上形态一致 `${name}:${size}:${idx}`）。
 */
async function idbChunkStore(): Promise<Record<string, unknown>> {
  const core = await loadSmartDLCore();
  let db: unknown = null;
  const open = async () => {
    if (!db) db = await core.idbOpen();
    return db;
  };
  return {
    async put(key: string, bytes: Uint8Array) {
      const d = await open();
      return core.idbPut(d, key, new Blob([bytes.slice().buffer as ArrayBuffer]));
    },
    async get(key: string) {
      const d = await open();
      const blob = (await core.idbGet(d, key)) as Blob | null;
      if (!blob) return null;
      return { size: blob.size, data: blob };
    },
    async clearPrefix(prefix: string) {
      const d = await open();
      return core.idbClear(d, prefix);
    },
    close() {
      db = null;
    },
  };
}
