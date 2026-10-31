/*
 * 参数契约冒烟 —— scripts/smoke-check.mjs
 *
 * 验收（openspec change project-bootstrap / legacy-tools-parity +
 * office-suite / real-file-assertion 能力）：
 * 对工具与黄页抽测 URL 参数契约——状态行文案逐字符断言、渲染产物
 * （画布尺寸/结果 URL/解码表）逐值断言。视觉允许升级，行为不允许漂移。
 * 办公三站（xlsx/docx/pptx）加**真文件反读断言**（硬要求）：headless 里真实
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
// 真文件反读：xlsx 用 SheetJS 社区版（根 devDeps，与页面同库但走 Node 侧独立
// 路径反读）；docx/pptx 用 adm-zip 解 zip（MIT）核对 OOXML 关键内容
const XLSXMOD = await import("xlsx");
const XLSX = XLSXMOD.default ?? XLSXMOD;
const AdmZip = (await import("adm-zip")).default;

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
  for (const app of ["pdf-tool", "img-tool", "url-tool", "directory", "xlsx", "docx", "pptx"]) {
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
      await withPage("xlsx", "?sample=1", async (page) => {
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
      await withPage("xlsx", "", async (page) => {
        await page.click("#generate-xlsx-btn");
        const s = await statusText(page);
        const want = "输入为空：请先粘贴 JSON、粘贴表格，或点「载入示例」。";
        if (s !== want) throw new Error(`状态行不符: got ${s}`);
      });
    });

    await check("xlsx JSON 生成真文件：SheetJS 反读核对单元格（含负数/小数/布尔/多表）", async () => {
      await withPage("xlsx", "?sample=1", async (page) => {
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("示例工作簿已载入"), { timeout: 10000 });
        const { suggested, bytes } = await generateAndCapture(page, "generate-xlsx-btn");
        if (suggested !== "xlsx-export.xlsx") throw new Error(`下载文件名不符: ${suggested}`);
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("已生成 xlsx-export.xlsx"), { timeout: 15000 });
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
      await withPage("xlsx", "", async (page) => {
        await page.fill("#input-tsv", "## 表A\n名字\t数值\n甲\t3.5\n## 表B\n乙\t-2");
        const { suggested, bytes } = await generateAndCapture(page, "generate-xlsx-btn");
        if (suggested !== "xlsx-export.xlsx") throw new Error(`下载文件名不符: ${suggested}`);
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
      await withPage("xlsx", "", async (page) => {
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
        if (download.suggestedFilename() !== "xlsx-export.xlsx") {
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
      await withPage("docx", "?sample=1", async (page) => {
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("示例文档已载入"), { timeout: 10000 });
        const v = await page.inputValue("#input-md");
        if (!v.includes("FDE2E 季度运营报告")) throw new Error("示例文档未载入");
        const previewText = await page.textContent("#preview");
        if (!previewText.includes("续约率")) throw new Error("预览未渲染文档结构");
      });
    });

    await check("docx 空输入点生成：错误文案保真", async () => {
      await withPage("docx", "", async (page) => {
        await page.click("#generate-docx-btn");
        const s = await statusText(page);
        const want = "输入为空：请先输入 Markdown、或点「载入示例」。";
        if (s !== want) throw new Error(`状态行不符: got ${s}`);
      });
    });

    await check("docx 生成真文件：解 zip 核对 document.xml（标题/粗斜标记/表格/命名空间）", async () => {
      await withPage("docx", "?sample=1", async (page) => {
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("示例文档已载入"), { timeout: 10000 });
        const { suggested, bytes } = await generateAndCapture(page, "generate-docx-btn");
        if (suggested !== "docx-export.docx") throw new Error(`下载文件名不符: ${suggested}`);
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("已生成 docx-export.docx"), { timeout: 15000 });
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
      await withPage("docx", "?sample=1", async (page) => {
        await page.setViewportSize({ width: 1280, height: 640 }); // 小视口复现折叠线场景
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("示例文档已载入"), { timeout: 10000 });
        const dlPromise = page.waitForEvent("download", { timeout: 30000 });
        await page.click("#generate-docx-btn");
        const download = await dlPromise;
        if (download.suggestedFilename() !== "docx-export.docx") {
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
      await withPage("pptx", "?sample=1", async (page) => {
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("示例幻灯已载入"), { timeout: 10000 });
        const v = await page.inputValue("#input-json");
        if (!v.includes("FDE2E 办公三件套")) throw new Error("示例幻灯未载入");
        const previewText = await page.textContent("#preview");
        if (!previewText.includes("开场页")) throw new Error("预览未渲染页面大纲");
      });
    });

    await check("pptx 空输入点生成：错误文案保真", async () => {
      await withPage("pptx", "", async (page) => {
        await page.click("#generate-pptx-btn");
        const s = await statusText(page);
        const want = "输入为空：请先粘贴 slides JSON、或点「载入示例」。";
        if (s !== want) throw new Error(`状态行不符: got ${s}`);
      });
    });

    await check("pptx 生成真文件：解 zip 核对 slide1.xml/notesSlide（标题/bullets/备注）", async () => {
      await withPage("pptx", "?sample=1", async (page) => {
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("示例幻灯已载入"), { timeout: 10000 });
        const { suggested, bytes } = await generateAndCapture(page, "generate-pptx-btn");
        if (suggested !== "pptx-export.pptx") throw new Error(`下载文件名不符: ${suggested}`);
        await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("已生成 pptx-export.pptx"), { timeout: 15000 });
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

    // ---------- directory ----------
    await check("directory：registry 渲染 + 纯前端搜索（含办公三站+文件预览共 7 卡）", async () => {
      await withPage("directory", "", async (page) => {
        await page.waitForFunction(() => document.querySelectorAll('[data-slot="card"]').length >= 7, { timeout: 10000 });
        const total = await page.evaluate(() => document.querySelectorAll('[data-slot="card"]').length);
        if (total !== 6) throw new Error(`卡片数不符: ${total}（期望 7）`);
        await page.fill('input[aria-label="搜索工具"]', "图片");
        await page.waitForFunction(() => document.querySelectorAll('[data-slot="card"]').length === 1, { timeout: 5000 });
        const count = await page.textContent("main, body");
        if (!count.includes("1 / 7")) throw new Error("搜索计数未显示 1 / 7");
        await page.fill('input[aria-label="搜索工具"]', "xlsx");
        await page.waitForFunction(() => document.querySelectorAll('[data-slot="card"]').length === 1, { timeout: 5000 });
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
