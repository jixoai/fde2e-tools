/**
 * 模型缓存层 —— packages/audio-engine/src/cache.ts
 *
 * Cache API 统一封装（spec「浏览器本地推理」+ tasks 1.4）：
 *  - transformers.js 路径：env.useBrowserCache 走本层命名的同一 Cache；
 *  - sherpa wasm 路径：fetch→MEMFS 前先查本层，命中零网络；
 *  - persist()：首载模型前请求持久化（防 Safari 7 天驱逐）；
 *  - 被清检测：estimate().usage 骤降＋键缺失＝重下提示（UI 侧消费）。
 *
 * 键约定：`fde2e-audio-models` 单 Cache；URL 为键（与 transformers.js 默认同形）。
 */

const CACHE_NAME = "fde2e-audio-models";

async function openCache(): Promise<Cache> {
  return caches.open(CACHE_NAME);
}

/** 缓存命中探测（不读 body） */
export async function cachedHas(url: string): Promise<boolean> {
  const cache = await openCache();
  const hit = await cache.match(url);
  return !!hit;
}

/** 取缓存响应（sherpa wasm/模型文件用；transformers.js 自管 fetch 时不用本函数） */
export async function cachedGet(url: string): Promise<Response | undefined> {
  const cache = await openCache();
  return cache.match(url);
}

/** 落缓存（下载器产物字节数组 → Response；调用方已过 sha 门才允许调） */
export async function cachedPut(url: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const cache = await openCache();
  const body = bytes.slice().buffer as ArrayBuffer; // 复制：脱离调用方 buffer 视图
  await cache.put(url, new Response(body, { headers: { "content-type": contentType } }));
}

/** 首载持久化：请求一次（拒绝＝UI 提示「缓存可能被系统清理」） */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/** 缓存占用估算（设置页/重下提示展示） */
export async function cacheUsageBytes(): Promise<number | null> {
  try {
    const est = await navigator.storage?.estimate?.();
    return est?.usage ?? null;
  } catch {
    return null;
  }
}

/** 清空模型缓存（设置页显式动作；幂等） */
export async function clearCache(): Promise<void> {
  await caches.delete(CACHE_NAME);
}
