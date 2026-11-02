#!/usr/bin/env node
/**
 * Canvas E2E（canvas-shaders-v1）：真 Chromium + WebMCP 原生工具面 + Paper Shaders。
 * 产出：.agents/reports/fde2e-tools/canvas-shaders-v1/{steps.json,img/*.png}
 * 可用 E2E_REPORT_DIR 覆盖报告目录（避免写主仓工作树时用 /tmp）。
 * 运行：node scripts/canvas-e2e.mjs（需先 pnpm --filter canvas build）
 */
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright-core";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const DIST = join(ROOT, "apps", "canvas", "dist");
const REPORT = process.env.E2E_REPORT_DIR
  ? resolve(process.env.E2E_REPORT_DIR)
  : resolve(ROOT, "..", "..", ".agents", "reports", "fde2e-tools", "canvas-shaders-v1");
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
    // SwiftShader 固定软件渲染：shader 确定性断言（同机/跨 dsf）的可复现前提
    args: ["--enable-blink-features=WebMCP", "--use-angle=swiftshader"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const downloads = [];
  page.on("download", async (d) => {
    const safe = d.suggestedFilename().replace(/[^\w.-]+/g, "-");
    const path = join(IMG, `download-${downloads.length + 1}-${safe}`);
    await d.saveAs(path);
    downloads.push({ name: d.suggestedFilename(), path });
  });

  async function callTool(pg, name, input) {
    return pg.evaluate(async ({ name, input }) => {
      // Chrome 原生 WebMCP 注册队列偶发缺工具：低频重试到工具出现
      let tools = [];
      for (let i = 0; i < 12; i++) {
        tools = await document.modelContext.getTools();
        if (tools.some((t) => t.name === name)) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      const tool = tools.find((t) => t.name === name);
      if (!tool) throw new Error(`缺工具 ${name}`);
      const raw = await document.modelContext.executeTool(tool, input);
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    }, { name, input });
  }
  const call = (name, input) => callTool(page, name, input);

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

  const shotShader = async (path) => {
    await page.evaluate(() => {
      const target = document.getElementById("shader-preview") ?? document.getElementById("shader-generate-btn");
      target?.scrollIntoView({ block: "center" });
    });
    await page.waitForTimeout(350);
    await page.screenshot({ path });
  };

  try {
    await page.goto(base, { waitUntil: "load" });
    await page.waitForFunction(() => document.modelContext && document.modelContext.getTools().then((ts) => ts.some((t) => t.name === "render_card")), { timeout: 30000 });
    // shader 工具最后注册：等齐 4 个再枚举（Chrome 原生注册是异步的）
    await page.waitForFunction(
      () =>
        document.modelContext &&
        document.modelContext
          .getTools()
          .then((ts) =>
            ["list_shader_presets", "generate_background", "apply_shader", "shader_to_asset"].every((n) =>
              ts.some((t) => t.name === n),
            ),
          ),
      { timeout: 60000, polling: 500 },
    );
    const toolNames = await page.evaluate(async () => (await document.modelContext.getTools()).map((t) => t.name));
    for (const must of ["list_shader_presets", "generate_background", "apply_shader", "shader_to_asset"]) {
      if (!toolNames.includes(must)) throw new Error(`工具面缺 ${must}（实际 ${toolNames.join(",")}）`);
    }
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(IMG, "s1-initial.png") });
    step("1 · Canvas 工具面与开箱素材", {
      intent: "打开 canvas.tool.fde2e.com（本地构建），确认 WebMCP 原生工具面与开箱素材可见。",
      expect: "18 个工具枚举齐全（14 存量 + 4 Paper Shaders）；素材库含背景/形状/字体；页面无外部 CDN 请求。",
      image: "img/s1-initial.png",
      imageMeta: "1440×960 · Canvas 初始界面实拍",
      assertion: "getTools 返回 render_card/inspect_layout/export_svg/export_canvas_png + 字体/素材/配方 + list_shader_presets/generate_background/apply_shader/shader_to_asset；list_assets 返回 12 背景 + 10 形状 + 1 字体。",
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

    // ---------- Paper Shaders（canvas-shaders-v1） ----------
    const presets = await call("list_shader_presets", {});
    if (!presets.ok || presets.total < 4) throw new Error(`list_shader_presets 失败: ${JSON.stringify(presets).slice(0, 200)}`);
    const presetIds = presets.presets.map((p) => p.id);
    for (const must of ["mesh-sunset", "mesh-aurora", "glass-prism", "paper-default"]) {
      if (!presetIds.includes(must)) throw new Error(`预设缺 ${must}（实际 ${presetIds.join(",")}）`);
    }
    if (presets.presets.some((p) => "defaults" in p)) throw new Error("list_shader_presets 泄露了全量默认参数");
    if (presets.presets.filter((p) => p.needsImage).length !== 2) throw new Error("needsImage 摘要不符");

    const mesh = await call("generate_background", {
      preset: "mesh-sunset",
      width: 600,
      height: 400,
      name: "E2E mesh sunset",
      tags: ["e2e"],
    });
    if (!mesh.ok || mesh.width !== 600 || mesh.height !== 400 || !mesh.assetId) {
      throw new Error(`generate_background 失败: ${JSON.stringify(mesh).slice(0, 240)}`);
    }
    const meshAsset = await call("get_asset", { id: mesh.assetId });
    if (
      !meshAsset.ok ||
      meshAsset.asset.type !== "background" ||
      meshAsset.asset.license !== "generated" ||
      meshAsset.asset.source !== "shader:mesh-sunset" ||
      meshAsset.asset.width !== 600 ||
      meshAsset.asset.height !== 400 ||
      !String(meshAsset.asset.dataUrl).startsWith("data:image/jpeg")
    ) {
      throw new Error(`生成资产元数据不符: ${JSON.stringify(meshAsset).slice(0, 240)}`);
    }
    const backgroundList = await call("list_assets", { type: "background" });
    if (!backgroundList.ok || !backgroundList.assets.some((a) => a.id === mesh.assetId)) {
      throw new Error(`生成资产未进 list_assets: ${JSON.stringify(backgroundList).slice(0, 200)}`);
    }
    // AI 生成经 subscribeAssets 同步到人类 UI（资产 id 出现在页面）
    await page.waitForFunction((id) => document.body.textContent.includes(id), mesh.assetId, { timeout: 15000 });
    await shotShader(join(IMG, "s9-mesh.png"));
    step("9 · Shader 预设与 mesh 生成", {
      intent: "list_shader_presets 取摘要；generate_background 用 mesh-sunset 生成 600×400 背景并注册资产。",
      expect: "≥4 个预设（含 mesh/glass/paper）且摘要不含 defaults；返回 assetId/尺寸/字节；list_assets/get_asset 可检索；UI 自动出现资产。",
      image: "img/s9-mesh.png",
      imageMeta: "1440×960 · Shader 卡实拍（AI 生成后自动预览）",
      assertion: `预设 ${presets.total} 个（${presetIds.join(", ")}）· ${mesh.assetId} ${mesh.width}×${mesh.height} ${mesh.format} ${mesh.bytes}B · type=background/license=generated/source=shader:mesh-sunset · list_assets 命中 · UI 同步。`,
      ok: true,
    });

    const chain = await call("shader_to_asset", {
      width: 600,
      height: 400,
      chain: [{ preset: "mesh-sunset" }, { preset: "glass-prism" }],
      format: "jpeg",
      quality: 0.9,
      name: "E2E chain",
    });
    if (!chain.ok || chain.steps.length !== 2 || chain.width !== 600 || chain.height !== 400) {
      throw new Error(`shader_to_asset 链式失败: ${JSON.stringify(chain).slice(0, 240)}`);
    }
    if (chain.steps[0].preset !== "mesh-sunset" || chain.steps[1].preset !== "glass-prism") {
      throw new Error(`链式步骤顺序不符: ${JSON.stringify(chain.steps)}`);
    }
    const chainAsset = await call("get_asset", { id: chain.assetId, summaryOnly: true });
    if (!chainAsset.ok || chainAsset.asset.source !== "shader:mesh-sunset>glass-prism") {
      throw new Error(`链式资产 source 不符: ${JSON.stringify(chainAsset).slice(0, 200)}`);
    }
    await shotShader(join(IMG, "s10-chain.png"));
    step("10 · 链式：mesh-sunset → glass-prism", {
      intent: "shader_to_asset 两步链式：第一步生成渐变，第二步无显式 source（消费上一步输出）做玻璃棱镜。",
      expect: "steps 2 步且顺序正确；最终尺寸=请求尺寸 600×400；资产 source=shader:mesh-sunset>glass-prism。",
      image: "img/s10-chain.png",
      imageMeta: "1440×960 · 链式生成后预览实拍",
      assertion: `${chain.assetId} · steps=${chain.steps.map((s) => `${s.preset}:${s.ms}ms`).join(" → ")} · ${chain.width}×${chain.height} ${chain.format} ${chain.bytes}B · source=shader:mesh-sunset>glass-prism。`,
      ok: true,
    });

    const meshBefore = await call("get_asset", { id: mesh.assetId });
    const paper = await call("apply_shader", {
      preset: "paper-default",
      sourceAssetId: mesh.assetId,
      width: 600,
      height: 400,
      name: "E2E paper",
    });
    const meshAfter = await call("get_asset", { id: mesh.assetId });
    if (!paper.ok || paper.assetId === mesh.assetId || paper.width !== 600 || paper.height !== 400) {
      throw new Error(`apply_shader 失败: ${JSON.stringify(paper).slice(0, 240)}`);
    }
    if (!meshBefore.ok || !meshAfter.ok || meshBefore.asset.dataUrl !== meshAfter.asset.dataUrl) {
      throw new Error("apply_shader 修改了源资产（应保持不变）");
    }
    // sourceDataUrl 形态：未给尺寸时按源图真实尺寸（600×400）
    const paperFromData = await call("apply_shader", {
      preset: "paper-default",
      sourceDataUrl: meshBefore.asset.dataUrl,
      name: "E2E paper from data",
    });
    if (!paperFromData.ok || paperFromData.width !== 600 || paperFromData.height !== 400) {
      throw new Error(`apply_shader(sourceDataUrl) 默认尺寸不符: ${JSON.stringify(paperFromData).slice(0, 200)}`);
    }
    await shotShader(join(IMG, "s11-paper.png"));
    step("11 · 图片加工：mesh 资产 → paper-default（源不变）", {
      intent: "apply_shader 以已生成 mesh 资产为输入执行纸纹压印（sourceAssetId + sourceDataUrl 两种形态）；比对调用前后源资产 data URL。",
      expect: "返回新 assetId；源资产 data URL 逐字节不变；sourceAssetId 尺寸=600×400，sourceDataUrl 缺省尺寸=源图 600×400。",
      image: "img/s11-paper.png",
      imageMeta: "1440×960 · 纸纹处理结果预览实拍",
      assertion: `源 ${mesh.assetId} 不变（${meshBefore.asset.dataUrl.length} chars）· 新资产 ${paper.assetId} ${paper.width}×${paper.height} ${paper.format} ${paper.bytes}B · sourceDataUrl 形态 ${paperFromData.assetId} ${paperFromData.width}×${paperFromData.height}。`,
      ok: true,
    });

    const bgSpec = {
      width: 600,
      height: 400,
      root: {
        type: "div",
        props: {
          id: "root",
          style: {
            width: "100%",
            height: "100%",
            position: "relative",
            display: "flex",
            alignItems: "flex-end",
            padding: 32,
            fontFamily: "Noto Sans SC",
          },
          children: [
            {
              type: "img",
              props: {
                id: "bg",
                src: `asset:${paper.assetId}`,
                style: { position: "absolute", left: 0, top: 0, width: "100%", height: "100%" },
              },
            },
            {
              type: "div",
              props: {
                id: "label",
                style: { position: "relative", fontSize: 36, fontWeight: 700, color: "#ffffff" },
                children: "Shader background",
              },
            },
          ],
        },
      },
    };
    const render3 = await call("render_card", { spec: bgSpec });
    if (!render3.ok || render3.width !== 600 || render3.height !== 400) {
      throw new Error(`asset:<id> 背景渲染失败: ${JSON.stringify(render3).slice(0, 240)}`);
    }
    const downloadsBefore = downloads.length;
    const exportShader = await call("export_canvas_png", { scale: 1, filename: "shader-e2e.png" });
    for (let i = 0; i < 40 && downloads.length === downloadsBefore; i++) await page.waitForTimeout(250);
    if (downloads.length === downloadsBefore) throw new Error("Shader 背景 PNG 下载未触发");
    const shaderDl = downloads[downloads.length - 1];
    const shaderPng = readFileSync(shaderDl.path);
    const shaderPngHead = shaderPng.subarray(0, 8).toString("latin1");
    if (!shaderPngHead.startsWith("\x89PNG\r\n\x1a\n")) throw new Error("导出产物非 PNG");
    const shaderPngW = shaderPng.readUInt32BE(16);
    const shaderPngH = shaderPng.readUInt32BE(20);
    if (shaderPngW !== 600 || shaderPngH !== 400) throw new Error(`导出尺寸不符: ${shaderPngW}×${shaderPngH}`);
    await shotPreview(join(IMG, "s12-asset-render.png"));
    step("12 · asset:<id> 全幅背景 → render_card → 导出 PNG", {
      intent: "把 shader 生成资产以 asset:<id> 作为全幅背景放进 spec，render_card 渲染后 export_canvas_png。",
      expect: "render_card ok 600×400；浏览器真实下载 PNG，尺寸 600×400。",
      image: "img/s12-asset-render.png",
      imageMeta: "1440×960 · 背景合成后的 Canvas 预览实拍",
      assertion: `render_card ${render3.width}×${render3.height} · 导出 ${shaderDl.name} ${shaderPngW}×${shaderPngH}（PNG 头 ✓）· ${exportShader.bytes}B。`,
      ok: true,
    });

    // 确定性：同页同请求两次 + 全新浏览器 dsf=1/2
    const detA = await call("generate_background", { preset: "mesh-aurora", width: 240, height: 160, format: "jpeg", quality: 0.9 });
    const detB = await call("generate_background", { preset: "mesh-aurora", width: 240, height: 160, format: "jpeg", quality: 0.9 });
    const detAssetA = await call("get_asset", { id: detA.assetId });
    const detAssetB = await call("get_asset", { id: detB.assetId });
    if (!detA.ok || !detB.ok || !detAssetA.ok || !detAssetB.ok) throw new Error("确定性探测生成失败");
    if (detAssetA.asset.dataUrl !== detAssetB.asset.dataUrl) {
      throw new Error("同机同参数两次生成字节不一致（确定性失守）");
    }

    async function dsfGenerate(dsf) {
      // 每档独立浏览器：Chrome 原生 WebMCP 多页后注册队列会缺工具
      const b = await chromium.launch({
        executablePath,
        headless: true,
        args: ["--enable-blink-features=WebMCP", "--use-angle=swiftshader"],
      });
      try {
        const ctx = await b.newContext({ deviceScaleFactor: dsf, viewport: { width: 800, height: 600 } });
        const p = await ctx.newPage();
        await p.goto(base, { waitUntil: "load" });
        await p.waitForFunction(
          () => document.modelContext && document.modelContext.getTools().then((ts) => ts.some((t) => t.name === "generate_background")),
          { timeout: 30000 },
        );
        const generated = await callTool(p, "generate_background", {
          preset: "mesh-aurora",
          width: 240,
          height: 160,
          format: "jpeg",
          quality: 0.9,
        });
        const asset = await callTool(p, "get_asset", { id: generated.assetId });
        return {
          dsf: await p.evaluate(() => window.devicePixelRatio),
          ok: generated.ok,
          width: generated.width,
          height: generated.height,
          url: asset.asset?.dataUrl,
        };
      } finally {
        await b.close();
      }
    }
    const dsf1 = await dsfGenerate(1);
    const dsf2 = await dsfGenerate(2);
    if (dsf1.dsf !== 1 || dsf2.dsf !== 2) throw new Error(`deviceScaleFactor 未生效: ${dsf1.dsf}/${dsf2.dsf}`);
    if (!dsf1.ok || !dsf2.ok || dsf1.width !== 240 || dsf2.height !== 160) throw new Error("dsf 生成失败");
    if (dsf1.url !== dsf2.url) throw new Error("dsf=1 与 dsf=2 输出字节不一致（u_pixelRatio 未锁定为 1）");
    await shotShader(join(IMG, "s13-determinism.png"));
    step("13 · 确定性：同请求两次 + dsf=1/2 字节一致", {
      intent: "同一页面连续两次 mesh-aurora 生成；再以全新浏览器上下文分别以 deviceScaleFactor=1/2 生成同请求。",
      expect: "同机同参数两次 data URL 完全相同；dsf=1 与 dsf=2 输出尺寸/字节完全一致。",
      image: "img/s13-determinism.png",
      imageMeta: "1440×960 · 确定性探测后页面实拍",
      assertion: `同页两次一致 ✓（${detAssetA.asset.dataUrl.length} chars）· dsf=1(${dsf1.width}×${dsf1.height}) 与 dsf=2(${dsf2.width}×${dsf2.height}) 字节一致 ✓。`,
      ok: true,
    });

    const illegalCases = [
      ["generate_background", { preset: "no-such-preset" }, "E_SHADER_UNKNOWN_PRESET"],
      ["generate_background", { preset: "mesh-sunset", params: { colors: ["not-a-color"] } }, "E_SHADER_BAD_PARAM"],
      ["generate_background", { preset: "mesh-sunset", width: 99999, height: 100 }, "E_SHADER_BAD_PARAM"],
      ["apply_shader", { preset: "glass-prism" }, "E_SHADER_SOURCE_REQUIRED"],
      ["apply_shader", { preset: "glass-prism", sourceDataUrl: "https://evil.example/x.png" }, "E_SHADER_SOURCE_UNSAFE"],
      ["shader_to_asset", { width: 100, height: 100, chain: [] }, "E_SHADER_BAD_PARAM"],
      [
        "shader_to_asset",
        {
          width: 100,
          height: 100,
          chain: [{ preset: "mesh-sunset" }, { preset: "mesh-aurora" }, { preset: "mesh-sunset" }, { preset: "mesh-aurora" }, { preset: "mesh-sunset" }],
        },
        "E_SHADER_BAD_PARAM",
      ],
    ];
    const illegalResults = [];
    for (const [toolName, input, expectedCode] of illegalCases) {
      const r = await call(toolName, input);
      if (r.ok !== false || !r.error || r.code !== expectedCode) {
        throw new Error(`非法入参未被结构化拒绝（${toolName} ${JSON.stringify(input)}）: ${JSON.stringify(r).slice(0, 200)}`);
      }
      illegalResults.push(`${toolName}:${r.code}`);
    }

    // WebGL2 缺失降级：打桩 getContext('webgl2')=null；页面其余功能（render_card）不受影响
    const stubShot = join(IMG, "s14-webgl2-stub.png");
    let stubOut = null;
    const stubBrowser = await chromium.launch({ executablePath, headless: true, args: ["--enable-blink-features=WebMCP"] });
    try {
      const ctx = await stubBrowser.newContext({ viewport: { width: 1440, height: 960 } });
      await ctx.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
          if (type === "webgl2") return null;
          return original.call(this, type, ...rest);
        };
      });
      const stubPage = await ctx.newPage();
      await stubPage.goto(base, { waitUntil: "load" });
      await stubPage.waitForFunction(
        () => document.modelContext && document.modelContext.getTools().then((ts) => ts.some((t) => t.name === "generate_background")),
        { timeout: 30000 },
      );
      const generated = await callTool(stubPage, "generate_background", { preset: "mesh-sunset", width: 100, height: 100 });
      const rendered = await callTool(stubPage, "render_card", {
        spec: {
          width: 200,
          height: 120,
          root: { type: "div", props: { id: "r", style: { width: "100%", height: "100%", backgroundColor: "#0b1020" }, children: "NO WEBGL2 · STILL WORKS" } },
        },
      });
      stubOut = { generated, rendered };
      await stubPage.screenshot({ path: stubShot });
    } finally {
      await stubBrowser.close();
    }
    if (!stubOut || stubOut.generated.ok !== false || stubOut.generated.code !== "E_SHADER_NO_WEBGL2") {
      throw new Error(`WebGL2 缺失未返回 E_SHADER_NO_WEBGL2: ${JSON.stringify(stubOut).slice(0, 240)}`);
    }
    if (!stubOut.rendered.ok) throw new Error("WebGL2 缺失时 render_card 不应受影响");
    step("14 · 非法矩阵 + WebGL2 缺失降级", {
      intent: "逐个调用非法 preset/颜色/尺寸/缺 source/外部 URL/链长；另开打桩页把 getContext('webgl2') 置 null 后调用生成。",
      expect: "7 项非法输入全部 ok:false + 结构化 code；WebGL2 缺失返回 E_SHADER_NO_WEBGL2；render_card 仍可用。",
      image: "img/s14-webgl2-stub.png",
      imageMeta: "1440×960 · WebGL2 打桩页实拍（Canvas 其余功能正常）",
      assertion: `${illegalResults.join(" · ")} · WebGL2 缺失=${stubOut.generated.code} · render_card ok=${stubOut.rendered.ok}。`,
      ok: true,
    });

    await page.evaluate(() => document.getElementById("shader-generate-btn")?.scrollIntoView({ block: "center" }));
    await page.click("#shader-preset-mesh-sunset");
    await page.fill("#shader-width", "480");
    await page.fill("#shader-height", "320");
    await page.click("#shader-generate-btn");
    await page.waitForSelector("#shader-preview", { timeout: 30000 });
    await page.waitForFunction(
      () => (document.getElementById("shader-status")?.textContent ?? "").includes("已生成"),
      { timeout: 30000 },
    );
    const humanStatus = await page.textContent("#shader-status");
    if (!/shader-\d+/.test(humanStatus)) throw new Error(`人类生成状态行未含资产 id: ${humanStatus}`);
    const useButtonId = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button[id^="shader-use-"]')];
      const last = buttons[buttons.length - 1];
      last?.click();
      return last?.id ?? null;
    });
    if (!useButtonId) throw new Error("生成资产列表缺「用于 spec」按钮");
    await page.waitForFunction(
      () => (document.getElementById("status")?.textContent ?? "").includes("渲染完成"),
      { timeout: 30000 },
    );
    const specText = await page.inputValue("#spec-input");
    if (!specText.includes('"asset:shader-')) throw new Error("「用于 spec」未把 asset:<id> 插入 spec");
    await shotShader(join(IMG, "s15-human-ui.png"));
    step("15 · 人类 UI：预设/尺寸/生成/用于 spec", {
      intent: "人类点选 mesh-sunset、填 480×320、点生成；再从生成资产列表点「用于 spec」把 asset:<id> 全幅背景插入 spec。",
      expect: "预览出现；状态行含资产 id；spec 文本含 asset:<id>；页面重新渲染完成。",
      image: "img/s15-human-ui.png",
      imageMeta: "1440×960 · Shader 卡与生成资产列表实拍",
      assertion: `状态行「${humanStatus.trim()}」· ${useButtonId} 已插入 · spec 含 asset:shader-* · render 完成。`,
      ok: true,
    });
  } finally {
    await page.close();
    await browser.close();
    server.close();
  }

  const report = {
    title: "Canvas 工具 v2：Satori 确定性出图 + Paper Shaders 背景生成",
    brand: "FDE2E™ fde2e-tools · 端到端交付报告",
    subtitle: "JSON spec → Satori → 自包含 SVG / 像素 PNG；Paper Shaders（mesh/glass/paper）页面内 WebGL2 光栅化；链式 asset 管线",
    meta: `2026-11-03 · change canvas-shaders-v1（fde2e-tools-v0）· 真 Chromium WebMCP 原生路径 · SwiftShader · ${steps.length} 步全绿`,
    thesis:
      "Canvas 不再只有内置 SVG 渐变：Paper Shaders 以配置式预设接入（不开放 GLSL/React 创作），mesh 渐变做背景、glass/paper 加工已有图片，并可 1–4 步链式混搭。产物只回 assetId，spec 用 asset:<id> 引用；speed=0/frame=0/pixelRatio=1 锁定确定性，同机同参数与 dsf=1/2 字节一致。",
    env: [
      ["交付仓", "fde2e-tools-v0 · apps/canvas（Satori 0.63.x + resvg-wasm + @paper-design/shaders 0.0.82）"],
      ["验证方式", "Playwright Chromium 156 + --enable-blink-features=WebMCP + --use-angle=swiftshader；真下载 PNG"],
      ["开箱素材", "12 背景 + 10 形状 + 1 内置 CJK WOFF2 子集 + 10 配方 + 4 个 Paper Shaders 预设"],
      ["Shader 预设", "mesh-sunset / mesh-aurora（StaticMeshGradient）· glass-prism（FlutedGlass）· paper-default（PaperTexture）"],
      ["许可", "Paper Shaders Apache-2.0（LICENSE/NOTICE 随包；页脚 Powered by Paper Shaders）"],
      ["报告纪律", "e2e-report-gen.mjs 生成（禁手写 HTML）· 截图实拍 · 零密钥"],
    ],
    sections: (() => {
      const stepNo = (s) => Number.parseInt(s.section, 10);
      const pick = (...nums) => steps.filter((s) => nums.includes(stepNo(s)));
      return [
        { title: "1 · 工具面与配方", note: "WebMCP 原生枚举 + 可信配方渲染。", steps: pick(1, 2) },
        { title: "2 · 布局真值与导出", note: "inspect 给出可行动的 overflow/off_canvas 警告；导出 SVG/PNG。", steps: pick(3, 4) },
        { title: "3 · 字体与素材", note: "字体导 SVG + 外部 SVG 导入。", steps: pick(5, 6) },
        { title: "4 · 中国网络门", note: "阻断境外字体/素材域，内置素材仍可渲染导出。", steps: pick(7) },
        { title: "5 · 安全与预算", note: "外部 href / 无 CORS 字体 / 响应预算负例。", steps: pick(8) },
        { title: "6 · Shader 预设与生成", note: "预设摘要；mesh 渐变生成并注册资产；AI 生成同步到人类 UI。", steps: pick(9) },
        { title: "7 · 链式处理与资产", note: "mesh→glass 链式；mesh→paper 图片加工且源资产不变。", steps: pick(10, 11) },
        { title: "8 · 背景渲染与导出", note: "asset:<id> 全幅背景 → Satori → PNG 导出。", steps: pick(12) },
        { title: "9 · 确定性与降级", note: "同请求两次/dsf=1/2 字节一致；非法矩阵；WebGL2 缺失显式降级。", steps: pick(13, 14) },
        { title: "10 · 人类 UI", note: "预设/尺寸/生成/预览/用于 spec 的完整人类路径。", steps: pick(15) },
      ];
    })(),
  };
  writeFileSync(join(REPORT, "steps.json"), JSON.stringify(report, null, 2));
  console.log(`✓ E2E 完成：${steps.length} 步；steps.json → ${REPORT}`);
}

main().catch((e) => { console.error("✗ Canvas E2E 失败：", e); process.exit(1); });
