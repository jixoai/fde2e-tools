/*
 * xlsx 编辑器 WebMCP 注册 —— apps/xlsx/src/webmcp.ts
 *
 * 与 easy-* 的「DOM 桥」形态不同（digest 建议已落地）：工具**直接调用编辑器
 * 内核 API**（Univer Facade），不经页面输入区。全部写工具统一走
 * withEditorWrite：Rendered 门禁（坑②）+ canary 健康校验（坑①）——未就绪/
 * 幽灵一律显式 ok:false，禁静默失败（openspec: univer-write-gate）。
 * 输出含用户可控内容（untrustedContentHint 纪律）。
 */
import { downloadBlob } from "@fde2e-tools/shared/download";
import { registerWebMCPTools, type WebMCPToolDef } from "@fde2e-tools/shared/webmcp";
import {
  canaryProbe,
  disposeActiveUnit,
  getHost,
  injectGhostWorkbook,
  restoreMainWorkbook,
  sleep,
  withEditorWrite,
  type FacadeSheet,
} from "./editor";
import { exportGridPdf, exportSheetLongPng } from "./export";
import { snapshotToXlsxBytes, xlsxBytesToSeed } from "./bridge";
import { resolveExportName } from "./export-name";
import { assertCompleteSeed, type SeedCell, type WorkbookSeed } from "./snapshot";

/* ---------- 基础助手 ---------- */

const A1_RE = /^(\$?[A-Za-z]{1,3})(\$?[1-9]\d{0,6})$/;

/** "B3" → [row, col]（0 基）；非法即抛人话错误 */
export function parseA1(ref: string): [number, number] {
  const m = A1_RE.exec(ref.trim());
  if (!m) throw new Error(`非法单元格地址「${ref}」（期望 A1 形态）`);
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return [parseInt(m[2], 10) - 1, col - 1];
}

function resolveSheet(h: NonNullable<ReturnType<typeof getHost>>, name: string | undefined): FacadeSheet {
  const wb = h.api.getActiveWorkbook();
  if (!wb) throw new Error("当前无活动工作簿");
  if (!name) return wb.getActiveSheet();
  const s = wb.getSheetByName(name);
  if (!s) throw new Error(`找不到工作表「${name}」（现有：${wb.getSheets().map((x) => x.getSheetName()).join("、")}）`);
  return s;
}

/** 公式补 = 前缀；计算值轮询（引擎异步算，3s 上限） */
async function formulaValue(sheet: FacadeSheet, range: string): Promise<unknown> {
  for (let i = 0; i < 15; i++) {
    await sleep(200);
    const v = sheet.getRange(range).getValue();
    if (v !== null && v !== undefined && v !== "") return v;
  }
  return sheet.getRange(range).getValue();
}

/** 快照紧凑化（get_snapshot / 工具摘要共用）：cellData 全量 + 表元信息 */
function compactSnapshot(save: Record<string, unknown>, workbookName: string): Record<string, unknown> {
  const sheets = (save.sheets ?? {}) as Record<string, { name?: string; rowCount?: number; columnCount?: number; cellData?: unknown }>;
  const order = (save.sheetOrder as string[]) ?? Object.keys(sheets);
  return {
    workbookName,
    sheetOrder: order,
    sheets: order.filter((id) => sheets[id]).map((id) => ({
      id,
      name: sheets[id].name ?? id,
      rowCount: sheets[id].rowCount,
      columnCount: sheets[id].columnCount,
      cellData: sheets[id].cellData ?? {},
    })),
  };
}

/* ---------- 工具面 ---------- */

function buildTools(): WebMCPToolDef[] {
  return [
    {
      name: "set_cells",
      title: "写入单元格",
      description:
        "向工作表写入二维数据 values[][]（自 startRow/startCol 起，0 基；支持字符串/数字/布尔/null）。" +
        "编辑器未渲染完成或工作簿异常时返回 ok:false（禁静默失败）。返回写入数量与覆盖范围。",
      inputSchema: {
        type: "object",
        properties: {
          sheet: { type: "string", description: "目标工作表名（缺省当前活动表）" },
          startRow: { type: "number", description: "起始行（0 基，缺省 0）" },
          startCol: { type: "number", description: "起始列（0 基，缺省 0）" },
          values: { type: "array", description: "二维数组，如 [[\"产品\",\"数量\"],[\"Widget\",3]]", items: { type: "array" } },
        },
        required: ["values"],
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        const values = input.values as unknown;
        if (!Array.isArray(values) || !values.length || !Array.isArray(values[0])) {
          return { ok: false, error: "values 必须是非空二维数组" };
        }
        const startRow = typeof input.startRow === "number" && input.startRow >= 0 ? Math.floor(input.startRow) : 0;
        const startCol = typeof input.startCol === "number" && input.startCol >= 0 ? Math.floor(input.startCol) : 0;
        const res = await withEditorWrite(async (h) => {
          const sheet = resolveSheet(h, typeof input.sheet === "string" ? input.sheet : undefined);
          let written = 0;
          let maxCols = 0;
          for (let r = 0; r < values.length; r++) {
            const row = values[r] as unknown[];
            maxCols = Math.max(maxCols, row.length);
            for (let c = 0; c < row.length; c++) {
              const cell = row[c];
              if (cell === undefined) continue;
              const target = sheet.getRange(startRow + r, startCol + c);
              target.setValue(cell === null ? null : (cell as SeedCell["v"]));
              written++;
              if (written % 100 === 0) await sleep(0); // 大批量让出主线程，保持网格可交互
            }
          }
          return {
            sheet: sheet.getSheetName(),
            written,
            range: `${startRow},${startCol} 起 ${values.length} 行 × ${maxCols} 列`,
          };
        });
        return res.ok ? { ok: true, ...res.value } : res;
      },
    },
    {
      name: "set_formula",
      title: "写公式",
      description:
        "对 A1 地址或区间写公式（如 =SUM(C2:C3)，跨表引用 Sheet2!A1 亦支持），公式引擎真算——返回计算值供 AI 自检。未就绪返回 ok:false。",
      inputSchema: {
        type: "object",
        properties: {
          sheet: { type: "string", description: "目标工作表名（缺省当前活动表）" },
          range: { type: "string", description: "A1 地址或区间（如 C5 或 C5:C9）" },
          formula: { type: "string", description: "公式串（= 可省略，如 =SUM(A1:A9) 或 SUM(A1:A9)）" },
        },
        required: ["range", "formula"],
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        const range = String(input.range ?? "");
        const raw = String(input.formula ?? "").trim();
        if (!range || !raw) return { ok: false, error: "range 与 formula 必填" };
        parseA1(range.split(":")[0]); // 前置校验地址形态
        const formula = raw.startsWith("=") ? raw : "=" + raw;
        const res = await withEditorWrite(async (h) => {
          const sheet = resolveSheet(h, typeof input.sheet === "string" ? input.sheet : undefined);
          sheet.getRange(range).setFormula(formula);
          const value = await formulaValue(sheet, range);
          return { sheet: sheet.getSheetName(), range, formula, value: value === null ? null : value };
        });
        return res.ok ? { ok: true, ...res.value } : res;
      },
    },
    {
      name: "format_range",
      title: "设置样式",
      description:
        "对 A1 区间设置样式：bold/italic（布尔）、color（字色 #rrggbb）、bg（底色）、align（left/center/right）、numfmt（数字格式如 $#,##0.00 或 0.0%）、border（细边框范围 all/outer/top/bottom/left/right/horizontal/vertical/inside）。返回实际应用的样式键。",
      inputSchema: {
        type: "object",
        properties: {
          sheet: { type: "string", description: "目标工作表名（缺省当前活动表）" },
          range: { type: "string", description: "A1 区间（如 A1:D1）" },
          styles: {
            type: "object",
            description: "样式键值对（至少一项）",
            properties: {
              bold: { type: "boolean" },
              italic: { type: "boolean" },
              color: { type: "string" },
              bg: { type: "string" },
              align: { type: "string", enum: ["left", "center", "right"] },
              numfmt: { type: "string" },
              border: { type: "string", enum: ["all", "outside", "top", "bottom", "left", "right", "horizontal", "vertical", "inside"], description: "细边框（THIN）应用范围" },
            },
            additionalProperties: false,
          },
        },
        required: ["range", "styles"],
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        const range = String(input.range ?? "");
        if (!range) return { ok: false, error: "range 必填" };
        parseA1(range.split(":")[0]);
        const styles = (input.styles ?? {}) as Record<string, unknown>;
        const res = await withEditorWrite(async (h) => {
          const sheet = resolveSheet(h, typeof input.sheet === "string" ? input.sheet : undefined);
          const r = sheet.getRange(range);
          const applied: string[] = [];
          if (typeof styles.bold === "boolean") {
            r.setFontWeight(styles.bold ? "bold" : "normal");
            applied.push("bold");
          }
          if (typeof styles.italic === "boolean") {
            r.setFontStyle(styles.italic ? "italic" : "normal");
            applied.push("italic");
          }
          if (typeof styles.color === "string") {
            r.setFontColor(styles.color);
            applied.push("color");
          }
          if (typeof styles.bg === "string") {
            r.setBackgroundColor(styles.bg);
            applied.push("bg");
          }
          if (styles.align === "left" || styles.align === "center" || styles.align === "right") {
            r.setHorizontalAlignment(styles.align);
            applied.push("align");
          }
          if (typeof styles.numfmt === "string") {
            r.setNumberFormat(styles.numfmt);
            applied.push("numfmt");
          }
          if (typeof styles.border === "string") {
            const borderType = String(styles.border).toUpperCase();
            const enumType = h.api.Enum?.BorderType?.[borderType];
            const enumStyle = h.api.Enum?.BorderStyleTypes?.THIN;
            if (!enumType || !enumStyle) throw new Error("border 范围值不支持（可用：all/outside/top/bottom/left/right/horizontal/vertical/inside）");
            r.setBorder(enumType, enumStyle);
            applied.push("border");
          }
          if (!applied.length) throw new Error("styles 至少需要一项可识别的样式键");
          return { sheet: sheet.getSheetName(), range, applied };
        });
        return res.ok ? { ok: true, ...res.value } : res;
      },
    },
    {
      name: "add_sheet",
      title: "新增工作表",
      description: "新增工作表（name 缺省自动 SheetN），可带初始二维数据 rows。返回新表名与全簿表清单。重名会报错。",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "新工作表名（≤31 字符且唯一）" },
          rows: { type: "array", description: "可选初始二维数据", items: { type: "array" } },
        },
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        const name = typeof input.name === "string" && input.name.trim() ? input.name.trim() : "";
        const res = await withEditorWrite(async (h) => {
          const wb = h.api.getActiveWorkbook();
          if (!wb) throw new Error("当前无活动工作簿");
          if (name.length > 31) throw new Error(`表名超长（${name.length} 字符，上限 31）——请缩短表名`);
          const finalName = name || `Sheet${wb.getSheets().length + 1}`;
          if (wb.getSheetByName(finalName)) throw new Error(`表名「${finalName}」已存在（表名不得重复）`);
          const created = wb.insertSheet(finalName);
          let written = 0;
          const rows = Array.isArray(input.rows) ? (input.rows as unknown[]) : [];
          for (let r = 0; r < rows.length; r++) {
            const row = rows[r];
            if (!Array.isArray(row)) continue;
            for (let c = 0; c < row.length; c++) {
              if (row[c] === undefined) continue;
              created.getRange(r, c).setValue(row[c] === null ? null : (row[c] as SeedCell["v"]));
              written++;
            }
          }
          return { sheet: finalName, written, allSheets: wb.getSheets().map((s) => s.getSheetName()) };
        });
        return res.ok ? { ok: true, ...res.value } : res;
      },
    },
    {
      name: "import_xlsx",
      title: "导入 .xlsx",
      description:
        "导入 .xlsx 文件（base64 编码）为可编辑工作簿（SheetJS 桥：值/公式保留；样式与列宽不保留），替换当前工作簿。返回表清单与单元格统计。导入后可继续 set_cells/export_xlsx。",
      inputSchema: {
        type: "object",
        properties: {
          base64: { type: "string", description: ".xlsx 文件内容的 base64 编码" },
          filename: { type: "string", description: "可选：来源文件名（仅用于状态展示）" },
        },
        required: ["base64"],
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        const b64 = String(input.base64 ?? "").replace(/\s+/g, "");
        let bytes: ArrayBuffer;
        try {
          const bin = atob(b64);
          bytes = new Uint8Array(Array.from(bin, (ch) => ch.charCodeAt(0))).buffer;
        } catch {
          return { ok: false, error: "base64 解码失败：请提供 .xlsx 文件内容的 base64 编码" };
        }
        const res = await withEditorWrite(async (h) => {
          const summary = await xlsxBytesToSeed(bytes, typeof input.filename === "string" ? input.filename.replace(/\.xlsx$/i, "") || "导入工作簿" : "导入工作簿");
          assertCompleteSeed(summary.seed); // 幽灵防御：导入路径同样只走完整格式
          disposeActiveUnit(h.api); // 对齐 loadSampleWorkbook：换簿前关旧 unit，防累积
          h.api.createWorkbook(summary.seed);
          const ready = await h.gate.ensureReady(h.api);
          if (!ready) throw new Error("导入后工作簿未在时限内渲染完成（Rendered）");
          await sleep(120);
          const canary = await canaryProbe(h.api);
          h.health = canary;
          if (!canary.verified) throw new Error(canary.error ?? "导入后 canary 校验失败");
          return { sheetNames: summary.sheetNames, cells: summary.cells };
        });
        return res.ok ? { ok: true, ...(res.value as { sheetNames: string[]; cells: number }) } : res;
      },
    },
    {
      name: "export_xlsx",
      title: "导出 .xlsx",
      description:
        "导出当前工作簿为真 .xlsx 下载（缺省文件名 xlsx-export.xlsx；值/公式保留，v1 样式与列宽不落导出文件）。返回文件名契约与逐表统计。",
      inputSchema: {
        type: "object",
        properties: {
          filename: { type: "string", description: "可选下载文件名（缺省 xlsx-export.xlsx）" },
        },
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        const filename = resolveExportName(typeof input.filename === "string" ? input.filename : undefined);
        const h = getHost();
        if (!h) return { ok: false, error: "编辑器尚未启动（内核加载中），请稍后重试" };
        const ready = await h.gate.ensureReady(h.api);
        if (!ready) return { ok: false, error: "编辑器尚未渲染完成（未到 Rendered），导出已拒绝——请稍后重试" };
        const wb = h.api.getActiveWorkbook();
        if (!wb) return { ok: false, error: "当前无活动工作簿" };
        try {
          const snapshot = wb.save() as Parameters<typeof snapshotToXlsxBytes>[0];
          const { bytes, stats } = await snapshotToXlsxBytes(snapshot);
          downloadBlob(new Blob([bytes as unknown as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename);
          return { ok: true, filename, sheetCount: stats.length, sheets: stats };
        } catch (e) {
          return { ok: false, error: e instanceof Error && e.message ? e.message : String(e) };
        }
      },
    },
    {
      name: "get_snapshot",
      title: "读工作簿快照",
      description:
        "只读：返回全簿快照 JSON（workbookName/sheetOrder/sheets[]{id,name,rowCount,columnCount,cellData}；cellData 含 v 值与 f 公式）——AI 先读后写的主通道。",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      async execute() {
        const h = getHost();
        if (!h) return { ok: false, error: "编辑器尚未启动（内核加载中），请稍后重试" };
        const ready = await h.gate.ensureReady(h.api);
        if (!ready) return { ok: false, error: "编辑器尚未渲染完成（未到 Rendered），读取已拒绝" };
        const wb = h.api.getActiveWorkbook();
        if (!wb) return { ok: false, error: "当前无活动工作簿" };
        const snapshot = compactSnapshot(wb.save(), h.workbookName);
        return { ok: true, ...snapshot };
      },
    },
    {
      name: "export_pdf",
      title: "导出 PDF",
      description:
        "把当前工作簿导出为矢量 PDF 下载（缺省 xlsx-export.pdf；真实文本层可搜索可复制；" +
        "A4 纵向多页，列宽自适应/表头加粗/数字右对齐/重复表头/页脚页码；不含编辑器 UI）。" +
        "编辑器未就绪时返回 ok:false。返回文件名契约与页数。",
      inputSchema: {
        type: "object",
        properties: {
          filename: { type: "string", description: "可选下载文件名（缺省 xlsx-export.pdf）" },
        },
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        return await exportGridPdf(typeof input.filename === "string" ? input.filename : undefined);
      },
    },
    {
      name: "export_png",
      title: "导出长图 PNG",
      description:
        "把全部工作表内容导出为一张长图 PNG 下载（缺省 xlsx-long.png）。数据面自绘表格（网格 canvas 只含可视视口，" +
        "长图诚实走快照数据）：全部工作表按 sheetOrder、列头 A/B/C、值与公式。内容超 16384px 会截断并在产物与返回值标注。",
      inputSchema: {
        type: "object",
        properties: {
          filename: { type: "string", description: "可选下载文件名（缺省 xlsx-long.png）" },
        },
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        return await exportSheetLongPng(typeof input.filename === "string" ? input.filename : undefined);
      },
    },
  ];
}

/* ---------- 测试缝（绿门双坑回归专用，非 WebMCP 工具面） ---------- */

interface OfficeTestHooks {
  /** 坑①：注入简化 seed 建幽灵工作簿 */
  injectGhostWorkbook: () => Promise<void>;
  /** 绿门矩阵探针用：原始 Facade API（只读用途；不改内核状态） */
  rawApi: () => unknown;
  /** 坑①：以工厂 seed 重建健康工作簿并重跑 canary */
  restoreMainWorkbook: () => Promise<boolean>;
  /** 坑②：强制生命周期门禁挂起/释放 */
  forcePending: (v: boolean) => void;
  /** 当前生命周期 stage（0 Started / 1 Ready / 2 Rendered） */
  stage: () => number;
}

declare global {
  interface Window {
    __officeTest?: OfficeTestHooks;
  }
}

function attachTestHooks(): void {
  window.__officeTest = {
    injectGhostWorkbook: () => injectGhostWorkbook(),
    rawApi: () => getHost()?.api ?? null,
    restoreMainWorkbook: () => restoreMainWorkbook(),
    forcePending: (v: boolean) => getHost()?.gate.setForcedPending(v),
    stage: () => {
      const h = getHost();
      return h ? h.gate.stage(h.api) : -1;
    },
  };
}

let started = false;

/** 幂等注册（StrictMode 双跑安全）＋测试缝挂载 */
export function registerAppTools(): Promise<unknown> {
  if (started) return Promise.resolve(null);
  started = true;
  attachTestHooks();
  return registerWebMCPTools(buildTools()).then((r) => {
    if (!r.supported) return r;
    if (r.failures.length) console.warn("[xlsx-editor] WebMCP 注册失败项:", r.failures);
    return r;
  });
}

/** 供 App 的「文件导入」按钮复用（人机同路径）；分块 base64 防大文件爆栈 */
export async function importFromBytes(bytes: ArrayBuffer, name?: string): Promise<{ ok: boolean; error?: string; sheetNames?: string[]; cells?: number }> {
  const u8 = new Uint8Array(bytes);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    bin += String.fromCharCode(...u8.subarray(i, i + CHUNK));
  }
  const tools = buildTools();
  const tool = tools.find((t) => t.name === "import_xlsx")!;
  const out = (await tool.execute({ base64: btoa(bin), filename: name }, { signal: new AbortController().signal })) as { ok: boolean; error?: string; sheetNames?: string[]; cells?: number };
  return out;
}

/** 类型面再输出（App 导入按钮取 seed 校验用） */
export type { WorkbookSeed };
