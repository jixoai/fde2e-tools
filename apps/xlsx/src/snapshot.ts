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
