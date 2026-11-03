#!/usr/bin/env node
/**
 * TTS 站浏览器 E2E 冒烟（tasks 5.1②；audio-smoke 系）
 *
 * dist 静态服务＋/models mirror（downloader 形态）＋页面链路真合成
 * （input-text→generate-btn→status「已合成」）→player.src wav 拉回断言
 * （RIFF 头/字节长/非静音比例）。
 *
 * 用法：node scripts/audio-tts-smoke.mjs
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(ROOT, "apps/audio-tts/dist");
const CACHE = join(ROOT, ".models-cache");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json", ".wav": "audio/wav", ".mjs": "text/javascript", ".txt": "text/plain" };

if (!existsSync(DIST)) { console.error("✗ dist 不存在（先 pnpm --filter audio-stt build）"); process.exit(1); }

const server = createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (process.env.SMOKE_VERBOSE && url.includes("/model/")) console.log("[req]", url);
  // /model/<upstreamId>/resolve/main/<file> → .models-cache/<root>/<file>
  const m = url.match(/^\/model\/([^/]+)\/([^/]+)\/resolve\/main\/(.+)$/);
  void m;
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
if (!tools.includes("create_speech")) { console.error("✗ create_speech 未注册"); process.exit(1); }

// 页面链路：点击后 node 侧轮询 status（evaluate 内长循环不冒泡日志）
await page.evaluate(() => {
  const input = document.getElementById("input-text");
  input.value = "你好，本地语音合成测试。";
  document.getElementById("generate-btn").click();
});
let statusText = "";
for (let i = 0; i < 900; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  statusText = await page.evaluate(() => document.getElementById("status")?.textContent ?? "");
  if (i % 10 === 0) console.log("[smoke]", i, statusText);
  if (/已合成|失败/.test(statusText)) break;
}
console.log("[smoke out]", JSON.stringify({ statusText }).slice(0, 300));
if (!statusText.includes("已合成")) {
  console.error("✗ TTS 冒烟不过（页面链路）");
  await browser.close(); server.close();
  process.exit(1);
}
// wav 产物断言：从 player.src 拉回
const wavInfo = await page.evaluate(async () => {
  const p = document.getElementById("audio-player");
  const src = p instanceof HTMLAudioElement ? p.src : "";
  if (!src) return null;
  const buf = await (await fetch(src)).arrayBuffer();
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  // RIFF 头＋data 长度＋非静音比例（16bit PCM 视角）
  const riff = String.fromCharCode(...u8.slice(0, 4));
  const dataLen = dv.getUint32(40, true);
  let nonSilent = 0, total = (u8.length - 44) / 2;
  for (let i = 44; i + 1 < u8.length; i += 2) {
    const v = dv.getInt16(i, true);
    if (Math.abs(v) > 300) nonSilent++;
  }
  return { riff, bytes: u8.length, dataLen, nonSilentRatio: total ? nonSilent / total : 0 };
});
console.log("wav:", JSON.stringify(wavInfo));
const ok = !!wavInfo && wavInfo.riff === "RIFF" && wavInfo.dataLen > 16000 && wavInfo.nonSilentRatio > 0.3;
console.log(ok ? `★ TTS 冒烟过：RIFF 头对、${(wavInfo.bytes/1024).toFixed(0)}KB、非静音 ${(wavInfo.nonSilentRatio*100).toFixed(0)}%` : "✗ TTS 冒烟不过");
await browser.close();
server.close();
process.exit(ok ? 0 : 1);
