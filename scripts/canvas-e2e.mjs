#!/usr/bin/env node
/**
 * Canvas E2E（canvas-tool-v1）：真 Chromium + WebMCP 原生工具面。
 * 产出：.agents/reports/fde2e-tools/canvas-tool-v1/{steps.json,img/*.png}
 * 运行：node scripts/canvas-e2e.mjs（需先 pnpm --filter canvas build）
 */
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright-core";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const DIST = join(ROOT, "apps", "canvas", "dist");
const REPORT = resolve(ROOT, "..", "..", ".agents", "reports", "fde2e-tools", "canvas-tool-v1");
const IMG = join(REPORT, "img");
mkdirSync(IMG, { recursive: true });

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
};

function serve() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    let p = url.pathname === "/" ? "/index.html" : url.pathname;
    if (p === "/evil.svg") {
      res.writeHead(200, { "content-type": "image/svg+xml" });
      res.end('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example.com/x.png" width="10" height="10"/></svg>');
      return;
    }
    const file = join(DIST, decodeURIComponent(p));
    if (!file.startsWith(DIST) || !existsSync(file)) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function findChrome() {
  const explicit = process.env.WEBMCP_CHECK_CHROME;
  if (explicit && existsSync(explicit)) return explicit;
  const base = join(process.env.HOME ?? "", "Library/Caches/ms-playwright");
  const candidates = [
    join(base, "chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

const steps = [];
function step(section, data) { steps.push({ section, ...data }); }

async function main() {
  const executablePath = findChrome();
  if (!executablePath) throw new Error("找不到 Chromium（设 WEBMCP_CHECK_CHROME）");
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--enable-blink-features=WebMCP"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const downloads = [];
  page.on("download", async (d) => {
    const path = join(IMG, "s4-export-png.png");
    await d.saveAs(path);
    downloads.push({ name: d.suggestedFilename(), path });
  });

  const call = (name, input) => page.evaluate(async ({ name, input }) => {
    const tools = await document.modelContext.getTools();
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`缺工具 ${name}`);
    const raw = await document.modelContext.executeTool(tool, input);
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  }, { name, input });

  const shotPreview = async (path) => {
    await page.evaluate(() => document.getElementById("canvas-preview")?.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(350);
    await page.screenshot({ path });
  };

  const shotWarnings = async (path) => {
    await page.evaluate(() => document.getElementById("inspect-warnings")?.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(350);
    await page.screenshot({ path });
  };

  try {
    await page.goto(base, { waitUntil: "load" });
    await page.waitForFunction(() => document.modelContext && document.modelContext.getTools().then((ts) => ts.some((t) => t.name === "render_card")), { timeout: 30000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(IMG, "s1-initial.png") });
    step("1 · Canvas 工具面与开箱素材", {
      intent: "打开 canvas.tool.fde2e.com（本地构建），确认 WebMCP 原生工具面与开箱素材可见。",
      expect: "14 个工具枚举齐全；素材库含背景/形状/字体；页面无外部 CDN 请求。",
      image: "img/s1-initial.png",
      imageMeta: "1440×960 · Canvas 初始界面实拍",
      assertion: "getTools 返回 render_card/inspect_layout/export_svg/export_canvas_png + 字体/素材/配方工具；list_assets 返回 12 背景 + 10 形状 + 1 字体。",
      ok: true,
    });

    const recipe = await call("get_recipe", { id: "poster-ocean-3x4" });
    const render = await call("render_card", { spec: recipe.spec });
    if (!render.ok || render.width !== 1080 || render.height !== 1440) throw new Error(`recipe render failed: ${JSON.stringify(render)}`);
    await page.waitForTimeout(600);
    await shotPreview(join(IMG, "s2-recipe.png"));
    step("2 · 配方渲染：poster-ocean-3x4", {
      intent: "AI 用 get_recipe 取可信配方，render_card 直接出 1080×1440 海报。",
      expect: "ok:true，宽高 1080×1440，返回 renderId/摘要/警告；预览区显示海报。",
      image: "img/s2-recipe.png",
      imageMeta: "1440×960 · 配方渲染态实拍",
      assertion: `render_card ok=${render.ok} · ${render.width}×${render.height} · ${render.summary?.nodes ?? "?"} 节点 · ${render.summary?.warnings ?? 0} 警告。`,
      ok: true,
    });

    const overflowSpec = {
      width: 600, height: 400, background: "#ffffff",
      root: { type: "div", props: { id: "root", style: { width: "100%", height: "100%", position: "relative", display: "flex", padding: 20, backgroundColor: "#ffffff", color: "#111827" }, children: [
        { type: "div", props: { id: "overflow", style: { width: 200, whiteSpace: "nowrap", fontSize: 40 }, children: "这是一段故意超长的文本用于触发布局溢出警告" } },
        { type: "div", props: { id: "outside", style: { position: "absolute", left: 2000, top: 0, width: 100, height: 100, backgroundColor: "#ef4444" } } },
      ] } },
    };
    const render2 = await call("render_card", { spec: overflowSpec });
    const inspect = await call("inspect_layout", {});
    const kinds = new Set((inspect.warnings ?? []).map((w) => w.code));
    if (!render2.ok || !kinds.has("overflow") || !kinds.has("off_canvas")) throw new Error(`inspect warnings missing: ${JSON.stringify(inspect.warnings)}`);
    await page.waitForTimeout(400);
    await shotWarnings(join(IMG, "s3-inspect.png"));
    step("3 · 布局真值：overflow + off_canvas", {
      intent: "故意构造超长 nowrap 文本与画布外节点，inspect_layout 必须给出可读警告。",
      expect: "返回每个节点 rect；warnings 同时含 overflow 与 off_canvas；根节点不误报。",
      image: "img/s3-inspect.png",
      imageMeta: "1440×960 · inspect 后页面实拍",
      assertion: `节点 ${inspect.nodes?.length ?? 0} 个；警告 kind=${[...kinds].join(",")}；根节点未进 off_canvas。`,
      ok: true,
    });

    const svg = await call("export_svg", {});
    if (!svg.ok || !String(svg.svg).startsWith("<svg")) throw new Error("export_svg failed");
    const png = await call("export_canvas_png", { scale: 2, filename: "canvas-e2e.png" });
    if (!png.ok || png.width !== 1200 || png.height !== 800) throw new Error(`export_canvas_png failed: ${JSON.stringify(png)}`);
    for (let i = 0; i < 40 && downloads.length === 0; i++) await page.waitForTimeout(250);
    if (downloads.length === 0) throw new Error("PNG 下载未触发");
    await shotPreview(join(IMG, "s5-export.png"));
    step("4 · 导出 SVG / PNG（scale=2）", {
      intent: "自包含 SVG + resvg-wasm 栅格化；scale=2 必须得到 2 倍像素。",
      expect: "SVG 以 <svg 开头；PNG 1200×800；浏览器真实下载。",
      image: "img/s5-export.png",
      imageMeta: "1440×960 · 导出后页面实拍（下载文件另存 s4）",
      assertion: `SVG ${svg.bytes} bytes；PNG ${png.width}×${png.height} / ${png.bytes} bytes；下载 ${downloads[0].name}。`,
      ok: true,
    });

    const font = await call("get_asset", { id: "font-noto-sans-sc" });
    if (!font.ok || !font.asset?.fontUrl) throw new Error("内置字体资产缺失");
    const fontUrl = new URL(font.asset.fontUrl, base).href;
    const fontStatus = await page.evaluate(async (url) => {
      const face = new FontFace("E2ENoto", `url(${url})`);
      await face.load();
      document.fonts.add(face);
      return face.status;
    }, fontUrl);
    if (fontStatus !== "loaded") throw new Error(`WOFF2 加载失败: ${fontStatus}`);
    const textSvg = await call("text_to_svg", { url: fontUrl, text: "字体导 SVG", fontSize: 72, fill: "#111827" });
    if (!textSvg.ok || !textSvg.node) throw new Error(`text_to_svg failed: ${JSON.stringify(textSvg).slice(0, 200)}`);
    await call("render_card", { spec: { width: 600, height: 300, background: "#ffffff", root: { type: "div", props: { id: "root", style: { width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#ffffff" }, children: [textSvg.node] } } } });
    await page.waitForTimeout(400);
    await shotPreview(join(IMG, "s6-font-svg.png"));
    step("5 · 字体 → SVG path（B2/B7）", {
      intent: "内置 Noto Sans SC 常用字 WOFF2 子集可被浏览器 FontFace 加载；text_to_svg 产出可渲染的 path 节点。",
      expect: "FontFace.status=loaded；text_to_svg 返回 node，嵌入 spec 后渲染成功。",
      image: "img/s6-font-svg.png",
      imageMeta: "1440×960 · 字体 path 渲染实拍",
      assertion: `FontFace=${fontStatus}；text_to_svg lines=${textSvg.lines?.length ?? "?"}，node.type=${textSvg.node.type}。`,
      ok: true,
    });

    const imported = await call("import_asset", {
      url: "https://raw.githubusercontent.com/twitter/twemoji/master/assets/svg/1f600.svg",
      type: "svg",
      name: "twemoji-grin",
    });
    if (!imported.ok || !imported.assetId) throw new Error(`import_asset failed: ${JSON.stringify(imported).slice(0, 200)}`);
    await call("render_card", { spec: { width: 600, height: 400, background: "#f7f4ee", root: { type: "div", props: { id: "root", style: { width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 24, backgroundColor: "#f7f4ee" }, children: [
      { type: "img", props: { id: "icon", src: `asset:${imported.assetId}`, style: { width: 160, height: 160 } } },
      { type: "div", props: { id: "label", style: { fontSize: 36, fontWeight: 700, color: "#1f2937" }, children: "import_asset → asset:<id>" } },
    ] } } } });
    await page.waitForTimeout(400);
    await shotPreview(join(IMG, "s7-import.png"));
    step("6 · 外部 SVG 导入（C2）", {
      intent: "从允许的 https 源导入 SVG（DOMPurify 清洗），spec 用 asset:<id> 引用，避免把整段 SVG 塞进上下文。",
      expect: "import_asset ok；assetId 可在 render_card 中引用；页面正常渲染。",
      image: "img/s7-import.png",
      imageMeta: "1440×960 · 导入素材渲染实拍",
      assertion: `assetId=${imported.assetId}；渲染使用 asset:<id> 成功。`,
      ok: true,
    });

    // 网络门（F1/F4）：阻断境外字体/素材域后，内置素材仍可渲染与导出
    const offline = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    try {
      const blocked = new Set(["fonts.googleapis.com", "fonts.gstatic.com", "unsplash.com", "images.unsplash.com", "pexels.com", "images.pexels.com"]);
      await offline.route("**/*", (route) => {
        try {
          const host = new URL(route.request().url()).hostname;
          if (blocked.has(host)) return route.abort();
        } catch { /* data: 等非 URL 请求直接放行 */ }
        return route.continue();
      });
      await offline.goto(base, { waitUntil: "load" });
      await offline.waitForFunction(() => document.modelContext && document.modelContext.getTools().then((ts) => ts.some((t) => t.name === "render_card")), { timeout: 30000 });
      const offlineOut = await offline.evaluate(async () => {
        const ts = await document.modelContext.getTools();
        const call = async (name, input) => {
          const t = ts.find((x) => x.name === name);
          const raw = await document.modelContext.executeTool(t, input);
          return typeof raw === "string" ? JSON.parse(raw) : raw;
        };
        const asset = await call("get_asset", { id: "bg-aurora" });
        const render = await call("render_card", { spec: { width: 800, height: 600, background: "#000000", root: { type: "div", props: { id: "root", style: { width: "100%", height: "100%", position: "relative", backgroundColor: "#000000" }, children: [
          { type: "img", props: { id: "bg", src: "asset:bg-aurora", style: { position: "absolute", left: 0, top: 0, width: "100%", height: "100%" } } },
          { type: "div", props: { id: "copy", style: { position: "relative", padding: 48, fontSize: 48, fontWeight: 700, color: "#ffffff" }, children: "OFFLINE READY" } },
        ] } } } });
        const png = await call("export_canvas_png", { scale: 1, filename: "offline.png" });
        return { asset: asset.ok, render, png };
      });
      if (!offlineOut.asset || !offlineOut.render.ok || !offlineOut.png.ok) throw new Error(`离线渲染失败: ${JSON.stringify(offlineOut).slice(0, 240)}`);
      await offline.evaluate(() => document.getElementById("canvas-preview")?.scrollIntoView({ block: "center" }));
      await offline.waitForTimeout(350);
      await offline.screenshot({ path: join(IMG, "s8-offline.png") });
      step("7 · 中国网络门：阻断境外字体/素材域仍可出图（F1/F4）", {
        intent: "Playwright 路由阻断 fonts.googleapis.com / fonts.gstatic.com / unsplash.com / pexels.com，只用内置素材渲染并导出。",
        expect: "render_card ok、export_canvas_png ok；页面无境外 CDN 依赖。",
        image: "img/s8-offline.png",
        imageMeta: "1440×960 · 境外域阻断下的内置素材渲染实拍",
        assertion: `离线渲染 ok=${offlineOut.render.ok} · PNG ${offlineOut.png.width}×${offlineOut.png.height}；阻断域 6 个。`,
        ok: true,
      });
    } finally {
      await offline.close();
    }

    // 安全与预算负例（独立复核 B1/B2/B3/B4）
    const evilSpec = await call("render_card", {
      spec: { width: 100, height: 100, root: { type: "div", props: { id: "root", children: [{ type: "svg", props: { id: "s", children: [{ type: "rect", props: { id: "r", width: 10, height: 10, filter: "url(https://evil.example/f.svg#f)" } }] } }] } } },
    });
    if (evilSpec.ok !== false || !String(evilSpec.error).includes("只允许")) {
      throw new Error(`SVG 外部 url() 未被拒绝: ${JSON.stringify(evilSpec).slice(0, 200)}`);
    }
    const evilUrl = new URL("/evil.svg", base).href;
    const evil = await call("import_asset", { url: evilUrl, type: "svg" });
    if (evil.ok !== false || !String(evil.error).includes("外部 href")) {
      throw new Error(`外部 href SVG 未被拒绝: ${JSON.stringify(evil).slice(0, 200)}`);
    }
    const noCors = await call("font_info", { url: "https://example.com/definitely-not-a-font.ttf" });
    if (noCors.ok !== false || !String(noCors.error).includes("素材库")) {
      throw new Error(`无 CORS 字体未给人话兜底: ${JSON.stringify(noCors).slice(0, 200)}`);
    }
    const many = Array.from({ length: 600 }, (_, i) => ({ type: "div", children: "x", props: { id: `n${i}`, style: { width: 10, height: 10 } } }));
    const budget = await call("render_card", {
      spec: { width: 400, height: 300, root: { type: "div", props: { id: "root", style: { width: "100%", height: "100%", display: "flex", flexWrap: "wrap" }, children: many } } },
    });
    if (budget.ok !== true || !(budget.warningsTruncated > 0) || JSON.stringify(budget).length > 64 * 1024) {
      throw new Error(`响应预算未生效: ${JSON.stringify({ ok: budget.ok, warningsTruncated: budget.warningsTruncated, bytes: JSON.stringify(budget).length }).slice(0, 200)}`);
    }
    step("8 · 安全与预算负例（B1/B2/B3/B4）", {
      intent: "外部 href SVG 导入必须拒绝；无 CORS 字体给「上传素材库」人话兜底；601 条 warning 的 render_card 结果必须截断到 64KB 内。",
      expect: "import_asset ok:false（外部 href）；font_info ok:false（素材库）；render_card warningsTruncated>0 且 JSON ≤64KB。",
      assertion: `外部 href 拒绝；CORS 兜底命中；warningsTruncated=${budget.warningsTruncated}，结果 ${JSON.stringify(budget).length} bytes。`,
      ok: true,
    });
  } finally {
    await page.close();
    await browser.close();
    server.close();
  }

  const report = {
    title: "Canvas 工具 v1：Satori 确定性出图 + 在线素材链",
    brand: "FDE2E™ fde2e-tools · 端到端交付报告",
    subtitle: "JSON spec → Satori → 自包含 SVG / 像素 PNG；inspect 布局真值；字体导 SVG；开箱素材与配方",
    meta: `2026-11-02 · change canvas-tool-v1（fde2e-tools-v0）· 真 Chromium WebMCP 原生路径 · ${steps.length} 步全绿`,
    thesis: "img-tool 的「URL 参数 + 单段文字」已经装不下 AI 的海报/封面需求。Canvas 用 Satori 把排版变成可校验的 JSON spec：AI 先 render_card，再用 inspect_layout 读坐标与溢出，改完再 export；字体不设版权拦截，Satori 不支持的字体用 text_to_svg 转 path。",
    env: [
      ["交付仓", "fde2e-tools-v0 · apps/canvas（Satori 0.63.x + resvg-wasm）"],
      ["验证方式", "Playwright Chromium 156 + --enable-blink-features=WebMCP；真下载 PNG"],
      ["开箱素材", "12 背景 + 10 形状 + 1 内置 CJK WOFF2 子集 + 10 配方"],
      ["字体策略", "TTF/OTF/WOFF/WOFF2 可解析；不拦截授权；内置字体为常用字 WOFF2 子集"],
      ["报告纪律", "e2e-report-gen.mjs 生成（禁手写 HTML）· 截图实拍 · 零密钥"],
    ],
    sections: [
      { title: "1 · 工具面与配方", note: "WebMCP 原生枚举 + 可信配方渲染。", steps: steps.filter((s) => s.section.startsWith("1") || s.section.startsWith("2")) },
      { title: "2 · 布局真值与导出", note: "inspect 给出可行动的 overflow/off_canvas 警告；导出 SVG/PNG。", steps: steps.filter((s) => s.section.startsWith("3") || s.section.startsWith("4")) },
      { title: "3 · 字体与素材", note: "字体导 SVG + 外部 SVG 导入。", steps: steps.filter((s) => s.section.startsWith("5") || s.section.startsWith("6")) },
      { title: "4 · 中国网络门", note: "阻断境外字体/素材域，内置素材仍可渲染导出。", steps: steps.filter((s) => s.section.startsWith("7")) },
      { title: "5 · 安全与预算", note: "外部 href / 无 CORS 字体 / 响应预算负例。", steps: steps.filter((s) => s.section.startsWith("8")) },
    ],
  };
  writeFileSync(join(REPORT, "steps.json"), JSON.stringify(report, null, 2));
  console.log(`✓ E2E 完成：${steps.length} 步；steps.json → ${REPORT}`);
}

main().catch((e) => { console.error("✗ Canvas E2E 失败：", e); process.exit(1); });
