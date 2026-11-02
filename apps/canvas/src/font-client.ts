/*
 * 字体 Worker 客户端 —— apps/canvas/src/font-client.ts
 * 主线程只发请求、收元数据/path；解析与排版全部在 Worker。
 */
import type {
  FontInfo,
  FontWorkerRequest,
  FontWorkerResponse,
  GlyphBox,
  TextToSvgResult,
} from "./font-types";

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./font-worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (ev: MessageEvent<FontWorkerResponse>) => {
    const msg = ev.data;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error));
  };
  worker.onerror = (ev) => {
    const err = new Error(ev.message || "字体 Worker 异常");
    for (const [, p] of pending) p.reject(err);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

type RequestInput = FontWorkerRequest extends infer T
  ? T extends FontWorkerRequest
    ? Omit<T, "id">
    : never
  : never;

function request<T>(req: RequestInput): Promise<T> {
  const id = ++seq;
  const w = getWorker();
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.postMessage({ ...req, id } as FontWorkerRequest);
  });
}

export function fontInfo(url: string): Promise<FontInfo> {
  return request<FontInfo>({ op: "font_info", url });
}

export function textToSvg(req: Omit<Extract<FontWorkerRequest, { op: "text_to_svg" }>, "id" | "op">): Promise<TextToSvgResult> {
  return request<TextToSvgResult>({ op: "text_to_svg", ...req });
}

export function fontGlyphs(url: string, chars: string): Promise<{ glyphs: GlyphBox[] }> {
  const req: RequestInput = { op: "font_glyphs", url, chars };
  return request<{ glyphs: GlyphBox[] }>(req);
}
