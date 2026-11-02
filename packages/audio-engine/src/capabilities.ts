/**
 * 设备能力探测 —— packages/audio-engine/src/capabilities.ts
 *
 * spec「引擎双轨与设备分层」：能力探测非身份枚举——所有判断只看能力存在性
 * （navigator.gpu / 存储配额 / AudioDecoder），不做 UA 解析。iOS 降级语义＝
 * 「Safari 26 以下能力缺失」：以 WebGPU+AudioDecoder 缺失表达，禁 UA 分支。
 */

/** 设备能力快照（页内显隐与 WebMCP get_capabilities 的唯一数据源） */
export interface DeviceCapabilities {
  /** WebGPU 可用且 requestAdapter 成功（STT 大模型档门） */
  webgpu: boolean;
  /** WebGPU adapter 信息（展示用） */
  gpuAdapterInfo: string | null;
  /** persist() 已授予（缓存被清风险提示用） */
  storagePersisted: boolean;
  /** 估算可用存储（字节；null＝探测不可用） */
  storageQuotaBytes: number | null;
  /** AudioWorklet（麦克风实时链路前提） */
  audioWorklet: boolean;
  /** AudioDecoder（iOS Safari 26 才有——缺失＝小模型档判据之一） */
  audioDecoder: boolean;
  /** 设备档位判定（manifest minDeviceTier 门） */
  tier: "small" | "mid" | "large";
}

/** 探测一次性完成（页 mount 时调一次，结果由调用方 memo） */
export async function detectCapabilities(): Promise<DeviceCapabilities> {
  let webgpu = false;
  let gpuAdapterInfo: string | null = null;
  // navigator.gpu：TS DOM lib 版本滞后（本仓 lib=ES2022+DOM 无 WebGPU 类型），
  // 结构化取用不做全局类型扩展（vendor 纪律：不为探测新增 .d.ts 面）
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (gpu) {
    try {
      // requestAdapter 返回 any（无 WebGPU lib）——用完即弃，不落类型面
      const adapter = (await gpu.requestAdapter()) as unknown as {
        info?: { vendor?: string; architecture?: string };
      } | null;
      if (adapter) {
        webgpu = true;
        gpuAdapterInfo = adapter.info
          ? [adapter.info.vendor, adapter.info.architecture].filter(Boolean).join("/") || null
          : null;
      }
    } catch {
      // requestAdapter 失败＝能力缺失（与 UA 无关）
    }
  }

  let storagePersisted = false;
  let storageQuotaBytes: number | null = null;
  try {
    storagePersisted = (await navigator.storage?.persisted?.()) ?? false;
    const est = await navigator.storage?.estimate?.();
    storageQuotaBytes = est?.quota ?? null;
  } catch {
    // 存储探测失败不阻断（Safari 隐身窗等）
  }

  const audioWorklet = typeof AudioWorkletNode !== "undefined";
  const audioDecoder = typeof AudioDecoder !== "undefined";

  // 档位判定（纯能力语义）：WebGPU+大存储＝large；缺 WebGPU 但桌面级存储或
  // AudioDecoder 在场＝mid；其余（旧 iOS Safari 等）＝small。
  const GB = 1024 * 1024 * 1024;
  const tier: DeviceCapabilities["tier"] =
    webgpu && (storageQuotaBytes ?? 0) > 2 * GB
      ? "large"
      : audioDecoder || (storageQuotaBytes ?? 0) > GB
        ? "mid"
        : "small";

  return { webgpu, gpuAdapterInfo, storagePersisted, storageQuotaBytes, audioWorklet, audioDecoder, tier };
}

/** 能力门：模型是否对当前设备呈现（manifest minDeviceTier × tier） */
const TIER_RANK = { small: 0, mid: 1, large: 2 } as const;
export function tierAllows(
  m: { minDeviceTier: "small" | "mid" | "large" },
  caps: DeviceCapabilities,
): boolean {
  return TIER_RANK[caps.tier] >= TIER_RANK[m.minDeviceTier];
}
