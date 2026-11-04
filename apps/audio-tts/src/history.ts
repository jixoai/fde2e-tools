/**
 * 生成历史 —— apps/audio-tts/src/history.ts（tasks 2.7）
 *
 * IndexedDB：blob＋参数元数据（replay/download/delete）。库形：
 * db fde2e-audio-tts / store generations（key=id 自增；索引 createdAt）。
 * 每应用仅最新版驱逐语义不适用（历史＝用户资产，显式删除才删）。
 */
export interface GenerationRecord {
  id?: number;
  createdAt: number;
  text: string;
  voice: string;
  speed: number;
  sentenceCount: number;
  durationSec: number;
  wav: Blob;
}

const DB_NAME = "fde2e-audio-tts";
const STORE = "generations";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open(DB_NAME, 1);
    rq.onupgradeneeded = () => {
      const d = rq.result;
      if (!d.objectStoreNames.contains(STORE)) {
        const store = d.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("createdAt", "createdAt");
      }
    };
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error ?? new Error("IndexedDB 打开失败"));
  });
}

async function tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await openDb();
  return db.transaction(STORE, mode).objectStore(STORE);
}

export async function saveGeneration(rec: Omit<GenerationRecord, "id" | "createdAt">): Promise<number> {
  const store = await tx("readwrite");
  return new Promise((resolve, reject) => {
    const rq = store.add({ ...rec, createdAt: Date.now() });
    rq.onsuccess = () => resolve(Number(rq.result));
    rq.onerror = () => reject(rq.error ?? new Error("历史写入失败"));
  });
}

export async function listGenerations(limit = 50): Promise<GenerationRecord[]> {
  const store = await tx("readonly");
  return new Promise((resolve, reject) => {
    const rq = store.getAll(null, limit);
    rq.onsuccess = () => {
      const rows = (rq.result as GenerationRecord[]).sort((a, b) => b.createdAt - a.createdAt);
      resolve(rows);
    };
    rq.onerror = () => reject(rq.error ?? new Error("历史读取失败"));
  });
}

export async function deleteGeneration(id: number): Promise<void> {
  const store = await tx("readwrite");
  return new Promise((resolve, reject) => {
    const rq = store.delete(id);
    rq.onsuccess = () => resolve();
    rq.onerror = () => reject(rq.error ?? new Error("历史删除失败"));
  });
}

export async function clearGenerations(): Promise<void> {
  const store = await tx("readwrite");
  return new Promise((resolve, reject) => {
    const rq = store.clear();
    rq.onsuccess = () => resolve();
    rq.onerror = () => reject(rq.error ?? new Error("历史清空失败"));
  });
}
