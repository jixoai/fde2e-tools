/*
 * WebMCP 绿门断言 —— scripts/webmcp-check.mjs
 *
 * 验收（openspec change project-bootstrap / webmcp-tools + office-suite /
 * real-file-assertion 能力）：
 * 1. **原生路径**（headless Chromium + `--enable-blink-features=WebMCP`，
 *    Chrome 156 实测有原生 API）：黄页、三存量工具与办公三站（easy-*）与
 *    编辑器三站（xlsx/docx/pptx，office-editorial-upgrade）`getTools()` 能
 *    枚举到全部注册工具；executeTool 返回 DOMString（spec 形态）；export_pdf
 *    走到「导出成功」终态（B3 断言面）；三构建站 create_* 走 executeTool
 *    全链——真下载捕获 + 文件名契约 + ok 终态（真文件断言 ①）；编辑器三站
 *    走「写入（未就绪 ok:false 按人话重试）→ 导出真下载」全链。
 * 2. **polyfill 路径**（同浏览器、无 flag）：官方 polyfill 自动兜底，同形
 *    getTools/executeTool 可枚举可调用；**偏差实证**——polyfill 的 executeTool
 *    裸返回对象（不 JSON.stringify，vendor 不能改），消费侧必须过
 *    normalizeExecuteResult 归一（B2 断言面）。
 *
 * 运行前提：`pnpm -r build`（各 app dist 就绪）。
 * 用法：node scripts/webmcp-check.mjs
 */
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertPdfText } from "./pdf-assert.mjs";
import { chromium } from "playwright-core";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
/** 可选子集（WEBMCP_APPS=canvas 只跑该站枚举 + canvas 全链，便于迭代；缺省全量） */
const ONLY_APPS = new Set(
  (process.env.WEBMCP_APPS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

/** 各页面的预期工具面（与 packages/shared/src/registry.ts tools 字段一致） */
const EXPECT = {
  directory: { tools: ["list_tools", "search_tools"] },
  "pdf-tool": { tools: ["render_preview", "export_pdf"] },
  canvas: { tools: ["render_card", "inspect_layout", "export_svg", "export_canvas_png", "list_fonts", "list_recipes", "get_recipe", "list_assets", "get_asset", "import_asset", "list_styles", "font_info", "text_to_svg", "font_glyphs"] },
  "url-tool": { tools: ["pack_url", "decode_url"] },
  "file-viewer": { tools: ["preview_file"] },
  "easy-xlsx": { tools: ["create_xlsx", "add_sheet_sample"] },
  "easy-docx": { tools: ["create_docx", "append_docx_markdown"] },
  "easy-pptx": { tools: ["create_pptx", "add_slide"] },
  // ---------- 专业编辑器三站（office-editorial-upgrade） ----------
  // export-pdf-png 扩容：+export_pdf / export_png（pptx 再 +export_long_png；
  // interface-consistency 批：pptx +export_pages_png 别名工具）
  xlsx: { tools: ["set_cells", "set_formula", "format_range", "add_sheet", "import_xlsx", "export_xlsx", "get_snapshot", "export_pdf", "export_png"] },
  docx: { tools: ["set_content", "append_markdown", "insert_heading", "insert_table", "export_docx", "import_docx", "export_pdf", "export_png"] },
  pptx: { tools: ["add_slide", "set_title", "add_bullets", "export_pptx", "import_pptx", "export_pdf", "export_png", "export_pages_png", "export_long_png"] },
};

/**
 * 三构建站 executeTool 全链断言面（原生路径）：executeTool 必须触发真实下载
 * （捕获 download 事件）且返回 ok=true + 文件名契约。
 */
const FULL_CHAIN = [
  {
    app: "easy-xlsx",
    tool: "create_xlsx",
    input: { sheets: [{ name: "Gates", rows: [["K", "V"], ["engine", "SheetJS"], [42, 1.5]] }] },
    filename: "easy-xlsx-export.xlsx", // v2 F19：easy 线缺省名与专业站区分
  },
  {
    app: "easy-docx",
    tool: "create_docx",
    input: { markdown: "# Gate\n\n**bold** and *italic* probe" },
    filename: "easy-docx-export.docx", // v2 F19
  },
  {
    app: "easy-pptx",
    tool: "create_pptx",
    input: { slides: [{ title: "Gate", bullets: ["a", "b"] }] },
    filename: "easy-pptx-export.pptx", // v2 F19
  },
];

/**
 * 编辑器三站 executeTool 全链（office-editorial-upgrade）：写工具先落编辑器内核
 * （未就绪 ok:false → 按人话错误重试等待，不得误报链路失败），导出工具触发真
 * 下载 + 文件名契约 + ok 终态。
 */
/**
 * 非法入参矩阵（interface-consistency 制度化①）：每工具 2-3 个非法输入必须
 * resolve {ok:false, error 非空}（word 命中即人话证据）且 execute 不 reject
 * （F16 类断层：裸 throw 在绿门这里现形）。编辑器站的矩阵挂在
 * EDITOR_FULL_CHAIN[].illegal（编辑器就绪后执行——选择器互斥等校验在就绪门之后）。
 */
const ILLEGAL_MATRIX = [
  {
    app: "pdf-tool",
    // DOM 桥站（f14StopList）：ok:false 必须带 error 且 message＝error 同值（F14）
    f14: true,
    cases: [
      { tool: "render_preview", input: {}, word: "输入为空" },
      { tool: "render_preview", input: { content: "" }, word: "输入为空" },
    ],
  },
  {
    app: "canvas",
    f14: true,
    cases: [
      { tool: "render_card", input: {}, word: "spec" },
      { tool: "font_info", input: {}, word: "url" },
      { tool: "import_asset", input: {}, word: "url" },
      { tool: "export_svg", input: { inlinePaths: true }, word: "inlinePaths" },
    ],
  },
  {
    app: "url-tool",
    cases: [
      { tool: "pack_url", input: {}, word: "base" },
      { tool: "decode_url", input: { q: "!!!" }, word: "" },
    ],
  },
  {
    app: "file-viewer",
    f14: true,
    cases: [
      { tool: "preview_file", input: {}, word: "url 参数必填" },
    ],
  },
  {
    app: "easy-xlsx",
    f14: true,
    cases: [{ tool: "create_xlsx", input: {}, word: "sheets 结构错误" }],
  },
  {
    app: "easy-docx",
    f14: true,
    cases: [{ tool: "create_docx", input: {}, word: "输入为空" }],
  },
  {
    app: "easy-pptx",
    f14: true,
    cases: [{ tool: "create_pptx", input: {}, word: "slides 结构错误" }],
  },
  {
    app: "directory",
    // 空 query＝全量列表属合法语义，非法矩阵无例；只做正例（F15：ok:true 面）
    cases: [],
    // 正例：判定谓词只在 Node 侧求值（函数不进 waitForFunction 序列化）
    positive: [
      { tool: "list_tools", input: {}, check: "list_ok" },
      { tool: "search_tools", input: { query: "pdf" }, check: "search_ok" },
    ],
  },
];
const EDITOR_FULL_CHAIN = [
  {
    app: "xlsx",
    sampleQuery: "?sample=1",
    steps: [{ tool: "set_cells", input: { values: [["webmcp-check", 1.5]] } }],
    exportTool: "export_xlsx",
    filename: "xlsx-export.xlsx",
    // 非法入参矩阵（编辑器就绪后执行）：选择器互斥/缺关键字段/A1 非法——全部
    // 必须 resolve {ok:false,error}（execute 不 reject，F16 回归）
    illegal: [
      { tool: "set_cells", input: {}, word: "二维数组" },
      { tool: "set_formula", input: { range: "!!", formula: "=1" }, word: "非法单元格地址" },
      { tool: "format_range", input: { range: "##", styles: { bold: true } }, word: "非法单元格地址" },
      { tool: "export_pdf", input: { items: [{ sheet: "周营收" }], sheets: ["房源价格表"] }, word: "只能用一个" },
      { tool: "export_pdf", input: { items: [{ sheet: "周营收", range: "hello" }] }, word: "非法区域" },
      { tool: "export_pdf", input: { items: [{ sheet: "周营收", range: "Z50:AB60" }] }, word: "无交集" },
      // F11（v2 D 批）：start×startRow 同传互斥；非法 A1 人话报错
      { tool: "set_cells", input: { start: "A2", startRow: 1, values: [["x"]] }, word: "只能用一个" },
      { tool: "set_cells", input: { start: "!!", values: [["x"]] }, word: "非法单元格地址" },
    ],
    // export-pdf-png 扩容：展示级导出真下载断言（%PDF / PNG 头）
    extraExports: [
      {
        tool: "export_pdf",
        filename: "xlsx-export.pdf",
        header: "%PDF",
        keywords: ["青旅", "周营收"],
        forbidden: ["Start", "Formulas", "Arial"],
      },
      { tool: "export_png", filename: "xlsx-long.png", header: "png" },
    ],
    readyMs: 90000,
  },
  {
    app: "docx",
    sampleQuery: "?sample=1",
    steps: [{ tool: "set_content", input: { content: "# webmcp-check\n\n探针段落", format: "markdown" } }],
    exportTool: "export_docx",
    filename: "docx-export.docx",
    illegal: [
      { tool: "export_pdf", input: { items: [{ section: "一" }], section: "二" }, word: "只能用一个" },
      { tool: "export_pdf", input: { items: [{}] }, word: "缺 section" },
      { tool: "export_pdf", input: { items: [{ section: "不存在的节" }] }, word: "可用标题" },
    ],
    extraExports: [
      { tool: "export_pdf", filename: "docx-export.pdf", header: "%PDF", keywords: ["青旅", "房型表现"] },
      { tool: "export_png", filename: "docx-long.png", header: "png" },
    ],
    readyMs: 30000,
  },
  {
    app: "pptx",
    sampleQuery: "?sample=1",
    steps: [{ tool: "add_slide", input: { layout: "title", title: "webmcp-check 探针页" } }],
    exportTool: "export_pptx",
    filename: "pptx-export.pptx",
    illegal: [
      { tool: "export_pdf", input: { items: [{ page: 2 }], pages: [3] }, word: "只能用一个" },
      { tool: "export_pdf", input: { items: [{ page: 99 }] }, word: "越界" },
      { tool: "export_pages_png", input: { items: [{ page: 0 }] }, word: "越界" },
      // F12（v2 D 批）：page×slideIndex 同传互斥报错；page 越界人话报错
      { tool: "set_title", input: { page: 1, slideIndex: 0, text: "x" }, word: "只能用一个" },
      { tool: "set_title", input: { page: 99, text: "x" }, word: "越界" },
    ],
    extraExports: [
      { tool: "export_pdf", filename: "pptx-export.pdf", header: "%PDF", keywords: ["青旅门店周会汇报", "入住间夜"] },
      { tool: "export_png", filename: "pptx-page-01.png", header: "png" },
      { tool: "export_long_png", filename: "pptx-long.png", header: "png" },
    ],
    readyMs: 120000,
    // F12/F6（v2）：page=1 命中首页＋add_slide 增返 slideCount（编辑器就绪后执行）
    pageProbe: async (call) => {
      const t = await call("set_title", { page: 1, text: "__wc_first_page_probe__" });
      if (!t.ok) throw new Error(`set_title(page=1) 未成功: ${JSON.stringify(t)}`);
      if (t.page !== 1 || t.index !== 0 || t.slideIndex !== 0) {
        throw new Error(`F12 返回页码自证不符: ${JSON.stringify({ page: t.page, index: t.index, slideIndex: t.slideIndex })}`);
      }
      const s = await call("add_slide", { layout: "blank" });
      if (!s.ok) throw new Error(`add_slide 未成功: ${JSON.stringify(s)}`);
      if (typeof s.slideCount !== "number" || s.slideCount !== s.total) {
        throw new Error(`F6: slideCount 缺失或≠total: ${JSON.stringify(s)}`);
      }
      // 复原首页标题（探针不污染后续摘要断言）
      await call("set_title", { page: 1, text: "青旅门店周会汇报" });
      return true;
    },
  },
];

/** PNG 魔数（\x89PNG\r\n\x1a\n） */
const PNG_MAGIC = "\u0089PNG\r\n\x1a\n";

/** 编辑器写工具的就绪重试语义：ok:false 且错误为「未就绪/渲染中」→ 等待重试 */
const READY_RETRY = /就绪|渲染|加载|启动/;

/** 与 @fde2e-tools/shared/webmcp 的 normalizeExecuteResult 同义（脚本侧独立实现） */
const normalizeExecuteResult = (r) => (typeof r === "string" ? r : JSON.stringify(r));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

// ---------- 极简静态服务器（纯静态产物，无 SPA fallback 需求） ----------
function serveDir(dir) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
        const filePath = join(dir, urlPath === "/" ? "index.html" : urlPath);
        const body = await readFile(filePath);
        res.writeHead(200, {
          "content-type": MIME[extname(filePath)] ?? "application/octet-stream",
        });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end("not found");
      }
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function findChrome() {
  const candidates = [
    process.env.WEBMCP_CHECK_CHROME,
    join(
      process.env.HOME ?? "",
      "Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    ),
    join(
      process.env.HOME ?? "",
      "Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    ),
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p));
}

const results = [];
let failed = false;
function record(name, ok, extra = "") {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : " → " + extra}`);
  results.push({ name, ok, extra });
  if (!ok) failed = true;
}

/**
 * 等页面 modelContext 就绪并枚举全部预期工具（原生或 polyfill 同形 API）。
 * 两处实证修正（2026-10-31 编辑器站扩容）：
 * 1. 谓词恒返回真值状态对象（null 语义在部分 playwright 版本会被当 resolve 值）；
 * 2. **每站独立启动浏览器**——Chrome 原生 WebMCP 注册队列在同浏览器连续多页
 *    枚举后出现「后开页面 getTools() 永久缺工具」的实现怪癖（11 站序列复现：
 *    xlsx 2/7→重试后 4/7 不收敛；新浏览器即满员），与工具定义本身无关——
 *    枚举断言一律新开浏览器，全链断言靠 executeTool 就绪重试容忍抖动。
 * 谓词恒返回真值状态对象，由外层裁决是否齐套。 */
async function assertToolsEnumerated(app, expect, withFlag) {
  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: withFlag ? ["--enable-blink-features=WebMCP"] : [],
  });
  const server = await serveDir(join(ROOT, "apps", app, "dist"));
  const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "load" });
    /* 实证（2026-10-31 编辑器站扩容）：对注册中的页面高频 getTools() 轮询会干扰
     * Chrome 原生注册队列——250/500ms 轮询下后注册的工具永久丢失（xlsx 2/7、
     * docx 3/6 不收敛），慢轮询（≥2.5s）或「等页面就绪后低频单次枚举＋重试」
     * 稳定满员。此处取后者：先等 #status 编辑器/工具站自报就绪，再 3s 间隔
     * 最多 8 次单次枚举。 */
    await page
      .waitForFunction(() => {
        const el = document.getElementById("status");
        return el && el.textContent && el.textContent.length > 0 && !/正在|加载/.test(el.textContent);
      }, undefined, { timeout: 90000, polling: 500 })
      .catch(() => null);
    let state = { ready: false, names: [] };
    for (let attempt = 0; attempt < 8; attempt++) {
      await page.waitForTimeout(3000);
      state = await page.evaluate(async (expected) => {
        if (!document.modelContext) return { ready: false, names: [] };
        const ts = await document.modelContext.getTools();
        return { ready: ts.length >= expected.length, names: ts.map((t) => t.name) };
      }, expect.tools);
      if (state.ready) break;
    }
    if (!state.ready) {
      throw new Error(`90s+ 未枚举齐（modelContext=${state.names.length} 个工具: ${state.names.join(", ")}）`);
    }
    const missing = expect.tools.filter((t) => !state.names.includes(t));
    if (missing.length) throw new Error(`缺工具: ${missing.join(", ")}（实际: ${state.names.join(", ")}）`);
    return state.names;
  } finally {
    await page.close();
    server.close();
    await browser.close();
  }
}

/** canvas 全链（canvas-tool-v1）：render_card → inspect_layout → export_svg →
 *  export_canvas_png；同一页内连续执行，验证 WebMCP 工具状态机与 PNG 尺寸。 */
async function assertCanvasPath() {
  // 独立浏览器（Chrome 原生 WebMCP 在同浏览器多页后注册队列会缺工具——见
  // assertToolsEnumerated 头注；canvas 全链必须在干净浏览器里跑）。
  const canvasBrowser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ["--enable-blink-features=WebMCP"],
  });
  const server = await serveDir(join(ROOT, "apps", "canvas", "dist"));
  const page = await canvasBrowser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "load" });
    const out = await page
      .waitForFunction(
        () => document.modelContext
          ? document.modelContext.getTools().then((ts) => ts.some((t) => t.name === "render_card") && ts.some((t) => t.name === "get_asset"))
          : false,
        undefined,
        { timeout: 30000, polling: 500 },
      )
      .then(() => page.evaluate(async (spec) => {
        const ts = await document.modelContext.getTools();
        const call = async (name, input) => {
          const tool = ts.find((t) => t.name === name);
          if (!tool) throw new Error(`缺工具 ${name}`);
          const raw = await document.modelContext.executeTool(tool, input);
          return typeof raw === "string" ? JSON.parse(raw) : raw;
        };
        const render = await call("render_card", { spec });
        const inspect = await call("inspect_layout", {});
        const svg = await call("export_svg", {});
        const png = await call("export_canvas_png", { scale: 2, filename: "gate.png" });
        const font = await call("get_asset", { id: "font-noto-sans-sc" });
        let fontStatus = "missing";
        if (font.ok && font.asset?.fontUrl) {
          const face = new FontFace("GateNotoSubset", `url(${font.asset.fontUrl})`);
          await face.load();
          document.fonts.add(face);
          fontStatus = face.status;
        }
        return { render, inspect, svg, png, font, fontStatus };
      }, {
        width: 600,
        height: 400,
        background: "#0b1020",
        root: {
          type: "div",
          props: {
            id: "gate-root",
            style: {
              width: "100%", height: "100%", display: "flex", alignItems: "center",
              justifyContent: "center", backgroundColor: "#0b1020", color: "#ffffff",
              fontSize: 40,
            },
            children: "CANVAS GATE",
          },
        },
      }));
    if (out.render.ok !== true || out.render.width !== 600 || out.render.height !== 400) {
      throw new Error(`render_card 失败: ${JSON.stringify(out.render).slice(0, 200)}`);
    }
    if (out.inspect.ok !== true || !Array.isArray(out.inspect.nodes)) {
      throw new Error(`inspect_layout 失败: ${JSON.stringify(out.inspect).slice(0, 200)}`);
    }
    if (out.svg.ok !== true || !String(out.svg.svg).startsWith("<svg")) {
      throw new Error(`export_svg 失败: ${JSON.stringify(out.svg).slice(0, 160)}`);
    }
    if (out.png.ok !== true || out.png.width !== 1200 || out.png.height !== 800) {
      throw new Error(`export_canvas_png 失败: ${JSON.stringify(out.png).slice(0, 200)}`);
    }
    if (out.font.ok !== true || out.fontStatus !== "loaded") {
      throw new Error(`内置 WOFF2 字体加载失败: ${JSON.stringify({ font: out.font, status: out.fontStatus }).slice(0, 200)}`);
    }
    record(
      `[原生] canvas 全链：render_card(600×400) → inspect_layout(${out.inspect.nodes.length} 节点) → export_svg → export_canvas_png(1200×800) → 内置 WOFF2 字体 ${out.fontStatus}`,
      true,
    );
  } catch (e) {
    record("[原生] canvas 全链 render/inspect/export", false, e.message);
  } finally {
    await page.close();
    server.close();
    await canvasBrowser.close();
  }
}

async function assertNativePath(browser) {
  // 全部页面枚举（原生：黄页+存量工具+办公三站+编辑器三站；每站独立浏览器）
  const selected = Object.entries(EXPECT).filter(([app]) => ONLY_APPS.size === 0 || ONLY_APPS.has(app));
  for (const [app, expect] of selected) {
    try {
      const names = await assertToolsEnumerated(app, expect, true);
      record(`[原生] ${app}: getTools() → [${names.join(", ")}]`, true);
    } catch (e) {
      record(`[原生] ${app}: getTools()`, false, e.message);
    }
  }

  // canvas 全链（选中 canvas 或全量时都跑）
  if (ONLY_APPS.size === 0 || ONLY_APPS.has("canvas")) await assertCanvasPath();

  // 子集模式只跑选中站枚举 + canvas 全链（不跑其余站的 execute 深链）
  if (ONLY_APPS.size > 0) return;

  // executeTool 返回形态＝string（spec：Promise<DOMString>）
  try {
    const server = await serveDir(join(ROOT, "apps", "url-tool", "dist"));
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "load" });
    const out = await page
      .waitForFunction(
        () =>
          document.modelContext
            ? document.modelContext
                .getTools()
                .then(async (ts) => {
                  const tool = ts.find((t) => t.name === "pack_url");
                  if (!tool) return null;
                  const raw = await document.modelContext.executeTool(tool, {
                    base: "https://example.com/api",
                    mode: "packed",
                    params: { title: "你好", tag: "abc" },
                  });
                  return { rawType: typeof raw, parsed: JSON.parse(raw) };
                })
            : null,
        undefined,
        { timeout: 15000, polling: 250 },
      )
      .then((h) => h.jsonValue());
    const expected =
      "JTdCJTIydGl0bGUlMjIlM0ElMjIlRTQlQkQlQTAlRTUlQTUlQkQlMjIlMkMlMjJ0YWclMjIlM0ElMjJhYmMlMjIlN0Q";
    if (out.rawType !== "string") throw new Error(`原生 executeTool 应返回 string，实为 ${out.rawType}`);
    if (out.parsed.url.split("?q=")[1] !== expected) {
      throw new Error(`pack_url 产物与页面契约不一致: ${out.parsed.url}`);
    }
    record("[原生] url-tool executeTool(pack_url)：DOMString + packed 契约字节一致", true);
    await page.close();
    server.close();
  } catch (e) {
    record("[原生] url-tool executeTool(pack_url)", false, e.message);
  }

  // export_pdf 终态断言（B3）：executeTool 后状态行必须走到「导出成功」，
  // 不得停在「正在导出…」中间态谎报成功（会真触发一次下载，headless 无害）
  try {
    const server = await serveDir(join(ROOT, "apps", "pdf-tool", "dist"));
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/?autoload=sample`, {
      waitUntil: "load",
    });
    const out = await page
      .waitForFunction(
        () =>
          document.modelContext && document.modelContext.getTools().then(async (ts) => {
            const tool = ts.find((t) => t.name === "export_pdf");
            if (!tool) return null;
            const res = await document.modelContext.executeTool(tool, {});
            return JSON.parse(res);
          }),
        undefined,
        { timeout: 120000, polling: 500 },
      )
      .then((h) => h.jsonValue());
    if (!out.ok) throw new Error(`export_pdf 未成功: ${JSON.stringify(out)}`);
    if (!out.message.includes("导出成功")) {
      throw new Error(`export_pdf 未到终态（停在中间态？）: ${out.message}`);
    }
    if (out.filename !== "pdf-tool-export.pdf") {
      throw new Error(`filename 契约不符: ${out.filename}`);
    }
    record("[原生] pdf-tool executeTool(export_pdf)：终态「导出成功」+ 文件名契约", true);
    await page.close();
    server.close();
  } catch (e) {
    record("[原生] pdf-tool executeTool(export_pdf) 终态", false, e.message);
  }

  // 非法入参矩阵（interface-consistency 制度化①）：每工具非法输入必须
  // resolve {ok:false, error 非空}（word 命中）且 execute 不 reject；
  // positive 正例断言（F15：directory 查询工具 ok:true）
  const POSITIVE_PREDICATES = {
    list_ok: (r) => r.ok === true && r.count >= 10,
    search_ok: (r) => r.ok === true && r.count >= 1,
  };
  for (const matrix of ILLEGAL_MATRIX) {
    let matrixBrowser = browser;
    try {
      // canvas 用干净浏览器（原生 WebMCP 多页后注册队列会缺工具）
      if (matrix.app === "canvas") {
        matrixBrowser = await chromium.launch({
          executablePath: findChrome(),
          headless: true,
          args: ["--enable-blink-features=WebMCP"],
        });
      }
      const server = await serveDir(join(ROOT, "apps", matrix.app, "dist"));
      const page = await matrixBrowser.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "load" });
      const plain = {
        cases: (matrix.cases ?? []).map((c) => ({ tool: c.tool, input: c.input, word: c.word })),
        positive: (matrix.positive ?? []).map((c) => ({ tool: c.tool, input: c.input })),
      };
      const out = await page
        .waitForFunction(
          async ([matrix]) => {
            if (!document.modelContext) return null;
            const ts = await document.modelContext.getTools();
            const run = async (toolName, input) => {
              const tool = ts.find((t) => t.name === toolName);
              if (!tool) return { ok: false, error: "工具未注册: " + toolName };
              try {
                const raw = await document.modelContext.executeTool(tool, input);
                return typeof raw === "string" ? JSON.parse(raw) : raw;
              } catch (e) {
                return { ok: false, error: "execute reject（违反不 reject 契约）: " + (e?.message ?? e) };
              }
            };
            const results = [];
            for (const c of matrix.cases ?? []) results.push({ kind: "illegal", tool: c.tool, r: await run(c.tool, c.input), word: c.word });
            for (const c of matrix.positive ?? []) results.push({ kind: "positive", tool: c.tool, r: await run(c.tool, c.input) });
            return results;
          },
          [plain],
          { timeout: 20000, polling: 500 },
        )
        .then((h) => h.jsonValue());
      if (!Array.isArray(out)) throw new Error("矩阵未执行（modelContext 未就绪？）");
      for (const item of out) {
        if (item.kind === "positive") {
          const c = matrix.positive.find((x) => x.tool === item.tool);
          const pred = POSITIVE_PREDICATES[c.check];
          if (!pred || !pred(item.r)) throw new Error(`正例断言失败（${item.tool}）: ${JSON.stringify(item.r).slice(0, 120)}`);
          continue;
        }
        if (item.r.ok !== false) throw new Error(`非法入参未被拒绝（${item.tool}）: ${JSON.stringify(item.r).slice(0, 120)}`);
        if (!String(item.r.error ?? "")) throw new Error(`非法入参拒绝缺 error（${item.tool}）`);
        // F14（v1.2）：DOM 桥站 ok:false 必带 message＝error 同值（人话/机器双字段同源）
        if (matrix.f14 && item.kind === "illegal" && item.r.message !== item.r.error) {
          throw new Error(`F14：message≠error 或缺 message（${item.tool}）: ${JSON.stringify(item.r).slice(0, 120)}`);
        }
        if (item.word && !String(item.r.error).includes(item.word)) {
          throw new Error(`非法入参报错未命中「${item.word}」（${item.tool}）: ${String(item.r.error).slice(0, 120)}`);
        }
      }
      record(
        `[原生] ${matrix.app} 非法入参矩阵 ${(matrix.cases ?? []).length} 项${matrix.positive ? `＋正例 ${matrix.positive.length} 项` : ""}：ok:false 全带 error 不 reject`,
        true,
      );
      await page.close();
      server.close();
    } catch (e) {
      record(`[原生] ${matrix.app} 非法入参矩阵`, false, e.message);
    } finally {
      if (matrixBrowser !== browser) await matrixBrowser.close().catch(() => {});
    }
  }

  // 三构建站 executeTool 全链（真文件断言 ①）：executeTool 必须触发真实下载
  // （捕获 download 事件 + 文件名契约），返回 ok=true —— 不是只看状态行
  for (const chain of FULL_CHAIN) {
    try {
      const server = await serveDir(join(ROOT, "apps", chain.app, "dist"));
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "load" });
      const dlPromise = page.waitForEvent("download", { timeout: 30000 }).catch(() => null);
      const out = await page
        .waitForFunction(
          ([toolName, input]) =>
            document.modelContext
              ? document.modelContext.getTools().then(async (ts) => {
                  const tool = ts.find((t) => t.name === toolName);
                  if (!tool) return null;
                  const raw = await document.modelContext.executeTool(tool, input);
                  return JSON.parse(raw);
                })
              : null,
          [chain.tool, chain.input],
          { timeout: 60000, polling: 500 },
        )
        .then((h) => h.jsonValue());
      const download = await dlPromise;
      const suggested = download ? download.suggestedFilename() : null;
      await page.close();
      server.close();
      if (!out.ok) throw new Error(`executeTool 未成功: ${JSON.stringify(out)}`);
      if (!download) throw new Error("未捕获到 download 事件（30s）");
      if (suggested !== chain.filename) {
        throw new Error(`下载文件名契约不符: got ${suggested}, want ${chain.filename}`);
      }
      record(
        `[原生] ${chain.app} executeTool(${chain.tool}) 全链：真下载 ${suggested} + ok 终态`,
        true,
      );
    } catch (e) {
      record(`[原生] ${chain.app} executeTool(${chain.tool}) 全链`, false, e.message);
    }
  }

  // 编辑器三站 executeTool 全链（office-editorial-upgrade）：写入（就绪重试）
  // → 导出真下载 + 文件名契约 + ok 终态。写工具 ok:false 且错误为「未就绪/
  // 渲染中/加载中」= 门禁显式拒绝（预期语义），等待重试而非误报链路失败。
  for (const chain of EDITOR_FULL_CHAIN) {
    try {
      const server = await serveDir(join(ROOT, "apps", chain.app, "dist"));
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "load" });
      const dlPromise = page.waitForEvent("download", { timeout: chain.readyMs }).catch(() => null);
      const stepResults = [];
      for (const step of chain.steps) {
        const stepOut = await page
          .waitForFunction(
            ([toolName, input, maxMs, retryable]) =>
              document.modelContext
                ? document.modelContext.getTools().then(async (ts) => {
                    const tool = ts.find((t) => t.name === toolName);
                    if (!tool) return null;
                    const deadline = Date.now() + maxMs;
                    for (;;) {
                      const raw = await document.modelContext.executeTool(tool, input);
                      const parsed = JSON.parse(raw);
                      if (parsed.ok) return parsed;
                      if (Date.now() > deadline || !new RegExp(retryable).test(String(parsed.error ?? ""))) return parsed;
                      await new Promise((r) => setTimeout(r, 1000));
                    }
                  })
                : null,
            [step.tool, step.input, chain.readyMs, READY_RETRY.source],
            { timeout: chain.readyMs + 30000, polling: 1000 },
          )
          .then((h) => h.jsonValue());
        stepResults.push({ tool: step.tool, out: stepOut });
        if (!stepOut.ok) throw new Error(`写入工具 ${step.tool} 未成功: ${JSON.stringify(stepOut)}`);
      }
      const exportOutPromise = page
        .waitForFunction(
          ([toolName, maxMs, retryable]) =>
            document.modelContext
              ? document.modelContext.getTools().then(async (ts) => {
                  const tool = ts.find((t) => t.name === toolName);
                  if (!tool) return null;
                  const deadline = Date.now() + maxMs;
                  for (;;) {
                    const raw = await document.modelContext.executeTool(tool, {});
                    const parsed = JSON.parse(raw);
                    if (parsed.ok) return parsed;
                    if (Date.now() > deadline || !new RegExp(retryable).test(String(parsed.error ?? ""))) return parsed;
                    await new Promise((r) => setTimeout(r, 1000));
                  }
                })
              : null,
          [chain.exportTool, chain.readyMs, READY_RETRY.source],
          { timeout: chain.readyMs + 30000, polling: 1000 },
        )
        .then((h) => h.jsonValue())
        .catch((e) => ({ ok: false, error: "导出轮询失败: " + e.message.slice(0, 80) }));
      const [exportOut, downloadRaw] = await Promise.all([exportOutPromise, dlPromise]);
      const suggested = downloadRaw ? downloadRaw.suggestedFilename() : null;
      // 非法入参矩阵（就绪页同款，页面关闭前执行）：全部 resolve {ok:false,error} 且 word 命中
      for (const bad of chain.illegal ?? []) {
        const out = await page
          .evaluate(
            async ([toolName, input]) => {
              const ts = await document.modelContext.getTools();
              const tool = ts.find((t) => t.name === toolName);
              if (!tool) return { ok: false, error: "工具未注册: " + toolName };
              try {
                const raw = await document.modelContext.executeTool(tool, input);
                const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
                return parsed;
              } catch (e) {
                return { ok: false, error: "execute reject（违反不 reject 契约）: " + (e?.message ?? e) };
              }
            },
            [bad.tool, bad.input],
          );
        if (out.ok !== false) throw new Error(`非法入参未被拒绝（${bad.tool} ${JSON.stringify(bad.input)}）: ${JSON.stringify(out).slice(0, 120)}`);
        if (!String(out.error ?? "")) throw new Error(`非法入参拒绝缺 error（${bad.tool}）`);
        if (bad.word && !String(out.error).includes(bad.word)) {
          throw new Error(`非法入参报错未命中「${bad.word}」（${bad.tool}）: ${String(out.error).slice(0, 120)}`);
        }
      }
      // v2 扩展探针（chain.pageProbe）：page=1 命中首页 / add_slide slideCount 等
      // 编辑器就绪语义断言（函数进 evaluate 字符串源——与 editorCall 同款形态）
      if (chain.pageProbe) {
        await page.evaluate(async (src) => {
          const call = async (name, input) => {
            const ts = await document.modelContext.getTools();
            const tool = ts.find((t) => t.name === name);
            if (!tool) throw new Error("工具未注册: " + name);
            const raw = await document.modelContext.executeTool(tool, input);
            return typeof raw === "string" ? JSON.parse(raw) : raw;
          };
          const fn = eval("(" + src + ")");
          await fn(call);
        }, chain.pageProbe.toString());
      }
      await page.close();
      server.close();
      if (!exportOut.ok) throw new Error(`导出工具 ${chain.exportTool} 未成功: ${JSON.stringify(exportOut)}`);
      if (suggested !== chain.filename) {
        throw new Error(`下载文件名契约不符: got ${suggested}, want ${chain.filename}`);
      }
      record(
        `[原生] ${chain.app} 编辑器全链：${chain.steps.map((s) => s.tool).join("+")} + ${chain.exportTool} 真下载 ${suggested} + ok 终态`,
        true,
      );
    } catch (e) {
      record(`[原生] ${chain.app} 编辑器全链`, false, e.message);
    }

    // export-pdf-png 扩容：展示级导出逐个真下载断言（%PDF / PNG 头＋文件名契约
    // ＋ok 终态）。每站新开页面（编辑器就绪重试语义与主链同款）。
    for (const extra of chain.extraExports ?? []) {
      try {
        const server = await serveDir(join(ROOT, "apps", chain.app, "dist"));
        const page = await browser.newPage();
        // 展示级导出面在 ?sample=1（真实业务示例）上断言——与主链（探针内容）分离
        await page.goto(`http://127.0.0.1:${server.address().port}/${chain.sampleQuery ?? ""}`, { waitUntil: "load" });
        const dlPromise = page.waitForEvent("download", { timeout: chain.readyMs }).catch(() => null);
        // 先等编辑器自报就绪再低频枚举（Chrome 原生注册队列对高频 getTools 轮询
        // 敏感的怪癖与本文件头部注记同源——waitForFunction 高频轮询会令后注册
        // 的导出工具永久丢失，实证 export_pdf 2/9 不收敛）
        await page
          .waitForFunction(
            () => {
              const el = document.getElementById("status");
              return el && el.textContent && el.textContent.length > 0 && !/正在|加载/.test(el.textContent);
            },
            undefined,
            { timeout: chain.readyMs, polling: 500 },
          )
          .catch(() => null);
        await page.waitForTimeout(3000);
        const out = await page
          .evaluate(
            async ([toolName, maxMs, retryable]) => {
              if (!document.modelContext) return { ok: false, error: "modelContext 不存在（页面环境异常）" };
              let tool = null;
              for (let i = 0; i < 8 && !tool; i++) {
                const ts = await document.modelContext.getTools();
                tool = ts.find((t) => t.name === toolName) ?? null;
                if (!tool) await new Promise((r) => setTimeout(r, 3000));
              }
              if (!tool) return { ok: false, error: `工具未注册: ${toolName}` };
              const deadline = Date.now() + maxMs;
              for (;;) {
                const raw = await document.modelContext.executeTool(tool, {});
                const parsed = JSON.parse(raw);
                if (parsed.ok) return parsed;
                if (Date.now() > deadline || !new RegExp(retryable).test(String(parsed.error ?? ""))) return parsed;
                await new Promise((r) => setTimeout(r, 1000));
              }
            },
            [extra.tool, chain.readyMs, READY_RETRY.source],
          )
          .catch((e) => ({ ok: false, error: "导出轮询失败: " + e.message.slice(0, 80) }));
        const download = await dlPromise;
        const suggested = download ? download.suggestedFilename() : null;
        let headOk = false;
        if (download) {
          const dlPath = await download.path();
          if (dlPath) {
            const full = await readFile(dlPath);
            const head = full.subarray(0, 8).toString("latin1");
            headOk = extra.header === "png" ? head.startsWith(PNG_MAGIC) : head.startsWith(extra.header);
            // v2 硬门：矢量 PDF 文本层（非空＋中文＋关键词＋无 UI 特征词）
            if (extra.header === "%PDF") {
              assertPdfText(full, `${chain.app} ${extra.tool}`, {
                requireChinese: true,
                keywords: extra.keywords ?? [],
                forbidden: extra.forbidden ?? [],
              });
            }
          }
        }
        await page.close();
        server.close();
        if (!out.ok) throw new Error(`${extra.tool} 未成功: ${JSON.stringify(out)}`);
        if (!download) throw new Error(`未捕获到 download 事件`);
        if (suggested !== extra.filename) throw new Error(`下载文件名契约不符: got ${suggested}, want ${extra.filename}`);
        if (!headOk) throw new Error(`产物头不符（期望 ${extra.header === "png" ? "PNG 魔数" : extra.header}）`);
        record(`[原生] ${chain.app} ${extra.tool} 展示级导出：真下载 ${suggested} + 产物头 OK${extra.header === "%PDF" ? " + 文本层 OK" : ""}`, true);
      } catch (e) {
        record(`[原生] ${chain.app} ${extra.tool} 展示级导出`, false, e.message);
      }
    }
  }
}

async function assertPolyfillPath(browser) {
  // 全部页面枚举（polyfill 兜底，无 flag；每站独立浏览器——同原生路径）
  for (const [app, expect] of Object.entries(EXPECT)) {
    try {
      const names = await assertToolsEnumerated(app, expect, false);
      record(`[polyfill] ${app}: getTools() → [${names.join(", ")}]`, true);
    } catch (e) {
      record(`[polyfill] ${app}: getTools()`, false, e.message);
    }
  }

  // B2 偏差实证 + 归一断言：polyfill executeTool 裸返回对象；消费侧过
  // normalizeExecuteResult 后 JSON.parse 与原生同形
  try {
    const server = await serveDir(join(ROOT, "apps", "url-tool", "dist"));
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "load" });
    const out = await page
      .waitForFunction(
        () =>
          document.modelContext
            ? document.modelContext
                .getTools()
                .then(async (ts) => {
                  const tool = ts.find((t) => t.name === "pack_url");
                  if (!tool) return null;
                  const raw = await document.modelContext.executeTool(tool, {
                    base: "https://example.com/api",
                    mode: "packed",
                    params: { title: "你好", tag: "abc" },
                  });
                  return { isPolyfill: !!window.__webmcp_registered_tools, raw, rawType: typeof raw };
                })
            : null,
        undefined,
        { timeout: 15000, polling: 250 },
      )
      .then((h) => h.jsonValue());
    if (!out.isPolyfill) throw new Error("页面未走 polyfill（__webmcp_registered_tools 缺失）");
    if (out.rawType !== "object") {
      throw new Error(`polyfill 偏差形态变化：executeTool 返回 ${out.rawType}（预期 object 实证）`);
    }
    const parsed = JSON.parse(normalizeExecuteResult(out.raw));
    const expected =
      "JTdCJTIydGl0bGUlMjIlM0ElMjIlRTQlQkQlQTAlRTUlQTUlQkQlMjIlMkMlMjJ0YWclMjIlM0ElMjJhYmMlMjIlN0Q";
    if (parsed.url.split("?q=")[1] !== expected) {
      throw new Error(`归一后 pack_url 产物与契约不一致: ${parsed.url}`);
    }
    record(
      "[polyfill] url-tool executeTool(pack_url)：裸 object 偏差实证 + normalizeExecuteResult 归一契约一致",
      true,
    );
    await page.close();
    server.close();
  } catch (e) {
    record("[polyfill] url-tool executeTool(pack_url) 归一", false, e.message);
  }
}

async function main() {
  const executablePath = findChrome();
  if (!executablePath) {
    console.error("✗ 找不到本机 Chromium（playwright 缓存）——设 WEBMCP_CHECK_CHROME 指定路径");
    process.exit(1);
  }
  console.log("browser:", executablePath);

  const withFlag = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--enable-blink-features=WebMCP"],
  });
  try {
    await assertNativePath(withFlag);
  } finally {
    await withFlag.close();
  }

  const noFlag = ONLY_APPS.size > 0 ? null : await chromium.launch({ executablePath, headless: true });
  if (noFlag !== null) {
    try {
      await assertPolyfillPath(noFlag);
    } finally {
      await noFlag.close();
    }
  }

  console.log("\n=== webmcp-check 结果 ===");
  for (const r of results) {
    console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.ok ? "" : " → " + r.extra}`);
  }
  if (failed) process.exit(1);
  console.log("全绿：原生/polyfill 双路径枚举齐 + 契约往返 + export_pdf 终态 + easy-* 三站 executeTool 真下载全链 + 编辑器三站写入/导出全链 + 非法入参矩阵（ok:false 全带 error 不 reject）");
}

main();
