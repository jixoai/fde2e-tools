/*
 * 参数契约冒烟 —— scripts/smoke-check.mjs
 *
 * 验收（openspec change project-bootstrap / legacy-tools-parity 能力）：
 * 对三工具与黄页抽测存量 URL 参数契约——状态行文案逐字符断言、渲染产物
 * （画布尺寸/结果 URL/解码表）逐值断言。视觉允许升级，行为不允许漂移。
 *
 * 用法：pnpm -r build 后 node scripts/smoke-check.mjs
 */
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
};

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
  return [
    process.env.WEBMCP_CHECK_CHROME,
    join(process.env.HOME ?? "", "Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
    join(process.env.HOME ?? "", "Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
  ].filter(Boolean).find((p) => existsSync(p));
}

const CHECKS = [];
async function check(name, fn) {
  try {
    await fn();
    console.log("✓", name);
    CHECKS.push({ name, ok: true });
  } catch (e) {
    console.error("✗", name, "\n   ", e.message);
    CHECKS.push({ name, ok: false, error: e.message });
  }
}

async function main() {
  const executablePath = findChrome();
  if (!executablePath) {
    console.error("✗ 找不到本机 Chromium——设 WEBMCP_CHECK_CHROME 指定路径");
    process.exit(1);
  }
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--enable-blink-features=WebMCP"],
  });

  const servers = {};
  for (const app of ["pdf-tool", "img-tool", "url-tool", "directory"]) {
    servers[app] = { server: await serveDir(join(ROOT, "apps", app, "dist")), get port() { return servers[app].server.address().port; } };
  }
  const base = (app) => `http://127.0.0.1:${servers[app].server.address().port}`;

  async function withPage(app, query, fn) {
    const page = await browser.newPage();
    try {
      await page.goto(base(app) + "/" + query, { waitUntil: "load" });
      return await fn(page);
    } finally {
      await page.close();
    }
  }

  const statusText = (page) => page.textContent("#status");

  try {
    // ---------- pdf-tool ----------
    await check("pdf-tool ?autoload=sample：自动载入示例并渲染", async () => {
      await withPage("pdf-tool", "?autoload=sample", async (page) => {
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("示例周报"), { timeout: 10000 });
        const v = await page.inputValue("#input-content");
        if (!v.includes("青旅训练营 · 第 3 周周报")) throw new Error("示例周报未载入");
        if (!v.includes("互动率提升至 7.6%")) throw new Error("示例周报内容不完整（尾随空格硬换行丢失？）");
        const s = await statusText(page);
        const want = "示例周报已载入并渲染预览，点「导出 PDF」即可下载。";
        if (s !== want) throw new Error(`状态行不符:\n  got:  ${s}\n  want: ${want}`);
        const srcdoc = await page.getAttribute("#preview", "srcdoc");
        if (!srcdoc || !srcdoc.includes("pdf-content")) throw new Error("预览 iframe 未注入排版结构");
      });
    });

    await check("pdf-tool 空输入点渲染：错误文案保真", async () => {
      await withPage("pdf-tool", "", async (page) => {
        await page.click("#render-btn");
        const s = await statusText(page);
        const want = "输入为空：请先粘贴内容、选择文件，或点「载入示例」。";
        if (s !== want) throw new Error(`状态行不符: got ${s}`);
      });
    });

    await check("pdf-tool WebMCP render_preview：MD 渲染路径", async () => {
      await withPage("pdf-tool", "", async (page) => {
        await page.waitForFunction(() => document.modelContext && document.modelContext.getTools().then((ts) => ts.some((t) => t.name === "render_preview")), { timeout: 10000 });
        const out = await page.evaluate(async () => {
          const ts = await document.modelContext.getTools();
          const tool = ts.find((t) => t.name === "render_preview");
          const res = await document.modelContext.executeTool(tool, { content: "# Hello\n\nworld" });
          return JSON.parse(res);
        });
        if (!out.ok || !out.message.includes("已按 Markdown 渲染预览。")) {
          throw new Error(`render_preview 结果异常: ${JSON.stringify(out)}`);
        }
      });
    });

    // ---------- img-tool ----------
    await check("img-tool URL 直调：sample + cover 裁切 + 文字 + 角标", async () => {
      await withPage(
        "img-tool",
        "?src=sample&w=1080&h=1440&text=%E9%9D%92%E6%97%85%E9%81%BF%E5%9D%91%E6%8C%87%E5%8D%97&pos=center&size=88&color=%23ffffff&bg=%23000000&pad=30&label=%E6%95%88%E6%9E%9C%E5%9B%BE",
        async (page) => {
          await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("渲染完成"), { timeout: 10000 });
          const dims = await page.evaluate(() => {
            const c = document.getElementById("canvas-result");
            return { w: c.width, h: c.height };
          });
          if (dims.w !== 1080 || dims.h !== 1440) throw new Error(`画布尺寸不符: ${dims.w}x${dims.h}（期望 1080x1440 cover）`);
          const s = await statusText(page);
          const want = "渲染完成：1080×1440 px · 已叠加文字 · 已加角标";
          if (s !== want) throw new Error(`状态行不符:\n  got:  ${s}\n  want: ${want}`);
        },
      );
    });

    await check("img-tool 参数 clamp：w=99999 → 8192", async () => {
      await withPage("img-tool", "?src=sample&w=99999", async (page) => {
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("渲染完成"), { timeout: 10000 });
        const w = await page.evaluate(() => document.getElementById("canvas-result").width);
        if (w !== 8192) throw new Error(`clamp 失效: canvas.width=${w}（期望 8192）`);
      });
    });

    await check("img-tool 魔法值 sample：离线示例底图", async () => {
      await withPage("img-tool", "?src=sample", async (page) => {
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("渲染完成"), { timeout: 10000 });
        const s = await statusText(page);
        const want = "渲染完成：1280×960 px";
        if (!s.startsWith(want)) throw new Error(`状态行不符: got ${s}`);
      });
    });

    // ---------- url-tool ----------
    await check("url-tool ?base=&mode=packed：预填即出结果", async () => {
      await withPage("url-tool", "?base=https%3A%2F%2Fexample.com%2Fapi&mode=packed&title=%E4%BD%A0%E5%A5%BD&tag=abc", async (page) => {
        const result = (await page.textContent("#result-url")).trim();
        const want =
          "https://example.com/api?q=JTdCJTIydGl0bGUlMjIlM0ElMjIlRTQlQkQlQTAlRTUlQTUlQkQlMjIlMkMlMjJ0YWclMjIlM0ElMjJhYmMlMjIlN0Q";
        if (result !== want) throw new Error(`结果不符:\n  got:  ${result}\n  want: ${want}`);
        const s = await statusText(page);
        const wantS = "已按 URL 参数预填并生成结果（packed 紧凑包 模式），按钮 id=copy-btn 可复制。";
        if (s !== wantS) throw new Error(`状态行不符:\n  got:  ${s}\n  want: ${wantS}`);
      });
    });

    await check("url-tool ?decode=：反向解码出键值对表", async () => {
      await withPage("url-tool", "?decode=JTdCJTIydGl0bGUlMjIlM0ElMjIlRTQlQkQlQTAlRTUlQTUlQkQlMjIlMkMlMjJ0YWclMjIlM0ElMjJhYmMlMjIlN0Q", async (page) => {
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("解码成功"), { timeout: 10000 });
        const rows = await page.evaluate(() => document.querySelectorAll("#decode-table tbody tr").length);
        if (rows !== 2) throw new Error(`解码表行数不符: ${rows}（期望 2）`);
        const json = await page.textContent("#decode-json");
        if (JSON.parse(json).title !== "你好") throw new Error("解码 JSON 内容不符");
        const s = await statusText(page);
        const want = "解码成功：q 值还原出 2 个参数（见上方表格）。";
        if (s !== want) throw new Error(`状态行不符: got ${s}`);
      });
    });

    await check("url-tool query 模式：重复键保留 + base 已有 query 续接", async () => {
      await withPage("url-tool", "?base=https%3A%2F%2Fexample.com%2Fapi%3Fx%3D1&tag=a&tag=b", async (page) => {
        const result = (await page.textContent("#result-url")).trim();
        const want = "https://example.com/api?x=1&tag=a&tag=b";
        if (result !== want) throw new Error(`结果不符: got ${result}`);
      });
    });

    await check("url-tool 相对 base：字符串拼接兜底", async () => {
      await withPage("url-tool", "?base=%2Fapi%2Fendpoint&k=v", async (page) => {
        const result = (await page.textContent("#result-url")).trim();
        if (result !== "/api/endpoint?k=v") throw new Error(`结果不符: got ${result}`);
      });
    });

    // ---------- directory ----------
    await check("directory：registry 渲染 + 纯前端搜索", async () => {
      await withPage("directory", "", async (page) => {
        await page.waitForFunction(() => document.querySelectorAll('[data-slot="card"]').length >= 3, { timeout: 10000 });
        const total = await page.evaluate(() => document.querySelectorAll('[data-slot="card"]').length);
        if (total !== 3) throw new Error(`卡片数不符: ${total}（期望 3）`);
        await page.fill('input[aria-label="搜索工具"]', "图片");
        await page.waitForFunction(() => document.querySelectorAll('[data-slot="card"]').length === 1, { timeout: 5000 });
        const count = await page.textContent("main, body");
        if (!count.includes("1 / 3")) throw new Error("搜索计数未显示 1 / 3");
      });
    });

    await check("directory WebMCP search_tools：registry 单源投影", async () => {
      await withPage("directory", "", async (page) => {
        await page.waitForFunction(() => document.modelContext && document.modelContext.getTools().then((ts) => ts.some((t) => t.name === "search_tools")), { timeout: 10000 });
        const out = await page.evaluate(async () => {
          const ts = await document.modelContext.getTools();
          const tool = ts.find((t) => t.name === "search_tools");
          return JSON.parse(await document.modelContext.executeTool(tool, { query: "pdf" }));
        });
        if (out.count !== 1 || out.tools[0].id !== "pdf-tool") {
          throw new Error(`search_tools 结果异常: ${JSON.stringify(out).slice(0, 200)}`);
        }
        if (out.tools[0].webmcpTools.length !== 2) throw new Error("registry webmcpTools 投影缺失");
      });
    });
  } finally {
    await browser.close();
    for (const s of Object.values(servers)) s.server.close();
  }

  const failed = CHECKS.filter((c) => !c.ok);
  console.log(`\n=== 冒烟结果：${CHECKS.length - failed.length}/${CHECKS.length} 过 ===`);
  if (failed.length) {
    for (const f of failed) console.log("✗", f.name, "→", f.error);
    process.exit(1);
  }
}

main();
