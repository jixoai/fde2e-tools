/*
 * 幽灵工作簿形态矩阵 probe —— scripts/ghost-matrix-probe.mjs（office-editorial-upgrade）
 *
 * 用途：对 apps/xlsx 构建产物做 Univer「幽灵工作簿」形态矩阵实测——哪些 seed
 * 形态创建的工作簿会静默拒绝一切写入（写入不落快照），哪些不中招。为
 * univer-write-gate 规格的 canary 防御提供边界证据（2026-10-31 首测结论：
 * sheets 数组形态与 sheet 缺 id 即中招；Record 带 id 无 sheetOrder/sheetOrder
 * 缺项不中招——Univer 自合成 sheetOrder）。
 *
 * 前提：pnpm --filter xlsx build（需 dist 产物，页面经 __officeTest.rawApi 测试缝）。
 * 用法：node scripts/ghost-matrix-probe.mjs
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(ROOT, "apps", "xlsx", "dist");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json" };

function serveDir(dir) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
        const filePath = join(dir, p === "/" ? "index.html" : p);
        const body = await readFile(filePath);
        res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end("nf");
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

const server = await serveDir(DIST);
const exe = findChrome();
if (!exe) {
  console.error("✗ 找不到本机 Chromium——设 WEBMCP_CHECK_CHROME 指定路径");
  process.exit(1);
}
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message.slice(0, 150)));
await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "load" });
await page.waitForFunction(() => (document.getElementById("status")?.textContent ?? "").includes("编辑器就绪"), null, { timeout: 90000 });

const r = await page.evaluate(async () => {
  const api = window.__officeTest.rawApi();
  const out = {};
  const probe = (label, seed) => {
    try {
      const wb = api.createWorkbook(seed);
      const sh = wb.getActiveSheet();
      sh.getRange(30, 5).setValue("M-" + label);
      const snapStr = JSON.stringify(wb.save());
      out[label] = {
        created: true,
        writeLanded: snapStr.includes("M-" + label), // false＝幽灵（写入被静默拒绝）
        sheetKeys: Object.keys(wb.save().sheets ?? {}),
      };
    } catch (e) {
      out[label] = { created: false, error: String(e).slice(0, 120) };
    }
  };

  // A: 数组形态（sheet 无 id）——已知中招
  probe("A-array", { sheets: [{ name: "GA", rowCount: 100, columnCount: 20, cellData: { 0: { 0: { v: "x" } } } }] });
  // B: 数组形态且无 rowCount/columnCount——已知中招
  probe("B-array-slim", { sheets: [{ name: "GB", cellData: { 0: { 0: { v: "x" } } } }] });
  // C: Record 形态但 sheet 无 id、无 sheetOrder——已知中招
  probe("C-record-noid", { sheets: { s9: { name: "GC", rowCount: 100, columnCount: 20, cellData: { 0: { 0: { v: "x" } } } } } });
  // D: Record 带 id 但无 sheetOrder——已知不中招（Univer 自合成 sheetOrder）
  probe("D-record-noorder", { sheets: { s10: { id: "s10", name: "GD", rowCount: 100, columnCount: 20, cellData: { 0: { 0: { v: "x" } } } } } });
  // E: sheetOrder 与 sheets 不一致——已知不中招
  probe("E-order-empty", { sheets: { s11: { id: "s11", name: "GE", rowCount: 100, columnCount: 20, cellData: { 0: { 0: { v: "x" } } } } }, sheetOrder: [] });
  return out;
});

console.log(JSON.stringify(r, null, 1));
const ghostShapes = Object.entries(r).filter(([, v]) => v.created && v.writeLanded === false).map(([k]) => k);
console.log(`\n=== 幽灵形态（写入不落盘）：${ghostShapes.join(", ") || "无"} ===`);
await browser.close();
server.close();
