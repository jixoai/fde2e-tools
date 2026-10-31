/*
 * 编辑器内核主机 —— apps/xlsx/src/editor.ts
 *
 * 职责：dynamic import Univer preset（≈1.84MB gzip 独立 chunk，体积纪律）→
 * 建工作簿（seed 一律经 snapshot.buildWorkbookSeed 工厂，禁简化格式）→
 * 生命周期门禁（【坑②】Rendered 前写命令静默失败——未就绪一律显式拒绝）→
 * canary 写入校验（【坑①】幽灵工作簿运行时探测）。
 *
 * 双坑防御落位（openspec: univer-write-gate）：
 * - 坑① 幽灵工作簿：seed 单源工厂 + assertCompleteSeed + createWorkbook 后
 *   canary 写入→save()→回读校验（save() 在幽灵态冻结在创建态，不触发 UI 弹窗，
 *   是无副作用的探测通道）；失败＝编辑器进入 unhealthy 态，全部写工具 ok:false。
 * - 坑② Rendered 门禁：LifecycleGate.ensureReady() 轮询 stage>=2；forcePending
 *   测试缝供绿门确定性回归（挂起→ok:false / 释放→ok:true）。
 */
import { buildWorkbookSeed, assertCompleteSeed, ROW_COUNT, COLUMN_COUNT, type WorkbookSeed } from "./snapshot";

/* ---------- Univer Facade 的结构化最小面（避免把 1.84MB 的类型拖进主包） ---------- */

export interface FacadeRange {
  setValue(v: unknown): unknown;
  getValue(): unknown;
  setFormula(f: string): unknown;
  getFormula(): string | null;
  setFontWeight(w: "bold" | "normal"): unknown;
  /** 真实 API 名（f-range.d.ts:1057）：setFontStyle("italic"|"normal") */
  setFontStyle(style: "italic" | "normal"): unknown;
  setBackgroundColor(c: string): unknown;
  setFontColor(c: string): unknown;
  setHorizontalAlignment(a: string): unknown;
  /** 真实 API 名（sheets-numfmt f-range.d.ts:37）：setNumberFormat(pattern) */
  setNumberFormat(pattern: string): unknown;
  /** 真实 API（f-range.d.ts:744）：setBorder(type, style, color?)；type/style 经 univerAPI.Enum 取值 */
  setBorder(type: string, style: string, color?: string): unknown;
}

export interface FacadeSheet {
  getSheetId(): string;
  getSheetName(): string;
  /** 双形态（实调验证）：getRange("A1:D4") ／ getRange(row, col) 单元格 */
  getRange(a1: string): FacadeRange;
  getRange(row: number, col: number): FacadeRange;
  getMaxRows(): number;
  getMaxColumns(): number;
}

export interface FacadeWorkbook {
  getId(): string;
  getSheets(): FacadeSheet[];
  getActiveSheet(): FacadeSheet;
  insertSheet(name: string): FacadeSheet;
  getSheetByName(name: string): FacadeSheet | null;
  save(): Record<string, unknown>;
}

export interface FacadeUniver {
  createWorkbook(seed: WorkbookSeed): FacadeWorkbook;
  getActiveWorkbook(): FacadeWorkbook | null;
  getCurrentLifecycleStage(): number;
  /** 枚举面（Enum.BorderType.ALL / Enum.BorderStyleTypes.THIN 等，setBorder 用） */
  Enum?: Record<string, Record<string, string>>;
  /** 生命周期常量（Started=0 Ready=1 Rendered=2） */
  LifecycleStage?: Record<string, number>;
  disposeUnit?(unitId: string): boolean;
}

/* ---------- 生命周期门禁 ---------- */

export const STAGE_RENDERED = 2;

export class LifecycleGate {
  private forcedPending = false;

  /** 测试缝（绿门回归）：强制门禁挂起——写工具必须 ok:false，不得静默成功 */
  setForcedPending(v: boolean): void {
    this.forcedPending = v;
  }

  isForcedPending(): boolean {
    return this.forcedPending;
  }

  stage(api: FacadeUniver | null): number {
    if (this.forcedPending) return Math.min(1, api?.getCurrentLifecycleStage() ?? 1);
    return api?.getCurrentLifecycleStage() ?? 0;
  }

  /** 就绪（stage>=2 且未挂起）；等待 timeoutMs 后放弃返回 false（调用方 ok:false） */
  async ensureReady(api: FacadeUniver | null, timeoutMs = 45000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (!this.forcedPending && api && api.getCurrentLifecycleStage() >= STAGE_RENDERED) return true;
      if (Date.now() > deadline) return false;
      await sleep(150);
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/* ---------- canary 写入校验（幽灵工作簿运行时探测） ---------- */

const CANARY_ROW = ROW_COUNT - 8; // 远离可视区（200 行簿的第 192 行）
const CANARY_COL = COLUMN_COUNT - 4;
const CANARY_MARK = "__canary__";

export interface Health {
  /** canary 校验通过（工作簿可写） */
  verified: boolean;
  /** 校验通过的工作簿 unitId——写入健康绑定到具体工作簿（切簿即重验） */
  workbookId: string | null;
  /** 失败原因（人话，含「幽灵工作簿」字样） */
  error: string | null;
}

/**
 * canary：写入标记 → save() 快照 → 回读校验 → 清理。
 * 用 save() 而非 getValue() 回读的原因：幽灵工作簿的静默拒绝恰在「写入不落
 * 快照」，getValue 可能读到 UI 层缓存造成假阳；快照回读直击数据层。
 */
export async function canaryProbe(api: FacadeUniver): Promise<Health> {
  const wb = api.getActiveWorkbook();
  if (!wb) return { verified: false, workbookId: null, error: "幽灵工作簿校验失败：当前无活动工作簿" };
  const sheet = wb.getActiveSheet();
  try {
    sheet.getRange(CANARY_ROW, CANARY_COL).setValue(CANARY_MARK);
    await sleep(30);
    const snap = wb.save() as { sheets?: Record<string, { cellData?: Record<string, Record<string, { v?: unknown }>> }> };
    const snapSheet = (snap.sheets ?? {})[sheet.getSheetId()];
    const v = snapSheet?.cellData?.[String(CANARY_ROW)]?.[String(CANARY_COL)]?.v;
    const ok = v === CANARY_MARK;
    const workbookId = wb.getId();
    return ok
      ? { verified: true, workbookId, error: null }
      : { verified: false, workbookId, error: "幽灵工作簿判定：写入未落快照（简化格式 seed 创建的工作簿拒绝一切写入——sheet 缺 id/数组形态即中招）——写操作已全部拒绝，请重新导入或重载页面" };
  } finally {
    try {
      sheet.getRange(CANARY_ROW, CANARY_COL).setValue(null); // 哨兵清理（best-effort）
    } catch {
      /* 幽灵态下清理也会失败——health 已如实记录 */
    }
  }
}

/* ---------- 编辑器主机（单例） ---------- */

export type StatusSink = (msg: string, kind: "ok" | "error" | "warn") => void;

export interface EditorHost {
  api: FacadeUniver;
  gate: LifecycleGate;
  health: Health;
  /** 当前工作簿 seed 的簿名（canary/工具摘要用） */
  workbookName: string;
}

let hostPromise: Promise<EditorHost> | null = null;
let host: EditorHost | null = null;

/** 以（已校验的）seed 建簿；成功返回 null，失败返回人话错误 */
async function createWorkbookFrom(api: FacadeUniver, seed: WorkbookSeed): Promise<string | null> {
  assertCompleteSeed(seed); // 幽灵防御前置：非完整格式直接抛（ok:false 语义在工具层捕获）
  try {
    api.createWorkbook(seed);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/**
 * 启动编辑器（单例）：dynamic import preset chunk → createUniver → 立即以工厂
 * seed 建示例簿（生命周期随工作簿渲染推进；建簿非「写命令」，不受 Rendered
 * 门禁约束——digest 实调即此形态）→ 等 Rendered → canary。StrictMode 双跑安全
 * （模块级 promise）。
 */
export function bootEditor(container: HTMLElement, onStatus: StatusSink): Promise<EditorHost> {
  if (hostPromise) return hostPromise;
  hostPromise = (async () => {
    onStatus("正在加载编辑器内核（Univer，首次约 1-3 秒）…", "ok");
    const boot = await import("./univer-boot");
    const api = await boot.mountUniver(container);
    const gate = new LifecycleGate();

    onStatus("正在渲染工作簿…", "ok");
    const seed = buildWorkbookSeed("演示工作簿", sampleSheets());
    const err = await createWorkbookFrom(api, seed);
    const h: EditorHost = {
      api,
      gate,
      workbookName: err ?? "演示工作簿",
      health: err ? { verified: false, workbookId: null, error: `幽灵工作簿判定：建簿失败（${err}）` } : { verified: false, workbookId: null, error: null },
    };
    host = h;
    if (err) {
      onStatus(h.health.error ?? "建簿失败", "error");
      return h;
    }

    const ready = await gate.ensureReady(api);
    if (!ready) {
      h.health = { verified: false, workbookId: null, error: "编辑器渲染超时（生命周期未到 Rendered）——写命令已全部拒绝" };
      onStatus(h.health.error ?? "编辑器渲染超时", "error");
      return h;
    }

    const canary = await canaryProbe(api);
    h.health = canary;
    if (canary.verified) {
      onStatus("编辑器就绪：真表格网格已可编辑，AI 可经 WebMCP 驱动（未就绪期写入一律显式拒绝）。", "ok");
    } else {
      onStatus(canary.error ?? "幽灵工作簿判定", "error");
    }
    return h;
  })();
  return hostPromise;
}

/** 取已启动主机（未启动返回 null——webmcp 工具据此走 ensureReady 路径） */
export function getHost(): EditorHost | null {
  return host;
}

/** 测试缝（绿门回归坑①）：注入简化 seed 建幽灵工作簿并切为活动簿 */
export async function injectGhostWorkbook(): Promise<void> {
  if (!host) throw new Error("编辑器未启动");
  const bad = {
    id: "wb-ghost",
    name: "Ghost",
    // 故意用「sheets 数组＋无 id＋无 sheetOrder」的简化格式（digest 实证的幽灵形态）
    sheets: [{ name: "GhostSheet", rowCount: ROW_COUNT, columnCount: COLUMN_COUNT, cellData: { 0: { 0: { v: "ghost" } } } }],
  } as unknown as WorkbookSeed;
  host.api.createWorkbook(bad as WorkbookSeed);
  await sleep(300); // 幽灵簿也会经历生命周期；等它安静下来再让工具层撞 canary
}

/** 关闭当前活动 unit（替换工作簿前调用，防 unit 累积；失败不阻塞——多簿并存也可工作） */
export function disposeActiveUnit(api: FacadeUniver): void {
  const wb = api.getActiveWorkbook();
  if (!wb) return;
  try {
    api.disposeUnit?.(wb.getId());
  } catch {
    /* 多簿并存可工作，关闭失败不阻塞主流程 */
  }
}

/** 测试缝（绿门回归坑①）：重建健康工作簿（工厂 seed）并重跑 canary */
export async function restoreMainWorkbook(): Promise<boolean> {
  if (!host) throw new Error("编辑器未启动");
  disposeActiveUnit(host.api);
  const seed = buildWorkbookSeed("演示工作簿", sampleSheets());
  host.api.createWorkbook(seed);
  await host.gate.ensureReady(host.api);
  await sleep(200);
  const canary = await canaryProbe(host.api);
  host.health = canary;
  return canary.verified;
}

/** 写工具统一入口：门禁（坑②）→ 健康 canary（坑①）→ 执行；任一不过＝ok:false */
export async function withEditorWrite<T>(
  fn: (h: EditorHost) => Promise<T> | T,
  opts: { timeoutMs?: number } = {},
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  const h = host;
  if (!h) return { ok: false, error: "编辑器尚未启动（内核加载中），请稍后重试" };
  const ready = await h.gate.ensureReady(h.api, opts.timeoutMs ?? 45000);
  if (!ready) {
    return { ok: false, error: `编辑器尚未渲染完成（生命周期 stage=${h.gate.stage(h.api)}<2，Rendered），写命令已拒绝——禁静默失败，请稍后重试` };
  }
  // 健康绑定到具体工作簿：首验未过、或活动簿已切换（导入/sample/异常注入）都重跑 canary
  const activeId = h.api.getActiveWorkbook()?.getId() ?? null;
  if (!h.health.verified || h.health.workbookId !== activeId) {
    const retry = await canaryProbe(h.api);
    h.health = retry;
    if (!retry.verified) return { ok: false, error: retry.error ?? "工作簿健康校验失败" };
  }
  try {
    return { ok: true, value: await fn(h) };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.message ? e.message : String(e) };
  }
}

/* ---------- 示例簿（?sample= 与首载共用） ---------- */

function sampleSheets(): Array<{ name: string; rows: unknown[][] }> {
  const today = new Date().toISOString().slice(0, 10);
  return [
    {
      name: "业绩",
      rows: [
        ["产品", "数量", "单价", "金额"],
        ["Widget", 3, 9.99, { f: "=B2*C2" }],
        ["Gadget", 5, 4.5, { f: "=B3*C3" }],
        ["合计", { f: "=SUM(B2:B3)" }, null, { f: "=SUM(D2:D3)" }],
        [],
        ["样例日期", today, "载入 ?sample=1 可重置为本示例"],
      ],
    },
    {
      name: "备注",
      rows: [
        ["键", "值"],
        ["引擎", "Univer preset-sheets-core（Apache-2.0）"],
        ["文件桥", "SheetJS 双向桥（值/公式保留；样式与列宽 v1 不落文件）"],
        ["写入防御", "Rendered 门禁 + 幽灵工作簿 canary（禁静默失败）"],
      ],
    },
  ];
}

/** sample 载入（页面按钮与 ?sample= 共用）：重置为示例簿并重跑 canary */
export async function loadSampleWorkbook(onStatus: StatusSink): Promise<boolean> {
  const h = host;
  if (!h) return false;
  disposeActiveUnit(h.api);
  const seed = buildWorkbookSeed("演示工作簿", sampleSheets());
  try {
    h.api.createWorkbook(seed);
  } catch (e) {
    onStatus("载入示例失败：" + (e instanceof Error ? e.message : String(e)), "error");
    return false;
  }
  const ready = await h.gate.ensureReady(h.api);
  if (!ready) {
    onStatus("编辑器尚未渲染完成（未到 Rendered），示例载入被拒绝——稍后重试。", "error");
    return false;
  }
  await sleep(150);
  const canary = await canaryProbe(h.api);
  h.health = canary;
  if (!canary.verified) {
    onStatus(canary.error ?? "幽灵工作簿判定", "error");
    return false;
  }
  onStatus("示例工作簿已载入：网格可直接编辑，或点「导出 .xlsx」下载。", "ok");
  return true;
}
