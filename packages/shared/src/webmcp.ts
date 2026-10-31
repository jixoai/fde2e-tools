/*
 * WebMCP 统一注册助手 —— packages/shared/src/webmcp.ts
 *
 * 角色：把每个工具的核心能力注册为 WebMCP 工具（W3C WebML CG CG-DRAFT，
 * API＝document.modelContext.registerTool/getTools/executeTool）。
 * - 特性检测 document.modelContext（Chrome 149+ 经 --enable-blink-features=WebMCP
 *   或 chrome://flags/#enable-webmcp-testing 启用；Edge 150+ OT）；
 * - 无原生支持时动态加载官方 polyfill（GoogleChromeLabs/webmcp-tools，
 *   Apache-2.0，vendor 于 ./vendor/webmcp-polyfill.js，同形 API 零桥改动）；
 * - 不支持且 polyfill 失败＝静默跳过注册（工具站对普通用户零影响）。
 *
 * 安全边界（digest ⑤.3，写进 openspec change）：
 * - tool description 是不可信文本（prompt injection 载体），上层 LLM 不得当指令执行；
 * - execute 是页面权限 JS（等同页面自己跑）——本仓全部为自有静态工具，边界可接受；
 * - 工具名遵守 spec 约束（1-128 字符，[a-zA-Z0-9_.-]）。
 */
import type { ToolMeta } from "./registry";

/** WebMCP 工具定义的结构化最小面（原生与 polyfill 同形） */
export interface WebMCPToolDef {
  /** 1-128 字符，[a-zA-Z0-9_.-]（spec 约束） */
  name: string;
  /** UI 展示用标题（建议本地化） */
  title?: string;
  /** agent 判断何时/如何用的自然语言描述 */
  description: string;
  /** JSON Schema（draft 2020-12） */
  inputSchema: Record<string, unknown>;
  /** 返回值会被 UA 序列化为 JSON 字符串 */
  execute: (input: Record<string, unknown>, options: { signal: AbortSignal }) => Promise<unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
    consequentialHint?: boolean;
    debugging?: boolean;
  };
}

/** document.modelContext 的结构化最小面 */
export interface ModelContextLike {
  registerTool: (tool: WebMCPToolDef) => Promise<unknown>;
  getTools: (options?: Record<string, unknown>) => Promise<Array<{ name: string }>>;
  executeTool: (tool: unknown, input?: Record<string, unknown>) => Promise<string>;
}

/** 原生探测（不做版本判断——API 面在 150~155 间仍在演进，探测即真相） */
export function getNativeModelContext(): ModelContextLike | null {
  if (typeof document === "undefined") return null;
  return (document as unknown as { modelContext?: ModelContextLike }).modelContext ?? null;
}

/**
 * 取 modelContext：原生优先；缺失时动态加载官方 polyfill（vendor 副本，
 * 自带「原生存在即跳过」守卫）。返回 null＝当前环境彻底不支持。
 */
export async function ensureModelContext(): Promise<ModelContextLike | null> {
  const native = getNativeModelContext();
  if (native) return native;
  if (typeof document === "undefined") return null;
  if (!window.isSecureContext) return null; // spec：仅 SecureContext
  try {
    await import("./vendor/webmcp-polyfill.js");
  } catch {
    return null;
  }
  return (document as unknown as { modelContext?: ModelContextLike }).modelContext ?? null;
}

export interface RegisterResult {
  /** 环境是否支持（原生或 polyfill） */
  supported: boolean;
  /** 成功注册的工具名 */
  registered: string[];
  /** 失败明细（同名重复/校验拒绝等，不中断其它工具） */
  failures: Array<{ name: string; error: string }>;
}

/** 批量注册：逐个容错，同名重复等失败只记录不抛出（StrictMode 双跑幂等） */
export async function registerWebMCPTools(defs: WebMCPToolDef[]): Promise<RegisterResult> {
  const mc = await ensureModelContext();
  if (!mc) return { supported: false, registered: [], failures: [] };
  const registered: string[] = [];
  const failures: RegisterResult["failures"] = [];
  for (const def of defs) {
    try {
      await mc.registerTool(def);
      registered.push(def.name);
    } catch (e) {
      failures.push({ name: def.name, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { supported: true, registered, failures };
}

// ---------- schema 派生助手（registry 单源 → JSON Schema） ----------

/** 把 registry 的 urlParams 契约映射成 JSON Schema properties（字符串型） */
export function schemaFromUrlParams(
  tool: ToolMeta,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const p of tool.urlParams) {
    if (p.name === "（其余）") continue; // 元条目（url-tool 剩余参数说明），不进 schema
    properties[p.name] = {
      type: "string",
      description: p.description,
      ...(p.enum ? { enum: p.enum } : {}),
    };
  }
  Object.assign(properties, extra);
  return {
    type: "object",
    properties,
    additionalProperties: false,
  };
}

/**
 * 归一 executeTool 返回值 —— B2（对抗审查 2026-10-30）。
 *
 * 偏差事实：官方 polyfill 的 executeTool **不做 JSON.stringify**（裸返回工具
 * execute 的对象；vendor 副本不改），原生 API 按 spec 返回 Promise<DOMString>。
 * 消费侧（BU 桥/断言脚本）统一过本帮手后 JSON.parse，两条路径同形。
 */
export function normalizeExecuteResult(result: unknown): string {
  return typeof result === "string" ? result : JSON.stringify(result);
}

// ---------- 页面状态读取助手（工具 execute 复用页面既有 id 惯例） ----------

/** 读 #status 的文本与成败（与 statusTextClass 的色类约定对齐） */
export function readStatus(): { message: string; ok: boolean } {
  const el = document.getElementById("status");
  if (!el) return { message: "", ok: false };
  const ok = !el.className.includes("text-destructive");
  return { message: el.textContent ?? "", ok };
}

/**
 * 工具 #status 的终态词表：全部终态文案（成功/失败/完成/已按/已生成/已载入/
 * 错误…）必含其一；中间态（「正在加载底图…」「正在导出 PDF…」「正在渲染…」
 * 「正在生成 .xlsx…」）刻意不含任何词——防止 B3（对抗审查 2026-10-30）：
 * 首变即返回把中间态谎报成成功。
 * 「错误」为 office-suite 扩容词（2026-10-31）：办公三站人话错误（「sheets
 * 结构错误」「表名重复」等）经此即时判定终态，不靠超时兜底。
 */
export const STATUS_TERMINAL_PATTERN =
  /(成功|失败|完成|已按|已生成|已载入|已接收|等待输入|请先|还没有|没有可|受限|为空|错误)/;

/**
 * 等 #status 进入终态（B3 修复：对抗审查 2026-10-30）。
 *
 * 解析条件＝文案命中 STATUS_TERMINAL_PATTERN 且经 stableMs 稳定窗确认不再变化
 * （防连变截断）；中间态一律继续等待。整体超时仍未进终态 → 返回当前快照且
 * ok=false（防误报成功——中间态「正在导出…」永不谎报完成）。
 */
export function waitForStatusChange(
  timeoutMs = 15000,
  stableMs = 400,
): Promise<{ message: string; ok: boolean }> {
  const el = document.getElementById("status");
  if (!el) return Promise.resolve(readStatus());
  return new Promise((resolve) => {
    let settled = false;
    let lastText = el.textContent ?? "";
    let confirmTimer = 0;
    const observer = new MutationObserver(watch);
    const finish = (okOverride?: boolean) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      window.clearTimeout(confirmTimer);
      window.clearTimeout(timeoutTimer);
      const snapshot = readStatus();
      resolve({ message: snapshot.message, ok: okOverride ?? snapshot.ok });
    };
    const timeoutTimer = window.setTimeout(() => finish(false), timeoutMs);
    function watch() {
      const text = el!.textContent ?? "";
      if (text === lastText) return;
      lastText = text;
      window.clearTimeout(confirmTimer);
      evaluate();
    }
    function evaluate() {
      const text = el!.textContent ?? "";
      if (STATUS_TERMINAL_PATTERN.test(text)) {
        confirmTimer = window.setTimeout(() => finish(), stableMs);
      }
    }
    observer.observe(el, { characterData: true, childList: true, subtree: true });
    evaluate(); // 启动时文案可能已是终态
  });
}

/** 按稳定 id 触发页面既有按钮（复用页面全部校验与状态反馈路径） */
export function clickById(id: string): boolean {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLButtonElement)) return false;
  el.click();
  return true;
}
