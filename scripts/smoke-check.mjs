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
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  for (const app of ["pdf-tool", "img-tool", "url-tool", "directory", "file-viewer"]) {
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

    // 绿门补强（对抗审查 B1/B3）：headless 真下载断言——点 export-btn 捕获
    // download 事件、验文件名契约与 %PDF 文件头（oklch 色守卫修复的回归门）
    await check("pdf-tool 导出真下载：pdf-tool-export.pdf（%PDF 头）", async () => {
      await withPage("pdf-tool", "?autoload=sample", async (page) => {
        await page.waitForFunction(
          () => (document.getElementById("status")?.textContent ?? "").includes("示例周报"),
          { timeout: 10000 },
        );
        const dlPromise = page.waitForEvent("download", { timeout: 90000 });
        await page.click("#export-btn");
        const download = await dlPromise;
        if (download.suggestedFilename() !== "pdf-tool-export.pdf") {
          throw new Error(`下载文件名不符: ${download.suggestedFilename()}`);
        }
        const dlPath = await download.path();
        if (!dlPath) throw new Error("下载产物不可读");
        const head = readFileSync(dlPath).subarray(0, 5).toString("latin1");
        if (!head.startsWith("%PDF")) throw new Error(`产物非 PDF（头: ${head}）`);
        const size = readFileSync(dlPath).length;
        if (size < 1000) throw new Error(`PDF 产物过小（${size}B），疑似空文档`);
        // 终态断言（B3）：状态行必须走到「导出成功」而非停在「正在导出…」
        await page.waitForFunction(
          () => (document.getElementById("status")?.textContent ?? "").includes("导出成功"),
          { timeout: 90000 },
        );
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

    // 近阻塞回归门（对抗审查 2026-10-30）：ai-guide 承诺「结果实时更新」——
    // 手工键入（触发 input 事件，不经任何按钮）必须实时重建结果
    await check("url-tool 手工键入：结果实时更新（input 事件路径）", async () => {
      await withPage("url-tool", "", async (page) => {
        await page.fill("#base-url", "https://example.com/api");
        await page.locator(".prow .pkey").first().fill("title");
        await page.locator(".prow .pval").first().fill("你好");
        const result = (await page.textContent("#result-url")).trim();
        if (!result.includes("title=%E4%BD%A0%E5%A5%BD")) {
          throw new Error(`键入后结果未实时更新: ${result}`);
        }
        // 再增删一行仍实时
        await page.click("#add-param-btn");
        await page.locator(".prow .pkey").last().fill("tag");
        const result2 = (await page.textContent("#result-url")).trim();
        if (!result2.includes("&tag=")) {
          throw new Error(`加行后结果未实时更新: ${result2}`);
        }
      });
    });

    // ---------- file-viewer ----------
    // 同源 demo 夹具随构建迁出（apps/file-viewer/public/demo → dist/demo），
    // 零外网依赖即可断言 URL 契约/解码判定/E2E 标记家族。
    // 注意：withPage 拼 URL 形如 base + "/" + query——query 必须以 ? 开头
    const fvOrigin = () => `http://127.0.0.1:${servers["file-viewer"].server.address().port}`;
    const fvDemo = (file, extra = "") =>
      "?url=" + encodeURIComponent(fvOrigin() + "/demo/" + file) + extra;

    await check("file-viewer ?url=demo/欢迎.md：markdown 自动判定 + 契约渲染", async () => {
      await withPage("file-viewer", fvDemo(encodeURIComponent("欢迎.md"), "&name=%E6%BC%94%E7%A4%BA.md"), async (page) => {
        await page.waitForSelector('[data-decoder-root="markdown"]', { timeout: 15000 });
        const name = await page.textContent('[data-viewer-filename="true"]');
        if (name !== "演示.md") throw new Error(`显示名不符: ${name}（期望 演示.md——name 参数契约）`);
        const topbar = await page.getAttribute('[data-viewer-topbar="true"]', "data-viewer-topbar");
        if (topbar !== "true") throw new Error("顶栏 E2E 标记缺失");
        // 解码器组件经 React.lazy（独立 chunk）+ marked/shiki 异步渲染——等内容落定
        await page.waitForFunction(
          () => (document.querySelector('[data-decoder-root="markdown"]')?.textContent ?? "").includes("通用文件预览站"),
          { timeout: 15000 },
        );
      });
    });

    await check("file-viewer 缺 url：契约错误文案保真 + #ai-guide 自发现", async () => {
      await withPage("file-viewer", "", async (page) => {
        await page.waitForSelector('[data-viewer-error="true"]', { timeout: 10000 });
        const pane = await page.textContent('[data-viewer-error="true"]');
        if (!pane.includes("缺少 url 参数——契约：/?url=<encodeURIComponent(绝对URL)>")) {
          throw new Error(`契约错误文案不符: ${pane.slice(0, 80)}`);
        }
        const guide = await page.textContent("#ai-guide");
        if (!guide.includes("decoder（可选）：强制解码器 id")) throw new Error("ai-guide 契约说明缺失");
        if (!guide.includes("svg image video audio pdf markdown json csv html docx xlsx pptx zip text")) {
          throw new Error("ai-guide 解码器清单缺失");
        }
        if ((guide.match(/\/\?url=/g) ?? []).length === 0) throw new Error("ai-guide 缺 URL 契约行");
        // 示例链接：4 条同源 demo 夹具链接，href 必须是「契约形态」（含 url= 且指向同源 /demo）
        const links = await page.evaluate(() =>
          Array.from(document.querySelectorAll("#ai-guide a")).map((a) => a.href),
        );
        if (links.length !== 4) throw new Error(`ai-guide 示例链接数不符: ${links.length}（期望 4）`);
        for (const href of links) {
          const u = new URL(href);
          if (u.pathname !== "/") throw new Error(`示例链接路径异常: ${href}`);
          const target = u.searchParams.get("url");
          if (!target || !target.startsWith(u.origin + "/demo/")) {
            throw new Error(`示例链接未按契约包 url 参数: ${href}`);
          }
        }
      });
    });

    await check("file-viewer decoder=text 强制 svg：二进制嗅探「未支持＋下载」兜底", async () => {
      // 嗅探用二进制夹具（NUL 字节）动态落进 dist（构建产物目录，可再生）——
      // 优雅拒绝规格场景：强制 text 打开二进制内容 → 未支持态，不渲染乱码
      const binPath = join(ROOT, "apps", "file-viewer", "dist", "demo", "__smoke__.bin");
      writeFileSync(binPath, Buffer.from([0x00, 0x01, 0x02, 0x00, 0x7f, 0x00]));
      try {
        await withPage("file-viewer", fvDemo(encodeURIComponent("__smoke__.bin"), "&decoder=text"), async (page) => {
          await page.waitForSelector('[data-viewer-error-kind="unsupported-binary"]', { timeout: 15000 });
          const rootId = await page.getAttribute("[data-decoder-root]", "data-decoder-root");
          if (rootId !== "text") throw new Error(`强制解码器未生效: ${rootId}`);
          const body = await page.textContent("body");
          if (body.includes("unpack")) throw new Error("疑似渲染了乱码");
        });
      } finally {
        rmSync(binPath, { force: true });
      }
    });

    // ---------- directory ----------
    await check("directory：registry 渲染 + 纯前端搜索", async () => {
      await withPage("directory", "", async (page) => {
        await page.waitForFunction(() => document.querySelectorAll('[data-slot="card"]').length >= 4, { timeout: 10000 });
        const total = await page.evaluate(() => document.querySelectorAll('[data-slot="card"]').length);
        if (total !== 4) throw new Error(`卡片数不符: ${total}（期望 4）`);
        await page.fill('input[aria-label="搜索工具"]', "图片");
        await page.waitForFunction(() => document.querySelectorAll('[data-slot="card"]').length === 1, { timeout: 5000 });
        const count = await page.textContent("main, body");
        if (!count.includes("1 / 4")) throw new Error("搜索计数未显示 1 / 4");
      });
    });

    await check("directory WebMCP search_tools：registry 单源投影", async () => {
      await withPage("directory", "", async (page) => {
        await page.waitForFunction(() => document.modelContext && document.modelContext.getTools().then((ts) => ts.some((t) => t.name === "search_tools")), { timeout: 10000 });
        const out = await page.evaluate(async () => {
          const ts = await document.modelContext.getTools();
          const tool = ts.find((t) => t.name === "search_tools");
          return JSON.parse(await document.modelContext.executeTool(tool, { query: "html2pdf" }));
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
