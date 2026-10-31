/*
 * pptx 编辑器 WebMCP 注册 —— apps/pptx/src/webmcp.ts
 *
 * 工具直接驱动 PPTist Pinia store（addSlide/updateElement/addElement）与自带
 * useExport/useImport 桥（pptxgenjs/pptxtojson），不经 DOM 输入区：
 * - add_slide（layout=title|bullets|blank）／set_title／add_bullets：store 语义建页；
 * - export_pptx：exportPPTX 真导出（文件名契约经标题临时换名实现）；
 * - import_pptx：pptxtojson 解析真 .pptx 置换画布。
 * 编辑器未就绪一律显式 ok:false（禁静默失败）；输出含用户可控内容
 * （untrustedContentHint 纪律）。
 */
import { registerWebMCPTools, type WebMCPToolDef } from "@fde2e-tools/shared/webmcp";
import { exportSlidesLongPng, exportSlidesPdf, exportSlidesPng } from "./export";
import {
  buildBulletsElement,
  buildTitleElement,
  getIsland,
  slideContentBottom,
  withPPTist,
  buildBlankSlide,
  type PPTSlide,
  type SlidesStoreApi,
} from "./bridge";
import { exportTitleOf, resolveExportName } from "./export-name";

/* ---------- 基础助手 ---------- */

function slideOf(slides: SlidesStoreApi, slideIndex: number | undefined, label = "slideIndex"): PPTSlide {
  const idx = slideIndex === undefined ? slides.slideIndex : Math.floor(slideIndex);
  const slide = slides.slides[idx];
  if (!slide) throw new Error(`${label} 越界（当前共 ${slides.slides.length} 页，有效索引 0~${slides.slides.length - 1}）`);
  return slide;
}

function slideSummary(slide: PPTSlide): Record<string, unknown> {
  return {
    id: slide.id,
    elementCount: slide.elements.length,
    texts: slide.elements
      .filter((el) => el.type === "text")
      .map((el) => (el as { content?: string }).content?.replace(/<[^>]+>/g, " ").trim().slice(0, 40))
      .filter(Boolean),
  };
}

/** 等待异步落定：忙→闲即完成；超时放行（正确性由下载事件与反读断言裁决） */
async function waitSettled(flag: { value: boolean }, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let busySeen = false;
  for (;;) {
    if (flag.value) busySeen = true;
    else if (busySeen) return true;
    if (Date.now() > deadline) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
}

/* ---------- 工具面 ---------- */

/** 参数「已给出」判定（undefined/null 视为未给） */
function isGiven(v: unknown): boolean {
  return v !== undefined && v !== null;
}

function buildTools(): WebMCPToolDef[] {
  return [
    {
      name: "add_slide",
      title: "新增幻灯页",
      description:
        "新增一页幻灯：layout=title（标题页：大标题）/ bullets（标题+要点列表）/ blank（空白页），可带 title/bullets[]/index（插入位置，缺省插到当前页之后）。返回新页索引与元素摘要。",
      inputSchema: {
        type: "object",
        properties: {
          layout: { type: "string", enum: ["title", "bullets", "blank"], description: "页面布局（缺省 bullets）" },
          title: { type: "string", description: "页标题（title/bullets 布局用）" },
          bullets: { type: "array", description: "要点列表（bullets 布局用；每条一个要点）", items: { type: "string" } },
          index: { type: "number", description: "插入位置（0 基；缺省当前页之后）" },
        },
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        const layout = input.layout === "title" || input.layout === "blank" ? input.layout : "bullets";
        const res = await withPPTist((m) => {
          const { slides } = m;
          const slide: PPTSlide = buildBlankSlide();
          if (layout !== "blank") {
            const title = typeof input.title === "string" && input.title.trim() ? input.title.trim() : "未命名页面";
            slide.elements.push(buildTitleElement(title));
            if (layout === "bullets") {
              const items = Array.isArray(input.bullets) ? (input.bullets as unknown[]).map((b) => String(b)).filter((b) => b.trim()) : [];
              if (items.length) slide.elements.push(buildBulletsElement(items, 220));
            }
          }
          // 空画布安全：初始 mock 尚未载入时 addSlide 会在空数组上 splice 出空洞
          // （下游渲染 undefined.id 崩溃）——空 deck 直接 setSlides 立为首页
          if (!slides.slides.length) {
            slides.setSlides([slide]);
          } else {
            // index 边界（顺手②）：0~length 有效，index=length＝队尾插入——
            // addSlide 语义＝插当前页之后，尾插先把当前页切到末页即自然落队尾
            const idx = typeof input.index === "number" ? Math.floor(input.index) : undefined;
            if (idx !== undefined && (idx < 0 || idx > slides.slides.length)) {
              throw new Error(`index 越界（当前共 ${slides.slides.length} 页，有效 0~${slides.slides.length}；index=length 表示队尾插入）`);
            }
            if (idx !== undefined) slides.updateSlideIndex(Math.min(idx, slides.slides.length - 1));
            slides.addSlide(slide);
          }
          return { index: slides.slideIndex, total: slides.slides.length, slide: slideSummary(slides.slides[slides.slideIndex]) };
        });
        return res.ok ? { ok: true, ...(res.value as Record<string, unknown>) } : res;
      },
    },
    {
      name: "set_title",
      title: "设置页标题",
      description:
        "设置指定页（slideIndex 缺省当前页）的标题文本：改写页内首个文本元素（保留原样式）；无文本元素则自动创建标题元素。",
      inputSchema: {
        type: "object",
        properties: {
          slideIndex: { type: "number", description: "目标页索引（0 基，缺省当前页）" },
          text: { type: "string", description: "标题文本" },
        },
        required: ["text"],
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        const text = String(input.text ?? "").trim();
        if (!text) return { ok: false, error: "text 为空" };
        const res = await withPPTist((m) => {
          const { slides } = m;
          const slide = slideOf(slides, typeof input.slideIndex === "number" ? input.slideIndex : undefined);
          const firstText = slide.elements.find((el) => el.type === "text") as (typeof slide.elements)[number] | undefined;
          if (firstText) {
            slides.updateElement({ id: firstText.id, props: { content: `<p>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>` }, slideId: slide.id });
          } else {
            slides.updateSlideIndex(slides.slides.indexOf(slide));
            slides.addElement(buildTitleElement(text));
          }
          return { slideIndex: slides.slides.indexOf(slide), ...slideSummary(slide) };
        });
        return res.ok ? { ok: true, ...(res.value as Record<string, unknown>) } : res;
      },
    },
    {
      name: "add_bullets",
      title: "追加要点列表",
      description:
        "向指定页（slideIndex 缺省当前页）追加要点列表元素（每条一个 • 段落，自动排版在既有内容下方）。",
      inputSchema: {
        type: "object",
        properties: {
          slideIndex: { type: "number", description: "目标页索引（0 基，缺省当前页）" },
          items: { type: "array", description: "要点数组（每条一个字符串）", items: { type: "string" } },
        },
        required: ["items"],
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        const items = Array.isArray(input.items) ? (input.items as unknown[]).map((b) => String(b)).filter((b) => b.trim()) : [];
        if (!items.length) return { ok: false, error: "items 为空（至少一条要点）" };
        const res = await withPPTist((m) => {
          const { slides } = m;
          const slide = slideOf(slides, typeof input.slideIndex === "number" ? input.slideIndex : undefined);
          slides.updateSlideIndex(slides.slides.indexOf(slide));
          const el = buildBulletsElement(items, Math.min(slideContentBottom(slide) + 20, 560));
          slides.addElement(el);
          return { slideIndex: slides.slides.indexOf(slide), added: items.length, ...slideSummary(slide) };
        });
        return res.ok ? { ok: true, ...(res.value as Record<string, unknown>) } : res;
      },
    },
    {
      name: "export_pptx",
      title: "导出 .pptx",
      description:
        "导出当前演示为真 .pptx 下载（PPTist exportPPTX：文本/形状/表格/图表基础项可靠；缺省文件名 pptx-export.pptx）。导出期间临时改写演示标题为文件名、完成后复位。返回页数与文件名契约。",
      inputSchema: {
        type: "object",
        properties: {
          filename: { type: "string", description: "可选下载文件名（缺省 pptx-export.pptx）" },
        },
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        const filename = resolveExportName(typeof input.filename === "string" ? input.filename : undefined);
        const res = await withPPTist(async (m) => {
          const { slides, export: exportApi } = m;
          const prevTitle = slides.title;
          slides.$patch({ title: exportTitleOf(filename) });
          try {
            await exportApi.exportPPTX(slides.slides, true, true);
            await waitSettled(exportApi.exporting, 30000);
          } finally {
            slides.$patch({ title: prevTitle });
          }
          return { filename, slideCount: slides.slides.length };
        });
        return res.ok ? { ok: true, ...(res.value as Record<string, unknown>) } : res;
      },
    },
    {
      name: "import_pptx",
      title: "导入 .pptx",
      description:
        "导入 .pptx 文件（base64 编码）为可编辑演示（PPTist useImport / pptxtojson 解析，cover 置换画布；复杂版式有损）。返回页数。",
      inputSchema: {
        type: "object",
        properties: {
          base64: { type: "string", description: ".pptx 文件内容的 base64 编码" },
          filename: { type: "string", description: "可选：来源文件名（仅用于状态展示）" },
        },
        required: ["base64"],
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        const b64 = String(input.base64 ?? "").replace(/\s+/g, "");
        let bytes: Uint8Array;
        try {
          const bin = atob(b64);
          bytes = new Uint8Array(Array.from(bin, (ch) => ch.charCodeAt(0)));
        } catch {
          return { ok: false, error: "base64 解码失败：请提供 .pptx 文件内容的 base64 编码" };
        }
        const res = await withPPTist(async (m) => {
          const { slides, import: importApi } = m;
          const before = slides.slides.length;
          const name = typeof input.filename === "string" && input.filename.trim() ? input.filename.trim() : "imported.pptx";
          const file = new File([bytes as unknown as BlobPart], name.toLowerCase().endsWith(".pptx") ? name : name + ".pptx");
          importApi.importPPTXFile([file], { cover: true });
          await waitSettled(importApi.exporting, 30000);
          // 等待 slides 真正落定（解析为异步链路；与页数变化或超时双保险）
          const deadline = Date.now() + 15000;
          for (;;) {
            if (slides.slides.length !== before || Date.now() > deadline) break;
            await new Promise((r) => setTimeout(r, 200));
          }
          if (!slides.slides.length) throw new Error("导入后画布为空——该 .pptx 可能无法被 pptxtojson 解析");
          return {
            slideCount: slides.slides.length,
            slideIndex: slides.slideIndex,
            slides: slides.slides.slice(0, 10).map((s) => slideSummary(s)),
          };
        });
        return res.ok ? { ok: true, ...(res.value as Record<string, unknown>) } : res;
      },
    },
    {
      name: "export_pdf",
      title: "导出 PDF",
      description:
        "把当前演示导出为矢量 PDF 下载（缺省 pptx-export.pdf；16:9 横向，每页幻灯一页；" +
        "真实文本层可搜索可复制；标题 32pt/要点 18pt/页眉带/右下页码）。" +
        '「导出哪些页」二选一（同传报错）：可选 items 页单元（每项 {page: 页码 1-based}，如 [{page:2},{page:3}]）；' +
        '或 pages 兼容别名（单数 2、数组 [2, 3] 或区间 "2-3"，1-based；越界人话报错）。' +
        "选择导出文件名 pptx-export-p2-3.pdf（自定义 filename 为主、tag 追加其上）。" +
        "编辑器未就绪时返回 ok:false。返回页数、文件名契约与 selected（实际导出的页码清单）。",
      inputSchema: {
        type: "object",
        properties: {
          filename: { type: "string", description: "可选下载文件名（缺省 pptx-export.pdf；有选择 tag 时追加其上）" },
          pages: {
            anyOf: [
              { type: "array", items: { type: "integer", minimum: 1 } },
              { type: "string", pattern: "^\\s*\\d+\\s*-\\s*\\d+\\s*$" },
            ],
            description: '可选页码选择（1-based，与 items 二选一）：单数 2、数组 [2, 3] 或区间 "2-3"；缺省全部页。选择导出时文件名带 -p2-3 标记',
          },
          items: {
            type: "array",
            description: '可选页导出单元（与 pages 二选一）：每项 {page: 页码（1-based）}，如 [{page:2},{page:3}]；顺序按 items',
            items: {
              type: "object",
              properties: { page: { type: "integer", minimum: 1, description: "页码（1-based，第 1 页=1）" } },
              required: ["page"],
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        return await exportSlidesPdf(
          typeof input.filename === "string" ? input.filename : undefined,
          isGiven(input.pages) ? (input.pages as unknown) : undefined,
          Array.isArray(input.items) ? input.items : undefined,
        );
      },
    },
    {
      name: "export_png",
      title: "导出逐页 PNG",
      description:
        "逐页多文件导出（每页一个 PNG）：把每页幻灯导出为独立 PNG 文件批量下载（缺省前缀 pptx-page，pptx-page-01.png 起两位序号＝原 deck 页码；" +
        "多文件间隔触发防浏览器拦截）。可选 filename 为文件名前缀语义（传 foo 产出 foo-01.png/foo-02.png）。" +
        '「导出哪些页」二选一（同传报错）：可选 items 页单元（每项 {page: 页码 1-based}）；或 pages 兼容别名（单数 2、数组 [2, 3] 或区间 "2-3"，1-based；越界人话报错）。' +
        "返回文件清单、页数与 selected（实际导出的页码清单）。",
      inputSchema: {
        type: "object",
        properties: {
          filename: { type: "string", description: '可选逐页文件名前缀（缺省 pptx-page；产出 <前缀>-01.png 起，序号＝原 deck 页码）' },
          pages: {
            anyOf: [
              { type: "array", items: { type: "integer", minimum: 1 } },
              { type: "string", pattern: "^\\s*\\d+\\s*-\\s*\\d+\\s*$" },
            ],
            description: '可选页码选择（1-based，与 items 二选一）：单数 2、数组 [2, 3] 或区间 "2-3"；缺省全部页。选择导出时文件名带 -p2-3 标记',
          },
          items: {
            type: "array",
            description: '可选页导出单元（与 pages 二选一）：每项 {page: 页码（1-based）}，如 [{page:2},{page:3}]；顺序按 items',
            items: {
              type: "object",
              properties: { page: { type: "integer", minimum: 1, description: "页码（1-based，第 1 页=1）" } },
              required: ["page"],
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        return await exportSlidesPng(
          typeof input.filename === "string" ? input.filename : undefined,
          isGiven(input.pages) ? (input.pages as unknown) : undefined,
          Array.isArray(input.items) ? input.items : undefined,
        );
      },
    },
    {
      name: "export_pages_png",
      title: "导出逐页 PNG（别名）",
      description:
        "export_png 的别名工具（F5 归一路径起点）：逐页多文件导出（每页一个 PNG），参数与行为同 export_png" +
        "（filename 前缀语义、items 页单元 / pages 兼容别名、文件序号＝原 deck 页码）。",
      inputSchema: {
        type: "object",
        properties: {
          filename: { type: "string", description: '可选逐页文件名前缀（缺省 pptx-page；产出 <前缀>-01.png 起，序号＝原 deck 页码）' },
          pages: {
            anyOf: [
              { type: "array", items: { type: "integer", minimum: 1 } },
              { type: "string", pattern: "^\\s*\\d+\\s*-\\s*\\d+\\s*$" },
            ],
            description: '可选页码选择（1-based，与 items 二选一）：单数 2、数组 [2, 3] 或区间 "2-3"；缺省全部页。选择导出时文件名带 -p2-3 标记',
          },
          items: {
            type: "array",
            description: '可选页导出单元（与 pages 二选一）：每项 {page: 页码（1-based）}，如 [{page:2},{page:3}]；顺序按 items',
            items: {
              type: "object",
              properties: { page: { type: "integer", minimum: 1, description: "页码（1-based，第 1 页=1）" } },
              required: ["page"],
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        return await exportSlidesPng(
          typeof input.filename === "string" ? input.filename : undefined,
          isGiven(input.pages) ? (input.pages as unknown) : undefined,
          Array.isArray(input.items) ? input.items : undefined,
        );
      },
    },
    {
      name: "export_long_png",
      title: "导出长图 PNG",
      description:
        "把幻灯纵向拼接为一张长图 PNG 下载（缺省 pptx-long.png；每页卡框＋间隔带＋「— i/n —」页码标注；" +
        "总高超 16384px 自动等比缩放，过小则截断并在产物与返回值标注）。" +
        '「导出哪些页」二选一（同传报错）：可选 items 页单元（每项 {page: 页码 1-based}）；或 pages 兼容别名（单数 2、数组 [2, 3] 或区间 "2-3"，1-based）。' +
        "选择导出文件名 pptx-long-p2-3.png（自定义 filename 为主、tag 追加其上）。" +
        "返回尺寸、文件名契约与 selected（实际导出的页码清单）。",
      inputSchema: {
        type: "object",
        properties: {
          filename: { type: "string", description: "可选下载文件名（缺省 pptx-long.png；有选择 tag 时追加其上）" },
          pages: {
            anyOf: [
              { type: "array", items: { type: "integer", minimum: 1 } },
              { type: "string", pattern: "^\\s*\\d+\\s*-\\s*\\d+\\s*$" },
            ],
            description: '可选页码选择（1-based，与 items 二选一）：单数 2、数组 [2, 3] 或区间 "2-3"；缺省全部页。选择导出时文件名带 -p2-3 标记',
          },
          items: {
            type: "array",
            description: '可选页导出单元（与 pages 二选一）：每项 {page: 页码（1-based）}，如 [{page:2},{page:3}]；顺序按 items',
            items: {
              type: "object",
              properties: { page: { type: "integer", minimum: 1, description: "页码（1-based，第 1 页=1）" } },
              required: ["page"],
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(input) {
        return await exportSlidesLongPng(
          typeof input.filename === "string" ? input.filename : undefined,
          isGiven(input.pages) ? (input.pages as unknown) : undefined,
          Array.isArray(input.items) ? input.items : undefined,
        );
      },
    },
  ];
}

/* ---------- 测试缝（绿门「编辑器状态核验」专用，非 WebMCP 工具面） ---------- */

interface OfficeTestHooks {
  /** 编辑器是否就绪 */
  isReady: () => boolean;
  /** 全 deck 摘要（页数/每页文本），供 WebMCP 写入后核验 store 状态 */
  deck: () => { total: number; slides: Array<Record<string, unknown>> };
  /** ？sample= 重置演示（确定性双页示例） */
  loadSample: () => void;
}

declare global {
  interface Window {
    __officeTest?: OfficeTestHooks;
  }
}

/** 确定性示例演示（?sample= 与绿门共用；青旅门店周会 3 页，真实业务内容） */
function sampleDeck(): PPTSlide[] {
  // 示例＝真实业务内容（青旅门店周会），不用工程术语/内部开发提示（P0-4）。
  // 每页 4-5 条要点，撑得起标题 32pt / 要点 18pt 的版式与版面利用率断言。
  const cover: PPTSlide = buildBlankSlide();
  cover.elements.push(buildTitleElement("青旅门店周会汇报"));
  cover.elements.push(
    buildBulletsElement(
      [
        "周期：2026 年第 43 周（10 月 19 日 — 10 月 25 日）",
        "门店：厦门曾厝垵店 · 前厅运营组",
        "汇报人：门店经理 林晓",
        "参会：前厅、客房、工程、餐饮四组",
      ],
      220,
    ),
  );
  const data: PPTSlide = buildBlankSlide();
  data.elements.push(buildTitleElement("本周经营数据"));
  data.elements.push(
    buildBulletsElement(
      [
        "入住间夜 412，同比增长 18%",
        "整体入住率 82%，环比提升 6 个百分点",
        "平均房价 268 元，会员价订单占比 46%",
        "餐饮收入 1.86 万元，早餐加购率 61%",
        "服务质量评分 4.8/5，零投诉结案",
      ],
      220,
    ),
  );
  const plan: PPTSlide = buildBlankSlide();
  plan.elements.push(buildTitleElement("下周行动计划"));
  plan.elements.push(
    buildBulletsElement(
      [
        "上线四人间加床方案，周末加床费 30 元",
        "推出淡季长住套餐：周租 520 元含双早",
        "与两家本地旅行社签署协议价，锁定周中房量",
        "完成前台夜班交接清单，减少漏单",
        "会员复购专项：长住客占比目标 26%",
      ],
      220,
    ),
  );
  return [cover, data, plan];
}

function attachTestHooks(): void {
  window.__officeTest = {
    isReady: () => !!getIsland(),
    deck: () => {
      const m = getIsland();
      if (!m) return { total: 0, slides: [] };
      return {
        total: m.slides.slides.length,
        slides: m.slides.slides.map((s, i) => ({ index: i, ...slideSummary(s) })),
      };
    },
    loadSample: () => {
      const m = getIsland();
      if (!m) return;
      // 等初始 deck 落定（App.vue onMounted 异步载 mock）再重置，避免被 mock 覆盖
      const deadline = Date.now() + 10000;
      const wait = () => new Promise((r) => setTimeout(r, 100));
      void (async () => {
        while (!m.slides.slides.length && Date.now() < deadline) await wait();
        // 文稿名同步置为示例主题（否则页眉带/PDF 元数据露出「未命名演示文稿」占位）
        m.slides.$patch({ title: "青旅门店周会汇报" });
        m.slides.setSlides(sampleDeck());
        m.slides.updateSlideIndex(0);
      })();
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
    if (r.failures.length) console.warn("[pptx-editor] WebMCP 注册失败项:", r.failures);
    return r;
  });
}

/** App 页面按钮复用（人机同路径）：导入 */
export async function importFromBytes(bytes: ArrayBuffer, name?: string): Promise<{ ok: boolean; error?: string; slideCount?: number }> {
  const u8 = new Uint8Array(bytes);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    bin += String.fromCharCode(...u8.subarray(i, i + CHUNK));
  }
  const tool = buildTools().find((t) => t.name === "import_pptx")!;
  const out = (await tool.execute({ base64: btoa(bin), filename: name }, { signal: new AbortController().signal })) as { ok: boolean; error?: string; slideCount?: number };
  return out;
}

/** App/?sample= 共用：重置示例演示 */
export function loadSampleDeck(): boolean {
  const hooks = window.__officeTest;
  if (!hooks?.isReady()) return false;
  hooks.loadSample();
  return true;
}
