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
import { chromium } from "playwright-core";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** 各页面的预期工具面（与 packages/shared/src/registry.ts tools 字段一致） */
const EXPECT = {
  directory: { tools: ["list_tools", "search_tools"] },
  "pdf-tool": { tools: ["render_preview", "export_pdf"] },
  "img-tool": { tools: ["overlay_text", "export_png"] },
  "url-tool": { tools: ["pack_url", "decode_url"] },
  "file-viewer": { tools: ["preview_file"] },
  "easy-xlsx": { tools: ["create_xlsx", "add_sheet_sample"] },
  "easy-docx": { tools: ["create_docx", "append_docx_markdown"] },
  "easy-pptx": { tools: ["create_pptx", "add_slide"] },
  // ---------- 专业编辑器三站（office-editorial-upgrade） ----------
  // export-pdf-png 扩容：+export_pdf / export_png（pptx 再 +export_long_png）
  xlsx: { tools: ["set_cells", "set_formula", "format_range", "add_sheet", "import_xlsx", "export_xlsx", "get_snapshot", "export_pdf", "export_png"] },
  docx: { tools: ["set_content", "append_markdown", "insert_heading", "insert_table", "export_docx", "import_docx", "export_pdf", "export_png"] },
  pptx: { tools: ["add_slide", "set_title", "add_bullets", "export_pptx", "import_pptx", "export_pdf", "export_png", "export_long_png"] },
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
    filename: "xlsx-export.xlsx",
  },
  {
    app: "easy-docx",
    tool: "create_docx",
    input: { markdown: "# Gate\n\n**bold** and *italic* probe" },
    filename: "docx-export.docx",
  },
  {
    app: "easy-pptx",
    tool: "create_pptx",
    input: { slides: [{ title: "Gate", bullets: ["a", "b"] }] },
    filename: "pptx-export.pptx",
  },
];

/**
 * 编辑器三站 executeTool 全链（office-editorial-upgrade）：写工具先落编辑器内核
 * （未就绪 ok:false → 按人话错误重试等待，不得误报链路失败），导出工具触发真
 * 下载 + 文件名契约 + ok 终态。
 */
const EDITOR_FULL_CHAIN = [
  {
    app: "xlsx",
    steps: [{ tool: "set_cells", input: { values: [["webmcp-check", 1.5]] } }],
    exportTool: "export_xlsx",
    filename: "xlsx-export.xlsx",
    // export-pdf-png 扩容：展示级导出真下载断言（%PDF / PNG 头）
    extraExports: [
      { tool: "export_pdf", filename: "xlsx-export.pdf", header: "%PDF" },
      { tool: "export_png", filename: "xlsx-long.png", header: "png" },
    ],
    readyMs: 90000,
  },
  {
    app: "docx",
    steps: [{ tool: "set_content", input: { content: "# webmcp-check\n\n探针段落", format: "markdown" } }],
    exportTool: "export_docx",
    filename: "docx-export.docx",
    extraExports: [
      { tool: "export_pdf", filename: "docx-export.pdf", header: "%PDF" },
      { tool: "export_png", filename: "docx-long.png", header: "png" },
    ],
    readyMs: 30000,
  },
  {
    app: "pptx",
    steps: [{ tool: "add_slide", input: { layout: "title", title: "webmcp-check 探针页" } }],
    exportTool: "export_pptx",
    filename: "pptx-export.pptx",
    extraExports: [
      { tool: "export_pdf", filename: "pptx-export.pdf", header: "%PDF" },
      { tool: "export_png", filename: "pptx-page-01.png", header: "png" },
      { tool: "export_long_png", filename: "pptx-long.png", header: "png" },
    ],
    readyMs: 120000,
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

async function assertNativePath(browser) {
  // 全部页面枚举（原生：黄页+三存量工具+办公三站+编辑器三站；每站独立浏览器）
  for (const [app, expect] of Object.entries(EXPECT)) {
    try {
      const names = await assertToolsEnumerated(app, expect, true);
      record(`[原生] ${app}: getTools() → [${names.join(", ")}]`, true);
    } catch (e) {
      record(`[原生] ${app}: getTools()`, false, e.message);
    }
  }

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
        await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "load" });
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
            const bytes = (await readFile(dlPath)).subarray(0, 8);
            const head = bytes.toString("latin1");
            headOk = extra.header === "png" ? head.startsWith(PNG_MAGIC) : head.startsWith(extra.header);
          }
        }
        await page.close();
        server.close();
        if (!out.ok) throw new Error(`${extra.tool} 未成功: ${JSON.stringify(out)}`);
        if (!download) throw new Error(`未捕获到 download 事件`);
        if (suggested !== extra.filename) throw new Error(`下载文件名契约不符: got ${suggested}, want ${extra.filename}`);
        if (!headOk) throw new Error(`产物头不符（期望 ${extra.header === "png" ? "PNG 魔数" : extra.header}）`);
        record(`[原生] ${chain.app} ${extra.tool} 展示级导出：真下载 ${suggested} + 产物头 OK`, true);
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

  const noFlag = await chromium.launch({ executablePath, headless: true });
  try {
    await assertPolyfillPath(noFlag);
  } finally {
    await noFlag.close();
  }

  console.log("\n=== webmcp-check 结果 ===");
  for (const r of results) {
    console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.ok ? "" : " → " + r.extra}`);
  }
  if (failed) process.exit(1);
  console.log("全绿：原生/polyfill 双路径枚举齐 + 契约往返 + export_pdf 终态 + easy-* 三站 executeTool 真下载全链 + 编辑器三站写入/导出全链");
}

main();
