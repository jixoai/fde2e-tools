/*
 * pptx WebMCP 注册 —— apps/pptx/src/webmcp.ts
 *
 * 把「大纲 JSON → .pptx」能力注册为 document.modelContext 工具（原生/polyfill
 * 同形）：
 * - create_pptx：slides[, filename] → 复用页面输入区 + 生成按钮全链路；
 * - add_slide：向当前 slides 追加一页（title/bullets/notes，细粒度逐页构建）。
 * 安全：输出含用户可控内容（untrustedContentHint），上层 LLM 不得当指令执行。
 */
import {
  clickById,
  registerWebMCPTools,
  waitForStatusChange,
  type WebMCPToolDef,
} from "@fde2e-tools/shared/webmcp";
import { safeFilename } from "@fde2e-tools/shared/download";
import { DEFAULT_EXPORT_NAME, setExportName } from "./export-name";
import { deckStats, normalizeDeck, type DeckSpec } from "./spec";

function setInputValue(id: string, value: string): void {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLTextAreaElement)) throw new Error(`页面未就绪（#${id} 缺失）`);
  el.value = value;
}

function readDeckFromPage(): DeckSpec | null {
  const el = document.getElementById("input-json");
  if (!(el instanceof HTMLTextAreaElement)) throw new Error("页面未就绪（#input-json 缺失）");
  const text = el.value.trim();
  if (!text) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error("当前 JSON 输入区不是合法 JSON：" + (e instanceof Error ? e.message : String(e)));
  }
  return normalizeDeck(data);
}

function buildTools(): WebMCPToolDef[] {
  return [
    {
      name: "create_pptx",
      title: "生成 .pptx",
      description:
        "按 slides 大纲生成并下载 pptx-export.pptx（16:9）。slides=[{title, bullets[], notes?}]，" +
        "每页必须有 title；可选 filename 自定义下载名（自动补 .pptx）。返回文件名/页数/要点数/状态行结果。",
      inputSchema: {
        type: "object",
        properties: {
          slides: {
            type: "array",
            description: "幻灯页数组（非空）",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                title: { type: "string", description: "页标题（必填）" },
                bullets: { type: "array", description: "要点列表（字符串数组，可省略）", items: { type: "string" } },
                notes: { type: "string", description: "演讲者备注（可省略）" },
              },
              required: ["title"],
              additionalProperties: false,
            },
          },
          filename: { type: "string", description: "可选下载文件名（缺省 pptx-export.pptx）" },
        },
        required: ["slides"],
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        let spec: DeckSpec;
        try {
          spec = normalizeDeck({ slides: input.slides });
        } catch (e) {
          return { ok: false, error: e instanceof Error && e.message ? e.message : String(e) };
        }
        // 文件名闭包：点击前算好（生成后页面会复位缺省，事后读会拿到缺省值）；
        // 与页面 setExportName 同函数同参，返回值与真实下载名一致
        const filename = safeFilename(
          typeof input.filename === "string" ? input.filename : undefined,
          DEFAULT_EXPORT_NAME,
          ".pptx",
        );
        setExportName(typeof input.filename === "string" ? input.filename : undefined);
        setInputValue("input-json", JSON.stringify(spec, null, 2));
        if (!clickById("generate-pptx-btn")) throw new Error("页面未就绪（generate-pptx-btn 缺失）");
        const snapshot = await waitForStatusChange(30000);
        const st = deckStats(spec);
        return {
          ok: snapshot.ok,
          message: snapshot.message,
          filename: snapshot.ok ? filename : null,
          slideCount: st.slideCount,
          bulletCount: st.bulletCount,
        };
      },
    },
    {
      name: "add_slide",
      title: "追加一页幻灯",
      description:
        "向当前 slides 大纲追加一页（title 必填；bullets/notes 可选；未载入大纲时自动新建），刷新预览并返回大纲 JSON——细粒度逐页构建后再用 create_pptx 生成。",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "页标题（必填）" },
          bullets: { type: "array", description: "要点列表（可省略）", items: { type: "string" } },
          notes: { type: "string", description: "演讲者备注（可省略）" },
        },
        required: ["title"],
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        let spec: DeckSpec;
        try {
          spec = readDeckFromPage() ?? { slides: [] };
          const title = String(input.title ?? "").trim();
          if (!title) return { ok: false, error: "title 必填（每页必须有标题）" };
          spec.slides.push({
            title,
            bullets: Array.isArray(input.bullets) ? input.bullets.map((b) => String(b)) : [],
            ...(typeof input.notes === "string" && input.notes.trim()
              ? { notes: input.notes.trim() }
              : {}),
          });
          spec = normalizeDeck({ slides: spec.slides });
        } catch (e) {
          return { ok: false, error: e instanceof Error && e.message ? e.message : String(e) };
        }
        setInputValue("input-json", JSON.stringify(spec, null, 2));
        if (!clickById("preview-btn")) throw new Error("页面未就绪（preview-btn 缺失）");
        const snapshot = await waitForStatusChange();
        const st = deckStats(spec);
        return {
          ok: snapshot.ok,
          message: snapshot.message,
          slideCount: st.slideCount,
          outline: JSON.stringify(spec, null, 2),
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
    if (r.failures.length) console.warn("[pptx] WebMCP 注册失败项:", r.failures);
    return r;
  });
}
