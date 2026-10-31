/*
 * 参数契约冒烟 —— scripts/smoke-check.mjs
 *
 * 验收（openspec change project-bootstrap / legacy-tools-parity +
 * office-suite / real-file-assertion 能力）：
 * 对工具与黄页抽测 URL 参数契约——状态行文案逐字符断言、渲染产物
 * （画布尺寸/结果 URL/解码表）逐值断言。视觉允许升级，行为不允许漂移。
 * 办公三站（easy-xlsx/easy-docx/easy-pptx，轻量快速档）加**真文件反读断言**（硬要求）：headless 里真实
 * 生成文件后——xlsx 用 SheetJS（Node 侧，非页面内）反读核对单元格；
 * docx/pptx 解 zip 核对 document.xml / slide1.xml / notesSlide 关键内容。
 *
 * 用法：pnpm -r build 后 node scripts/smoke-check.mjs
 */
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { rmSync, writeFileSync } from 'node:fs';
import { assertPdfText, pdfPageInkRatio, pdfWordBoxes } from './pdf-assert.mjs';
// 真文件反读：xlsx 用 SheetJS 社区版（根 devDeps，与页面同库但走 Node 侧独立
// 路径反读）；docx/pptx 用 adm-zip 解 zip（MIT）核对 OOXML 关键内容；
// 编辑器三站（office-editorial-upgrade）另用 mammoth（BSD-2，docx 导出桥的
// 非亲缘独立解析器）做 Node 侧回读
const XLSXMOD = await import("xlsx");
const XLSX = XLSXMOD.default ?? XLSXMOD;
const AdmZip = (await import("adm-zip")).default;
const mammoth = (await import("mammoth")).default;

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
  for (const app of ["pdf-tool", "img-tool", "url-tool", "directory", "easy-xlsx", "easy-docx", "easy-pptx", "file-viewer", "xlsx", "docx", "pptx"]) {
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

  /** 真文件生成助手（真文件断言共用）：点生成按钮 → 捕获下载 → 返回字节 */
  async function generateAndCapture(page, buttonId, timeoutMs = 30000) {
    const dlPromise = page.waitForEvent("download", { timeout: timeoutMs });
    await page.click(`#${buttonId}`);
    const download = await dlPromise;
    const suggested = download.suggestedFilename();
    const dlPath = await download.path();
    if (!dlPath) throw new Error("下载产物不可读");
    return { suggested, bytes: readFileSync(dlPath) };
  }

  try {
    // ---------- pdf-tool ----------
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

    // ---------- xlsx（真文件反读断言） ----------
    await check("xlsx ?sample=1：示例工作簿载入 + 预览刷新", async () => {
      await withPage("easy-xlsx", "?sample=1", async (page) => {
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("示例工作簿已载入"), { timeout: 10000 });
        const v = await page.inputValue("#input-json");
        if (!v.includes("报销明细")) throw new Error("示例工作簿未载入");
        const s = await statusText(page);
        const want = "示例工作簿已载入并刷新预览，点「生成 .xlsx 下载」即可。";
        if (s !== want) throw new Error(`状态行不符:\n  got:  ${s}\n  want: ${want}`);
        const previewText = await page.textContent("#preview");
        if (!previewText.includes("餐补")) throw new Error("预览未渲染工作表结构");
      });
    });

    await check("xlsx 空输入点生成：错误文案保真", async () => {
      await withPage("easy-xlsx", "", async (page) => {
        await page.click("#generate-xlsx-btn");
        const s = await statusText(page);
        const want = "输入为空：请先粘贴 JSON、粘贴表格，或点「载入示例」。";
        if (s !== want) throw new Error(`状态行不符: got ${s}`);
      });
    });

    await check("xlsx JSON 生成真文件：SheetJS 反读核对单元格（含负数/小数/布尔/多表）", async () => {
      await withPage("easy-xlsx", "?sample=1", async (page) => {
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("示例工作簿已载入"), { timeout: 10000 });
        const { suggested, bytes } = await generateAndCapture(page, "generate-xlsx-btn");
        if (suggested !== "easy-xlsx-export.xlsx") throw new Error(`下载文件名不符: ${suggested}`);
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("已生成 easy-xlsx-export.xlsx"), { timeout: 15000 });
        const wb = XLSX.read(bytes, { type: "buffer" });
        const wantSheets = JSON.stringify(["报销明细", "汇总"]);
        if (JSON.stringify(wb.SheetNames) !== wantSheets) {
          throw new Error(`工作表名不符: ${wb.SheetNames.join(",")}`);
        }
        const ws1 = wb.Sheets["报销明细"];
        const cell = (ref) => {
          const c = ws1[ref];
          if (!c) throw new Error(`报销明细!${ref} 缺失`);
          return c;
        };
        if (cell("A1").v !== "项目" || cell("B1").v !== "金额" || cell("C1").v !== "备注") {
          throw new Error("表头行不符");
        }
        if (cell("A2").v !== "差旅" || cell("B2").v !== 1280.5 || cell("B2").t !== "n") {
          throw new Error("小数单元格反读不符（B2 应为数字 1280.5）");
        }
        if (cell("B4").v !== -80 || cell("B4").t !== "n") {
          throw new Error("负数单元格反读不符（B4 应为 -80）");
        }
        if (cell("A5").v !== "是否通过" || cell("B5").t !== "b" || cell("B5").v !== true) {
          throw new Error("布尔单元格反读不符（B5 应为布尔 true）");
        }
        const ws2 = wb.Sheets["汇总"];
        if (ws2["B2"].v !== "张三" || ws2["A2"].v !== "报销人") {
          throw new Error("汇总表单元格反读不符");
        }
        console.log(`      反读证据：2 表 · 报销明细 B2=${cell("B2").v}(n) B4=${cell("B4").v}(n) B5=${cell("B5").v}(b) · 汇总 B2=${ws2["B2"].v}`);
      });
    });

    await check("xlsx TSV 粘贴表格路径：## 分表 + 数字转换 + 真文件反读", async () => {
      await withPage("easy-xlsx", "", async (page) => {
        await page.fill("#input-tsv", "## 表A\n名字\t数值\n甲\t3.5\n## 表B\n乙\t-2");
        const { suggested, bytes } = await generateAndCapture(page, "generate-xlsx-btn");
        if (suggested !== "easy-xlsx-export.xlsx") throw new Error(`下载文件名不符: ${suggested}`);
        const wb = XLSX.read(bytes, { type: "buffer" });
        if (JSON.stringify(wb.SheetNames) !== JSON.stringify(["表A", "表B"])) {
          throw new Error(`TSV 分表不符: ${wb.SheetNames.join(",")}`);
        }
        if (wb.Sheets["表A"]["B2"].v !== 3.5 || wb.Sheets["表A"]["B2"].t !== "n") {
          throw new Error("TSV 数字转换反读不符（表A!B2 应为 3.5）");
        }
        if (wb.Sheets["表B"]["B1"].v !== -2) {
          throw new Error("TSV 负数反读不符（表B!B1 应为 -2）");
        }
        console.log(`      反读证据：TSV 2 表 · 表A!B2=${wb.Sheets["表A"]["B2"].v}(n) · 表B!B1=${wb.Sheets["表B"]["B1"].v}(n)`);
      });
    });

    // B1 回归门（对抗审查 2026-10-31）：add_sheet_sample 必须与页面真相源同
    // 语义——TSV-only 场景（JSON 空只粘表格）追加后 TSV 表不得静默丢失，且
    // TSV 表必须出现在生成产物里
    await check("xlsx WebMCP add_sheet_sample：TSV-only 场景表不丢（B1 回归门）", async () => {
      await withPage("easy-xlsx", "", async (page) => {
        await page.waitForFunction(
          () => document.modelContext && document.modelContext.getTools().then((ts) => ts.some((t) => t.name === "add_sheet_sample")),
          { timeout: 10000 },
        );
        await page.fill("#input-tsv", "## 表A\n名字\t数值\n甲\t3.5"); // 只粘 TSV，JSON 留空
        const out = await page.evaluate(async () => {
          const ts = await document.modelContext.getTools();
          const tool = ts.find((t) => t.name === "add_sheet_sample");
          const raw = await document.modelContext.executeTool(tool, { name: "审查表" });
          return JSON.parse(raw);
        });
        if (!out.ok) throw new Error(`add_sheet_sample 失败: ${JSON.stringify(out)}`);
        if (!Array.isArray(out.sheets) || !out.sheets.includes("表A") || !out.sheets.includes("审查表")) {
          throw new Error(`B1：TSV 表静默丢失或未追加（sheets=${JSON.stringify(out.sheets)}）`);
        }
        // 产物断言：生成真文件，TSV 表 + 追加表都必须在产物里且数据保真
        const dlPromise = page.waitForEvent("download", { timeout: 30000 });
        await page.click("#generate-xlsx-btn");
        const download = await dlPromise;
        if (download.suggestedFilename() !== "easy-xlsx-export.xlsx") {
          throw new Error(`下载文件名不符: ${download.suggestedFilename()}`);
        }
        const dlPath = await download.path();
        const wb = XLSX.read(readFileSync(dlPath), { type: "buffer" });
        if (!wb.SheetNames.includes("表A") || !wb.SheetNames.includes("审查表")) {
          throw new Error(`B1：产物缺表（实际 ${wb.SheetNames.join(",")}）`);
        }
        if (wb.Sheets["表A"]["B2"].v !== 3.5 || wb.Sheets["表A"]["B2"].t !== "n") {
          throw new Error("B1：TSV 表数据丢失（表A!B2 应为数字 3.5）");
        }
        console.log(`      反读证据：TSV-only 追加后产物 2 表（${wb.SheetNames.join(" / ")}）· 表A!B2=3.5(n)`);
      });
    });

    // ---------- docx（真文件反读断言） ----------
    await check("docx ?sample=1：示例文档载入 + 预览刷新", async () => {
      await withPage("easy-docx", "?sample=1", async (page) => {
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("示例文档已载入"), { timeout: 10000 });
        const v = await page.inputValue("#input-md");
        if (!v.includes("FDE2E 季度运营报告")) throw new Error("示例文档未载入");
        const previewText = await page.textContent("#preview");
        if (!previewText.includes("续约率")) throw new Error("预览未渲染文档结构");
      });
    });

    await check("docx 空输入点生成：错误文案保真", async () => {
      await withPage("easy-docx", "", async (page) => {
        await page.click("#generate-docx-btn");
        const s = await statusText(page);
        const want = "输入为空：请先输入 Markdown、或点「载入示例」。";
        if (s !== want) throw new Error(`状态行不符: got ${s}`);
      });
    });

    await check("docx 生成真文件：解 zip 核对 document.xml（标题/粗斜标记/表格/命名空间）", async () => {
      await withPage("easy-docx", "?sample=1", async (page) => {
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("示例文档已载入"), { timeout: 10000 });
        const { suggested, bytes } = await generateAndCapture(page, "generate-docx-btn");
        if (suggested !== "easy-docx-export.docx") throw new Error(`下载文件名不符: ${suggested}`);
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("已生成 easy-docx-export.docx"), { timeout: 15000 });
        const zip = new AdmZip(bytes);
        const names = zip.getEntries().map((e) => e.entryName);
        for (const must of ["[Content_Types].xml", "word/document.xml"]) {
          if (!names.includes(must)) throw new Error(`OOXML 结构缺 ${must}（实际 ${names.length} 项）`);
        }
        const doc = zip.readAsText("word/document.xml");
        if (!doc.includes('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/')) {
          throw new Error("wordprocessingml 命名空间缺失");
        }
        const probes = ["FDE2E 季度运营报告", "客户续约率提升至", "完成法务合规评审", "续约率", "<w:b/>", "<w:i/>"];
        const missing = probes.filter((p) => !doc.includes(p));
        if (missing.length) throw new Error(`document.xml 缺关键内容: ${missing.join(", ")}`);
        console.log(`      反读证据：zip ${names.length} 项 · document.xml 含标题/列表/表格文本 + <w:b/>/<w:i/> 标记`);
      });
    });

    // 折叠线回归门（视觉验收追加修复项 2026-10-31）：小视口长预览下点生成，
    // #status 必须滚入视口（shared scrollStatusIntoView 统一模式）
    await check("docx 折叠线回归门：小视口长预览点生成后 #status 在视口内", async () => {
      await withPage("easy-docx", "?sample=1", async (page) => {
        await page.setViewportSize({ width: 1280, height: 640 }); // 小视口复现折叠线场景
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("示例文档已载入"), { timeout: 10000 });
        const dlPromise = page.waitForEvent("download", { timeout: 30000 });
        await page.click("#generate-docx-btn");
        const download = await dlPromise;
        if (download.suggestedFilename() !== "easy-docx-export.docx") {
          throw new Error(`下载文件名不符: ${download.suggestedFilename()}`);
        }
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("已生成"), { timeout: 15000 });
        await page.waitForTimeout(800); // smooth 滚动落定
        const rect = await page.evaluate(() => {
          const r = document.getElementById("status").getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, vh: window.innerHeight };
        });
        if (!(rect.top >= 0 && rect.bottom <= rect.vh)) {
          throw new Error(`状态行仍在视口外: top=${rect.top} bottom=${rect.bottom} vh=${rect.vh}`);
        }
      });
    });

    // ---------- pptx（真文件反读断言） ----------
    await check("pptx ?sample=1：示例幻灯载入 + 预览刷新", async () => {
      await withPage("easy-pptx", "?sample=1", async (page) => {
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("示例幻灯已载入"), { timeout: 10000 });
        const v = await page.inputValue("#input-json");
        if (!v.includes("FDE2E 办公三件套")) throw new Error("示例幻灯未载入");
        const previewText = await page.textContent("#preview");
        if (!previewText.includes("开场页")) throw new Error("预览未渲染页面大纲");
      });
    });

    await check("pptx 空输入点生成：错误文案保真", async () => {
      await withPage("easy-pptx", "", async (page) => {
        await page.click("#generate-pptx-btn");
        const s = await statusText(page);
        const want = "输入为空：请先粘贴 slides JSON、或点「载入示例」。";
        if (s !== want) throw new Error(`状态行不符: got ${s}`);
      });
    });

    await check("pptx 生成真文件：解 zip 核对 slide1.xml/notesSlide（标题/bullets/备注）", async () => {
      await withPage("easy-pptx", "?sample=1", async (page) => {
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("示例幻灯已载入"), { timeout: 10000 });
        const { suggested, bytes } = await generateAndCapture(page, "generate-pptx-btn");
        if (suggested !== "easy-pptx-export.pptx") throw new Error(`下载文件名不符: ${suggested}`);
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("已生成 easy-pptx-export.pptx"), { timeout: 15000 });
        const zip = new AdmZip(bytes);
        const names = zip.getEntries().map((e) => e.entryName);
        for (const must of ["ppt/presentation.xml", "ppt/slides/slide1.xml", "ppt/slides/slide3.xml", "ppt/notesSlides/notesSlide1.xml"]) {
          if (!names.includes(must)) throw new Error(`OOXML 结构缺 ${must}（实际 ${names.length} 项）`);
        }
        const slide1 = zip.readAsText("ppt/slides/slide1.xml");
        if (!slide1.includes("FDE2E 办公三件套")) throw new Error("slide1.xml 缺首页标题");
        if (!slide1.includes("表格生成 · xlsx 站")) throw new Error("slide1.xml 缺 bullet 文本");
        const notes1 = zip.readAsText("ppt/notesSlides/notesSlide1.xml");
        if (!notes1.includes("开场页")) throw new Error("notesSlide1.xml 缺备注文本");
        const slide3 = zip.readAsText("ppt/slides/slide3.xml");
        if (!slide3.includes("谢谢观看")) throw new Error("slide3.xml 缺第三页标题");
        console.log(`      反读证据：zip ${names.length} 项 · slide1 标题+bullet · notesSlide1 备注 · slide3 标题`);
      });
    });

    // ---------- 编辑器三站（office-editorial-upgrade：编辑器路径真文件反读） ----------
    /** 编辑器站工具调用助手：getTools → executeTool（JSON.parse 归一） */
    async function editorCall(page, fn) {
      return await page.evaluate(async (fnSrc) => {
        const call = async (name, input) => {
          const ts = await document.modelContext.getTools();
          const tool = ts.find((t) => t.name === name);
          if (!tool) throw new Error(`工具未注册: ${name}`);
          const raw = await document.modelContext.executeTool(tool, input);
          return JSON.parse(raw);
        };
        return eval("(" + fnSrc + ")")(call);
      }, fn);
    }

    await check("xlsx 编辑器全链：WebMCP 写入→get_snapshot 核验→导出→SheetJS 反读（值/数字/公式 f+计算值 v）", async () => {
      await withPage("xlsx", "?sample=1", async (page) => {
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("编辑器就绪"), { timeout: 90000 });
        const write = await editorCall(page, `async (call) => {
          const r1 = await call("set_cells", { startRow: 8, startCol: 0, values: [["绿门探针", 42.5]] });
          const r2 = await call("set_formula", { range: "B10", formula: "=B9*2" });
          // F11（v2）：A1 锚主推形态——start:"A11"（=0 基 [10,0]）与数字形态等价；
          // start 返回值带 A1 起点自证
          const ra1 = await call("set_cells", { start: "A11", values: [["A1锚探针", 7.75]] });
          // 同传互斥：start × startRow 必须报「只能用一个」；非法 A1 人话报错不 reject
          const conflict = await call("set_cells", { start: "A20", startRow: 19, values: [["不应生效"]] });
          const badA1 = await call("set_cells", { start: "!!", values: [["不应生效"]] });
          // format_range 六键断言（对抗审查 B1 追加 2026-10-31）：全部样式键各执行一次验
          // ok:true——堵「断言面零覆盖」洞（setFontStyle/setNumberFormat/setBorder 经 Enum）
          const fmt = {};
          for (const [key, styles] of [
            ["bold", { bold: true }],
            ["italic", { italic: true }],
            ["color", { color: "#1a73e8" }],
            ["numfmt", { numfmt: "$#,##0.00" }],
            ["bg", { bg: "#fef7e0" }],
            ["border", { border: "all" }],
            ["align", { align: "center" }],
          ]) {
            const r = await call("format_range", { range: "A9:D10", styles });
            fmt[key] = r.ok === true && Array.isArray(r.applied) && r.applied.includes(key);
          }
          const snap = await call("get_snapshot", {});
          const sheet = snap.sheets.find((s) => s.name === "房源价格表");
          return { r1ok: r1.ok, ra1ok: ra1.ok, ra1start: ra1.start, r2ok: r2.ok, r2value: r2.value, fmt,
            conflictOk: conflict.ok, conflictErr: String(conflict.error ?? ""), badA1Ok: badA1.ok,
            a9: sheet.cellData[8]?.[0]?.v, b9: sheet.cellData[8]?.[1]?.v, b10: sheet.cellData[9]?.[1],
            a11: sheet.cellData[10]?.[0]?.v, b11: sheet.cellData[10]?.[1]?.v };
        }`);
        if (!write.r1ok || !write.r2ok) throw new Error(`写入工具未成功: ${JSON.stringify(write)}`);
        // F11 断言：A1 锚产物等价（A11 落格）＋ start 自证 ＋ 同传报错＋非法 A1 转 ok:false
        if (!write.ra1ok) throw new Error(`F11 A1 锚写入未成功: ${JSON.stringify(write)}`);
        if (write.ra1start !== "A11") throw new Error(`F11 start 自证不符: ${JSON.stringify(write.ra1start)}`);
        if (write.conflictOk !== false || !write.conflictErr.includes("只能用一个")) {
          throw new Error(`F11 start×startRow 同传未互斥报错: ${JSON.stringify(write.conflictErr)}`);
        }
        if (write.badA1Ok !== false) throw new Error("F11 非法 A1 未转 ok:false");
        if (write.a11 !== "A1锚探针" || write.b11 !== 7.75) throw new Error(`F11 A1 锚落位不符: a11=${write.a11} b11=${write.b11}（A1 形态应与 startRow/startCol 等价）`);
        const fmtMissing = Object.entries(write.fmt ?? {}).filter(([, v]) => v !== true).map(([k]) => k);
        if (fmtMissing.length) throw new Error(`format_range 六键断言未全过（未命中键: ${fmtMissing.join(",")}）——B1 修复面失守`);
        if (write.a9 !== "绿门探针" || write.b9 !== 42.5) throw new Error(`get_snapshot 核验不符: a9=${write.a9} b9=${write.b9}`);
        if (write.b10?.f !== "=B9*2" || write.b10?.v !== 85) throw new Error(`公式核验不符: ${JSON.stringify(write.b10)}（引擎真算应 85）`);
        const dlPromise = page.waitForEvent("download", { timeout: 30000 });
        const exp = await editorCall(page, `async (call) => call("export_xlsx", {})`);
        const download = await dlPromise;
        if (download.suggestedFilename() !== "xlsx-export.xlsx") throw new Error(`下载文件名契约不符: ${download.suggestedFilename()}`);
        if (!exp.ok) throw new Error(`export_xlsx 未成功: ${JSON.stringify(exp)}`);
        const bytes = readFileSync(await download.path());
        const wb = XLSX.read(bytes, { type: "buffer" });
        const ws = wb.Sheets["房源价格表"];
        if (!ws) throw new Error(`反读缺房源价格表（实际 ${wb.SheetNames.join(",")}）`);
        if (ws["A9"]?.v !== "绿门探针") throw new Error(`A9 反读不符: ${ws["A9"]?.v}`);
        if (ws["B9"]?.v !== 42.5 || ws["B9"]?.t !== "n") throw new Error(`B9 反读不符（应数字 42.5）: ${ws["B9"]?.v}`);
        if (ws["B10"]?.f !== "B9*2") throw new Error(`B10 公式反读不符: ${ws["B10"]?.f}`);
        if (ws["B10"]?.v !== 85) throw new Error(`B10 计算值反读不符（应 85）: ${ws["B10"]?.v}`);
        if (ws["A11"]?.v !== "A1锚探针") throw new Error(`F11 A11 反读不符: ${ws["A11"]?.v}`);
        if (ws["B11"]?.v !== 7.75) throw new Error(`F11 B11 反读不符（应 7.75）: ${ws["B11"]?.v}`);
        console.log(`      反读证据：A9=绿门探针 · B9=42.5(n) · B10 f=${ws["B10"].f} v=${ws["B10"].v} · format_range 七键断言全过（bold/italic/color/numfmt/bg/border/align）· F11 start:"A11"≡startRow/startCol（A11/B11 落格等价，同传报错＋非法 A1 人话拒绝）`);
      });
    });

    // Univer 双坑回归（openspec: univer-write-gate）——坑①幽灵工作簿：注入简化
    // seed（sheet 缺 id/数组形态即中招，本地 1.3.1 矩阵实证）创建的工作簿静默
    // 拒绝一切写入，写工具必须 ok:false（含幽灵判定）；恢复工厂 seed 后 ok:true
    await check("xlsx 编辑器双坑回归①：幽灵工作簿注入→set_cells 必须 ok:false→恢复后 ok:true", async () => {
      await withPage("xlsx", "?sample=1", async (page) => {
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("编辑器就绪"), { timeout: 90000 });
        const out = await page.evaluate(async () => {
          const ts = await document.modelContext.getTools();
          const call = async (name, input) => {
            const tool = ts.find((t) => t.name === name);
            return JSON.parse(await document.modelContext.executeTool(tool, input));
          };
          await window.__officeTest.injectGhostWorkbook();
          const onGhost = await call("set_cells", { values: [["x"]] });
          const restored = await window.__officeTest.restoreMainWorkbook();
          const after = await call("set_cells", { values: [["恢复探针"]] });
          return { onGhostOk: onGhost.ok, onGhostErr: String(onGhost.error ?? ""), restored, afterOk: after.ok };
        });
        if (out.onGhostOk !== false) throw new Error(`幽灵工作簿写入未被拒绝（ok=${out.onGhostOk}）——坑①防御失效`);
        if (!out.onGhostErr.includes("幽灵工作簿")) throw new Error(`幽灵错误文案不符: ${out.onGhostErr.slice(0, 80)}`);
        if (out.restored !== true) throw new Error("恢复健康工作簿失败");
        if (out.afterOk !== true) throw new Error("恢复后写入仍被拒绝");
        console.log("      证据：幽灵注入后 ok=false（含幽灵判定）→ 恢复后 ok=true");
      });
    });

    // 坑②Rendered 门禁：生命周期挂起时写命令必须显式 ok:false（禁静默失败），
    // 释放后 ok:true 且写入落格
    await check("xlsx 编辑器双坑回归②：Rendered 门禁挂起→set_cells 必须 ok:false→释放后 ok:true", async () => {
      await withPage("xlsx", "?sample=1", async (page) => {
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("编辑器就绪"), { timeout: 90000 });
        const out = await page.evaluate(async () => {
          const ts = await document.modelContext.getTools();
          const call = async (name, input) => {
            const tool = ts.find((t) => t.name === name);
            return JSON.parse(await document.modelContext.executeTool(tool, input));
          };
          window.__officeTest.forcePending(true);
          const blocked = await call("set_cells", { values: [["x"]] });
          window.__officeTest.forcePending(false);
          const released = await call("set_cells", { values: [["门禁释放探针"]] });
          const snap = await call("get_snapshot", {});
          const sheet = snap.sheets.find((s) => s.name === "房源价格表");
          const landed = JSON.stringify(sheet?.cellData ?? {}).includes("门禁释放探针");
          return { blockedOk: blocked.ok, blockedErr: String(blocked.error ?? ""), releasedOk: released.ok, landed };
        });
        if (out.blockedOk !== false) throw new Error(`门禁挂起时写入未被拒绝（ok=${out.blockedOk}）——坑②防御失效`);
        if (!/渲染|就绪/.test(out.blockedErr)) throw new Error(`门禁错误文案不符: ${out.blockedErr.slice(0, 80)}`);
        if (out.releasedOk !== true) throw new Error("门禁释放后写入仍被拒绝");
        if (!out.landed) throw new Error("释放后写入未落快照");
        console.log("      证据：挂起 ok=false（含未渲染判定）→ 释放 ok=true 且写入落快照");
      });
    });

    await check("docx 编辑器全链：set_content/insert_heading/insert_table→状态核验→导出→解 zip 核对 document.xml＋mammoth 独立回读", async () => {
      await withPage("docx", "", async (page) => {
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("编辑器就绪"), { timeout: 30000 });
        const write = await editorCall(page, `async (call) => {
          const r1 = await call("set_content", { content: "# 探针文档标题\\n\\n正文带**粗体**与*斜体*。", format: "markdown" });
          const r2 = await call("insert_heading", { text: "追加二级标题", level: 2 });
          const r3 = await call("insert_table", { rows: 2, cols: 2, header: true, data: ["指标", "值", "营收", "1.2 亿"] });
          const text = window.__officeTest.text();
          return { r1ok: r1.ok, r2ok: r2.ok, r3ok: r3.ok, hasProbe: text.includes("探针文档标题") && text.includes("追加二级标题") && text.includes("营收") && text.includes("1.2 亿") };
        }`);
        if (!write.r1ok || !write.r2ok || !write.r3ok) throw new Error(`写入工具未成功: ${JSON.stringify(write)}`);
        if (!write.hasProbe) throw new Error(`编辑器状态核验不符（文本未含写入探针）`);
        const dlPromise = page.waitForEvent("download", { timeout: 30000 });
        const exp = await editorCall(page, `async (call) => call("export_docx", {})`);
        const download = await dlPromise;
        if (download.suggestedFilename() !== "docx-export.docx") throw new Error(`下载文件名契约不符: ${download.suggestedFilename()}`);
        if (!exp.ok) throw new Error(`export_docx 未成功: ${JSON.stringify(exp)}`);
        const bytes = readFileSync(await download.path());
        const zip = new AdmZip(bytes);
        const names = zip.getEntries().map((e) => e.entryName);
        for (const must of ["[Content_Types].xml", "word/document.xml"]) {
          if (!names.includes(must)) throw new Error(`OOXML 结构缺 ${must}（实际 ${names.length} 项）`);
        }
        const doc = zip.readAsText("word/document.xml");
        if (!doc.includes('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/')) throw new Error("wordprocessingml 命名空间缺失");
        const probes = ["探针文档标题", "追加二级标题", "粗体", "斜体", "营收", "1.2 亿", "<w:b/>", "<w:i/>"];
        const missing = probes.filter((p) => !doc.includes(p));
        if (missing.length) throw new Error(`document.xml 缺关键内容: ${missing.join(", ")}`);
        if (!/w:val="Heading2"/.test(doc)) throw new Error("Heading2 样式缺失（insert_heading 未映射标题层级）");
        // mammoth 独立回读（与导出桥非亲缘的解析路径）
        const { value: html } = await mammoth.convertToHtml({ buffer: bytes });
        for (const probe of ["探针文档标题", "追加二级标题", "营收"]) {
          if (!html.includes(probe)) throw new Error(`mammoth 回读缺: ${probe}`);
        }
        console.log(`      反读证据：zip ${names.length} 项 · document.xml 含标题/Heading2/<w:b/>/<w:i/>/表格 · mammoth 回读全命中`);
      });
    });

    await check("pptx 编辑器全链：add_slide/set_title/add_bullets→deck 核验→导出→解 zip 核对 slideN.xml", async () => {
      await withPage("pptx", "?sample=1", async (page) => {
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("编辑器就绪"), { timeout: 120000 });
        const write = await editorCall(page, `async (call) => {
          const r1 = await call("add_slide", { layout: "bullets", title: "绿门探针页", bullets: ["要点甲：绿门", "要点乙：导出"] });
          const idx = r1.index;
          // F6（v1.2 C 批）：add_slide 增返 slideCount（与 import/export 同名；total 保留）
          if (typeof r1.slideCount !== "number" || r1.slideCount !== r1.total) {
            throw new Error("F6: add_slide slideCount 缺失或≠total: " + JSON.stringify({ slideCount: r1.slideCount, total: r1.total }));
          }
          // D2 双形态（v2）：page=4（1 基，命中第 4 页＝探针页）≡ slideIndex=3（0 基别名）
          const rp = await call("set_title", { page: idx + 1, text: "绿门探针页（page 形态核验）" });
          const r2 = await call("set_title", { slideIndex: idx, text: "绿门探针页（核验改名）" });
          const r3 = await call("add_bullets", { slideIndex: idx, items: ["追加要点丙"] });
          // page 形态返回自证：page=1 基、index/slideIndex=0 基同值
          if (rp.page !== idx + 1 || rp.slideIndex !== idx) throw new Error("D2: set_title(page) 返回页码自证不符: " + JSON.stringify(rp));
          // 同传报错：page×slideIndex 同传必须 ok:false
          const conflict = await call("set_title", { page: 1, slideIndex: 0, text: "不应生效" });
          const deck = window.__officeTest.deck();
          return { r1ok: r1.ok, rpok: rp.ok, r2ok: r2.ok, r3ok: r3.ok, conflictOk: conflict.ok, conflictErr: String(conflict.error ?? ""), idx, total: deck.total, firstTitle: deck.slides[0]?.texts ?? [], targetTexts: JSON.stringify(deck.slides[idx]?.texts ?? []) };
        }`);
        if (!write.r1ok || !write.r2ok || !write.r3ok) throw new Error(`写入工具未成功: ${JSON.stringify(write)}`);
        if (write.conflictOk !== false || !write.conflictErr.includes("只能用一个")) {
          throw new Error(`D2 page×slideIndex 同传未互斥报错: ${JSON.stringify(write.conflictErr)}`);
        }
        if (write.total !== 4) throw new Error(`deck 页数不符: ${write.total}（期望 4＝三页示例＋探针页）`);
        if (JSON.stringify(write.firstTitle).includes("不应生效")) throw new Error("D2: 同传冲突仍生效（静默取舍回归）");
        const joined = write.targetTexts;
        if (!joined.includes("绿门探针页（核验改名）") || !joined.includes("追加要点丙")) {
          throw new Error(`deck 核验不符: ${joined.slice(0, 120)}`);
        }
        const dlPromise = page.waitForEvent("download", { timeout: 90000 });
        const exp = await editorCall(page, `async (call) => call("export_pptx", {})`);
        const download = await dlPromise;
        if (download.suggestedFilename() !== "pptx-export.pptx") throw new Error(`下载文件名契约不符: ${download.suggestedFilename()}`);
        if (!exp.ok) throw new Error(`export_pptx 未成功: ${JSON.stringify(exp)}`);
        const bytes = readFileSync(await download.path());
        const zip = new AdmZip(bytes);
        const names = zip.getEntries().map((e) => e.entryName);
        for (const must of ["ppt/presentation.xml"]) {
          if (!names.includes(must)) throw new Error(`OOXML 结构缺 ${must}（实际 ${names.length} 项）`);
        }
        // 探针页序号随示例页数变化（示例 3 页 → 新页 index=3？按工具返回 index 定位）
        const slideEntry = `ppt/slides/slide${Number(write.idx) + 1}.xml`;
        const slideXml = zip.readAsText(slideEntry);
        for (const probe of ["绿门探针页（核验改名）", "要点甲：绿门", "追加要点丙"]) {
          if (!slideXml.includes(probe)) throw new Error(`${slideEntry} 缺写入内容: ${probe}`);
        }
        console.log(`      反读证据：zip ${names.length} 项 · ${slideEntry} 含改名标题/要点/追加要点 · D2 page≡slideIndex 双形态（同传报只能用一个）· F6 slideCount=${write.total}`);
      });
    });

    // ---------- 展示级导出（export-pdf-png）----------
    /** PNG 头断言 */
    function assertPngHead(bytes, label) {
      const head = bytes.subarray(0, 8).toString("latin1");
      if (!head.startsWith("\x89PNG\r\n\x1a\n")) throw new Error(`${label} 产物非 PNG（头: ${head.slice(0, 8)}）`);
    }
    /** PDF 头＋页数断言（/Type /Page 计数） */
    function assertPdfHead(bytes, label, minPages = 1) {
      const head = bytes.subarray(0, 5).toString("latin1");
      if (!head.startsWith("%PDF")) throw new Error(`${label} 产物非 PDF（头: ${head}）`);
      const pages = (bytes.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
      if (pages < minPages) throw new Error(`${label} 页数不符: ${pages} < ${minPages}`);
      return pages;
    }
    /** PNG 像素非平凡断言（空图证伪）：字节回灌页面解码后统计非白像素占比 */
    async function assertPngContentful(page, bytes, label) {
      const b64 = bytes.toString("base64");
      const r = await page.evaluate(async (b64) => {
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("PNG 解码失败")); img.src = "data:image/png;base64," + b64; });
        const c = document.createElement("canvas");
        const k = Math.min(1, 900 / img.width);
        c.width = Math.max(1, Math.round(img.width * k));
        c.height = Math.max(1, Math.round(img.height * k));
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let nw = 0, n = 0;
        for (let i = 0; i < d.length; i += 16) { n++; if (d[i] < 250 || d[i + 1] < 250 || d[i + 2] < 250) nw++; }
        return { ratio: nw / n, w: img.width, h: img.height };
      }, b64);
      if (!(r.ratio > 0.01)) throw new Error(`${label} 空图证伪失败：非白像素占比 ${(r.ratio * 100).toFixed(2)}%（疑似空白产物）`);
      return r;
    }

    await check("xlsx 展示级导出：export_pdf（%PDF）＋export_png（空图证伪：像素解码非平凡）", async () => {
      await withPage("xlsx", "?sample=1", async (page) => {
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("示例工作簿已载入"), { timeout: 90000 });
        // 写入探针内容（长图数据面非平凡）
        const w = await editorCall(page, `async (call) => call("set_cells", { values: [["产品", "数量"], ["Widget", 3], ["Gadget", 5], ["合计", { f: "=SUM(B2:B3)" }]] })`);
        if (!w.ok) throw new Error(`set_cells 未成功: ${JSON.stringify(w)}`);
        let dl = page.waitForEvent("download", { timeout: 90000 });
        await page.click("#export-pdf-btn");
        const pdfDl = await dl;
        if (pdfDl.suggestedFilename() !== "xlsx-export.pdf") throw new Error(`PDF 文件名契约不符: ${pdfDl.suggestedFilename()}`);
        const pdfBytes = readFileSync(await pdfDl.path());
        const pages = assertPdfHead(pdfBytes, "xlsx export_pdf");
        // v2 硬门：文本层非空＋中文在场＋关键词＋无编辑器 UI 特征词（P0-1/P0-2 回归）
        assertPdfText(pdfBytes, "xlsx export_pdf", {
          requireChinese: true,
          keywords: ["青旅", "周营收"],
          forbidden: ["Start", "Formulas", "Arial", "Univer", "sample"],
        });
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("已生成"), { timeout: 20000 });
        dl = page.waitForEvent("download", { timeout: 90000 });
        await page.click("#export-png-btn");
        const pngDl = await dl;
        if (pngDl.suggestedFilename() !== "xlsx-long.png") throw new Error(`PNG 文件名契约不符: ${pngDl.suggestedFilename()}`);
        const pngBytes = readFileSync(await pngDl.path());
        assertPngHead(pngBytes, "xlsx export_png");
        const px = await assertPngContentful(page, pngBytes, "xlsx export_png");
        console.log(`      反读证据：PDF ${pages} 页（%PDF 头＋文本层含「青旅」）· PNG ${px.w}×${px.h} 非白像素 ${(px.ratio * 100).toFixed(1)}%（内容非空）`);
      });
    });

    await check("docx 展示级导出：export_pdf（%PDF）＋export_png（高>宽长图）", async () => {
      await withPage("docx", "?sample=1", async (page) => {
        // 等 ?sample= 重置完全落定再写长文（写完就被 sample 重置覆盖＝长图竞态，
        // 首跑实证 1720×1672 即 sample 高度）
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("示例文档已载入"), { timeout: 30000 });
        // 先写入长文档（>一屏，保证长图高>宽）
        const w = await editorCall(page, `async (call) => call("set_content", { content: ${JSON.stringify(
          Array.from({ length: 24 }, (_, i) => `## 第 ${i + 1} 节\n\n这是展示级导出长度探针的第 ${i + 1} 段正文，用来把文档撑过一屏高度（**粗体**与*斜体*混排）。`).join("\n\n"),
        )}, format: "markdown" })`);
        if (!w.ok) throw new Error(`set_content 未成功: ${JSON.stringify(w)}`);
        let dl = page.waitForEvent("download", { timeout: 90000 });
        await page.click("#export-pdf-btn");
        const pdfDl = await dl;
        if (pdfDl.suggestedFilename() !== "docx-export.pdf") throw new Error(`PDF 文件名契约不符: ${pdfDl.suggestedFilename()}`);
        const docxBytes = readFileSync(await pdfDl.path());
        const pages = assertPdfHead(docxBytes, "docx export_pdf");
        // v2 硬门：文本层非空＋中文关键词（P0-2 回归）
        assertPdfText(docxBytes, "docx export_pdf", {
          requireChinese: true,
          keywords: ["第1节", "展示级导出长度探针"],
        });
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("已生成"), { timeout: 30000 });
        dl = page.waitForEvent("download", { timeout: 90000 });
        await page.click("#export-png-btn");
        const pngDl = await dl;
        if (pngDl.suggestedFilename() !== "docx-long.png") throw new Error(`PNG 文件名契约不符: ${pngDl.suggestedFilename()}`);
        const pngBytes = readFileSync(await pngDl.path());
        assertPngHead(pngBytes, "docx export_png");
        const w2 = pngBytes.readUInt32BE(16), h2 = pngBytes.readUInt32BE(20);
        if (!(h2 > w2)) throw new Error(`长图纵横比不符: ${w2}×${h2}（应高>宽——长文档撑屏）`);
        console.log(`      反读证据：PDF ${pages} 页（%PDF 头＋文本层含「第 1 节」）· PNG ${w2}×${h2}（高>宽 ✓）`);
      });
    });

    await check("pptx 展示级导出：export_pdf（%PDF 页数=页数）＋export_png（逐页文件）＋export_long_png（高>宽）", async () => {
      await withPage("pptx", "?sample=1", async (page) => {
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("示例演示已载入"), { timeout: 120000 });
        let dl = page.waitForEvent("download", { timeout: 90000 });
        await page.click("#export-pdf-btn");
        const pdfDl = await dl;
        if (pdfDl.suggestedFilename() !== "pptx-export.pdf") throw new Error(`PDF 文件名契约不符: ${pdfDl.suggestedFilename()}`);
        const pptxBytes = readFileSync(await pdfDl.path());
        const pages = assertPdfHead(pptxBytes, "pptx export_pdf", 2);
        // v2 硬门：文本层非空＋中文关键词（P0-2）＋每页版面利用率 ≥3%（P0-3 空洞回归）
        assertPdfText(pptxBytes, "pptx export_pdf", {
          requireChinese: true,
          keywords: ["青旅门店周会汇报", "入住间夜"],
        });
        for (let p = 1; p <= pages; p++) {
          const ink = await pdfPageInkRatio(page, pptxBytes, "pptx export_pdf", p);
          if (ink.ratio < 0.03) {
            throw new Error(`pptx export_pdf 第 ${p} 页版面利用率不足：非白像素 ${(ink.ratio * 100).toFixed(2)}% < 3%（空洞版式回归）`);
          }
        }
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("已生成"), { timeout: 30000 });
        // 逐页 PNG（2 页示例 → 2 个 download；page.on 数组收集——waitForEvent
        // 双挂会把两个 promise 都解析到第一个事件上，首跑实证双双报 page-01）
        const downloads = [];
        page.on("download", (d) => downloads.push(d));
        await page.click("#export-png-btn");
        for (let i = 0; i < 60 && downloads.length < 2; i++) await page.waitForTimeout(500);
        const names = downloads.map((d) => d.suggestedFilename());
        if (!names.includes("pptx-page-01.png") || !names.includes("pptx-page-02.png")) {
          throw new Error(`逐页文件名契约不符: ${names.join(",")}`);
        }
        assertPngHead(readFileSync(await downloads[0].path()), "pptx export_png#1");
        if (downloads[1]) assertPngHead(readFileSync(await downloads[1].path()), "pptx export_png#2");
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("已生成"), { timeout: 30000 });
        dl = page.waitForEvent("download", { timeout: 90000 });
        await page.click("#export-long-png-btn");
        const longDl = await dl;
        if (longDl.suggestedFilename() !== "pptx-long.png") throw new Error(`长图文件名契约不符: ${longDl.suggestedFilename()}`);
        const longBytes = readFileSync(await longDl.path());
        assertPngHead(longBytes, "pptx export_long_png");
        const lw = longBytes.readUInt32BE(16), lh = longBytes.readUInt32BE(20);
        if (!(lh > lw)) throw new Error(`长图纵横比不符: ${lw}×${lh}（应高>宽）`);
        console.log(`      反读证据：PDF ${pages} 页（=幻灯页数，文本层含「青旅门店周会汇报」，每页非白 ≥3%）· 逐页 ${names.join("/")}（PNG 头）· 长图 ${lw}×${lh}（高>宽 ✓）`);
      });
    });

    // ---------- 选择性导出（openspec: selective-export）----------
    /** 工具级导出助手：executeTool（带 input）＋真下载捕获（产物落定后才返回） */
    async function selectiveExport(page, tool, input) {
      const dlPromise = page.waitForEvent("download", { timeout: 90000 });
      const out = await editorCall(page, `async (call) => call(${JSON.stringify(tool)}, ${JSON.stringify(input)})`);
      const download = await dlPromise;
      if (!out.ok) throw new Error(`${tool} 未成功: ${JSON.stringify(out)}`);
      const dlPath = await download.path();
      if (!dlPath) throw new Error("下载产物不可读");
      return { out, suggested: download.suggestedFilename(), bytes: readFileSync(dlPath) };
    }

    await check("编辑器选择性导出：pptx pages=[2]（单页＋内容）＋xlsx sheets 单表＋docx section 单节＋越界/缺节人话报错", async () => {
      // pptx：pages=[2] → pptx-export-p2.pdf，1 页，含第 2 页特征文本、不含第 3 页；越界报错
      await withPage("pptx", "?sample=1", async (page) => {
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("示例演示已载入"), { timeout: 120000 });
        const r = await selectiveExport(page, "export_pdf", { pages: [2] });
        if (r.suggested !== "pptx-export-p2.pdf") throw new Error(`文件名契约不符: ${r.suggested}`);
        const pages = assertPdfHead(r.bytes, "pptx pages=[2]");
        if (pages !== 1) throw new Error(`选择 [2] 页数应为 1，实为 ${pages}`);
        assertPdfText(r.bytes, "pptx pages=[2]", { requireChinese: true, keywords: ["本周经营数据"], forbidden: ["下周行动计划"] });
        if (r.out.selected?.[0] !== 2) throw new Error(`selected 不符: ${JSON.stringify(r.out.selected)}`);
        const bad = await editorCall(page, `async (call) => call("export_pdf", { pages: [9] })`);
        if (bad.ok !== false || !String(bad.error ?? "").includes("越界")) throw new Error(`越界页码未人话报错: ${JSON.stringify(bad)}`);
        console.log("      反读证据：pptx-export-p2.pdf 1 页（含「本周经营数据」不含「下周行动计划」）· selected=[2] · 越界 [9] 报「越界」");
      });
      // xlsx：sheets=["周营收"] → 只含该表；文件名带表名 tag
      await withPage("xlsx", "?sample=1", async (page) => {
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("示例工作簿已载入"), { timeout: 90000 });
        const r = await selectiveExport(page, "export_pdf", { sheets: ["周营收"] });
        if (r.suggested !== "xlsx-export-周营收.pdf") throw new Error(`文件名契约不符: ${r.suggested}`);
        assertPdfText(r.bytes, "xlsx sheets=[周营收]", { requireChinese: true, keywords: ["入住间夜"], forbidden: ["房源价格表", "加床费"] });
        if (r.out.selected?.[0] !== "周营收") throw new Error(`selected 不符: ${JSON.stringify(r.out.selected)}`);
        const bad = await editorCall(page, `async (call) => call("export_pdf", { sheets: ["不存在的表"] })`);
        if (bad.ok !== false || !String(bad.error ?? "").includes("可用表")) throw new Error(`缺表未人话报错: ${JSON.stringify(bad)}`);
        console.log("      反读证据：xlsx-export-周营收.pdf（含「入住间夜」不含「房源价格表」）· selected=[周营收] · 缺表报「可用表」");
      });
      // docx：section 单节 → 含该节不含后续节；缺节列出可用标题（F9：选择导出
      // 文件名带节名 tag——docx-export-<节名>.pdf，与 xlsx-export-表1 同款规则）
      await withPage("docx", "?sample=1", async (page) => {
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("示例文档已载入"), { timeout: 30000 });
        // F17：全量导出 selected=null（v1.2 规范——废除「整篇」哨兵）
        const full = await editorCall(page, `async (call) => call("export_pdf", {})`);
        if (!full.ok || full.selected !== null) {
          throw new Error(`F17 全量导出 selected 应为 null: ${JSON.stringify(full.selected)}`);
        }
        console.log("      反读证据：F17 全量导出 selected=null（无「整篇」哨兵）");
        const r = await selectiveExport(page, "export_pdf", { section: "二、本周问题与处理" });
        if (r.suggested !== "docx-export-二、本周问题与处理.pdf") throw new Error(`文件名契约不符: ${r.suggested}`);
        assertPdfText(r.bytes, "docx section", { requireChinese: true, keywords: ["本周问题与处理", "热水压力不足"], forbidden: ["下周重点", "淡季长住套餐"] });
        if (r.out.selected?.[0] !== "二、本周问题与处理") throw new Error(`selected 不符: ${JSON.stringify(r.out.selected)}`);
        const bad = await editorCall(page, `async (call) => call("export_pdf", { section: "不存在的节" })`);
        if (bad.ok !== false || !String(bad.error ?? "").includes("可用标题")) throw new Error(`缺节未人话报错: ${JSON.stringify(bad)}`);
        // F4：items 多节选择（section 单值的断层修复）——两节拼接，顺序按 items
        const multi = await selectiveExport(page, "export_pdf", { items: [{ section: "一、经营概况" }, { section: "三、下周重点" }] });
        if (multi.suggested !== "docx-export-一、经营概况-三、下周重点.pdf") throw new Error(`items 多节文件名契约不符: ${multi.suggested}`);
        assertPdfText(multi.bytes, "docx items 多节", { requireChinese: true, keywords: ["经营概况", "下周重点"], forbidden: ["热水压力不足"] });
        if (multi.out.selected?.[0]?.section !== "一、经营概况" || multi.out.selected?.[1]?.section !== "三、下周重点") {
          throw new Error(`items 多节 selected 不符: ${JSON.stringify(multi.out.selected)}`);
        }
        // F4：items 与 section 同传＝冲突显式报错（禁静默取舍）
        const conflict = await editorCall(page, `async (call) => call("export_pdf", { items: [{ section: "一、经营概况" }], section: "三、下周重点" })`);
        if (conflict.ok !== false || !String(conflict.error ?? "").includes("只能用一个")) throw new Error(`items×section 未互斥报错: ${JSON.stringify(conflict)}`);
        console.log("      反读证据：docx-export-二、本周问题与处理.pdf 单节（含「热水压力不足」不含「下周重点」）· items 两节拼接（缺节报「可用标题」）· items×section 互斥报错");
      });
    });

    // ---------- xlsx 导出能力三层（G1 items 区域 / G2 寻址加固 / G3 trim 契约）----------
    /** 构造「外部重名表 xlsx」夹具（手工 OOXML zip——book_append_sheet 对重名
     * throw，正是外部构造文件绕过 Excel UI 限制的威胁模型；两表数据各异） */
    function buildDupNameXlsxBase64() {
      const CT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;
      const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
      const WB = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>
<sheet name="周报" sheetId="1" r:id="rId1"/>
<sheet name="周报" sheetId="2" r:id="rId2"/>
</sheets>
</workbook>`;
      const WBRELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>`;
      const sheetXml = (txt, num) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${txt}</t></is></c><c r="B1"><v>${num}</v></c></row></sheetData>
</worksheet>`;
      const zip = new AdmZip();
      zip.addFile("[Content_Types].xml", Buffer.from(CT));
      zip.addFile("_rels/.rels", Buffer.from(RELS));
      zip.addFile("xl/workbook.xml", Buffer.from(WB));
      zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(WBRELS));
      zip.addFile("xl/worksheets/sheet1.xml", Buffer.from(sheetXml("探针甲", 111)));
      zip.addFile("xl/worksheets/sheet2.xml", Buffer.from(sheetXml("探针乙", 222)));
      return zip.toBuffer().toString("base64");
    }

    await check("xlsx G3①＋区域收敛：尾部空区不进产物（页数=usedRange 版式）＋range 超界按内容收敛（文件名即证据）", async () => {
      await withPage("xlsx", "?sample=1", async (page) => {
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("示例工作簿已载入"), { timeout: 90000 });
        // 裁剪探针表：A1:D6 有内容 ＋ 远端 canary 壳键（行 59 / 行 3 列 N）——
        // 壳键若进 usedRange，59 行 × 13 列必溢出到第 2 页（产物页数即判别器）
        const w = await editorCall(page, `async (call) => {
          const mk = await call("add_sheet", { name: "裁剪探针" });
          const put = await call("set_cells", { sheet: "裁剪探针", values: [
            ["裁剪头A", "裁剪头B", "裁剪头C", "裁剪头D"],
            ["R1", 1, 2, 3], ["R2", 4, 5, 6], ["R3", 7, 8, 9], ["R4", 10, 11, 12], ["R5", 13, 14, 15],
            ["裁剪尾", 16, 17, 18],
          ] });
          const shell1 = await call("set_cells", { sheet: "裁剪探针", startRow: 58, startCol: 9, values: [["__canary__"]] });
          const shell2 = await call("set_cells", { sheet: "裁剪探针", startRow: 2, startCol: 13, values: [["__canary__"]] });
          return { mk: mk.ok, put: put.ok, s1: shell1.ok, s2: shell2.ok };
        }`);
        if (!(w.mk && w.put && w.s1 && w.s2)) throw new Error(`裁剪探针表构造失败: ${JSON.stringify(w)}`);
        const r = await selectiveExport(page, "export_pdf", { sheets: ["裁剪探针"] });
        if (r.suggested !== "xlsx-export-裁剪探针.pdf") throw new Error(`文件名契约不符: ${r.suggested}`);
        const pages = assertPdfHead(r.bytes, "trim①", 1);
        if (pages !== 1) throw new Error(`尾部空区泄漏：产物 ${pages} 页（远端壳键进了 usedRange？应恰 1 页）`);
        assertPdfText(r.bytes, "trim①", { requireChinese: true, keywords: ["裁剪头A", "裁剪尾"], forbidden: ["__canary__"] });
        // G1 区域收敛：A1:Z99 → 按内容收敛为 A1:D7（7 行内容；文件名/返回值按收敛后区域）
        const r2 = await selectiveExport(page, "export_pdf", { items: [{ sheet: "裁剪探针", range: "A1:Z99" }] });
        if (r2.suggested !== "xlsx-export-裁剪探针-A1D7.pdf") throw new Error(`收敛文件名契约不符: ${r2.suggested}`);
        assertPdfText(r2.bytes, "区域收敛", { requireChinese: true, keywords: ["裁剪头A", "裁剪尾"] });
        const sel0 = r2.out.selected?.[0];
        if (sel0?.sheet !== "裁剪探针" || sel0?.range !== "A1:D7") throw new Error(`收敛 selected 不符: ${JSON.stringify(r2.out.selected)}`);
        console.log(`      反读证据：trim① 产物恰 ${pages} 页（59 行壳键未进 usedRange）· A1:Z99 收敛为 A1:D7（xlsx-export-裁剪探针-A1D7.pdf · selected=[{sheet,range:A1:D7}]）`);
      });
    });

    await check("xlsx G1/G2：items 三形态（名字/序号/区域）＋多单元＋序号 sheets＋互斥与非法入参矩阵", async () => {
      await withPage("xlsx", "?sample=1", async (page) => {
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("示例工作簿已载入"), { timeout: 90000 });
        // ① 整表（名字）
        const a = await selectiveExport(page, "export_pdf", { items: [{ sheet: "周营收" }] });
        if (a.suggested !== "xlsx-export-周营收.pdf") throw new Error(`items 名字形态文件名不符: ${a.suggested}`);
        assertPdfText(a.bytes, "items 名字", { requireChinese: true, keywords: ["入住间夜"], forbidden: ["房源价格表"] });
        if (a.out.selected?.[0]?.sheet !== "周营收") throw new Error(`items 名字 selected 不符: ${JSON.stringify(a.out.selected)}`);
        // ② 整表（1 起序号，与 pptx pages 一致）
        const b = await selectiveExport(page, "export_pdf", { items: [{ sheet: 2 }] });
        if (b.suggested !== "xlsx-export-周营收.pdf") throw new Error(`items 序号形态文件名不符: ${b.suggested}`);
        assertPdfText(b.bytes, "items 序号", { requireChinese: true, keywords: ["入住间夜"], forbidden: ["房源价格表"] });
        // ③ 表内区域（A1:F5：含表头与前 4 个数据日，不含合计行/备注列）
        const c = await selectiveExport(page, "export_pdf", { items: [{ sheet: "周营收", range: "A1:F5" }] });
        if (c.suggested !== "xlsx-export-周营收-A1F5.pdf") throw new Error(`items 区域文件名不符: ${c.suggested}`);
        assertPdfText(c.bytes, "items 区域", { requireChinese: true, keywords: ["入住间夜", "10-21 周三"], forbidden: ["备注", "本周合计", "房源价格表"] });
        if (c.out.selected?.[0]?.range !== "A1:F5") throw new Error(`items 区域 selected 不符: ${JSON.stringify(c.out.selected)}`);
        // ④ 多单元（整表＋区域混合，每单元一个章节、顺序按 items）
        const d = await selectiveExport(page, "export_pdf", { items: [{ sheet: 1 }, { sheet: "周营收", range: "A2:F4" }] });
        if (d.suggested !== "xlsx-export-房源价格表-周营收-A2F4.pdf") throw new Error(`多单元文件名不符: ${d.suggested}`);
        assertPdfText(d.bytes, "多单元", { requireChinese: true, keywords: ["房型", "10-21 周三"], forbidden: ["入住间夜", "本周合计", "10-24 周六"] });
        // ⑤ F8：自定义 filename 为主、tag 追加其上
        const e = await selectiveExport(page, "export_pdf", { filename: "周报附件", items: [{ sheet: "周营收", range: "A1:F5" }] });
        if (e.suggested !== "周报附件-周营收-A1F5.pdf") throw new Error(`filename×tag 优先级不符: ${e.suggested}`);
        // ⑥ 序号 sheets（兼容糖，v1 表名断言不缩水）
        const f = await selectiveExport(page, "export_pdf", { sheets: [2] });
        if (f.suggested !== "xlsx-export-周营收.pdf") throw new Error(`序号 sheets 文件名不符: ${f.suggested}`);
        if (f.out.selected?.[0] !== "周营收") throw new Error(`序号 sheets selected 不符（应为表名数组）: ${JSON.stringify(f.out.selected)}`);
        // ⑦ 非法入参矩阵（全部 resolve {ok:false,error} 不 reject）
        const bads = [
          [{ items: [{ sheet: "周营收" }], sheets: ["房源价格表"] }, "只能用一个"],
          [{ sheets: ["周营收", 1] }, "混用"],
          [{ sheets: [5] }, "越界"],
          [{ items: [{ range: "A1:F5" }] }, "缺 sheet"],
          [{ items: [{ sheet: "周营收", range: "hello" }] }, "非法区域"],
          [{ items: [{ sheet: "周营收", range: "Z50:AB60" }] }, "无交集"],
          [{ items: [{ sheet: "不存在的表" }] }, "可用表"],
        ];
        for (const [input, word] of bads) {
          const bad = await editorCall(page, `async (call) => call("export_pdf", ${JSON.stringify(input)})`);
          if (bad.ok !== false || !String(bad.error ?? "").includes(word)) {
            throw new Error(`非法入参未人话报错（期望含「${word}」）: ${JSON.stringify(bad)}`);
          }
        }
        console.log(`      反读证据：items 名字/序号/区域三形态文件名全对 · 多单元两章节 · filename×tag＝周报附件-周营收-A1F5.pdf · 序号 sheets selected=[周营收] · 7 项非法入参全 ok:false`);
      });
    });

    await check("xlsx G3②③：中间空行占位（bbox 行距几何证据）＋不规则右边界（绘制计划单源＋HTML 结构）", async () => {
      await withPage("xlsx", "?sample=1", async (page) => {
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("示例工作簿已载入"), { timeout: 90000 });
        // ② 空行探针：行 3 全空、行 4 有数据——空行占位则 R2→R4 行距 ≈ 2×R1→R2
        const w = await editorCall(page, `async (call) => {
          const mk = await call("add_sheet", { name: "空行探针" });
          const put = await call("set_cells", { sheet: "空行探针", values: [["HA", "HB"], ["R1", "v1"], ["R2", "v2"], [], ["R4", "v4"]] });
          return { mk: mk.ok, put: put.ok };
        }`);
        if (!(w.mk && w.put)) throw new Error(`空行探针表构造失败: ${JSON.stringify(w)}`);
        const r = await selectiveExport(page, "export_pdf", { sheets: ["空行探针"] });
        assertPdfText(r.bytes, "trim②", { keywords: ["R1", "R2", "R4"] });
        const words = pdfWordBoxes(r.bytes, "trim②");
        const yOf = (t) => {
          const hit = words.find((x) => x.text === t);
          if (!hit) throw new Error(`词框缺「${t}」`);
          return hit.yMin;
        };
        const gap12 = yOf("R2") - yOf("R1");
        const gap24 = yOf("R4") - yOf("R2");
        const ratio = gap24 / gap12;
        if (!(ratio > 1.55 && ratio < 2.45)) {
          throw new Error(`中间空行未占位：R2→R4 行距 / R1→R2 行距 = ${ratio.toFixed(2)}（空行保留应 ≈2.0，被跳过则 ≈1.0）`);
        }
        // ③ 边界探针（seam＝绘制计划单源，PDF/PNG 双路径共用）：A 列 10 行、B 列仅 5 行
        const seam = await page.evaluate(() => {
          const cellData = {};
          const put = (rr, cc, v) => { (cellData[rr] ??= {})[cc] = { v }; };
          put(0, 0, "HA"); put(0, 1, "HB");
          for (let rr = 1; rr <= 10; rr++) put(rr, 0, `甲${rr}`);
          for (let rr = 1; rr <= 5; rr++) put(rr, 1, `乙${rr}`);
          const plan = window.__officeTest.planSheetDrawProbe(cellData);
          const html = window.__officeTest.tablesHtmlProbe({ sheetOrder: ["s1"], sheets: { s1: { name: "边界探针", cellData } } }, "边界探针簿");
          const rows = [...html.matchAll(/<tr>(.*?)<\/tr>/g)].map((m) => (m[1].match(/<td/g) ?? []).length);
          return { plan, rows, htmlHasHeader: /<th>HA<\/th><th>HB<\/th>/.test(html) };
        });
        if (!seam.plan || seam.plan.rows.length !== 11) throw new Error(`绘制计划行数不符: ${JSON.stringify(seam.plan?.rows?.length)}（应 11＝表头+10 行，中间无空行）`);
        for (const row of seam.plan.rows.slice(6)) {
          if (row.maxC !== 0) throw new Error(`不规则右边界失守：行 ${row.r} maxC=${row.maxC}（应 0——B 列 6-10 行不画格线不渲染空格）`);
        }
        for (const row of seam.plan.rows.slice(1, 6)) {
          if (row.maxC !== 1) throw new Error(`右边界过收：行 ${row.r} maxC=${row.maxC}（应 1——B 列 1-5 行有内容）`);
        }
        // HTML（PNG 路径同源）：表头 2 列；有内容行 2 td；右边界行仅 1 td（无空格渲染）
        if (!seam.htmlHasHeader) throw new Error("PNG 路径表头结构缺失");
        if (seam.rows[0] !== 0) throw new Error(`thead 行 td 数不符: ${seam.rows[0]}`);
        for (let i = 1; i <= 5; i++) if (seam.rows[i] !== 2) throw new Error(`HTML 行 ${i} td 数不符: ${seam.rows[i]}（应 2）`);
        for (let i = 6; i <= 10; i++) if (seam.rows[i] !== 1) throw new Error(`HTML 行 ${i} td 数不符: ${seam.rows[i]}（应 1——不规则右边界不渲染空格）`);
        console.log(`      反读证据：trim② 行距比 ${ratio.toFixed(2)}（≈2＝空行占位在产）· trim③ 行 6-10 maxC=0（不画格线）· HTML 右边界行 1 td（不渲染空格）`);
      });
    });

    await check("xlsx G2 重名防御：外部重名 xlsx 导入 → 去重后缀＋warning＋两表数据各归其位", async () => {
      const b64 = buildDupNameXlsxBase64();
      await withPage("xlsx", "", async (page) => {
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("编辑器就绪"), { timeout: 90000 });
        const out = await editorCall(page, `async (call) => call("import_xlsx", { base64: "${b64}", filename: "重名探针.xlsx" })`);
        if (!out.ok) throw new Error(`import_xlsx 未成功: ${JSON.stringify(out)}`);
        if (JSON.stringify(out.sheetNames) !== JSON.stringify(["周报", "周报 (2)"])) {
          throw new Error(`表名去重不符: ${JSON.stringify(out.sheetNames)}（期望 ["周报","周报 (2)"]）`);
        }
        if (!String(out.warning ?? "").includes("周报 (2)")) throw new Error(`warning 未声明重命名: ${JSON.stringify(out.warning)}`);
        const snap = await editorCall(page, `async (call) => call("get_snapshot", {})`);
        const s1 = snap.sheets.find((x) => x.name === "周报");
        const s2 = snap.sheets.find((x) => x.name === "周报 (2)");
        if (!s1 || !s2) throw new Error(`重命名后两表未俱在: ${JSON.stringify(snap.sheets.map((x) => x.name))}`);
        if (s1.cellData[0]?.[0]?.v !== "探针甲" || s1.cellData[0]?.[1]?.v !== 111) throw new Error(`第一表数据塌缩: ${JSON.stringify(s1.cellData[0])}`);
        if (s2.cellData[0]?.[0]?.v !== "探针乙" || s2.cellData[0]?.[1]?.v !== 222) throw new Error(`第二表数据塌缩: ${JSON.stringify(s2.cellData[0])}`);
        console.log("      反读证据：SheetNames=[周报,周报 (2)] · warning 声明重命名 · 两表 A1=探针甲(111)/探针乙(222) 各归其位（SheetJS 重名塌缩已被 zip 手术修复）");
      });
    });


    await check("img-tool F23 颜色双重编码：裸 #rrggbb 与 URL 层 %23 两形态各喂一次，底衬色均正确落画布", async () => {
      await withPage("img-tool", "?src=sample", async (page) => {
        await page.waitForFunction(() => document.modelContext && document.modelContext.getTools().then((ts) => ts.some((t) => t.name === "overlay_text")), { timeout: 10000 });
        const countBg = async (bgValue) => {
          const r = await page.evaluate(async (bg) => {
            const ts = await document.modelContext.getTools();
            const tool = ts.find((t) => t.name === "overlay_text");
            const raw = await document.modelContext.executeTool(tool, { src: "sample", text: "色值探针", bg, pos: "center" });
            const out = typeof raw === "string" ? JSON.parse(raw) : raw;
            const canvas = document.getElementById("canvas-result");
            const ctx = canvas.getContext("2d");
            const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            let red = 0;
            for (let i = 0; i < d.length; i += 16) {
              if (d[i] > 250 && d[i + 1] < 30 && d[i + 2] < 30) red++;
            }
            return { ok: out.ok, red };
          }, bgValue);
          if (!r.ok) throw new Error(`overlay_text 未成功: ${JSON.stringify(r)}`);
          return r.red;
        };
        const bare = await countBg("#ff0000"); // 工具层解码形态（新文档语汇）
        const encoded = await countBg("%23ff0000"); // 旧文档/URL 层习惯形态（F23 兜底剥编码）
        if (bare < 1000) throw new Error(`裸 #ff0000 底衬未落画布（红像素 ${bare}）——bg 解析回归`);
        if (encoded < 1000) throw new Error(`%23ff0000 双重编码兜底失效（红像素 ${encoded}）——F23 修复面失守`);
        console.log(`      证据：#ff0000 → 红像素 ${bare} · %23ff0000 → 红像素 ${encoded}（两形态底衬均纯红落画布）`);
      });
    });

    await check("pptx filename 契约扩展（F5/F8）：export_pdf 自定义名×tag、export_png 前缀语义、export_pages_png 别名", async () => {
      await withPage("pptx", "?sample=1", async (page) => {
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("示例演示已载入"), { timeout: 120000 });
        // F8：自定义 filename 为主、选择 tag 追加其上（汇报-p2.pdf）
        const f8 = await selectiveExport(page, "export_pdf", { filename: "汇报", pages: [2] });
        if (f8.suggested !== "汇报-p2.pdf") throw new Error(`F8 filename×tag 不符: ${f8.suggested}`);
        if (f8.out.selected?.[0] !== 2) throw new Error(`F8 selected 不符: ${JSON.stringify(f8.out.selected)}`);
        // F5①：export_png filename＝前缀语义（foo-01.png/foo-02.png，序号＝原 deck 页码）
        const downloads = [];
        page.on("download", (d) => downloads.push(d));
        const f5 = await editorCall(page, `async (call) => call("export_png", { filename: "foo", pages: [1, 2] })`);
        for (let i = 0; i < 60 && downloads.length < 2; i++) await page.waitForTimeout(500);
        if (!f5.ok) throw new Error(`export_png 前缀导出未成功: ${JSON.stringify(f5)}`);
        const names = downloads.map((d) => d.suggestedFilename());
        if (!names.includes("foo-01.png") || !names.includes("foo-02.png")) {
          throw new Error(`F5 前缀文件名不符: ${names.join(",")}`);
        }
        // F5③：export_pages_png 别名工具（同 execute；缺省契约名不变）
        const aliasDls = [];
        page.on("download", (d) => aliasDls.push(d));
        const alias = await editorCall(page, `async (call) => call("export_pages_png", {})`);
        for (let i = 0; i < 80 && aliasDls.length < 3; i++) await page.waitForTimeout(500);
        if (!alias.ok) throw new Error(`export_pages_png 未成功: ${JSON.stringify(alias)}`);
        const aliasNames = aliasDls.map((d) => d.suggestedFilename());
        for (const must of ["pptx-page-01.png", "pptx-page-02.png", "pptx-page-03.png"]) {
          if (!aliasNames.includes(must)) throw new Error(`别名工具缺省文件名不符: ${aliasNames.join(",")}`);
        }
        // F4：items 页单元 / pages 别名 / 互斥
        const dlPromise = page.waitForEvent("download", { timeout: 90000 });
        const viaItems = await editorCall(page, `async (call) => call("export_pdf", { items: [{ page: 2 }] })`);
        const d2 = await dlPromise;
        if (!viaItems.ok) throw new Error(`items 页单元未成功: ${JSON.stringify(viaItems)}`);
        if (d2.suggestedFilename() !== "pptx-export-p2.pdf") throw new Error(`items 页单元文件名不符: ${d2.suggestedFilename()}`);
        if (viaItems.selected?.[0] !== 2) throw new Error(`items 页单元 selected 不符: ${JSON.stringify(viaItems.selected)}`);
        const conflict = await editorCall(page, `async (call) => call("export_pdf", { items: [{ page: 2 }], pages: [3] })`);
        if (conflict.ok !== false || !String(conflict.error ?? "").includes("只能用一个")) {
          throw new Error(`items×pages 未互斥报错: ${JSON.stringify(conflict)}`);
        }
        console.log(`      证据：汇报-p2.pdf（F8）· foo-01/foo-02.png（F5 前缀）· 别名工具缺省 pptx-page-0N.png · items=[{page:2}]≡pages=[2] · 互斥报错`);
      });
    });

    // 未就绪显式拒绝门（对抗审查回单：spec「未就绪 ok:false」SHALL 钉死）——
    // xlsx：Rendered 门禁 forcePending 挂起→export_pdf 必须 resolve {ok:false,人话可重试}
    // （forcePending 测试缝确定性复现，与 univer-write-gate 回归同款）；
    // pptx：CDP 限速把岛 chunk 拖慢→内核未就绪早调用 export_pdf 必须 resolve
    // {ok:false} 而非 reject（P1 修复回归：异常通道已全部转返回值形态）
    await check("编辑器展示级导出未就绪门：xlsx forcePending→ok:false＋pptx 限速早调用→resolve {ok:false} 不 reject", async () => {
      await withPage("xlsx", "", async (page) => {
        await page.waitForFunction(() => !!document.getElementById("status")?.textContent, { timeout: 30000 });
        await page.waitForFunction(() => !!window.__officeTest, { timeout: 30000 });
        const out = await page.evaluate(async () => {
          window.__officeTest.forcePending(true);
          try {
            const ts = await document.modelContext.getTools();
            const tool = ts.find((t) => t.name === "export_pdf");
            if (!tool) return { ok: false, error: "工具未注册: export_pdf" };
            const raw = await document.modelContext.executeTool(tool, {});
            return JSON.parse(raw);
          } finally {
            window.__officeTest.forcePending(false);
          }
        });
        if (out.ok !== false) throw new Error(`门禁挂起时 export_pdf 未显式拒绝（ok=${out.ok}）`);
        if (!/渲染|就绪|加载/.test(String(out.error ?? ""))) throw new Error(`拒绝文案非人话可重试: ${out.error}`);
        console.log(`      证据：forcePending 挂起 → resolve {ok:false, "${String(out.error).slice(0, 40)}…"}（execute 未 reject）`);
      });
      // pptx：CDP 限速 50KB/s（domcontentloaded 后即开——岛 chunk ≈1.66MB 拖到
      // 30s+，主包与工具注册不受影响）→ 内核未就绪窗口早调用 export_pdf，
      // 钉死「resolve {ok:false} 不 reject」契约（P1 修复回归）
      {
        const page = await browser.newPage();
        const server = servers["pptx"].server;
        try {
          await page.goto(base("pptx") + "/", { waitUntil: "domcontentloaded" });
          const cdp = await page.context().newCDPSession(page);
          await cdp.send("Network.enable");
          await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 400, downloadThroughput: 50 * 1024, uploadThroughput: 50 * 1024 });
          await page.waitForFunction(() => !!document.modelContext, { timeout: 30000, polling: 500 });
          const out = await page.evaluate(async () => {
            for (let i = 0; i < 16; i++) {
              const ts = await document.modelContext.getTools();
              const tool = ts.find((t) => t.name === "export_pdf");
              if (tool) {
                // 原生 executeTool 返回 DOMString（spec 形态）；polyfill 裸 object——
                // 双形态归一后断言（B2 偏差纪律）
                const raw = await document.modelContext.executeTool(tool, {});
                const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
                return { parsed, rawType: typeof raw };
              }
              await new Promise((r) => setTimeout(r, 2500));
            }
            return { parsed: { ok: false, error: "工具未注册: export_pdf" }, rawType: "object" };
          });
          if (!["string", "object"].includes(out.rawType)) throw new Error(`execute 返回形态异常: ${out.rawType}`);
          if (out.parsed.ok !== false) throw new Error(`未就绪窗口 export_pdf 应 ok:false，实为 ${JSON.stringify(out.parsed).slice(0, 80)}`);
          if (!/就绪|加载|渲染/.test(String(out.parsed.error ?? ""))) throw new Error(`拒绝文案非人话可重试: ${out.parsed.error}`);
          console.log(`      证据：岛加载限速窗口早调用 → resolve {ok:false, "${String(out.parsed.error).slice(0, 40)}…"}（execute 未 reject——P1 修复回归）`);
        } finally {
          await page.close();
        }
      }
    });

    // ---------- img-tool ----------
    await check("directory：registry 渲染 + 纯前端搜索（editor 二期加入后 11 卡全现役、0 建设中占位）", async () => {
      await withPage("directory", "", async (page) => {
        await page.waitForFunction(() => document.querySelectorAll('[data-slot="card"]').length >= 11, { timeout: 30000 });
        const total = await page.evaluate(() => document.querySelectorAll('[data-slot="card"]').length);
        if (total !== 11) throw new Error(`卡片数不符: ${total}（期望 11＝11 现役 + 0 建设中占位）`);
        const comingSoon = await page.evaluate(() => document.querySelectorAll('[data-testid="coming-soon-badge"]').length);
        if (comingSoon !== 0) throw new Error(`建设中 Badge 数不符: ${comingSoon}（期望 0——编辑器三站已转现役）`);
        // 「图片」命中 img-tool + pptx 编辑器（特性描述含「图片表格图表」，2026-10-31 起）
        await page.fill('input[aria-label="搜索工具"]', "图片");
        await page.waitForFunction(() => document.querySelectorAll('[data-slot="card"]').length === 2, { timeout: 30000 });
        const count = await page.textContent("main, body");
        if (!count.includes("2 / 11")) throw new Error("搜索计数未显示 2 / 11");
        await page.fill('input[aria-label="搜索工具"]', "表格生成");
        await page.waitForFunction(() => document.querySelectorAll('[data-slot="card"]').length === 1, { timeout: 30000 });
        // 编辑器三站转现役：主域名卡带完整 WebMCP 面投影（抽查 xlsx 卡）
        await page.fill('input[aria-label="搜索工具"]', "univer");
        await page.waitForFunction(() => document.querySelectorAll('[data-slot="card"]').length === 1, { timeout: 30000 });
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

    // ---------- directory ----------
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
