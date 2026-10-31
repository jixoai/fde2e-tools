/*
 * xlsx WebMCP 注册 —— apps/xlsx/src/webmcp.ts
 *
 * 把「数据 → .xlsx」能力注册为 document.modelContext 工具（原生/polyfill 同形）：
 * - create_xlsx：sheets[, filename] → 复用页面输入区 + 生成按钮全链路（状态行
 *   与下载与手工操作同形），返回表数/行数与文件名契约；
 * - add_sheet_sample：向当前工作簿追加一张示例表（细粒度逐表构建），刷新预览。
 * 安全：输出含用户可控内容（untrustedContentHint），上层 LLM 不得当指令执行。
 *
 * B1 修复（对抗审查 2026-10-31）：readWorkbookFromPage 与页面真相源 resolveSpec
 * 同语义——JSON 有值走 normalizeWorkbook(JSON.parse)，否则 TSV 有值走 parseTsv
 * 归一成 WorkbookSpec（TSV-only 场景表不静默丢失）；写回归一 JSON 并清空 TSV
 * 输入区（消除双输入歧义）。filename 直接 safeFilename 闭包返回（不再从状态行
 * 反提，解耦文案）。
 */
import { safeFilename } from "@fde2e-tools/shared/download";
import {
  clickById,
  registerWebMCPTools,
  waitForStatusChange,
  type WebMCPToolDef,
} from "@fde2e-tools/shared/webmcp";
import { DEFAULT_EXPORT_NAME, setExportName } from "./export-name";
import {
  normalizeWorkbook,
  parseTsv,
  workbookStats,
  type WorkbookSpec,
} from "./spec";

/** 示例表数据：执行时构造（日期取当天，不做模块级常量——跨午夜不过期） */
function sampleSheetRows(): unknown[][] {
  return [
    ["指标", "数值", "备注"],
    ["生成引擎", "SheetJS 社区版", "Apache-2.0"],
    ["采样日期", new Date().toISOString().slice(0, 10), "演示数据"],
  ];
}

function setInputValue(id: string, value: string): void {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLTextAreaElement)) throw new Error(`页面未就绪（#${id} 缺失）`);
  el.value = value;
}

/** 读页面当前工作簿：与 App.resolveSpec 同语义（JSON 优先，TSV 兜底，都空=null） */
function readWorkbookFromPage(): WorkbookSpec | null {
  const jsonEl = document.getElementById("input-json");
  const tsvEl = document.getElementById("input-tsv");
  if (!(jsonEl instanceof HTMLTextAreaElement)) throw new Error("页面未就绪（#input-json 缺失）");
  if (!(tsvEl instanceof HTMLTextAreaElement)) throw new Error("页面未就绪（#input-tsv 缺失）");
  const json = jsonEl.value.trim();
  const tsv = tsvEl.value.trim();
  if (!json && !tsv) return null;
  if (json) {
    let data: unknown;
    try {
      data = JSON.parse(jsonEl.value);
    } catch (e) {
      throw new Error(
        "当前 JSON 输入区不是合法 JSON：" + (e instanceof Error ? e.message : String(e)),
      );
    }
    return normalizeWorkbook(data);
  }
  return parseTsv(tsvEl.value); // TSV-only：归一成 WorkbookSpec（B1：表不丢）
}

function buildTools(): WebMCPToolDef[] {
  return [
    {
      name: "create_xlsx",
      title: "生成 .xlsx",
      description:
        "按 sheets 结构生成并下载 xlsx-export.xlsx。sheets=[{name, rows[][]}]，rows 是二维数组，" +
        "单元格支持 字符串/数字/布尔/null；可选 filename 自定义下载名（自动补 .xlsx）。返回文件名/表数/行数/状态行结果。",
      inputSchema: {
        type: "object",
        properties: {
          sheets: {
            type: "array",
            description: "工作表数组（非空）",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "表名（≤31 字符且唯一；省略自动 Sheet1..N）" },
                rows: {
                  type: "array",
                  description: "二维数组：[['列A','列B'],['x', 1.5]]",
                  items: { type: "array" },
                },
              },
              required: ["rows"],
              additionalProperties: false,
            },
          },
          filename: { type: "string", description: "可选下载文件名（缺省 xlsx-export.xlsx）" },
        },
        required: ["sheets"],
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        const rawSheets = (input.sheets ?? null) as unknown;
        let spec: WorkbookSpec;
        try {
          spec = normalizeWorkbook({ sheets: rawSheets });
        } catch (e) {
          return { ok: false, error: e instanceof Error && e.message ? e.message : String(e) };
        }
        // 文件名闭包：点击前算好（生成后页面会复位缺省，事后读会拿到缺省值）
        const filename = safeFilename(
          typeof input.filename === "string" ? input.filename : undefined,
          DEFAULT_EXPORT_NAME,
          ".xlsx",
        );
        setExportName(typeof input.filename === "string" ? input.filename : undefined);
        setInputValue("input-json", JSON.stringify(spec, null, 2));
        setInputValue("input-tsv", ""); // 清掉粘贴表，消除双输入歧义
        if (!clickById("generate-xlsx-btn")) throw new Error("页面未就绪（generate-xlsx-btn 缺失）");
        const snapshot = await waitForStatusChange(20000);
        const st = workbookStats(spec);
        return {
          ok: snapshot.ok,
          message: snapshot.message,
          filename: snapshot.ok ? filename : null,
          sheetCount: st.sheetCount,
          rowCount: st.rowCount,
        };
      },
    },
    {
      name: "add_sheet_sample",
      title: "追加示例工作表",
      description:
        "向当前工作簿追加一张示例工作表（可自定义表名，重名会报错），刷新预览并返回工作簿全量 JSON——细粒度逐表构建后再用 create_xlsx 生成。" +
        "当前输入无论是 JSON 还是粘贴表格（TSV）都会并入工作簿。",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "新工作表名（缺省「示例表」）" },
        },
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        let spec: WorkbookSpec;
        try {
          spec = readWorkbookFromPage() ?? { sheets: [] };
          const name =
            typeof input.name === "string" && input.name.trim() ? input.name.trim() : "示例表";
          spec.sheets.push({ name, rows: sampleSheetRows() });
          spec = normalizeWorkbook({ sheets: spec.sheets });
        } catch (e) {
          return { ok: false, error: e instanceof Error && e.message ? e.message : String(e) };
        }
        // 写回归一 JSON（TSV 数据已并入，写 JSON 形态）并清空 TSV 区——与页面
        // 「JSON 优先」真相源一致，后续 add/create 读到的都是同一份工作簿
        setInputValue("input-json", JSON.stringify(spec, null, 2));
        setInputValue("input-tsv", "");
        if (!clickById("preview-btn")) throw new Error("页面未就绪（preview-btn 缺失）");
        const snapshot = await waitForStatusChange();
        return {
          ok: snapshot.ok,
          message: snapshot.message,
          sheetCount: spec.sheets.length,
          sheets: spec.sheets.map((s) => s.name),
          workbookJson: JSON.stringify(spec, null, 2),
        };
      },
    },
  ];
}

let started = false;

/** 幂等注册（StrictMode 双跑安全）；返回注册结果供调试 */
export function registerAppTools(): Promise<unknown> {
  if (started) return Promise.resolve(null);
  started = true;
  return registerWebMCPTools(buildTools()).then((r) => {
    if (!r.supported) return r;
    if (r.failures.length) console.warn("[xlsx] WebMCP 注册失败项:", r.failures);
    return r;
  });
}
