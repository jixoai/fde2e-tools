/*
 * 工作簿输入解析单源 —— apps/xlsx/src/spec.ts
 *
 * 两种输入形态（预览与生成共用同一份解析，禁止各写一套）：
 * 1. JSON：{"sheets":[{"name":"表名","rows":[[cell,...],...]}]}
 * 2. 粘贴表格（TSV）：Tab 分列、换行分行；「## 表名」行开启新工作表；
 *    纯数字单元格自动转数字；缺省首表 Sheet1。
 *
 * 全部错误都是人话（#status 直接展示），不抛裸异常文案。
 */

export interface SheetSpec {
  name: string;
  rows: unknown[][];
}

export interface WorkbookSpec {
  sheets: SheetSpec[];
}

/** 校验并归一工作簿结构（JSON/程序化构造共用）：人话错误 + Excel 约束检查 */
export function normalizeWorkbook(data: unknown): WorkbookSpec {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error('sheets 结构错误：顶层应为对象 {"sheets":[{"name":"表名","rows":[[...]]}]}');
  }
  const sheetsRaw = (data as { sheets?: unknown }).sheets;
  if (!Array.isArray(sheetsRaw) || sheetsRaw.length === 0) {
    throw new Error("sheets 结构错误：sheets 必须是非空数组");
  }
  const sheets: SheetSpec[] = sheetsRaw.map((s, i) => {
    if (s === null || typeof s !== "object" || Array.isArray(s)) {
      throw new Error(`sheets[${i}] 结构错误：应为 {"name":"表名","rows":[[...]]}`);
    }
    const nameRaw = (s as { name?: unknown }).name;
    const name =
      typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim() : `Sheet${i + 1}`;
    if (name.length > 31) {
      throw new Error(`sheets[${i}] 表名超长（Excel 上限 31 字符）：${name.slice(0, 40)}…`);
    }
    const rowsRaw = (s as { rows?: unknown }).rows;
    if (!Array.isArray(rowsRaw)) {
      throw new Error(`sheets[${i}]（${name}）的 rows 必须是二维数组`);
    }
    const rows = rowsRaw.map((row, r) => {
      if (!Array.isArray(row)) {
        throw new Error(`sheets[${i}]（${name}）第 ${r + 1} 行不是数组`);
      }
      return row.map((cell) => {
        if (
          cell === null ||
          typeof cell === "string" ||
          typeof cell === "number" ||
          typeof cell === "boolean"
        ) {
          return cell;
        }
        if (cell instanceof Date) return cell.toISOString();
        throw new Error(
          `sheets[${i}]（${name}）第 ${r + 1} 行存在不支持的单元格类型（支持：字符串/数字/布尔/null）`,
        );
      });
    });
    return { name, rows };
  });
  const seen = new Set<string>();
  for (const s of sheets) {
    if (seen.has(s.name)) {
      throw new Error(`表名重复：${s.name}（同一工作簿内表名必须唯一）`);
    }
    seen.add(s.name);
  }
  return { sheets };
}

/** JSON 输入 → 工作簿（空输入/语法错误/结构错误都给人话） */
export function parseWorkbookJson(text: string): WorkbookSpec {
  if (!text.trim()) {
    throw new Error("输入为空：请先粘贴 JSON、粘贴表格，或点「载入示例」。");
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error("JSON 解析失败：" + (e instanceof Error ? e.message : String(e)));
  }
  return normalizeWorkbook(data);
}

/** 粘贴表格（TSV）→ 工作簿：## 表名 分表；纯数字单元格转数字 */
export function parseTsv(text: string): WorkbookSpec {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => l.trim() !== "");
  if (lines.length === 0) {
    throw new Error("输入为空：请先粘贴 JSON、粘贴表格，或点「载入示例」。");
  }
  const sheets: SheetSpec[] = [];
  let current: SheetSpec | null = null;
  const ensure = (): SheetSpec => {
    if (!current) {
      current = { name: "Sheet1", rows: [] };
      sheets.push(current);
    }
    return current;
  };
  for (const line of lines) {
    const m = /^##\s*(.+?)\s*$/.exec(line);
    if (m) {
      current = { name: m[1] || `Sheet${sheets.length + 1}`, rows: [] };
      sheets.push(current);
      continue;
    }
    const cells = line.split("\t").map((c) => {
      const t = c.trim();
      return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : c;
    });
    ensure().rows.push(cells);
  }
  const spec: WorkbookSpec = { sheets };
  // 复用同一校验器兜底（表名超长/重复等）
  return normalizeWorkbook(spec);
}

export function workbookStats(spec: WorkbookSpec): { sheetCount: number; rowCount: number } {
  return {
    sheetCount: spec.sheets.length,
    rowCount: spec.sheets.reduce((n, s) => n + s.rows.length, 0),
  };
}
