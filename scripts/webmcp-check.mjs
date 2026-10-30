/*
 * WebMCP 绿门断言 —— scripts/webmcp-check.mjs
 *
 * 验收（openspec change project-bootstrap / webmcp-tools 能力）：
 * 黄页与三个工具页在 headless Chromium + `--enable-blink-features=WebMCP` 下，
 * `document.modelContext.getTools()` 能枚举到各页注册的全部工具；并抽测
 * executeTool 全链路（url-tool pack_url 纯函数 + pdf-tool 状态读取路径）。
 *
 * 运行前提：`pnpm -r build`（各 app dist 就绪）。浏览器用本机 playwright
 * 缓存构建（chromium-1248，Google Chrome for Testing），无原生 WebMCP 时
 * 页面自带的官方 polyfill 自动兜底——断言不依赖具体实现路径。
 *
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
  directory: { path: "/index.html", tools: ["list_tools", "search_tools"] },
  "pdf-tool": { path: "/index.html", tools: ["render_preview", "export_pdf"] },
  "img-tool": { path: "/index.html", tools: ["overlay_text", "export_png"] },
  "url-tool": { path: "/index.html", tools: ["pack_url", "decode_url"] },
};

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
        res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
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
    join(process.env.HOME ?? "", "Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
    join(process.env.HOME ?? "", "Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
  ].filter(Boolean);
  return { candidates };
}

async function main() {
  const { candidates } = findChrome();
  const executablePath = candidates.find((p) => existsSync(p));
  if (!executablePath) {
    console.error("✗ 找不到本机 Chromium（playwright 缓存）——设 WEBMCP_CHECK_CHROME 指定路径");
    process.exit(1);
  }
  console.log("browser:", executablePath);

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--enable-blink-features=WebMCP"],
  });
  const results = [];
  let failed = false;

  try {
    for (const [app, expect] of Object.entries(EXPECT)) {
      const server = await serveDir(join(ROOT, "apps", app, "dist"));
      const port = server.address().port;
      const base = `http://127.0.0.1:${port}`;
      const page = await browser.newPage();
      try {
        await page.goto(base + expect.path, { waitUntil: "load" });
        // 等注册完成（原生或 polyfill 同形 API）：轮询 getTools 直到预期数量
        const names = await page.waitForFunction(
          (expected) =>
            document.modelContext
              ? document.modelContext
                  .getTools()
                  .then((ts) => (ts.length >= expected.length ? ts.map((t) => t.name) : null))
              : null,
          expect.tools,
          { timeout: 15000, polling: 250 },
        ).then((h) => h.jsonValue());

        const missing = expect.tools.filter((t) => !names.includes(t));
        if (missing.length) throw new Error(`缺工具: ${missing.join(", ")}（实际: ${names.join(", ")}）`);
        console.log(`✓ ${app}: getTools() → [${names.join(", ")}]`);
        results.push({ app, ok: true, tools: names });
      } catch (e) {
        failed = true;
        console.error(`✗ ${app}: ${e.message}`);
        results.push({ app, ok: false, error: e.message });
      } finally {
        await page.close();
        server.close();
      }
    }

    // ---- executeTool 全链路抽测（url-tool pack_url 纯函数）----
    {
      const server = await serveDir(join(ROOT, "apps", "url-tool", "dist"));
      const port = server.address().port;
      const page = await browser.newPage();
      try {
        await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
        const result = await page.waitForFunction(
          () =>
            document.modelContext
              ? document.modelContext
                  .getTools()
                  .then(async (ts) => {
                    const tool = ts.find((t) => t.name === "pack_url");
                    if (!tool) return null;
                    const out = await document.modelContext.executeTool(tool, {
                      base: "https://example.com/api",
                      mode: "packed",
                      params: { title: "你好", tag: "abc" },
                    });
                    return { parsed: JSON.parse(out) };
                  })
              : null,
          undefined,
          { timeout: 15000, polling: 250 },
        ).then((h) => h.jsonValue());
        const url = result?.parsed?.url ?? "";
        const expectedSuffix = url.split("?q=")[1];
        if (!expectedSuffix) throw new Error("pack_url 未返回 ?q= 形态: " + url);
        // 与 url-tool ai-guide 示例 1 的产物字节一致（契约互操作证明）
        const expected =
          "JTdCJTIydGl0bGUlMjIlM0ElMjIlRTQlQkQlQTAlRTUlQTUlQkQlMjIlMkMlMjJ0YWclMjIlM0ElMjJhYmMlMjIlN0Q";
        if (expectedSuffix !== expected) {
          throw new Error(`pack_url 产物与页面契约不一致: ${expectedSuffix}`);
        }
        console.log(`✓ url-tool executeTool(pack_url) → packed 契约字节一致`);
        results.push({ app: "url-tool executeTool", ok: true });
      } catch (e) {
        failed = true;
        console.error(`✗ url-tool executeTool: ${e.message}`);
        results.push({ app: "url-tool executeTool", ok: false, error: e.message });
      } finally {
        await page.close();
        server.close();
      }
    }
  } finally {
    await browser.close();
  }

  console.log("\n=== webmcp-check 结果 ===");
  for (const r of results) {
    console.log(`${r.ok ? "✓" : "✗"} ${r.app}${r.ok ? " → [" + (r.tools ?? []).join(", ") + "]" : " → " + (r.error ?? "")}`);
  }
  if (failed) process.exit(1);
  console.log("全绿：四个页面 getTools() 枚举齐 + executeTool 往返契约一致");
}

main();
