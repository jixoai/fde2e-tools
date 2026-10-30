/*
 * WebMCP 绿门断言 —— scripts/webmcp-check.mjs
 *
 * 验收（openspec change project-bootstrap / webmcp-tools 能力）：
 * 1. **原生路径**（headless Chromium + `--enable-blink-features=WebMCP`，
 *    Chrome 156 实测有原生 API）：黄页与三个工具页 `getTools()` 能枚举到全部
 *    注册工具；executeTool 返回 DOMString（spec 形态）；export_pdf 走到
 *    「导出成功」终态（B3 断言面）。
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
};

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

/** 等页面 modelContext 就绪并枚举全部预期工具（原生或 polyfill 同形 API） */
async function assertToolsEnumerated(browser, app, expect) {
  const server = await serveDir(join(ROOT, "apps", app, "dist"));
  const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "load" });
    const names = await page
      .waitForFunction(
        (expected) =>
          document.modelContext
            ? document.modelContext
                .getTools()
                .then((ts) => (ts.length >= expected.length ? ts.map((t) => t.name) : null))
            : null,
        expect.tools,
        { timeout: 15000, polling: 250 },
      )
      .then((h) => h.jsonValue());
    const missing = expect.tools.filter((t) => !names.includes(t));
    if (missing.length) throw new Error(`缺工具: ${missing.join(", ")}（实际: ${names.join(", ")}）`);
    return names;
  } finally {
    await page.close();
    server.close();
  }
}

async function assertNativePath(browser) {
  // 四页面枚举（原生）
  for (const [app, expect] of Object.entries(EXPECT)) {
    try {
      const names = await assertToolsEnumerated(browser, app, expect);
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
}

async function assertPolyfillPath(browser) {
  // 四页面枚举（polyfill 兜底，无 flag）
  for (const [app, expect] of Object.entries(EXPECT)) {
    try {
      const names = await assertToolsEnumerated(browser, app, expect);
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
  console.log("全绿：原生/ polyfill 双路径枚举齐 + 契约往返 + export_pdf 终态");
}

main();
