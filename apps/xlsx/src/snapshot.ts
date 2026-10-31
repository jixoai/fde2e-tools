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

/* ---------- 选择性导出（openspec: selective-export） ---------- */

export interface SheetFilterResult {
  /** 过滤后的 sheetOrder id 序列（按调用方给出的表名顺序） */
  ids: string[];
  /** 实际导出的表名清单（返回值 selected 字段） */
  selected: string[];
  /** 人话错误（表名不存在时列出可用表名） */
  error: string | null;
}

/**
 * 按表名过滤工作簿快照（export_pdf/export_png/export_xlsx 三路径共用）。
 * sheets 缺省/空数组＝全部表；表名不存在＝人话报错并列出可用表名。
 */
export function filterSheetIds(
  snapshot: { sheetOrder?: string[]; sheets: Record<string, { name?: string }> },
  sheets: unknown,
): SheetFilterResult {
  const order = snapshot.sheetOrder?.length ? snapshot.sheetOrder : Object.keys(snapshot.sheets);
  const nameOf = (id: string): string => snapshot.sheets[id]?.name ?? id;
  const allNames = order.map(nameOf);
  if (sheets === undefined || sheets === null || (Array.isArray(sheets) && sheets.length === 0)) {
    return { ids: order, selected: allNames, error: null };
  }
  if (!Array.isArray(sheets) || sheets.length === 0 || sheets.some((n) => typeof n !== "string")) {
    return { ids: [], selected: [], error: `sheets 参数须为工作表名数组（如 ["房源价格表"]）——当前可用表：${allNames.join("、")}` };
  }
  const wanted = sheets as string[];
  const missing = wanted.filter((w) => !allNames.includes(w));
  if (missing.length) {
    return { ids: [], selected: [], error: `工作表不存在：${missing.join("、")}——当前可用表：${allNames.join("、")}` };
  }
  const ids = wanted.flatMap((w) => order.filter((id) => nameOf(id) === w)); // 按调用方顺序
  return { ids, selected: ids.map(nameOf), error: null };
}
