/*
 * 完整快照格式 seed 单源工厂 —— apps/xlsx/src/snapshot.ts
 *
 * 【坑①防御（digest 实证：库级 footgun）】Univer createWorkbook 的 seed 必须
 * 是完整快照格式：sheets = 按 sheetId 索引的 Record ＋ sheetOrder 数组 ＋ 各
 * sheet 带 id。「sheets 数组＋无 id」的简化格式创建的工作簿会静默拒绝一切写入
 * （幽灵「range protected」弹窗、save() 冻结在创建态、公式引擎断连）——官方
 * playground 100% 复现。本文件是全 app 唯一的 seed 构造点（grep 无旁路），
 * 并提供结构自检（assertCompleteSeed）供 canary 前置校验。
 */

/** Univer 单元格的桥接子集（v=值 f=公式 s=样式引用） */
export interface SeedCell {
  v?: string | number | boolean | null;
  f?: string;
  s?: Record<string, unknown>;
}

export interface SeedSheet {
  id: string;
  name: string;
  rowCount: number;
  columnCount: number;
  cellData: Record<number, Record<number, SeedCell>>;
}

export interface WorkbookSeed {
  id: string;
  name: string;
  sheetOrder: string[];
  sheets: Record<string, SeedSheet>;
}

export const ROW_COUNT = 200;
export const COLUMN_COUNT = 30;

/**
 * canary 哨兵（幽灵工作簿运行时探测的写入标记）。导出/桥接必须把它当空单元格
 * ——Univer 的 setValue(null) 不落快照（实证：导出 PDF 里出现「__canary__」
 * 远列，把 maxC 撑到 26、整表列宽被压到 8mm，P0-4 内容污染同族问题）。
 */
export const CANARY_MARK = "__canary__";
export const CANARY_ROW = ROW_COUNT - 8; // 远离可视区（200 行簿的第 192 行）
export const CANARY_COL = COLUMN_COUNT - 4;

/** 该格是否为 canary 哨兵（导出侧一律视作空） */
export function isCanaryCell(cell: SeedCell | undefined): boolean {
  return cell?.v === CANARY_MARK;
}

/** 二维数组 → cellData（稀疏 Record；null/undefined 跳过） */
export function rowsToCellData(rows: unknown[][]): SeedSheet["cellData"] {
  const cellData: SeedSheet["cellData"] = {};
  rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (cell === null || cell === undefined) return;
      if (typeof cell === "object") {
        // { f: '=SUM(...)', v? } 公式格形态
        const spec = cell as { f?: string; v?: SeedCell["v"] };
        if (typeof spec.f === "string" && spec.f.length) {
          cellData[r] = cellData[r] ?? {};
          cellData[r][c] = { f: spec.f.startsWith("=") ? spec.f : "=" + spec.f, ...(spec.v !== undefined ? { v: spec.v } : {}) };
        }
        return;
      }
      cellData[r] = cellData[r] ?? {};
      cellData[r][c] = { v: cell as SeedCell["v"] };
    });
  });
  return cellData;
}

/**
 * 完整快照格式 seed 工厂（全 app 唯一 createWorkbook seed 来源）。
 * id 依次 sheet-0/sheet-1/…；重名 sheet 由调用方先行去重（add_sheet 路径）。
 */
let workbookSeq = 0;

export function buildWorkbookSeed(
  name: string,
  sheets: Array<{ name: string; rows?: unknown[][] }>,
  workbookId = `wb-${Date.now().toString(36)}-${(workbookSeq++).toString(36)}`,
): WorkbookSeed {
  const out: WorkbookSeed = { id: workbookId, name, sheetOrder: [], sheets: {} };
  sheets.forEach((s, i) => {
    const id = `sheet-${i}`;
    out.sheets[id] = {
      id,
      name: s.name,
      rowCount: ROW_COUNT,
      columnCount: COLUMN_COUNT,
      cellData: rowsToCellData(s.rows ?? []),
    };
    out.sheetOrder.push(id);
  });
  if (!out.sheetOrder.length) throw new Error("工作簿至少需要一张工作表");
  return out;
}

/**
 * 结构自检：seed 必须是完整快照格式（sheets 为 Record、sheetOrder 全覆盖、
 * 各 sheet 带 id）。幽灵工作簿的成因就是绕过本形态；工厂产物恒过，此函数
 * 供导入/测试缝前置校验与绿门对照。
 */
export function assertCompleteSeed(seed: unknown): asserts seed is WorkbookSeed {
  const s = seed as Partial<WorkbookSeed>;
  if (!s || typeof s !== "object") {
    throw new Error("seed 非完整快照格式（幽灵工作簿风险）：seed 缺失");
  }
  if (!s.sheets || Array.isArray(s.sheets) || typeof s.sheets !== "object") {
    throw new Error("seed 非完整快照格式（幽灵工作簿风险）：sheets 必须是按 sheetId 索引的 Record（数组形态即简化格式）");
  }
  const sheets: Record<string, SeedSheet> = s.sheets;
  if (!Array.isArray(s.sheetOrder)) {
    throw new Error("seed 非完整快照格式（幽灵工作簿风险）：缺 sheetOrder 数组");
  }
  const sheetOrder: string[] = s.sheetOrder;
  const ids = Object.keys(sheets);
  if (!ids.length) {
    throw new Error("seed 非完整快照格式（幽灵工作簿风险）：sheets 为空");
  }
  for (const id of ids) {
    const sheet = sheets[id];
    if (!sheet || sheet.id !== id) {
      throw new Error(`seed 非完整快照格式（幽灵工作簿风险）：sheet ${id} 缺 id 或 id 不一致`);
    }
    if (typeof sheet.name !== "string") {
      throw new Error(`seed 非完整快照格式（幽灵工作簿风险）：sheet ${id} 缺 name`);
    }
    if (!sheetOrder.includes(id)) {
      throw new Error(`seed 非完整快照格式（幽灵工作簿风险）：sheetOrder 未覆盖 ${id}`);
    }
  }
  if (sheetOrder.length !== ids.length) {
    throw new Error("seed 非完整快照格式（幽灵工作簿风险）：sheetOrder 与 sheets 数量不一致");
  }
}

/* ---------- A1 地址单源（webmcp 单元格寻址与导出区域解析共用） ---------- */

const A1_RE = /^(\$?[A-Za-z]{1,3})(\$?[1-9]\d{0,6})$/;

/** "B3" → [row, col]（0 基）；非法即抛人话错误 */
export function parseA1(ref: string): [number, number] {
  const m = A1_RE.exec(ref.trim());
  if (!m) throw new Error(`非法单元格地址「${ref}」（期望 A1 形态）`);
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return [parseInt(m[2], 10) - 1, col - 1];
}

/** 0 基 [row, col] → "A1" 形态（列号 → 字母，A=0） */
export function encodeA1(r: number, c: number): string {
  let s = "";
  let n = c + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return `${s}${r + 1}`;
}

export interface A1Window {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}

/** "A1:F20" → 0 基闭区间窗口（支持单格 "B3"；角序自动归一）；非法即抛人话错误 */
export function parseA1Range(ref: string): A1Window {
  const parts = ref.trim().split(":");
  if (parts.length > 2) throw new Error(`非法区域「${ref}」（期望 A1:F20 形态）`);
  const [r0, c0] = parseA1(parts[0]);
  let r1 = r0;
  let c1 = c0;
  if (parts.length === 2) [r1, c1] = parseA1(parts[1]);
  return { r0: Math.min(r0, r1), r1: Math.max(r0, r1), c0: Math.min(c0, c1), c1: Math.max(c0, c1) };
}

/* ---------- 单元格显示文本与已用范围（导出侧单源） ---------- */

/** 单元格显示文本：计算值优先，公式兜底（v 缺失时灰显 =f） */
export function cellText(cell: SeedCell | undefined): { text: string; isFormulaFallback: boolean } {
  if (!cell) return { text: "", isFormulaFallback: false };
  // canary 哨兵视作空（setValue(null) 不落快照的实证防线，双重保险）
  if (cell.v === CANARY_MARK) return { text: "", isFormulaFallback: false };
  if (cell.v !== undefined && cell.v !== null && cell.v !== "") return { text: String(cell.v), isFormulaFallback: false };
  if (cell.f) return { text: cell.f, isFormulaFallback: true };
  return { text: "", isFormulaFallback: false };
}

export interface UsedRange {
  minR: number;
  maxR: number;
  minC: number;
  maxC: number;
  hasContent: boolean;
}

/** 已用范围只认有内容格（空壳行键不进导出）；canary 哨兵视作空 */
export function usedRange(cellData: Record<number, Record<number, SeedCell>>): UsedRange {
  let minR = Number.MAX_SAFE_INTEGER;
  let maxR = -1;
  let minC = Number.MAX_SAFE_INTEGER;
  let maxC = -1;
  for (const rKey of Object.keys(cellData)) {
    const r = Number(rKey);
    for (const cKey of Object.keys(cellData[r])) {
      const c = Number(cKey);
      if (cellText(cellData[r]?.[c]).text === "") continue;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
    }
  }
  return { minR: maxR >= 0 ? minR : 0, maxR, minC: maxR >= 0 ? minC : 0, maxC, hasContent: maxR >= 0 };
}

export interface DrawRow {
  /** 行号（0 基） */
  r: number;
  /** 该行绘制右边界（最右内容列，0 基闭区间） */
  maxC: number;
}

export interface SheetDrawPlan extends UsedRange {
  /** 逐行绘制计划（minR..maxR 连续，中间空行在列） */
  rows: DrawRow[];
}

/**
 * 表绘制计划（trim 契约单源，矢量 PDF 与长图 PNG 双路径共用）：
 * - 行域＝[首个内容行 .. 末个内容行]，**中间空行保留**（占位全宽——办公语义：
 *   空行是内容的一部分）；
 * - 有内容行右边界＝该行自身最右内容列（**不规则右边界**：右侧空区不画格线
 *   不渲染空格）；
 * - 全空占位行宽度＝整表 maxC。
 */
export function planSheetDraw(cellData: Record<number, Record<number, SeedCell>>): SheetDrawPlan {
  const ur = usedRange(cellData);
  const rows: DrawRow[] = [];
  for (let r = ur.minR; r <= ur.maxR; r++) {
    const rowCells = cellData[r] ?? {};
    let rowMaxC = -1;
    for (const cKey of Object.keys(rowCells)) {
      const c = Number(cKey);
      if (c > ur.maxC) continue;
      if (cellText(rowCells[c]).text !== "" && c > rowMaxC) rowMaxC = c;
    }
    rows.push({ r, maxC: rowMaxC >= 0 ? rowMaxC : ur.maxC });
  }
  return { ...ur, rows };
}

/* ---------- 选择性导出（openspec: selective-export；items 统一选择器） ---------- */

/** A1 区域窗口在快照上的切片（0 基闭区间） */
function sliceWindow(
  cellData: Record<number, Record<number, SeedCell>>,
  r0: number,
  r1: number,
  c0: number,
  c1: number,
): Record<number, Record<number, SeedCell>> {
  const out: Record<number, Record<number, SeedCell>> = {};
  for (const rKey of Object.keys(cellData)) {
    const r = Number(rKey);
    if (r < r0 || r > r1) continue;
    for (const cKey of Object.keys(cellData[r])) {
      const c = Number(cKey);
      if (c < c0 || c > c1) continue;
      out[r] = out[r] ?? {};
      out[r][c] = cellData[r][c];
    }
  }
  return out;
}

/** 导出单元（items 主形态解析产物；sheets 兼容糖映射为整表单元） */
export interface ExportUnit {
  /** 解析出的 sheetId（快照 sheetOrder 中的键） */
  id: string;
  /** 表名 */
  name: string;
  /** range 解析出的原始窗口（0 基闭区间）；与实际内容的交集在导出侧收敛 */
  window?: A1Window;
  /** 调用方原始 range 文本（报错用） */
  rangeRef?: string;
}

export type ExportSelection = { ok: false; error: string } | { ok: true; units: ExportUnit[] };

/**
 * 解析「导出什么」（items 主形态 ＋ sheets 兼容糖，openspec: selective-export）：
 * - 两者都给 → 人话报错（只能用一个）；
 * - 都缺 → 全部表整表；
 * - sheets（v1 已发布契约，语法糖）：表名数组（如 ["周营收"]）或 1 起序号数组
 *   （如 [1,3]，与 pptx pages 一致）；混合形态人话报错；
 * - items：每项 {sheet: 表名或 1 起序号, range?: "A1:F20" 单表内区域}。
 */
export function resolveExportSelection(
  snapshot: { sheetOrder?: string[]; sheets: Record<string, { name?: string }> },
  items: unknown,
  sheets: unknown,
): ExportSelection {
  const order = snapshot.sheetOrder?.length ? snapshot.sheetOrder : Object.keys(snapshot.sheets);
  const nameOf = (id: string): string => snapshot.sheets[id]?.name ?? id;
  const allNames = order.map(nameOf);
  const allUnits = (): ExportUnit[] => order.map((id) => ({ id, name: nameOf(id) }));
  const itemsGiven = items !== undefined && items !== null;
  const sheetsGiven = sheets !== undefined && sheets !== null;

  if (itemsGiven && sheetsGiven) {
    return {
      ok: false,
      error:
        'items 与 sheets 只能用一个——items 单元形态如 [{sheet:"周营收"}] 或 [{sheet:2,range:"A1:F20"}]，sheets 形态如 ["周营收"] 或 [1,3]',
    };
  }
  if (!itemsGiven && !sheetsGiven) return { ok: true, units: allUnits() };

  /* --- sheets 兼容糖（v1 表名数组契约不变；本批扩 1 起序号数组） --- */
  if (sheetsGiven) {
    if (!Array.isArray(sheets) || sheets.length === 0) return { ok: true, units: allUnits() };
    const allStr = sheets.every((n) => typeof n === "string");
    const allNum = sheets.every((n) => typeof n === "number");
    if (!allStr && !allNum) {
      return {
        ok: false,
        error: `sheets 数组混用了表名与序号——请统一形态：表名数组如 ["房源价格表","周营收"]，或 1 起序号数组如 [1,3]（当前可用表：${allNames.join("、")}）`,
      };
    }
    if (allStr) {
      const wanted = sheets as string[];
      const missing = wanted.filter((w) => !allNames.includes(w));
      if (missing.length) {
        return { ok: false, error: `工作表不存在：${missing.join("、")}——当前可用表：${allNames.join("、")}` };
      }
      // 按调用方顺序（v1 语义）
      const units = wanted.flatMap((w) => order.filter((id) => nameOf(id) === w).map((id) => ({ id, name: w })));
      return { ok: true, units };
    }
    const nums = sheets as number[];
    const bad = nums.find((n) => !Number.isInteger(n) || n < 1 || n > order.length);
    if (bad !== undefined) {
      return {
        ok: false,
        error: `序号越界：${bad}（有效范围 1..${order.length}）——当前可用表：${order.map((id, i) => `${i + 1}=${nameOf(id)}`).join("、")}`,
      };
    }
    return { ok: true, units: nums.map((n) => ({ id: order[n - 1], name: nameOf(order[n - 1]) })) };
  }

  /* --- items 主形态 --- */
  if (!Array.isArray(items)) {
    return { ok: false, error: 'items 须为导出单元数组（如 [{sheet:"周营收"}]、[{sheet:2}]、[{sheet:"周营收表",range:"A1:F20"}]）' };
  }
  if (items.length === 0) return { ok: true, units: allUnits() };
  const units: ExportUnit[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: `items 单元须为对象 {sheet: 表名或1起序号, range?: "A1:F20"}——收到 ${JSON.stringify(raw)}` };
    }
    const unit = raw as { sheet?: unknown; range?: unknown };
    if (typeof unit.sheet !== "string" && typeof unit.sheet !== "number") {
      return { ok: false, error: 'items 单元缺 sheet（表名或 1 起序号），如 {sheet:"周营收"} 或 {sheet:2,range:"A1:F20"}' };
    }
    let id: string;
    let name: string;
    if (typeof unit.sheet === "number") {
      if (!Number.isInteger(unit.sheet) || unit.sheet < 1 || unit.sheet > order.length) {
        return { ok: false, error: `序号越界：${unit.sheet}（有效范围 1..${order.length}）——当前可用表：${allNames.join("、")}` };
      }
      id = order[unit.sheet - 1];
      name = nameOf(id);
    } else {
      const found = order.find((x) => nameOf(x) === unit.sheet);
      if (!found) {
        return { ok: false, error: `工作表不存在：${unit.sheet}——当前可用表：${allNames.join("、")}（也可用 1 起序号，如 {sheet:1}）` };
      }
      id = found;
      name = unit.sheet;
    }
    let window: A1Window | undefined;
    let rangeRef: string | undefined;
    if (unit.range !== undefined && unit.range !== null) {
      if (typeof unit.range !== "string" || !unit.range.trim()) {
        return { ok: false, error: 'items 单元 range 须为 A1 区域字符串（如 "A1:F20"）' };
      }
      try {
        window = parseA1Range(unit.range);
      } catch (e) {
        // 区域语境包装（人话报错带「非法区域」框架 + 具体地址错误）
        return { ok: false, error: `非法区域「${unit.range}」——${e instanceof Error ? e.message : String(e)}` };
      }
      rangeRef = unit.range.trim();
    }
    units.push({ id, name, window, rangeRef });
  }
  return { ok: true, units };
}

export interface UnitWorkSnapshot {
  sheetOrder: string[];
  sheets: Record<string, { name?: string; cellData?: Record<number, Record<number, SeedCell>> }>;
}

export interface UnitWorkResult {
  /** 切片后的工作快照（sheetOrder/sheets 一体；同表多单元用合成键防覆盖） */
  work: UnitWorkSnapshot;
  /** 逐单元回：整表单元 {sheet}；区域单元 {sheet, range(收敛后)} */
  selected: Array<{ sheet: string; range?: string }>;
  /** 文件名 tag（单元标签以 - 连接：整表单元＝表名，区域单元＝表名-A1F20） */
  tag: string;
}

/**
 * 单元 → 工作快照（区域窗口与实际内容 usedRange 取交集收敛；range 超出内容
 * 按内容范围收敛，无交集＝人话报错）。同表多单元以合成键区分（draw/xlsx 桥
 * 只读 name/cellData，键形态不外泄）。
 */
export function buildUnitWorkSnapshot(
  snapshot: { sheets: Record<string, { name?: string; cellData?: Record<number, Record<number, SeedCell>> }> },
  units: ExportUnit[],
): { ok: false; error: string } | { ok: true; result: UnitWorkResult } {
  const work: UnitWorkSnapshot = { sheetOrder: [], sheets: {} };
  const selected: UnitWorkResult["selected"] = [];
  const tagParts: string[] = [];
  for (let k = 0; k < units.length; k++) {
    const unit = units[k];
    const cellData = snapshot.sheets[unit.id]?.cellData ?? {};
    const key = `${unit.id}#u${k}`;
    if (!unit.window) {
      work.sheets[key] = { name: unit.name, cellData };
      work.sheetOrder.push(key);
      selected.push({ sheet: unit.name });
      tagParts.push(unit.name);
      continue;
    }
    const ur = usedRange(cellData);
    const wr0 = Math.max(0, unit.window.r0);
    const wc0 = Math.max(0, unit.window.c0);
    const wr1 = Math.min(unit.window.r1, ur.maxR);
    const wc1 = Math.min(unit.window.c1, ur.maxC);
    if (!ur.hasContent || wr0 > wr1 || wc0 > wc1) {
      const contentLabel = ur.hasContent ? `${encodeA1(ur.minR, ur.minC)}:${encodeA1(ur.maxR, ur.maxC)}` : "空表";
      return {
        ok: false,
        error: `区域 ${unit.rangeRef} 与表「${unit.name}」的实际内容无交集（内容范围 ${contentLabel}）——请调整 range`,
      };
    }
    const label = `${encodeA1(wr0, wc0)}:${encodeA1(wr1, wc1)}`;
    work.sheets[key] = { name: unit.name, cellData: sliceWindow(cellData, wr0, wr1, wc0, wc1) };
    work.sheetOrder.push(key);
    selected.push({ sheet: unit.name, range: label });
    tagParts.push(`${unit.name}-${label.replace(/:/g, "")}`);
  }
  return { ok: true, result: { work, selected, tag: tagParts.join("-") } };
}
