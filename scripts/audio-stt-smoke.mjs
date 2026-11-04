#!/usr/bin/env node
/**
 * STT 站浏览器 E2E 冒烟（tasks 7.1 绿门的 audio 部分前置；POC ③ mirror 语义验证）
 *
 * dist 静态服务＋/.models-cache mirror（/model/<upstreamId>/resolve/main/ 形态＝
 * 自托管 mirror 的本地形态）＋ sensevoice zh.wav → transcribe_audio 工具真转写
 * → TranscriptDoc 断言（segments 非空、文本含关键词、ok:true）。
 *
 * 用法：node scripts/audio-stt-smoke.mjs
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(ROOT, "apps/audio-stt/dist");
const CACHE = join(ROOT, ".models-cache");
const SAMPLE = join(CACHE, "sense-voice-int8-2024-07-17/test_wavs/zh.wav");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json", ".wav": "audio/wav", ".mjs": "text/javascript", ".txt": "text/plain" };

if (!existsSync(DIST)) { console.error("✗ dist 不存在（先 pnpm --filter audio-stt build）"); process.exit(1); }
if (!existsSync(SAMPLE)) { console.error("✗ 样例 wav 不在场（跑 deploy/models-fetch.sh fetch）"); process.exit(1); }

const server = createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (process.env.SMOKE_VERBOSE && url.includes("/model/")) console.log("[req]", url);
  if (url === "/sample.wav") { res.writeHead(200, { "content-type": MIME[".wav"] }); res.end(readFileSync(SAMPLE)); return; }
  // /model/<upstreamId>/resolve/main/<file> → .models-cache/<root>/<file>
  const m = url.match(/^\/model\/([^/]+)\/([^/]+)\/resolve\/main\/(.+)$/);
  if (m) {
    const [, owner, repo, file] = m;
    const upstream = `${owner}/${repo}`;
    const model = { "onnx-community/whisper-base": "whisper-base-q8" }[upstream];
    if (model) {
      const p = normalize(join(CACHE, model, file));
      if (p.startsWith(CACHE) && existsSync(p) && statSync(p).isFile()) {
        res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream" });
        res.end(readFileSync(p));
        return;
      }
    }
  }
  const p = normalize(join(DIST, url === "/" ? "index.html" : url));
  // downloader 自托管路由：/models/<root>/<path>（engine urlTemplate 形态）
  const dm = url.match(/^\/models\/([^/]+)\/(.+)$/);
  if (dm) {
    const p2 = normalize(join(CACHE, dm[1], dm[2]));
    if (p2.startsWith(CACHE) && existsSync(p2) && statSync(p2).isFile()) {
      res.writeHead(200, { "content-type": MIME[extname(p2)] ?? "application/octet-stream" });
      res.end(readFileSync(p2));
      return;
    }
  }
  if (!p.startsWith(DIST) || !existsSync(p) || !statSync(p).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream" });
  res.end(readFileSync(p));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
console.log("serving:", base);

const chrome = [
  process.env.WEBMCP_CHECK_CHROME,
  join(process.env.HOME ?? "", "Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
  join(process.env.HOME ?? "", "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
].filter((p) => p && existsSync(p))[0];
if (!chrome) { console.error("✗ 找不到本机 Chromium"); process.exit(1); }
const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ["--enable-blink-features=WebMCP", "--no-sandbox"] });
const page = await browser.newPage();
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning" || process.env.SMOKE_VERBOSE) console.log("[page]", m.type(), m.text().slice(0, 200)); });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 240)));

await page.goto(base + "/", { waitUntil: "load" });
await page.waitForFunction(() => !!document.modelContext, undefined, { timeout: 30000 }).catch(() => null);
const tools = await page.evaluate(async () => (document.modelContext ? (await document.modelContext.getTools()).map((t) => t.name) : []));
console.log("tools:", tools.join(","));
if (!tools.includes("transcribe_audio")) { console.error("✗ transcribe_audio 未注册"); process.exit(1); }

// 直接页面链路：fetch sample→input-file→transcribe-btn→status 轮询（比 executeTool
// 谓词多日志可见性——headless 静默挂起时能看到卡在哪一步）
const out = await page.evaluate(async ({ sampleUrl }) => {
  const log = [];
  try {
    const resp = await fetch(sampleUrl);
    const blob = await resp.blob();
    const file = new File([blob], "zh.wav", { type: "audio/wav" });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.getElementById("input-file");
    input.files = dt.files;
    document.getElementById("transcribe-btn").click();
    for (let i = 0; i < 600; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const st = document.getElementById("status")?.textContent ?? "";
      const prog = document.querySelector('[role="status"] .text-xs')?.textContent ?? "";
      if (i % 5 === 0) console.log("[smoke]", i, st, "|", prog);
      if (/已转写|失败/.test(st)) return { statusText: st };
    }
    return { statusText: document.getElementById("status")?.textContent ?? "timeout", timeout: true };
  } catch (e) {
    return { error: String(e) };
  }
}, { sampleUrl: `${base}/sample.wav` });
console.log("[smoke out]", JSON.stringify(out).slice(0, 300));
if (!out?.statusText?.includes("已转写")) {
  console.error("✗ STT 冒烟不过（页面链路）");
  await browser.close(); server.close();
  process.exit(1);
}
const docJson = await page.evaluate(() => (window).__sttDoc ?? null);
console.log("doc:", JSON.stringify(docJson).slice(0, 400));
const text = (docJson?.segments ?? []).map((s) => s.text).join("");
const segs = (docJson?.segments ?? []).length;
const pageOk = segs > 0 && /开放|開放|开饭|开饭|时间|時間|9点|9點|5点|5點/.test(text);
console.log(pageOk ? `★ STT 页面冒烟过：${segs} 段，文本「${text.slice(0, 40)}…」` : "✗ STT 页面冒烟不过");

// WebMCP 真推理回归：先把受控 Select 切到另一档，再由工具参数切回 Whisper；
// 同页第二轮还覆盖 baseline 纪律（上一轮「已转写」不得被秒读为本轮结果）。
const switchedBefore = await page.evaluate(async () => {
  if (typeof window.__audioSttSetModel !== "function") return { ok: false, text: "" };
  window.__audioSttSetModel("sensevoice-small-int8");
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const text = document.getElementById("model-select")?.textContent ?? "";
  return { ok: text.includes("sensevoice-small-int8"), text };
});
const webmcpOut = await page.evaluate(async ({ sampleUrl }) => {
  const mc = document.modelContext;
  const tool = (await mc.getTools()).find((t) => t.name === "transcribe_audio");
  if (!tool) return { ok: false, error: "transcribe_audio 未注册" };
  const raw = await mc.executeTool(tool, { fileUrl: sampleUrl, model: "whisper-base-q8" });
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}, { sampleUrl: `${base}/sample.wav` });
const modelText = await page.evaluate(() => document.getElementById("model-select")?.textContent ?? "");
const webDoc = webmcpOut?.doc ?? {};
const webText = (webDoc.segments ?? []).map((s) => s.text).join("");
const webmcpOk = switchedBefore.ok
  && webmcpOut?.ok === true
  && webmcpOut?.segmentCount > 0
  && webDoc.model === "whisper-base-q8"
  && modelText.includes("whisper-base-q8")
  && /开放|開放|开饭|时间|時間|9点|9點|5点|5點/.test(webText);
console.log(webmcpOk
  ? `★ STT WebMCP 冒烟过：模型状态实生效，${webmcpOut.segmentCount} 段，message=${webmcpOut.message}`
  : `✗ STT WebMCP 冒烟不过：${JSON.stringify({ switchedBefore, modelText, webmcpOut }).slice(0, 900)}`);

const ok = pageOk && webmcpOk;
await browser.close();
server.close();
process.exit(ok ? 0 : 1);

console.log(JSON.stringify(out, null, 2).slice(0, 900));
const doc = out.doc ?? {};
server.close();
process.exit(ok ? 0 : 1);
